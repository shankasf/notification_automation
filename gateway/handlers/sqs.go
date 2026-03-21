package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
)

var (
	sqsClient  *sqs.Client
	sqsOnce    sync.Once
	sqsInitErr error

	analysisQueueURL   string // metasource-analysis.fifo
	emailQueueURL      string // metasource-email
	snsPublishQueueURL string // metasource-sns-publish

	analysisDLQURL   string // metasource-analysis-dlq.fifo
	emailDLQURL      string // metasource-email-dlq
	snsPublishDLQURL string // metasource-sns-publish-dlq
)

// initSQS initializes the SQS client and creates all queues idempotently.
// Safe to call multiple times — work is done only once via sync.Once.
func initSQS() {
	sqsOnce.Do(func() {
		region := os.Getenv("AWS_REGION")
		accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
		secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")

		if accessKey == "" || secretKey == "" {
			sqsInitErr = fmt.Errorf("AWS credentials not configured")
			slog.Warn("sqs_init_skip", "reason", "missing AWS credentials")
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
			sqsInitErr = err
			slog.Error("sqs_config_error", "error", err)
			return
		}
		sqsClient = sqs.NewFromConfig(cfg)

		// Create all queues (DLQs first, then main queues that reference them)
		if err := createQueues(); err != nil {
			sqsInitErr = err
			return
		}

		slog.Info("sqs_initialized",
			"analysisQueue", analysisQueueURL,
			"emailQueue", emailQueueURL,
			"snsPublishQueue", snsPublishQueueURL,
		)
	})
}

// createQueues creates the 6 queues (3 DLQ + 3 main) idempotently.
func createQueues() error {
	ctx := context.Background()

	// ── DLQs first (main queues need their ARNs for redrive policy) ──

	// Analysis DLQ (FIFO — must match main queue type)
	analysisDLQ, err := sqsClient.CreateQueue(ctx, &sqs.CreateQueueInput{
		QueueName: aws.String("metasource-analysis-dlq.fifo"),
		Attributes: map[string]string{
			"FifoQueue":              "true",
			"MessageRetentionPeriod": "1209600", // 14 days
		},
	})
	if err != nil {
		slog.Error("sqs_create_analysis_dlq_error", "error", err)
		return fmt.Errorf("create analysis DLQ: %w", err)
	}
	analysisDLQURL = *analysisDLQ.QueueUrl
	analysisDLQArn, err := getQueueArn(ctx, analysisDLQURL)
	if err != nil {
		return fmt.Errorf("get analysis DLQ ARN: %w", err)
	}

	// Email DLQ (standard)
	emailDLQ, err := sqsClient.CreateQueue(ctx, &sqs.CreateQueueInput{
		QueueName: aws.String("metasource-email-dlq"),
		Attributes: map[string]string{
			"MessageRetentionPeriod": "1209600",
		},
	})
	if err != nil {
		slog.Error("sqs_create_email_dlq_error", "error", err)
		return fmt.Errorf("create email DLQ: %w", err)
	}
	emailDLQURL = *emailDLQ.QueueUrl
	emailDLQArn, err := getQueueArn(ctx, emailDLQURL)
	if err != nil {
		return fmt.Errorf("get email DLQ ARN: %w", err)
	}

	// SNS-publish DLQ (standard)
	snsPublishDLQ, err := sqsClient.CreateQueue(ctx, &sqs.CreateQueueInput{
		QueueName: aws.String("metasource-sns-publish-dlq"),
		Attributes: map[string]string{
			"MessageRetentionPeriod": "1209600",
		},
	})
	if err != nil {
		slog.Error("sqs_create_sns_publish_dlq_error", "error", err)
		return fmt.Errorf("create sns-publish DLQ: %w", err)
	}
	snsPublishDLQURL = *snsPublishDLQ.QueueUrl
	snsPublishDLQArn, err := getQueueArn(ctx, snsPublishDLQURL)
	if err != nil {
		return fmt.Errorf("get sns-publish DLQ ARN: %w", err)
	}

	// ── Main queues ──

	// Analysis queue (FIFO — one analysis per category at a time)
	analysisQ, err := sqsClient.CreateQueue(ctx, &sqs.CreateQueueInput{
		QueueName: aws.String("metasource-analysis.fifo"),
		Attributes: map[string]string{
			"FifoQueue":                 "true",
			"ContentBasedDeduplication": "false",
			"VisibilityTimeout":         "60", // analysis can take up to 30s HTTP + processing
			"MessageRetentionPeriod":    "345600",
			"RedrivePolicy":             fmt.Sprintf(`{"deadLetterTargetArn":"%s","maxReceiveCount":"3"}`, analysisDLQArn),
		},
	})
	if err != nil {
		slog.Error("sqs_create_analysis_queue_error", "error", err)
		return fmt.Errorf("create analysis queue: %w", err)
	}
	analysisQueueURL = *analysisQ.QueueUrl

	// Email queue (standard)
	emailQ, err := sqsClient.CreateQueue(ctx, &sqs.CreateQueueInput{
		QueueName: aws.String("metasource-email"),
		Attributes: map[string]string{
			"VisibilityTimeout":      "30",
			"MessageRetentionPeriod": "345600",
			"RedrivePolicy":          fmt.Sprintf(`{"deadLetterTargetArn":"%s","maxReceiveCount":"3"}`, emailDLQArn),
		},
	})
	if err != nil {
		slog.Error("sqs_create_email_queue_error", "error", err)
		return fmt.Errorf("create email queue: %w", err)
	}
	emailQueueURL = *emailQ.QueueUrl

	// SNS-publish queue (standard)
	snsQ, err := sqsClient.CreateQueue(ctx, &sqs.CreateQueueInput{
		QueueName: aws.String("metasource-sns-publish"),
		Attributes: map[string]string{
			"VisibilityTimeout":      "30",
			"MessageRetentionPeriod": "345600",
			"RedrivePolicy":          fmt.Sprintf(`{"deadLetterTargetArn":"%s","maxReceiveCount":"3"}`, snsPublishDLQArn),
		},
	})
	if err != nil {
		slog.Error("sqs_create_sns_publish_queue_error", "error", err)
		return fmt.Errorf("create sns-publish queue: %w", err)
	}
	snsPublishQueueURL = *snsQ.QueueUrl

	return nil
}

// getQueueArn fetches the ARN for a queue URL (needed for redrive policies).
func getQueueArn(ctx context.Context, queueURL string) (string, error) {
	out, err := sqsClient.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl:       aws.String(queueURL),
		AttributeNames: []sqstypes.QueueAttributeName{sqstypes.QueueAttributeNameQueueArn},
	})
	if err != nil {
		return "", err
	}
	arn, ok := out.Attributes["QueueArn"]
	if !ok {
		return "", fmt.Errorf("QueueArn attribute not found for %s", queueURL)
	}
	return arn, nil
}

// ── Producer functions ─────────────────────────────────────────────────────
// All producers are synchronous — SQS SendMessage is fast (<50ms).
// Callers do NOT need to wrap these in goroutines.

// EnqueueAnalysis sends an analysis request to the FIFO queue.
// MessageGroupId is set to the category so that analysis requests for the same
// category are processed in order, while different categories run concurrently.
func EnqueueAnalysis(category string) {
	initSQS()
	if sqsInitErr != nil {
		slog.Error("sqs_enqueue_analysis_failed", "error", sqsInitErr, "category", category)
		return
	}

	body, _ := json.Marshal(map[string]string{"category": category})

	_, err := sqsClient.SendMessage(context.Background(), &sqs.SendMessageInput{
		QueueUrl:               aws.String(analysisQueueURL),
		MessageBody:            aws.String(string(body)),
		MessageGroupId:         aws.String(category),
		MessageDeduplicationId: aws.String(fmt.Sprintf("%s-%d", category, time.Now().UnixMilli())),
	})
	if err != nil {
		slog.Error("sqs_enqueue_analysis_error", "error", err, "category", category)
		return
	}
	slog.Info("sqs_enqueued_analysis", "category", category)
}

// EnqueueEmail sends an email notification request to the standard queue.
func EnqueueEmail(managerID, changeType, subject, body string) {
	initSQS()
	if sqsInitErr != nil {
		slog.Error("sqs_enqueue_email_failed", "error", sqsInitErr, "managerId", managerID)
		return
	}

	payload, _ := json.Marshal(map[string]string{
		"managerId":  managerID,
		"changeType": changeType,
		"subject":    subject,
		"body":       body,
	})

	_, err := sqsClient.SendMessage(context.Background(), &sqs.SendMessageInput{
		QueueUrl:    aws.String(emailQueueURL),
		MessageBody: aws.String(string(payload)),
	})
	if err != nil {
		slog.Error("sqs_enqueue_email_error", "error", err, "managerId", managerID)
		return
	}
	slog.Info("sqs_enqueued_email", "managerId", managerID, "changeType", changeType)
}

// EnqueueSNSPublish sends an SNS publish request to the standard queue.
func EnqueueSNSPublish(event ChangeEvent) {
	initSQS()
	if sqsInitErr != nil {
		slog.Error("sqs_enqueue_sns_publish_failed", "error", sqsInitErr, "requisitionId", event.RequisitionID)
		return
	}

	payload, err := json.Marshal(event)
	if err != nil {
		slog.Error("sqs_enqueue_sns_marshal_error", "error", err)
		return
	}

	_, err = sqsClient.SendMessage(context.Background(), &sqs.SendMessageInput{
		QueueUrl:    aws.String(snsPublishQueueURL),
		MessageBody: aws.String(string(payload)),
	})
	if err != nil {
		slog.Error("sqs_enqueue_sns_publish_error", "error", err, "requisitionId", event.RequisitionID)
		return
	}
	slog.Info("sqs_enqueued_sns_publish", "type", event.Type, "requisitionId", event.RequisitionID)
}
