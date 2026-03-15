package main

import (
	"log"
	"log/slog"
	"os"

	"metasource-gateway/db"
	"metasource-gateway/handlers"
	"metasource-gateway/middleware"

	"github.com/gin-gonic/gin"
)

func main() {
	// Structured JSON logging
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	// Connect to PostgreSQL
	if err := db.Connect(); err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer db.DB.Close()
	slog.Info("database connected")

	pythonURL := getEnv("PYTHON_BACKEND", "http://meta-ai:8000")
	port := getEnv("PORT", "8080")

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()

	// Middleware stack (order matters)
	r.Use(middleware.RecoveryMiddleware())
	r.Use(middleware.RequestLoggingMiddleware())
	r.Use(middleware.CORSMiddleware())
	r.Use(middleware.RateLimitMiddleware(100))

	// ── Health ───────────────────────────────────────────────
	r.GET("/health", handlers.HealthCheck(pythonURL))
	r.GET("/api/health", handlers.HealthCheck(pythonURL))
	r.GET("/api/debug/stats", handlers.DebugStats)

	// ── WebSocket (real-time notifications) ──────────────────
	r.GET("/ws/notifications", handlers.HandleWebSocket)

	// ── Managers ─────────────────────────────────────────────
	r.GET("/api/managers", handlers.GetManagers)

	// ── Stats ────────────────────────────────────────────────
	r.GET("/api/stats", handlers.GetStats)

	// ── Requisitions (direct DB) ─────────────────────────────
	r.GET("/api/requisitions", handlers.ListRequisitions)
	r.POST("/api/requisitions", handlers.CreateRequisition)
	r.GET("/api/requisitions/:id", handlers.GetRequisition)
	r.PUT("/api/requisitions/:id", handlers.UpdateRequisition)
	r.DELETE("/api/requisitions/:id", handlers.DeleteRequisition)

	// ── CSV Upload ───────────────────────────────────────────
	r.POST("/api/requisitions/upload", handlers.UploadCSV)

	// ── Notifications (direct DB) ────────────────────────────
	r.GET("/api/notifications", handlers.ListNotifications)
	r.PUT("/api/notifications", handlers.MarkNotificationsRead)

	// ── Changes (direct DB) ──────────────────────────────────
	r.GET("/api/changes", handlers.ListChanges)

	// ── Market Rates (direct DB) ─────────────────────────────
	r.GET("/api/market-rates", handlers.GetMarketRates)

	// ── SNS Setup ───────────────────────────────────────────
	r.POST("/api/sns/setup", handlers.SetupSNS)
	r.GET("/api/sns/setup", handlers.GetSNSStatus)

	// ── AI Service (proxy to Python) ─────────────────────────
	aiProxy := handlers.GenericProxyHandler(pythonURL)
	r.POST("/api/ai/chat", aiProxy)
	r.POST("/api/ai/summarize", aiProxy)
	r.POST("/api/ai/analyze", aiProxy)
	r.POST("/api/ai/detect-changes", aiProxy)
	r.POST("/api/ai/scrape", aiProxy)
	r.GET("/api/ai/health", aiProxy)

	slog.Info("starting gateway", "port", port, "python_backend", pythonURL)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
