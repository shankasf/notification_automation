package handlers

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

// GenericProxyHandler proxies any request to the Python AI service
func GenericProxyHandler(pythonURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		targetURL := pythonURL + c.Request.URL.Path
		if c.Request.URL.RawQuery != "" {
			targetURL += "?" + c.Request.URL.RawQuery
		}

		reqID, _ := c.Get("request_id")

		body, err := io.ReadAll(c.Request.Body)
		c.Request.Body.Close()
		if err != nil {
			slog.Error("proxy_body_read_error", "error", err, "request_id", reqID)
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read request body"})
			return
		}

		req, err := http.NewRequest(c.Request.Method, targetURL, io.NopCloser(
			&bodyReader{data: body},
		))
		if err != nil {
			slog.Error("proxy_request_create_error", "error", err, "request_id", reqID)
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to create proxy request"})
			return
		}

		// Forward headers
		for key, vals := range c.Request.Header {
			for _, val := range vals {
				req.Header.Add(key, val)
			}
		}
		if rid, ok := reqID.(string); ok {
			req.Header.Set("X-Request-ID", rid)
		}
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			slog.Error("proxy_request_error", "error", err, "target", targetURL, "request_id", reqID)
			c.JSON(http.StatusBadGateway, gin.H{"error": "AI service unavailable"})
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for key, vals := range resp.Header {
			for _, val := range vals {
				c.Header(key, val)
			}
		}

		respBody, _ := io.ReadAll(resp.Body)
		c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), respBody)
	}
}

type bodyReader struct {
	data []byte
	pos  int
}

func (b *bodyReader) Read(p []byte) (n int, err error) {
	if b.pos >= len(b.data) {
		return 0, io.EOF
	}
	n = copy(p, b.data[b.pos:])
	b.pos += n
	return
}
