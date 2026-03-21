package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// ── Test 7: resolveRPM returns route-specific limit for /api/ai/chat ────
func TestResolveRPMChatRoute(t *testing.T) {
	rpm := resolveRPM("/api/ai/chat", 100)
	if rpm != 30 {
		t.Errorf("resolveRPM(/api/ai/chat) = %d, want 30", rpm)
	}
}

// ── Test 8: resolveRPM returns default for unknown routes ───────────────
func TestResolveRPMDefaultRoute(t *testing.T) {
	rpm := resolveRPM("/api/requisitions", 100)
	if rpm != 100 {
		t.Errorf("resolveRPM(/api/requisitions) = %d, want 100", rpm)
	}
}

// ── Test 9: resolveRPM returns route-specific limit for data-upload ─────
func TestResolveRPMUploadRoute(t *testing.T) {
	rpm := resolveRPM("/api/data-upload", 100)
	if rpm != 5 {
		t.Errorf("resolveRPM(/api/data-upload) = %d, want 5", rpm)
	}
}

// ── Test 10: CORS sets headers for allowed origin ───────────────────────
func TestCORSAllowedOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)

	r.Use(CORSMiddleware())
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	c.Request, _ = http.NewRequest("GET", "/test", nil)
	c.Request.Header.Set("Origin", "https://meta.callsphere.tech")
	r.ServeHTTP(w, c.Request)

	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "https://meta.callsphere.tech" {
		t.Errorf("CORS origin = %q, want %q", origin, "https://meta.callsphere.tech")
	}

	creds := w.Header().Get("Access-Control-Allow-Credentials")
	if creds != "true" {
		t.Errorf("CORS credentials = %q, want %q", creds, "true")
	}
}

// ── Test 11: CORS does not set Allow-Origin for unauthorized origin ─────
func TestCORSBlocksUnauthorizedOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)

	r.Use(CORSMiddleware())
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	c.Request, _ = http.NewRequest("GET", "/test", nil)
	c.Request.Header.Set("Origin", "https://evil.example.com")
	r.ServeHTTP(w, c.Request)

	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "" {
		t.Errorf("CORS should not set Allow-Origin for evil origin, got %q", origin)
	}
}

// ── Test 12: CORS preflight returns 204 ─────────────────────────────────
func TestCORSPreflightReturns204(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, r := gin.CreateTestContext(w)

	r.Use(CORSMiddleware())
	r.OPTIONS("/test", func(c *gin.Context) {
		c.String(200, "should not reach here")
	})

	c.Request, _ = http.NewRequest("OPTIONS", "/test", nil)
	c.Request.Header.Set("Origin", "https://meta.callsphere.tech")
	r.ServeHTTP(w, c.Request)

	if w.Code != http.StatusNoContent {
		t.Errorf("OPTIONS response code = %d, want %d", w.Code, http.StatusNoContent)
	}
}

// ── Test 13: RequireRole blocks user with wrong role ────────────────────
func TestRequireRoleBlocksUnauthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(func(c *gin.Context) {
		c.Set("user_role", "viewer")
		c.Set("user_email", "viewer@test.com")
		c.Next()
	})
	r.Use(RequireRole("admin", "manager"))
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("RequireRole response code = %d, want %d", w.Code, http.StatusForbidden)
	}

	if !strings.Contains(w.Body.String(), "Insufficient permissions") {
		t.Errorf("expected 'Insufficient permissions' in body, got %q", w.Body.String())
	}
}

// ── Test 14: RequireRole allows user with correct role (case-insensitive)
func TestRequireRoleAllowsAuthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	_, r := gin.CreateTestContext(w)

	r.Use(func(c *gin.Context) {
		c.Set("user_role", "ADMIN") // uppercase — should still match "admin"
		c.Next()
	})
	r.Use(RequireRole("admin", "manager"))
	r.GET("/test", func(c *gin.Context) {
		c.String(200, "ok")
	})

	req, _ := http.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("RequireRole response code = %d, want %d", w.Code, http.StatusOK)
	}
}
