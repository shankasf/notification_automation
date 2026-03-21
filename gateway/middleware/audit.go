// File: audit.go
// Implements asynchronous audit logging for all authenticated API requests.
// Every request's metadata (user, action, resource, status code, duration) is
// sent to a background writer goroutine via a buffered channel. The writer
// batches entries and performs a single multi-row INSERT every 50 entries or
// every 5 seconds (whichever comes first), minimizing database round-trips.
//
// The audit channel is capacity-bounded (1000 entries). If the channel fills
// up (e.g., during a burst), new entries are dropped with a warning log rather
// than blocking the request. FlushAuditLog must be called during shutdown to
// drain remaining entries.
package middleware

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

const (
	auditBatchSize     = 50
	auditFlushInterval = 5 * time.Second
	auditChanCapacity  = 1000
)

type auditEntry struct {
	CorrelationID string
	UserID        string
	UserRole      string
	Action        string // AuditAction enum value
	Resource      string
	ResourceID    string
	Method        string
	Path          string
	ResponseCode  int
	IPAddress     string
	Metadata      map[string]interface{}
	DurationMs    int
}

var (
	auditChan chan auditEntry
	auditOnce sync.Once
	auditDone chan struct{} // closed when the writer goroutine exits
)

// startAuditWriter launches the background goroutine that batch-INSERTs
// audit entries. It is called exactly once via sync.Once.
func startAuditWriter() {
	auditChan = make(chan auditEntry, auditChanCapacity)
	auditDone = make(chan struct{})

	go func() {
		defer close(auditDone)

		batch := make([]auditEntry, 0, auditBatchSize)
		ticker := time.NewTicker(auditFlushInterval)
		defer ticker.Stop()

		for {
			select {
			case entry, ok := <-auditChan:
				if !ok {
					// Channel closed — flush remaining and exit
					if len(batch) > 0 {
						flushAuditBatch(batch)
					}
					return
				}
				batch = append(batch, entry)
				if len(batch) >= auditBatchSize {
					flushAuditBatch(batch)
					batch = batch[:0]
				}

			case <-ticker.C:
				if len(batch) > 0 {
					flushAuditBatch(batch)
					batch = batch[:0]
				}
			}
		}
	}()
}

// flushAuditBatch performs a single multi-row INSERT for a batch of audit entries.
func flushAuditBatch(batch []auditEntry) {
	if len(batch) == 0 {
		return
	}

	// Build a multi-row INSERT:
	// INSERT INTO "AuditLog" (...) VALUES ($1,$2,...), ($13,$14,...), ...
	const cols = 12 // number of columns per row
	valuePlaceholders := make([]string, 0, len(batch))
	args := make([]interface{}, 0, len(batch)*cols)

	for i, e := range batch {
		offset := i * cols

		metaJSON, err := json.Marshal(e.Metadata)
		if err != nil {
			metaJSON = []byte("{}")
		}

		valuePlaceholders = append(valuePlaceholders, fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			offset+1, offset+2, offset+3, offset+4, offset+5, offset+6,
			offset+7, offset+8, offset+9, offset+10, offset+11, offset+12,
		))

		args = append(args,
			e.CorrelationID, // 1
			e.UserID,        // 2
			e.UserRole,      // 3
			e.Action,        // 4
			e.Resource,      // 5
			nilIfEmpty(e.ResourceID), // 6
			e.Method,        // 7
			e.Path,          // 8
			e.ResponseCode,  // 9
			e.IPAddress,     // 10
			string(metaJSON), // 11
			e.DurationMs,    // 12
		)
	}

	query := fmt.Sprintf(
		`INSERT INTO "AuditLog" ("correlationId","userId","userRole",action,resource,"resourceId",method,path,"responseCode","ipAddress",metadata,"durationMs") VALUES %s`,
		strings.Join(valuePlaceholders, ","),
	)

	_, err := db.DB.Exec(query, args...)
	if err != nil {
		slog.Error("audit_flush_error", "error", err, "batch_size", len(batch))
	} else {
		slog.Debug("audit_flush_ok", "batch_size", len(batch))
	}
}

// nilIfEmpty returns nil for empty strings so PostgreSQL stores NULL.
func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// FlushAuditLog closes the audit channel and waits for the writer goroutine
// to finish flushing any remaining entries. Call this during shutdown.
func FlushAuditLog() {
	if auditChan == nil {
		return
	}
	close(auditChan)

	// Wait up to 10 seconds for the writer to drain
	select {
	case <-auditDone:
		slog.Info("audit_log_flushed")
	case <-time.After(10 * time.Second):
		slog.Warn("audit_log_flush_timeout")
	}
}

// AuditMiddleware captures request/response metadata and sends it to the
// async audit writer. It must be placed AFTER AuthMiddleware so that user
// identity fields are available in the Gin context.
func AuditMiddleware() gin.HandlerFunc {
	auditOnce.Do(startAuditWriter)

	return func(c *gin.Context) {
		start := time.Now()

		// Let the handler execute
		c.Next()

		// --- Post-handler: collect audit data ---
		durationMs := int(time.Since(start).Milliseconds())
		status := c.Writer.Status()

		correlationID := c.GetString("correlation_id")
		if correlationID == "" {
			// Fallback: read from request header
			correlationID = c.GetHeader("X-Request-ID")
		}

		userEmail := c.GetString("user_email")
		userRole := c.GetString("user_role")

		path := c.Request.URL.Path
		method := c.Request.Method

		action := resolveAuditAction(method, path, status)
		resource := resolveResource(path)
		resourceID := c.Param("id")
		if resourceID == "" {
			resourceID = c.Param("jobId")
		}

		entry := auditEntry{
			CorrelationID: correlationID,
			UserID:        userEmail,
			UserRole:      userRole,
			Action:        action,
			Resource:      resource,
			ResourceID:    resourceID,
			Method:        method,
			Path:          path,
			ResponseCode:  status,
			IPAddress:     c.ClientIP(),
			DurationMs:    durationMs,
		}

		// Non-blocking send
		select {
		case auditChan <- entry:
		default:
			slog.Warn("audit_channel_full", "dropped_path", path, "correlation_id", correlationID)
		}
	}
}

// resolveAuditAction maps HTTP method + path to an AuditAction enum value.
func resolveAuditAction(method, path string, status int) string {
	if status == 403 {
		return "RBAC_DENIED"
	}
	if status == 401 {
		return "AUTH_FAILURE"
	}

	switch method {
	case "GET":
		return "DATA_READ"
	case "DELETE":
		return "DATA_DELETE"
	case "POST":
		if strings.Contains(path, "/api/ai/") {
			return "AI_QUERY"
		}
		if strings.Contains(path, "/upload") {
			return "FILE_UPLOAD"
		}
		return "DATA_WRITE"
	case "PUT", "PATCH":
		return "DATA_WRITE"
	default:
		return "API_CALL"
	}
}

// resolveResource extracts a human-readable resource name from the URL path.
func resolveResource(path string) string {
	// Normalize: /api/requisitions/:id -> "requisition"
	// /api/ai/chat -> "ai"
	// /api/notifications -> "notification"
	segments := strings.Split(strings.Trim(path, "/"), "/")

	// Skip the "api" prefix if present
	if len(segments) > 0 && segments[0] == "api" {
		segments = segments[1:]
	}

	if len(segments) == 0 {
		return "unknown"
	}

	resource := segments[0]

	// Singularize common plural resources
	resource = strings.TrimSuffix(resource, "s")

	// Special handling: "data-upload" -> "data-upload" (don't singularize)
	if strings.Contains(segments[0], "data-upload") {
		return "data-upload"
	}

	return resource
}
