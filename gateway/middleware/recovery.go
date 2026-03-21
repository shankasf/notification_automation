// File: recovery.go
// Provides panic recovery middleware that catches any unhandled panics in
// request handlers, logs the error with a full stack trace for debugging,
// and returns a generic 500 response to the client. This prevents a single
// panicking request from crashing the entire gateway process.
package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
)

// RecoveryMiddleware catches panics, logs the stack trace, and returns 500.
// Must be registered first in the middleware chain so it wraps all handlers.
func RecoveryMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				reqID, _ := c.Get("request_id")
				slog.Error("panic_recovered",
					"request_id", reqID,
					"error", r,
					"stack", string(debug.Stack()),
				)
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"error":      "Internal server error",
					"request_id": reqID,
				})
			}
		}()
		c.Next()
	}
}
