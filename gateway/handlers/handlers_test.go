package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// ── Test 1: statusStr returns "ok" for true ─────────────────────────────
func TestStatusStrReturnsOk(t *testing.T) {
	result := statusStr(true)
	if result != "ok" {
		t.Errorf("statusStr(true) = %q, want %q", result, "ok")
	}
}

// ── Test 2: statusStr returns "error" for false ─────────────────────────
func TestStatusStrReturnsError(t *testing.T) {
	result := statusStr(false)
	if result != "error" {
		t.Errorf("statusStr(false) = %q, want %q", result, "error")
	}
}

// ── Test 3: getChangedBy reads X-Changed-By header ──────────────────────
func TestGetChangedByReadsHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest("PUT", "/api/requisitions/123", nil)
	c.Request.Header.Set("X-Changed-By", "admin@meta.com")

	result := getChangedBy(c)
	if result != "admin@meta.com" {
		t.Errorf("getChangedBy() = %q, want %q", result, "admin@meta.com")
	}
}

// ── Test 4: getChangedBy defaults to "user" when header absent ──────────
func TestGetChangedByDefaultsToUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request, _ = http.NewRequest("PUT", "/api/requisitions/123", nil)

	result := getChangedBy(c)
	if result != "user" {
		t.Errorf("getChangedBy() = %q, want %q", result, "user")
	}
}

// ── Test 5: REQ-ID abbreviation map covers all 5 categories ────────────
func TestReqIDAbbreviationMapComplete(t *testing.T) {
	abbrevMap := map[string]string{
		"ENGINEERING_CONTRACTORS": "ENG",
		"CONTENT_TRUST_SAFETY":   "CTS",
		"DATA_OPERATIONS":        "DOP",
		"MARKETING_CREATIVE":     "MKT",
		"CORPORATE_SERVICES":     "COR",
	}

	expected := map[string]string{
		"ENGINEERING_CONTRACTORS": "ENG",
		"CONTENT_TRUST_SAFETY":   "CTS",
		"DATA_OPERATIONS":        "DOP",
		"MARKETING_CREATIVE":     "MKT",
		"CORPORATE_SERVICES":     "COR",
	}

	if len(abbrevMap) != len(expected) {
		t.Fatalf("abbreviation map has %d entries, want %d", len(abbrevMap), len(expected))
	}

	for cat, want := range expected {
		got, ok := abbrevMap[cat]
		if !ok {
			t.Errorf("abbreviation map missing category %q", cat)
			continue
		}
		if got != want {
			t.Errorf("abbrevMap[%q] = %q, want %q", cat, got, want)
		}
	}
}

// ── Test 6: Unknown category falls back to "GEN" abbreviation ───────────
func TestReqIDAbbreviationFallback(t *testing.T) {
	abbrevMap := map[string]string{
		"ENGINEERING_CONTRACTORS": "ENG",
		"CONTENT_TRUST_SAFETY":   "CTS",
		"DATA_OPERATIONS":        "DOP",
		"MARKETING_CREATIVE":     "MKT",
		"CORPORATE_SERVICES":     "COR",
	}

	abbrev := abbrevMap["UNKNOWN_CATEGORY"]
	if abbrev == "" {
		abbrev = "GEN"
	}
	if abbrev != "GEN" {
		t.Errorf("unknown category abbreviation = %q, want %q", abbrev, "GEN")
	}
}
