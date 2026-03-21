package handlers

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/aws/aws-sdk-go-v2/service/sns/types"
	"github.com/gin-gonic/gin"
)

const topicName = "metasource-requisition-changes"

var (
	snsClient  *sns.Client
	topicARN   string
	snsOnce    sync.Once
	snsInitErr error
)

func initSNS() {
	snsOnce.Do(func() {
		region := os.Getenv("AWS_REGION")
		accessKey := os.Getenv("AWS_ACCESS_KEY_ID")
		secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY")

		if accessKey == "" || secretKey == "" {
			snsInitErr = fmt.Errorf("AWS credentials not configured")
			slog.Warn("sns_init_skip", "reason", "missing AWS credentials")
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
			snsInitErr = err
			slog.Error("sns_config_error", "error", err)
			return
		}
		snsClient = sns.NewFromConfig(cfg)

		// Create topic (idempotent)
		out, err := snsClient.CreateTopic(context.Background(), &sns.CreateTopicInput{
			Name: aws.String(topicName),
		})
		if err != nil {
			snsInitErr = err
			slog.Error("sns_create_topic_error", "error", err)
			return
		}
		topicARN = *out.TopicArn
		slog.Info("sns_initialized", "topicArn", topicARN)
	})
}

// ChangeEvent represents a requisition change for SNS notification
type ChangeEvent struct {
	Type          string        `json:"type"`
	RequisitionID string        `json:"requisitionId"`
	RoleTitle     string        `json:"roleTitle"`
	Category      string        `json:"category"`
	Changes       []FieldChange `json:"changes"`
	Summary       string        `json:"summary"`
	ChangedBy     string        `json:"changedBy"`
}

type FieldChange struct {
	Field    string `json:"field"`
	OldValue string `json:"oldValue"`
	NewValue string `json:"newValue"`
}

// PublishChange enqueues a change notification for asynchronous SNS publishing.
// The actual SNS publish is performed by the SQS consumer in sqs_consumers.go.
func PublishChange(event ChangeEvent) {
	EnqueueSNSPublish(event)
}

// DoPublishSNS performs the actual SNS publish for a ChangeEvent.
// Called by the SQS consumer — not directly by request handlers.
func DoPublishSNS(event ChangeEvent) error {
	initSNS()
	if snsInitErr != nil || snsClient == nil {
		return fmt.Errorf("SNS not initialized: %v", snsInitErr)
	}

	subject := fmt.Sprintf("[MetaSource] %s: %s — %s", event.Type, event.RequisitionID, event.RoleTitle)
	runes := []rune(subject)
	if len(runes) > 100 {
		subject = string(runes[:97]) + "..."
	}

	var body strings.Builder
	body.WriteString("MetaSource Hiring Request Change Notification\n")
	body.WriteString("==================================================\n\n")
	fmt.Fprintf(&body, "Type: %s\n", event.Type)
	fmt.Fprintf(&body, "Request ID: %s\n", event.RequisitionID)
	fmt.Fprintf(&body, "Role: %s\n", event.RoleTitle)
	fmt.Fprintf(&body, "Category: %s\n", event.Category)
	fmt.Fprintf(&body, "Changed By: %s\n", event.ChangedBy)
	fmt.Fprintf(&body, "Time: %s\n\n", time.Now().Format(time.RFC3339))

	if len(event.Changes) > 0 {
		body.WriteString("Changes:\n")
		body.WriteString("------------------------------\n")
		for _, c := range event.Changes {
			fmt.Fprintf(&body, "  %s: %s → %s\n", c.Field, c.OldValue, c.NewValue)
		}
		body.WriteString("\n")
	}

	fmt.Fprintf(&body, "Summary: %s\n\n", event.Summary)
	body.WriteString("---\nView details: https://meta.callsphere.tech/requisitions\n")

	_, err := snsClient.Publish(context.Background(), &sns.PublishInput{
		TopicArn: aws.String(topicARN),
		Subject:  aws.String(subject),
		Message:  aws.String(body.String()),
		MessageAttributes: map[string]types.MessageAttributeValue{
			"changeType": {
				DataType:    aws.String("String"),
				StringValue: aws.String(event.Type),
			},
			"category": {
				DataType:    aws.String("String"),
				StringValue: aws.String(event.Category),
			},
		},
	})
	if err != nil {
		slog.Error("sns_publish_error", "error", err, "requisitionId", event.RequisitionID)
		return fmt.Errorf("SNS publish failed for %s: %w", event.RequisitionID, err)
	}

	slog.Info("sns_published", "type", event.Type, "requisitionId", event.RequisitionID)
	return nil
}

// SetupSNS handles POST /api/sns/setup — creates topic and subscribes admin email
func SetupSNS(c *gin.Context) {
	initSNS()
	if snsInitErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SNS not configured", "details": snsInitErr.Error()})
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	c.ShouldBindJSON(&body)

	email := body.Email
	if email == "" {
		email = os.Getenv("SNS_ADMIN_EMAIL")
	}
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email is required — set SNS_ADMIN_EMAIL or pass email in request body"})
		return
	}

	// Check existing subscriptions
	subs, err := snsClient.ListSubscriptionsByTopic(context.Background(), &sns.ListSubscriptionsByTopicInput{
		TopicArn: aws.String(topicARN),
	})

	alreadySubscribed := false
	var existingArn string
	if err == nil {
		for _, s := range subs.Subscriptions {
			if s.Protocol != nil && *s.Protocol == "email" && s.Endpoint != nil && *s.Endpoint == email {
				alreadySubscribed = true
				if s.SubscriptionArn != nil {
					existingArn = *s.SubscriptionArn
				}
				break
			}
		}
	}

	if alreadySubscribed {
		c.JSON(http.StatusOK, gin.H{
			"success":  true,
			"topicArn": topicARN,
			"subscription": gin.H{
				"arn":               existingArn,
				"alreadySubscribed": true,
				"message":           "Email is already subscribed",
			},
		})
		return
	}

	subOut, err := snsClient.Subscribe(context.Background(), &sns.SubscribeInput{
		TopicArn: aws.String(topicARN),
		Protocol: aws.String("email"),
		Endpoint: aws.String(email),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to subscribe", "details": err.Error()})
		return
	}

	arn := "PendingConfirmation"
	if subOut.SubscriptionArn != nil {
		arn = *subOut.SubscriptionArn
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"topicArn": topicARN,
		"subscription": gin.H{
			"arn":               arn,
			"alreadySubscribed": false,
			"message":           "Confirmation email sent — check inbox to confirm subscription",
		},
	})
}

// GetSNSStatus handles GET /api/sns/setup — returns topic status
func GetSNSStatus(c *gin.Context) {
	initSNS()
	if snsInitErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SNS not configured", "details": snsInitErr.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"topicArn": topicARN, "status": "active"})
}
