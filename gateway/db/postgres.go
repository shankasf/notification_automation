// Package db manages the PostgreSQL connection pool used by all handlers.
// It exposes a single package-level *sql.DB that is initialized once at
// startup via Connect(). Connection parameters are read from environment
// variables (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME) so that
// credentials are never hardcoded.
package db

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"time"

	_ "github.com/lib/pq"
)

// DB is the shared connection pool. Initialized by Connect(), closed in main().
var DB *sql.DB

// Connect validates that all required env vars are present, opens a connection
// pool with tuned limits, and pings the database to verify connectivity.
func Connect() error {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")
	dbname := os.Getenv("DB_NAME")

	// Fail fast if required credentials are missing
	var missing []string
	if host == "" {
		missing = append(missing, "DB_HOST")
	}
	if port == "" {
		missing = append(missing, "DB_PORT")
	}
	if user == "" {
		missing = append(missing, "DB_USER")
	}
	if password == "" {
		missing = append(missing, "DB_PASSWORD")
	}
	if dbname == "" {
		missing = append(missing, "DB_NAME")
	}
	if len(missing) > 0 {
		return fmt.Errorf("required database environment variables not set: %v", missing)
	}

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		host, port, user, password, dbname)

	var err error
	DB, err = sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Pool tuning: 25 max open prevents exhausting PostgreSQL's default 100-connection limit
	// across multiple gateway replicas. 5-minute lifetime forces periodic reconnection
	// to pick up DNS changes and release server-side resources.
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(10)
	DB.SetConnMaxLifetime(5 * time.Minute)

	if err = DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	slog.Info("connected to PostgreSQL", "host", host, "db", dbname)
	return nil
}
