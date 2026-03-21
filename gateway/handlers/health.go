// File: health.go
// Provides health check and debug/stats endpoints. The health check verifies
// both the PostgreSQL connection and the Python AI service, returning 503 if
// either is unhealthy. The debug stats endpoint (admin-only) exposes Go runtime
// metrics, database pool stats, WebSocket connection count, and SQS queue depths.
package handlers

import (
	"fmt"
	"net/http"
	"runtime"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

// HealthCheck returns a composite health status of the gateway, database,
// and AI service. Returns 200 when all are healthy, 503 otherwise.
func HealthCheck(pythonURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check DB
		dbOk := true
		if err := db.DB.Ping(); err != nil {
			dbOk = false
		}

		// Check Python AI service
		aiOk := true
		resp, err := http.Get(fmt.Sprintf("%s/api/ai/health", pythonURL))
		if err != nil {
			aiOk = false
		} else {
			if resp.StatusCode != 200 {
				aiOk = false
			}
			resp.Body.Close()
		}

		status := http.StatusOK
		if !dbOk || !aiOk {
			status = http.StatusServiceUnavailable
		}

		c.JSON(status, gin.H{
			"status":   statusStr(dbOk && aiOk),
			"database": statusStr(dbOk),
			"ai":       statusStr(aiOk),
			"ws_conns": NotifHub.ConnCount(),
		})
	}
}

// DebugStats returns runtime diagnostics for the admin dashboard: goroutine count,
// memory allocation, GC cycles, DB pool utilization, WebSocket connections,
// and SQS queue depths. This is a read-only diagnostic endpoint.
func DebugStats(c *gin.Context) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	dbStats := db.DB.Stats()

	resp := gin.H{
		"runtime": gin.H{
			"goroutines": runtime.NumGoroutine(),
			"alloc_mb":   m.Alloc / 1024 / 1024,
			"sys_mb":     m.Sys / 1024 / 1024,
			"gc_cycles":  m.NumGC,
		},
		"db_pool": gin.H{
			"open":     dbStats.OpenConnections,
			"in_use":   dbStats.InUse,
			"idle":     dbStats.Idle,
			"max_open": dbStats.MaxOpenConnections,
		},
		"websocket": gin.H{
			"connections": NotifHub.ConnCount(),
		},
	}

	// Include SQS queue depths if SQS is initialized
	if depths := GetQueueDepths(); depths != nil {
		resp["sqs_queues"] = depths
	}

	c.JSON(200, resp)
}

// statusStr converts a boolean health flag to "ok" or "error" for JSON output.
func statusStr(ok bool) string {
	if ok {
		return "ok"
	}
	return "error"
}
