// File: auto_analyze.go
// Orchestrates automated analysis and email notification for requisition changes.
// TriggerAnalysis enqueues an anomaly-detection request via SQS (processed by
// the consumer in sqs_consumers.go). NotifyManagerEmail checks per-manager
// notification rules before enqueuing an email, ensuring managers only receive
// emails for change types they have opted into.
package handlers

import (
	"log/slog"
	"os"

	"metasource-gateway/db"
)

// pythonBackend is the base URL for the Python AI service, used by scheduled
// tasks and SQS consumers to call analysis, summarization, and email endpoints.
var pythonBackend = os.Getenv("PYTHON_BACKEND")

func init() {
	if pythonBackend == "" {
		pythonBackend = "http://meta-ai:8000"
	}
}

// TriggerAnalysis enqueues an anomaly detection request for a category.
// The actual analysis work (AI service call, dedup, notification creation,
// WebSocket broadcast) is performed by the SQS consumer in sqs_consumers.go.
func TriggerAnalysis(category string) {
	EnqueueAnalysis(category)
}

// ruleTypeForChange maps a RequisitionChange changeType to a NotificationRule ruleType.
func ruleTypeForChange(changeType string) string {
	switch changeType {
	case "STATUS_CHANGE":
		return "status_change"
	case "RATE_CHANGE":
		return "rate_change_threshold"
	case "BUDGET_CHANGE":
		return "budget_warning"
	case "HEADCOUNT_CHANGE":
		return "headcount_change"
	default:
		return ""
	}
}

// NotifyManagerEmail checks NotificationRule preferences and enqueues an email
// notification if the rule for this change type is enabled.
// The synchronous DB rule check happens here; the actual HTTP POST to the
// email service is performed by the SQS consumer in sqs_consumers.go.
func NotifyManagerEmail(managerID, changeType, subject, body string) {
	ruleType := ruleTypeForChange(changeType)
	if ruleType == "" {
		return
	}

	var isEnabled bool
	err := db.DB.QueryRow(
		`SELECT "isEnabled" FROM "NotificationRule" WHERE "managerId" = $1 AND "ruleType" = $2`,
		managerID, ruleType,
	).Scan(&isEnabled)
	if err != nil || !isEnabled {
		slog.Info("email_skip_rule_disabled", "managerId", managerID, "ruleType", ruleType)
		return
	}

	EnqueueEmail(managerID, changeType, subject, body)
}
