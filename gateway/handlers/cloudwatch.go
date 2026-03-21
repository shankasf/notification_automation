package handlers

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/cloudwatch"
	cwtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

var (
	cwClient  *cloudwatch.Client
	cwOnce    sync.Once
	cwInitErr error
)

// initCloudWatch creates the CloudWatch client using the same credential
// pattern as initSNS() and initSQS(). Safe to call multiple times.
func initCloudWatch() {
	cwOnce.Do(func() {
		region := os.Getenv("AWS_REGION")
		accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
		secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")

		if accessKey == "" || secretKey == "" {
			cwInitErr = fmt.Errorf("AWS credentials not configured")
			slog.Warn("cw_init_skip", "reason", "missing AWS credentials")
			return
		}
		if region == "" {
			region = "us-east-1"
		}

		cfg, err := awsconfig.LoadDefaultConfig(context.Background(),
			awsconfig.WithRegion(region),
			awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
		)
		if err != nil {
			cwInitErr = err
			slog.Error("cw_config_error", "error", err)
			return
		}
		cwClient = cloudwatch.NewFromConfig(cfg)
		slog.Info("cloudwatch_initialized")
	})
}

// PublishMetric publishes a single custom metric to CloudWatch.
// This is non-blocking in the sense that failures are logged and swallowed —
// the caller is never blocked by a CloudWatch outage.
func PublishMetric(namespace, metricName string, value float64, unit cwtypes.StandardUnit, dimensions []cwtypes.Dimension) {
	initCloudWatch()
	if cwInitErr != nil || cwClient == nil {
		slog.Debug("cw_publish_skip", "reason", "not initialized", "metric", metricName)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := cwClient.PutMetricData(ctx, &cloudwatch.PutMetricDataInput{
		Namespace: aws.String(namespace),
		MetricData: []cwtypes.MetricDatum{
			{
				MetricName: aws.String(metricName),
				Value:      aws.Float64(value),
				Unit:       unit,
				Timestamp:  aws.Time(time.Now()),
				Dimensions: dimensions,
			},
		},
	})
	if err != nil {
		slog.Error("cw_publish_error", "error", err, "namespace", namespace, "metric", metricName)
	}
}

// PublishSQSProcessingMetric is a convenience wrapper that publishes SQS
// consumer processing metrics (duration + success/failure count).
func PublishSQSProcessingMetric(queueName, messageType string, durationMs float64, success bool) {
	dims := []cwtypes.Dimension{
		{Name: aws.String("QueueName"), Value: aws.String(queueName)},
		{Name: aws.String("MessageType"), Value: aws.String(messageType)},
	}

	PublishMetric("MetaSource/SQS", "ProcessingDuration", durationMs, cwtypes.StandardUnitMilliseconds, dims)

	statusMetric := "ProcessingSuccess"
	if !success {
		statusMetric = "ProcessingFailure"
	}
	PublishMetric("MetaSource/SQS", statusMetric, 1, cwtypes.StandardUnitCount, dims)
}

// CreateAlarms idempotently creates CloudWatch alarms for DLQ monitoring
// and queue backlog detection. All alarms send notifications to the existing
// SNS topic (topicARN from sns.go).
func CreateAlarms() {
	initCloudWatch()
	if cwInitErr != nil || cwClient == nil {
		slog.Warn("cw_alarms_skip", "reason", "CloudWatch not initialized")
		return
	}

	// Ensure SNS topic is available for alarm actions
	initSNS()
	if snsInitErr != nil || topicARN == "" {
		slog.Warn("cw_alarms_skip", "reason", "SNS topic not available for alarm actions")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	alarmActions := []string{topicARN}

	// DLQ alarms — trigger when any DLQ has messages sitting in it
	dlqAlarms := []struct {
		name      string
		queueName string
	}{
		{"metasource-analysis-dlq-not-empty", "metasource-analysis-dlq.fifo"},
		{"metasource-email-dlq-not-empty", "metasource-email-dlq"},
		{"metasource-sns-publish-dlq-not-empty", "metasource-sns-publish-dlq"},
	}

	for _, a := range dlqAlarms {
		_, err := cwClient.PutMetricAlarm(ctx, &cloudwatch.PutMetricAlarmInput{
			AlarmName:          aws.String(a.name),
			AlarmDescription:   aws.String(fmt.Sprintf("Alarm: %s has messages — failed messages need investigation", a.queueName)),
			Namespace:          aws.String("AWS/SQS"),
			MetricName:         aws.String("ApproximateNumberOfMessagesVisible"),
			Statistic:          cwtypes.StatisticSum,
			Period:             aws.Int32(300), // 5 minutes
			EvaluationPeriods:  aws.Int32(1),
			Threshold:          aws.Float64(1),
			ComparisonOperator: cwtypes.ComparisonOperatorGreaterThanOrEqualToThreshold,
			TreatMissingData:   aws.String("notBreaching"),
			Dimensions: []cwtypes.Dimension{
				{Name: aws.String("QueueName"), Value: aws.String(a.queueName)},
			},
			AlarmActions: alarmActions,
			OKActions:    alarmActions,
		})
		if err != nil {
			slog.Error("cw_create_alarm_error", "alarm", a.name, "error", err)
		} else {
			slog.Info("cw_alarm_created", "alarm", a.name)
		}
	}

	// Queue backlog alarm — triggers when any main queue has >100 messages for 5 minutes
	backlogQueues := []struct {
		name      string
		queueName string
	}{
		{"metasource-analysis-backlog", "metasource-analysis.fifo"},
		{"metasource-email-backlog", "metasource-email"},
		{"metasource-sns-publish-backlog", "metasource-sns-publish"},
	}

	for _, q := range backlogQueues {
		alarmName := fmt.Sprintf("metasource-queue-backlog-%s", q.queueName)
		_, err := cwClient.PutMetricAlarm(ctx, &cloudwatch.PutMetricAlarmInput{
			AlarmName:          aws.String(alarmName),
			AlarmDescription:   aws.String(fmt.Sprintf("Alarm: %s has >100 messages for 5+ minutes — consumers may be stuck", q.queueName)),
			Namespace:          aws.String("AWS/SQS"),
			MetricName:         aws.String("ApproximateNumberOfMessagesVisible"),
			Statistic:          cwtypes.StatisticSum,
			Period:             aws.Int32(300), // 5 minutes
			EvaluationPeriods:  aws.Int32(1),
			Threshold:          aws.Float64(100),
			ComparisonOperator: cwtypes.ComparisonOperatorGreaterThanOrEqualToThreshold,
			TreatMissingData:   aws.String("notBreaching"),
			Dimensions: []cwtypes.Dimension{
				{Name: aws.String("QueueName"), Value: aws.String(q.queueName)},
			},
			AlarmActions: alarmActions,
			OKActions:    alarmActions,
		})
		if err != nil {
			slog.Error("cw_create_alarm_error", "alarm", alarmName, "error", err)
		} else {
			slog.Info("cw_alarm_created", "alarm", alarmName)
		}
	}

	slog.Info("cw_alarms_setup_complete")
}

// GetQueueDepths returns the ApproximateNumberOfMessagesVisible for all 6
// SQS queues (3 main + 3 DLQ). Returns nil if SQS is not initialized.
func GetQueueDepths() map[string]int {
	initSQS()
	if sqsInitErr != nil || sqsClient == nil {
		return nil
	}

	queues := map[string]string{
		"analysis":        analysisQueueURL,
		"email":           emailQueueURL,
		"sns-publish":     snsPublishQueueURL,
		"analysis-dlq":    analysisDLQURL,
		"email-dlq":       emailDLQURL,
		"sns-publish-dlq": snsPublishDLQURL,
	}

	depths := make(map[string]int, len(queues))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for name, url := range queues {
		if url == "" {
			continue
		}
		out, err := sqsClient.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
			QueueUrl: aws.String(url),
			AttributeNames: []sqstypes.QueueAttributeName{
				sqstypes.QueueAttributeName("ApproximateNumberOfMessagesVisible"),
			},
		})
		if err != nil {
			slog.Error("cw_queue_depth_error", "queue", name, "error", err)
			depths[name] = -1
			continue
		}

		countStr := out.Attributes["ApproximateNumberOfMessagesVisible"]
		count := 0
		if countStr != "" {
			fmt.Sscanf(countStr, "%d", &count)
		}
		depths[name] = count
	}

	return depths
}
