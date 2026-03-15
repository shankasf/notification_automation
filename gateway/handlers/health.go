package handlers

import (
	"fmt"
	"net/http"
	"runtime"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

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

func DebugStats(c *gin.Context) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	dbStats := db.DB.Stats()

	c.JSON(200, gin.H{
		"runtime": gin.H{
			"goroutines":  runtime.NumGoroutine(),
			"alloc_mb":    m.Alloc / 1024 / 1024,
			"sys_mb":      m.Sys / 1024 / 1024,
			"gc_cycles":   m.NumGC,
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
	})
}

func statusStr(ok bool) string {
	if ok {
		return "ok"
	}
	return "error"
}
