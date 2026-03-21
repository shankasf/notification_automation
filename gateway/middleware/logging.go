package middleware

import (
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func RequestLoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/health") || strings.HasPrefix(c.Request.URL.Path, "/api/health") {
			c.Next()
			return
		}

		reqID := c.GetHeader("X-Request-ID")
		if reqID == "" {
			reqID = uuid.New().String()[:12]
		}
		c.Set("request_id", reqID)
		c.Set("correlation_id", reqID)
		c.Header("X-Request-ID", reqID)

		start := time.Now()

		slog.Info("request_start",
			"request_id", reqID,
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"query", c.Request.URL.RawQuery,
			"client_ip", c.ClientIP(),
		)

		c.Next()

		duration := time.Since(start)
		status := c.Writer.Status()

		logFn := slog.Info
		if status >= 500 {
			logFn = slog.Error
		} else if status >= 400 {
			logFn = slog.Warn
		}

		logFn("request_complete",
			"request_id", reqID,
			"status", status,
			"duration_ms", duration.Milliseconds(),
			"size", c.Writer.Size(),
		)
	}
}
