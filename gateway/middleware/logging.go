// File: logging.go
// Provides structured request/response logging middleware. Each request gets
// a unique request ID (from the X-Request-ID header or auto-generated) that
// is stored in the Gin context as both "request_id" and "correlation_id" for
// use by downstream handlers and the audit middleware. Health check endpoints
// are excluded to avoid log noise from load balancer probes.
//
// Log level is chosen based on response status: INFO for 2xx/3xx, WARN for
// 4xx, ERROR for 5xx.
package middleware

import (
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestLoggingMiddleware logs request start and completion with timing.
// Skips health check paths to reduce noise.
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

		// Select log level based on status code so errors are easy to filter
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
