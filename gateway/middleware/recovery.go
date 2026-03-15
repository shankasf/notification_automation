package middleware

import (
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/gin-gonic/gin"
)

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
