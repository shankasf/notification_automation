// File: cors.go
// Implements Cross-Origin Resource Sharing (CORS) for the gateway. Only
// explicitly allowlisted origins receive the Access-Control-Allow-Origin
// header, and credentials (cookies) are allowed for those origins. Preflight
// OPTIONS requests are handled with a 204 No Content response.
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// allowedOrigins is the set of origins permitted to make credentialed
// cross-origin requests. Production and local development origins only.
var allowedOrigins = map[string]bool{
	"https://meta.callsphere.tech": true,
	"http://localhost:3000":         true,
}

// CORSMiddleware sets CORS headers for allowed origins and short-circuits
// preflight OPTIONS requests. The Vary: Origin header ensures CDNs/proxies
// don't serve cached responses with the wrong origin header.
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		if allowedOrigins[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, Accept, X-Request-ID, X-Changed-By")
		c.Header("Vary", "Origin")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
