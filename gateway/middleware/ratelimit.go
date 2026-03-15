package middleware

import (
	"net/http"
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

func init() {
	// Cleanup stale limiters every 5 minutes
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			mu.Lock()
			for ip, entry := range limiters {
				if time.Since(entry.lastSeen) > 10*time.Minute {
					delete(limiters, ip)
				}
			}
			mu.Unlock()
		}
	}()
}

func getLimiter(ip string, rps int) *rate.Limiter {
	mu.Lock()
	defer mu.Unlock()
	if entry, ok := limiters[ip]; ok {
		entry.lastSeen = time.Now()
		return entry.limiter
	}
	lim := rate.NewLimiter(rate.Limit(rps), rps*2)
	limiters[ip] = &limiterEntry{limiter: lim, lastSeen: time.Now()}
	return lim
}

func RateLimitMiddleware(rps int) gin.HandlerFunc {
	return func(c *gin.Context) {
		lim := getLimiter(c.ClientIP(), rps)
		if !lim.Allow() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
			})
			return
		}
		c.Next()
	}
}
