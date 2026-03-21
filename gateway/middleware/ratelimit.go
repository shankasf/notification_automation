package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

type limiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

var (
	limiters = make(map[string]*limiterEntry)
	mu       sync.Mutex
)

// Route-specific rate limits (requests per minute).
var routeLimits = map[string]int{
	"/api/ai/chat":    30, // expensive LLM calls
	"/api/data-upload": 5,  // heavy processing
}

func init() {
	// Cleanup stale limiters every 5 minutes
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			mu.Lock()
			for key, entry := range limiters {
				if time.Since(entry.lastSeen) > 10*time.Minute {
					delete(limiters, key)
				}
			}
			mu.Unlock()
		}
	}()
}

func getLimiter(key string, rpm int) *rate.Limiter {
	mu.Lock()
	defer mu.Unlock()
	if entry, ok := limiters[key]; ok {
		entry.lastSeen = time.Now()
		return entry.limiter
	}
	// Convert requests-per-minute to a rate.Limit (per second) with burst = rpm
	rps := rate.Limit(float64(rpm) / 60.0)
	lim := rate.NewLimiter(rps, rpm)
	limiters[key] = &limiterEntry{limiter: lim, lastSeen: time.Now()}
	return lim
}

// limiterKey returns the best available identifier for the requester.
// After AuthMiddleware sets "user_email", that is used; otherwise falls back to client IP.
func limiterKey(c *gin.Context) string {
	if email := c.GetString("user_email"); email != "" {
		return "user:" + email
	}
	return "ip:" + c.ClientIP()
}

// resolveRPM returns the requests-per-minute limit for a given path,
// checking route-specific overrides first, then falling back to the default.
func resolveRPM(path string, defaultRPM int) int {
	for prefix, rpm := range routeLimits {
		if strings.HasPrefix(path, prefix) {
			return rpm
		}
	}
	return defaultRPM
}

// RateLimitMiddleware applies a default requests-per-minute limit.
// For pre-auth (public) routes, the key is the client IP.
// For authenticated routes where user_email is set in context, the key is the user email.
// Certain routes have stricter per-route limits.
func RateLimitMiddleware(defaultRPM int) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := limiterKey(c)
		rpm := resolveRPM(c.Request.URL.Path, defaultRPM)

		// Composite key includes the route limit bucket so that
		// a user's chat limit is tracked separately from their default limit.
		bucketKey := key
		if rpm != defaultRPM {
			bucketKey = key + "|" + c.Request.URL.Path
		}

		lim := getLimiter(bucketKey, rpm)
		if !lim.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
			})
			return
		}
		c.Next()
	}
}
