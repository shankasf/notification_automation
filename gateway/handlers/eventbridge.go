// File: eventbridge.go
// Implements timer-based scheduled tasks that run as background goroutines
// inside the gateway process. These replace Python cron jobs and provide:
//   - Summarization (every 15 min): detects unsummarized RequisitionChange
//     records and calls the AI service to generate natural-language summaries.
//   - Anomaly scan (every hour): iterates all 5 categories, calls the AI
//     service for anomaly detection, deduplicates results via the Python
//     dedup endpoint, and creates in-app notifications + WebSocket broadcasts
//     for genuinely new anomalies.
//
// Both tasks publish success/failure/duration metrics to CloudWatch and
// support graceful shutdown via context cancellation.
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

	cwtypes "github.com/aws/aws-sdk-go-v2/service/cloudwatch/types"
	"github.com/google/uuid"

	"metasource-gateway/db"
)

// allCategories is the canonical list of requisition categories.
// Used by executeAnomalyScan to iterate all categories.
var allCategories = []string{
	"ENGINEERING_CONTRACTORS",
	"CONTENT_TRUST_SAFETY",
	"DATA_OPERATIONS",
	"MARKETING_CREATIVE",
	"CORPORATE_SERVICES",
}

// StartScheduledTasks launches timer-based background tasks that replace
// Python cron jobs. Each task runs on its own goroutine with proper error
// handling, metric publishing, and graceful shutdown via context cancellation.
func StartScheduledTasks(ctx context.Context, wg *sync.WaitGroup) {
	// Summarization: every 15 minutes
	wg.Add(1)
	go runScheduledTask(ctx, wg, "summarize", 15*time.Minute, executeSummarization)

	// Anomaly scan: every hour
	wg.Add(1)
	go runScheduledTask(ctx, wg, "anomaly_scan", 1*time.Hour, executeAnomalyScan)
}

// runScheduledTask is the core loop for a single scheduled task. It fires on
// the configured interval and publishes success/failure metrics to CloudWatch.
func runScheduledTask(ctx context.Context, wg *sync.WaitGroup, name string, interval time.Duration, fn func(ctx context.Context) error) {
	defer wg.Done()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("scheduled_task_started", "task", name, "interval", interval.String())
	for {
		select {
		case <-ctx.Done():
			slog.Info("scheduled_task_stopped", "task", name)
			return
		case <-ticker.C:
			start := time.Now()
			slog.Info("scheduled_task_running", "task", name)

			taskCtx, taskCancel := context.WithTimeout(ctx, 5*time.Minute)
			err := fn(taskCtx)
			taskCancel()

			duration := time.Since(start).Milliseconds()

			if err != nil {
				slog.Error("scheduled_task_failed", "task", name, "error", err, "duration_ms", duration)
				PublishMetric("MetaSource/Scheduled", "TaskFailure", 1, cwtypes.StandardUnitCount,
					[]cwtypes.Dimension{{Name: strPtr("TaskName"), Value: strPtr(name)}})
			} else {
				slog.Info("scheduled_task_completed", "task", name, "duration_ms", duration)
				PublishMetric("MetaSource/Scheduled", "TaskSuccess", 1, cwtypes.StandardUnitCount,
					[]cwtypes.Dimension{{Name: strPtr("TaskName"), Value: strPtr(name)}})
			}

			PublishMetric("MetaSource/Scheduled", "TaskDuration", float64(duration), cwtypes.StandardUnitMilliseconds,
				[]cwtypes.Dimension{{Name: strPtr("TaskName"), Value: strPtr(name)}})
		}
	}
}

// strPtr is a tiny helper to avoid repeated inline aws.String() calls
// for dimension values that are plain Go strings.
func strPtr(s string) *string { return &s }

// executeSummarization calls the AI service to detect unsummarized changes
// and generate summaries for them.
func executeSummarization(ctx context.Context) error {
	client := &http.Client{Timeout: 60 * time.Second}

	// Step 1: detect unsummarized changes
	detectReq, err := http.NewRequestWithContext(ctx, http.MethodPost, pythonBackend+"/api/ai/detect-changes", bytes.NewReader([]byte("{}")))
	if err != nil {
		return fmt.Errorf("build detect-changes request: %w", err)
	}
	detectReq.Header.Set("Content-Type", "application/json")

	detectResp, err := client.Do(detectReq)
	if err != nil {
		return fmt.Errorf("detect-changes HTTP failed: %w", err)
	}
	defer detectResp.Body.Close()

	if detectResp.StatusCode != http.StatusOK {
		return fmt.Errorf("detect-changes returned status %d", detectResp.StatusCode)
	}

	var detectResult struct {
		HasChanges bool `json:"hasChanges"`
		Count      int  `json:"count"`
	}
	if err := json.NewDecoder(detectResp.Body).Decode(&detectResult); err != nil {
		return fmt.Errorf("decode detect-changes response: %w", err)
	}

	if !detectResult.HasChanges {
		slog.Info("scheduled_summarize_no_changes")
		return nil
	}

	// Step 2: generate summaries
	sumReq, err := http.NewRequestWithContext(ctx, http.MethodPost, pythonBackend+"/api/ai/summarize", bytes.NewReader([]byte("{}")))
	if err != nil {
		return fmt.Errorf("build summarize request: %w", err)
	}
	sumReq.Header.Set("Content-Type", "application/json")

	sumResp, err := client.Do(sumReq)
	if err != nil {
		return fmt.Errorf("summarize HTTP failed: %w", err)
	}
	defer sumResp.Body.Close()

	if sumResp.StatusCode != http.StatusOK {
		return fmt.Errorf("summarize returned status %d", sumResp.StatusCode)
	}

	var sumResult struct {
		Summarized int `json:"summarized"`
	}
	if err := json.NewDecoder(sumResp.Body).Decode(&sumResult); err != nil {
		return fmt.Errorf("decode summarize response: %w", err)
	}

	slog.Info("scheduled_summarize_complete",
		"unsummarized_found", detectResult.Count,
		"summarized", sumResult.Summarized)
	return nil
}

// executeAnomalyScan iterates all 5 categories, calls the AI service for
// anomaly detection, deduplicates results, creates in-app notifications,
// and broadcasts via WebSocket. This mirrors the processAnalysisMessage
// logic from sqs_consumers.go but runs proactively on a schedule.
func executeAnomalyScan(ctx context.Context) error {
	client := &http.Client{Timeout: 30 * time.Second}
	var totalNew, totalSkipped int

	for _, category := range allCategories {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		newCount, skippedCount, err := analyzeCategory(ctx, client, category)
		if err != nil {
			// Log per-category failure but continue with remaining categories
			slog.Error("scheduled_anomaly_category_failed", "category", category, "error", err)
			continue
		}

		totalNew += newCount
		totalSkipped += skippedCount
	}

	slog.Info("scheduled_anomaly_scan_complete",
		"categories_scanned", len(allCategories),
		"new_anomalies", totalNew,
		"skipped_duplicates", totalSkipped)
	return nil
}

// analyzeCategory runs anomaly detection for a single category, deduplicates
// results, creates notifications, and broadcasts to WebSocket. Returns counts
// of new and skipped anomalies.
func analyzeCategory(ctx context.Context, client *http.Client, category string) (newCount, skippedCount int, err error) {
	// Step 1: call AI service for analysis
	reqBody, _ := json.Marshal(map[string]string{"category": category})
	analyzeReq, err := http.NewRequestWithContext(ctx, http.MethodPost, pythonBackend+"/api/ai/analyze", bytes.NewReader(reqBody))
	if err != nil {
		return 0, 0, fmt.Errorf("build analyze request: %w", err)
	}
	analyzeReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(analyzeReq)
	if err != nil {
		return 0, 0, fmt.Errorf("analyze HTTP failed for %s: %w", category, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("analyze returned status %d for %s", resp.StatusCode, category)
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
		return 0, 0, fmt.Errorf("decode analyze response for %s: %w", category, err)
	}

	// Step 2: collect critical/high anomalies
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
		return 0, 0, nil
	}

	// Step 3: send to dedup endpoint
	notifyBody, _ := json.Marshal(map[string]interface{}{
		"anomalies": criticalAnomalies,
		"category":  category,
	})
	notifyReq, err := http.NewRequestWithContext(ctx, http.MethodPost, pythonBackend+"/api/ai/notify-anomaly", bytes.NewReader(notifyBody))
	if err != nil {
		return 0, 0, fmt.Errorf("build notify-anomaly request: %w", err)
	}
	notifyReq.Header.Set("Content-Type", "application/json")

	notifyResp, err := client.Do(notifyReq)
	if err != nil {
		return 0, 0, fmt.Errorf("notify-anomaly HTTP failed for %s: %w", category, err)
	}
	defer notifyResp.Body.Close()

	var dedupResult struct {
		Sent         int                      `json:"sent"`
		Skipped      int                      `json:"skipped"`
		NewAnomalies []map[string]interface{} `json:"newAnomalies"`
	}
	if err := json.NewDecoder(notifyResp.Body).Decode(&dedupResult); err != nil {
		return 0, 0, fmt.Errorf("decode dedup response for %s: %w", category, err)
	}

	// Step 4: create in-app notifications for new anomalies
	if len(dedupResult.NewAnomalies) > 0 {
		var managerID string
		db.DB.QueryRow(`SELECT id FROM "SourcingManager" WHERE category = $1`, category).Scan(&managerID)
		if managerID != "" {
			for _, a := range dedupResult.NewAnomalies {
				severity, _ := a["severity"].(string)
				description, _ := a["description"].(string)
				notifID := uuid.New().String()
				msg := "[" + severity + "] " + description

				_, dbErr := db.DB.Exec(
					`INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
					 VALUES ($1, $2, 'ANOMALY_ALERT', 'Auto-Detected Anomaly', $3, false, NOW())`,
					notifID, managerID, msg,
				)
				if dbErr != nil {
					slog.Error("scheduled_anomaly_notif_insert_error", "error", dbErr, "category", category)
					continue
				}

				NotifHub.Broadcast(managerID, "notification", map[string]interface{}{
					"id": notifID, "title": "Auto-Detected Anomaly", "message": msg,
				})
			}
		}
	}

	slog.Info("scheduled_anomaly_category_complete", "category", category,
		"total_anomalies", len(result.Anomalies),
		"new", len(dedupResult.NewAnomalies),
		"skipped_duplicates", dedupResult.Skipped)

	return len(dedupResult.NewAnomalies), dedupResult.Skipped, nil
}
