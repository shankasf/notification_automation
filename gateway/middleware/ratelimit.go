// File: ratelimit.go
// Implements per-user (or per-IP for unauthenticated requests) rate limiting
// using token-bucket rate limiters from golang.org/x/time/rate. Each user gets
// a default requests-per-minute budget, with route-specific overrides for
// expensive operations (e.g., AI chat calls, data uploads). Limiters are keyed
// by user email (post-auth) or client IP (pre-auth). A background goroutine
// evicts stale limiter entries every 5 minutes to prevent memory leaks.
package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// limiterEntry pairs a token-bucket limiter with a timestamp so stale entries
// can be garbage-collected by the cleanup goroutine.
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
	// Evict limiter entries that haven't been seen in 10 minutes to prevent
	// unbounded memory growth from one-off visitors.
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

// getLimiter returns the existing limiter for a key or creates a new one.
// Burst size equals the RPM so that short bursts within a minute are allowed
// as long as the average rate stays below the limit.
func getLimiter(key string, rpm int) *rate.Limiter {
	mu.Lock()
	defer mu.Unlock()
	if entry, ok := limiters[key]; ok {
		entry.lastSeen = time.Now()
		return entry.limiter
	}
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
