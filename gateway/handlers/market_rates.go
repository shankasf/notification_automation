// File: market_rates.go
// Provides GET /api/market-rates which returns three datasets in a single
// response: external market rate benchmarks (from the MarketRate table),
// internal rate averages (aggregated from live Requisition data), and recent
// scrape logs showing the history of external data collection runs.
// This powers the market rate comparison dashboard in the frontend.
package handlers

import (
	"net/http"
	"time"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

// GetMarketRates returns market rates, internal rate averages, and scrape logs.
// If managerId is provided without a category, the manager's category is resolved
// automatically so the response is scoped to their domain.
func GetMarketRates(c *gin.Context) {
	managerID := c.Query("managerId")
	category := c.Query("category")

	// If managerId provided, find their category
	if managerID != "" && category == "" {
		db.DB.QueryRow(`SELECT category FROM "SourcingManager" WHERE id = $1`, managerID).Scan(&category)
	}

	// Build WHERE clause
	whereClause := ""
	var args []interface{}
	if category != "" {
		whereClause = `WHERE category = $1`
		args = append(args, category)
	}

	// Market rates
	query := `SELECT id, "roleTitle", category, location, "minRate", "maxRate", "medianRate", source, "scrapedAt"
		FROM "MarketRate" ` + whereClause + ` ORDER BY category ASC, "roleTitle" ASC`
	rows, err := db.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	rates := []gin.H{}
	for rows.Next() {
		var id, role, cat, loc, source string
		var minR, maxR, medR float64
		var scrapedAt time.Time
		rows.Scan(&id, &role, &cat, &loc, &minR, &maxR, &medR, &source, &scrapedAt)
		rates = append(rates, gin.H{
			"id":         id,
			"roleTitle":  role,
			"category":   cat,
			"location":   loc,
			"minRate":    minR,
			"maxRate":    maxR,
			"medianRate": medR,
			"source":     source,
			"scrapedAt":  scrapedAt,
		})
	}

	// Internal rate averages — aggregated from live requisition data so managers
	// can compare their actual bill rates against external benchmarks
	intQuery := `SELECT "roleTitle", category, AVG("billRateHourly") as avg_rate, COUNT(*) as count
		FROM "Requisition" ` + whereClause + `
		GROUP BY "roleTitle", category
		ORDER BY category, "roleTitle"`
	intRows, _ := db.DB.Query(intQuery, args...)
	internalRates := []gin.H{}
	if intRows != nil {
		defer intRows.Close()
		for intRows.Next() {
			var role, cat string
			var avgRate float64
			var count int
			intRows.Scan(&role, &cat, &avgRate, &count)
			internalRates = append(internalRates, gin.H{
				"roleTitle": role, "category": cat,
				"avgRate": avgRate, "count": count,
			})
		}
	}

	// Scrape logs — last 20 runs of the external rate-scraping jobs for audit/debugging
	logRows, _ := db.DB.Query(`
		SELECT id, source, "rolesScraped", status, duration, error, "createdAt"
		FROM "ScrapeLog" ORDER BY "createdAt" DESC LIMIT 20
	`)
	logs := []gin.H{}
	if logRows != nil {
		defer logRows.Close()
		for logRows.Next() {
			var id, source, status string
			var rolesScraped, duration int
			var scrapeErr *string
			var createdAt time.Time
			logRows.Scan(&id, &source, &rolesScraped, &status, &duration, &scrapeErr, &createdAt)
			logs = append(logs, gin.H{
				"id": id, "source": source, "rolesScraped": rolesScraped,
				"status": status, "duration": duration, "error": scrapeErr,
				"createdAt": createdAt,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"marketRates":   rates,
		"internalRates": internalRates,
		"scrapeLogs":    logs,
	})
}
