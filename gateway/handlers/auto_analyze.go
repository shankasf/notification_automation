package handlers

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"metasource-gateway/db"

	"github.com/google/uuid"
)

var pythonBackend = os.Getenv("PYTHON_BACKEND")

func init() {
	if pythonBackend == "" {
		pythonBackend = "http://meta-ai:8000"
	}
}

// TriggerAnalysis fires an async anomaly detection for a category.
// It calls the AI service to detect anomalies, then sends them through the
// dedup endpoint FIRST — only genuinely new anomalies (not seen in the last
// 24h) get an in-app notification and WebSocket broadcast.
func TriggerAnalysis(category string) {
	go func() {
		client := &http.Client{Timeout: 30 * time.Second}
		body, _ := json.Marshal(map[string]string{"category": category})
		resp, err := client.Post(pythonBackend+"/api/ai/analyze", "application/json", bytes.NewReader(body))
		if err != nil {
			slog.Warn("auto_analyze_failed", "category", category, "error", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return
		}

		var result struct {
			Anomalies []struct {
				Type          string  `json:"type"`
				Description   string  `json:"description"`
				Severity      string  `json:"severity"`
				RequisitionId *string `json:"requisitionId"`
			} `json:"anomalies"`
		}
		json.NewDecoder(resp.Body).Decode(&result)

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
			return
		}

		// Send to dedup endpoint FIRST — it returns only the genuinely new ones
		notifyBody, _ := json.Marshal(map[string]interface{}{
			"anomalies": criticalAnomalies,
			"category":  category,
		})
		notifyResp, notifyErr := client.Post(pythonBackend+"/api/ai/notify-anomaly", "application/json", bytes.NewReader(notifyBody))
		if notifyErr != nil {
			slog.Warn("notify_anomaly_failed", "category", category, "error", notifyErr)
			return
		}
		defer notifyResp.Body.Close()

		var dedupResult struct {
			Sent         int                      `json:"sent"`
			Skipped      int                      `json:"skipped"`
			NewAnomalies []map[string]interface{} `json:"newAnomalies"`
		}
		json.NewDecoder(notifyResp.Body).Decode(&dedupResult)

		// Only create in-app notifications for anomalies that passed dedup
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
	}()
}
