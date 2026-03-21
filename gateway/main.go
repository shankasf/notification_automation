// File: main.go
// Gateway entry point for the MetaSource hiring-request management platform.
// This service acts as the API gateway: it connects to PostgreSQL, registers
// all HTTP routes (public + authenticated), starts background SQS consumers
// and scheduled tasks (summarization, anomaly scans), and handles graceful
// shutdown of every subsystem in the correct order.
package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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

	// ── Public routes (no auth) ─────────────────────────────
	r.GET("/health", handlers.HealthCheck(pythonURL))
	r.GET("/api/health", handlers.HealthCheck(pythonURL))

	// WebSocket (auth handled inside the handler via token query param)
	r.GET("/ws/notifications", handlers.HandleWebSocket)

	// ── Authenticated routes ────────────────────────────────
	auth := r.Group("/")
	auth.Use(middleware.AuthMiddleware())
	auth.Use(middleware.AuditMiddleware())
	auth.Use(middleware.RateLimitMiddleware(100)) // per-user rate limiting (uses user_email from auth)

	// -- Admin-only routes --
	admin := auth.Group("/")
	admin.Use(middleware.RequireRole("admin"))
	{
		admin.GET("/api/managers", handlers.GetManagers)
		admin.GET("/api/debug/stats", handlers.DebugStats)
		admin.POST("/api/data-upload", handlers.DataUpload(pythonURL))
		admin.POST("/api/data-upload/progress", handlers.UploadProgress)
		admin.POST("/api/sns/setup", handlers.SetupSNS)
	}

	// -- Admin + Manager routes --
	authenticated := auth.Group("/")
	authenticated.Use(middleware.RequireRole("admin", "manager"))
	{
		// Stats
		authenticated.GET("/api/stats", handlers.GetStats)

		// Requisitions (direct DB)
		authenticated.GET("/api/requisitions", handlers.ListRequisitions)
		authenticated.POST("/api/requisitions", handlers.CreateRequisition)
		authenticated.GET("/api/requisitions/:id", handlers.GetRequisition)
		authenticated.PUT("/api/requisitions/:id", handlers.UpdateRequisition)
		authenticated.DELETE("/api/requisitions/:id", handlers.DeleteRequisition)

		// CSV Upload
		authenticated.POST("/api/requisitions/upload", handlers.UploadCSV)

		// AI Service (proxy to Python)
		aiProxy := handlers.GenericProxyHandler(pythonURL)
		authenticated.POST("/api/ai/chat", aiProxy)
		authenticated.POST("/api/ai/summarize", aiProxy)
		authenticated.POST("/api/ai/analyze", aiProxy)
		authenticated.POST("/api/ai/detect-changes", aiProxy)
		authenticated.POST("/api/ai/scrape", aiProxy)
		authenticated.GET("/api/ai/health", aiProxy)

		// Data Upload status
		authenticated.GET("/api/data-upload/:jobId/status", handlers.GenericProxyHandler(pythonURL))

		// Notifications (direct DB)
		authenticated.GET("/api/notifications", handlers.ListNotifications)
		authenticated.PUT("/api/notifications", handlers.MarkNotificationsRead)

		// Changes (direct DB)
		authenticated.GET("/api/changes", handlers.ListChanges)

		// Market Rates (direct DB)
		authenticated.GET("/api/market-rates", handlers.GetMarketRates)

		// SNS status (read-only)
		authenticated.GET("/api/sns/setup", handlers.GetSNSStatus)
	}

	// ── Start SQS consumers ─────────────────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	consumerWg := handlers.StartSQSConsumers(ctx)

	// ── Create CloudWatch alarms (non-blocking, log-only on failure) ──
	go func() {
		handlers.CreateAlarms()
	}()

	// ── Start scheduled tasks (replaces Python cron jobs) ──
	handlers.StartScheduledTasks(ctx, consumerWg)

	// ── Start HTTP server with graceful shutdown ─────────────
	srv := &http.Server{Addr: ":" + port, Handler: r}

	go func() {
		slog.Info("starting gateway", "port", port, "python_backend", pythonURL)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	slog.Info("shutting down...")

	// Flush any pending audit log entries before connections close
	middleware.FlushAuditLog()

	// Stop SQS consumers first (cancel context, then wait for in-flight messages)
	cancel()
	consumerWg.Wait()

	// Gracefully shut down the HTTP server with a 15-second deadline
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server_shutdown_error", "error", err)
	}

	slog.Info("gateway stopped")
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
