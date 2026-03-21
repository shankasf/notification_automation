package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"metasource-gateway/db"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/google/uuid"
)

// PollQueue long-polls an SQS queue and dispatches messages to handler.
// It respects ctx for graceful shutdown and uses a semaphore to cap concurrency.
//   - On handler success: message is deleted from the queue.
//   - On handler error: message is NOT deleted — SQS will retry, then move to DLQ
//     after maxReceiveCount (3) failures.
func PollQueue(ctx context.Context, queueURL string, handler func(body string) error, maxConcurrency int) {
	sem := make(chan struct{}, maxConcurrency)

	for {
		select {
		case <-ctx.Done():
			slog.Info("sqs_consumer_stopping", "queue", queueURL)
			return
		default:
		}

		out, err := sqsClient.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:            aws.String(queueURL),
			MaxNumberOfMessages: int32(maxConcurrency),
			WaitTimeSeconds:     20, // long polling
		})
		if err != nil {
			// Context cancellation is expected during shutdown
			if ctx.Err() != nil {
				return
			}
			slog.Error("sqs_receive_error", "queue", queueURL, "error", err)
			// Back off briefly on receive errors to avoid tight-loop spam
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		for _, msg := range out.Messages {
			sem <- struct{}{} // acquire semaphore slot

			go func(messageBody, receiptHandle string) {
				defer func() { <-sem }() // release semaphore slot

				if err := handler(messageBody); err != nil {
					slog.Error("sqs_handler_error", "queue", queueURL, "error", err)
					// Don't delete — SQS will make the message visible again after VisibilityTimeout
					return
				}

				// Success — delete the message
				_, delErr := sqsClient.DeleteMessage(ctx, &sqs.DeleteMessageInput{
					QueueUrl:      aws.String(queueURL),
					ReceiptHandle: aws.String(receiptHandle),
				})
				if delErr != nil {
					slog.Error("sqs_delete_error", "queue", queueURL, "error", delErr)
				}
			}(*msg.Body, *msg.ReceiptHandle)
		}
	}
}

// ── Per-queue message processors ──────────────────────────────────────────

// processAnalysisMessage contains the full TriggerAnalysis logic that was
// previously inside the fire-and-forget goroutine in auto_analyze.go.
func processAnalysisMessage(body string) error {
	var msg struct {
		Category string `json:"category"`
	}
	if err := json.Unmarshal([]byte(body), &msg); err != nil {
		return fmt.Errorf("unmarshal analysis message: %w", err)
	}
	category := msg.Category

	client := &http.Client{Timeout: 30 * time.Second}
	reqBody, _ := json.Marshal(map[string]string{"category": category})
	resp, err := client.Post(pythonBackend+"/api/ai/analyze", "application/json", bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("auto_analyze HTTP failed for %s: %w", category, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("auto_analyze HTTP status %d for %s", resp.StatusCode, category)
	}

	var result struct {
		Anomalies []struct {
			Type          string  `json:"type"`
			Description   string  `json:"description"`
			Severity      string  `json:"severity"`
			RequisitionId *string `json:"requisitionId"`
		} `json:"anomalies"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode analyze response for %s: %w", category, err)
	}

	// Collect critical/high anomalies
	var criticalAnomalies []map[string]interface{}
	for _, a := range result.Anomalies {
		if a.Severity == "critical" || a.Severity == "high" {
			entry := map[string]interface{}{
				"type":        a.Type,
				"description": a.Description,
				"severity":    a.Severity,
			}
			if a.RequisitionId != nil {
				entry["requisitionId"] = *a.RequisitionId
			}
			criticalAnomalies = append(criticalAnomalies, entry)
		}
	}

	if len(criticalAnomalies) == 0 {
		slog.Info("auto_analyze_complete", "category", category, "anomalies", 0)
		return nil
	}

	// Send to dedup endpoint — it returns only genuinely new anomalies
	notifyBody, _ := json.Marshal(map[string]interface{}{
		"anomalies": criticalAnomalies,
		"category":  category,
	})
	notifyResp, notifyErr := client.Post(pythonBackend+"/api/ai/notify-anomaly", "application/json", bytes.NewReader(notifyBody))
	if notifyErr != nil {
		return fmt.Errorf("notify_anomaly HTTP failed for %s: %w", category, notifyErr)
	}
	defer notifyResp.Body.Close()

	var dedupResult struct {
		Sent         int                      `json:"sent"`
		Skipped      int                      `json:"skipped"`
		NewAnomalies []map[string]interface{} `json:"newAnomalies"`
	}
	if err := json.NewDecoder(notifyResp.Body).Decode(&dedupResult); err != nil {
		return fmt.Errorf("decode dedup response for %s: %w", category, err)
	}

	// Create in-app notifications for anomalies that passed dedup
	if len(dedupResult.NewAnomalies) > 0 {
		var managerID string
		db.DB.QueryRow(`SELECT id FROM "SourcingManager" WHERE category = $1`, category).Scan(&managerID)
		if managerID != "" {
			for _, a := range dedupResult.NewAnomalies {
				severity, _ := a["severity"].(string)
				description, _ := a["description"].(string)
				notifID := uuid.New().String()
				msg := "[" + severity + "] " + description
				db.DB.Exec(`INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
							VALUES ($1, $2, 'ANOMALY_ALERT', 'Auto-Detected Anomaly', $3, false, NOW())`,
					notifID, managerID, msg)

				NotifHub.Broadcast(managerID, "notification", map[string]interface{}{
					"id": notifID, "title": "Auto-Detected Anomaly", "message": msg,
				})
			}
		}
	}

	slog.Info("auto_analyze_complete", "category", category,
		"total_anomalies", len(result.Anomalies),
		"new", len(dedupResult.NewAnomalies),
		"skipped_duplicates", dedupResult.Skipped)
	return nil
}

// processEmailMessage contains the NotifyManagerEmail HTTP POST logic that was
// previously inside the fire-and-forget goroutine.
func processEmailMessage(body string) error {
	var msg struct {
		ManagerID  string `json:"managerId"`
		ChangeType string `json:"changeType"`
		Subject    string `json:"subject"`
		Body       string `json:"body"`
	}
	if err := json.Unmarshal([]byte(body), &msg); err != nil {
		return fmt.Errorf("unmarshal email message: %w", err)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	payload, _ := json.Marshal(map[string]string{
		"managerId": msg.ManagerID,
		"subject":   msg.Subject,
		"body":      msg.Body,
		"notifType": "CHANGE_SUMMARY",
	})
	resp, err := client.Post(pythonBackend+"/api/ai/send-email", "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("email HTTP failed for manager %s: %w", msg.ManagerID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return fmt.Errorf("email HTTP status %d for manager %s", resp.StatusCode, msg.ManagerID)
	}

	slog.Info("email_notify_sent", "managerId", msg.ManagerID, "changeType", msg.ChangeType)
	return nil
}

// processSNSPublishMessage contains the SNS publish logic that was previously
// inside the fire-and-forget goroutine in sns.go.
func processSNSPublishMessage(body string) error {
	var event ChangeEvent
	if err := json.Unmarshal([]byte(body), &event); err != nil {
		return fmt.Errorf("unmarshal SNS publish message: %w", err)
	}

	return DoPublishSNS(event)
}

// ── Consumer lifecycle ────────────────────────────────────────────────────

// StartSQSConsumers initializes SQS and starts a polling goroutine for each
// queue. Returns a WaitGroup that completes when all consumers have stopped
// (i.e., after the context is cancelled).
func StartSQSConsumers(ctx context.Context) *sync.WaitGroup {
	initSQS()
	if sqsInitErr != nil {
		slog.Error("sqs_consumers_not_started", "error", sqsInitErr)
		return &sync.WaitGroup{}
	}

	var wg sync.WaitGroup

	type consumer struct {
		name        string
		queueURL    string
		handler     func(string) error
		concurrency int
	}

	consumers := []consumer{
		{"analysis", analysisQueueURL, processAnalysisMessage, 1},
		{"email", emailQueueURL, processEmailMessage, 3},
		{"sns-publish", snsPublishQueueURL, processSNSPublishMessage, 2},
	}

	for _, c := range consumers {
		wg.Add(1)
		go func(c consumer) {
			defer wg.Done()
			slog.Info("sqs_consumer_started", "queue", c.name, "concurrency", c.concurrency)
			PollQueue(ctx, c.queueURL, c.handler, c.concurrency)
			slog.Info("sqs_consumer_stopped", "queue", c.name)
		}(c)
	}

	return &wg
}
