// File: stats.go
// Provides GET /api/stats which returns aggregated dashboard statistics:
// total active requisitions, headcount gap, budget allocation vs spend,
// critical-priority count, and breakdowns by category and status.
// When managerId is provided, results are scoped to that manager's category.
package handlers

import (
	"net/http"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

// GetStats computes and returns dashboard-level statistics. Uses two separate
// WHERE clause strategies: "active" (excludes COMPLETED/CANCELLED) for headline
// KPIs, and "all" (includes every status) for the status distribution chart.
func GetStats(c *gin.Context) {
	managerID := c.Query("managerId")

	// If managerId provided, find their category
	var categoryFilter string
	if managerID != "" {
		db.DB.QueryRow(`SELECT category FROM "SourcingManager" WHERE id = $1`, managerID).Scan(&categoryFilter)
	}

	// Base filter: optional category
	allWhereClause := ""
	var allArgs []interface{}
	if categoryFilter != "" {
		allWhereClause = `WHERE category = $1`
		allArgs = append(allArgs, categoryFilter)
	}

	// Active filter: exclude completed/cancelled for headline stats
	activeWhereClause := `WHERE status NOT IN ('COMPLETED', 'CANCELLED')`
	var activeArgs []interface{}
	if categoryFilter != "" {
		activeWhereClause = `WHERE status NOT IN ('COMPLETED', 'CANCELLED') AND category = $1`
		activeArgs = append(activeArgs, categoryFilter)
	}

	// Totals (active only)
	var totalReqs int
	var hcNeeded, hcFilled int
	var budgetAlloc, budgetSpent float64
	var criticalCount int

	row := db.DB.QueryRow(`
		SELECT COUNT(*),
			COALESCE(SUM("headcountNeeded"), 0),
			COALESCE(SUM("headcountFilled"), 0),
			COALESCE(SUM("budgetAllocated"), 0),
			COALESCE(SUM("budgetSpent"), 0),
			COUNT(*) FILTER (WHERE priority = 'CRITICAL')
		FROM "Requisition" `+activeWhereClause, activeArgs...)

	row.Scan(&totalReqs, &hcNeeded, &hcFilled, &budgetAlloc, &budgetSpent, &criticalCount)

	// By category (active only)
	catRows, _ := db.DB.Query(`
		SELECT category, COUNT(*) FROM "Requisition" `+activeWhereClause+` GROUP BY category`, activeArgs...)
	byCategory := gin.H{}
	if catRows != nil {
		defer catRows.Close()
		for catRows.Next() {
			var cat string
			var cnt int
			catRows.Scan(&cat, &cnt)
			byCategory[cat] = cnt
		}
	}

	// By status — includes ALL statuses for distribution chart
	statusRows, _ := db.DB.Query(`
		SELECT status, COUNT(*) FROM "Requisition" `+allWhereClause+` GROUP BY status`, allArgs...)
	byStatus := gin.H{}
	if statusRows != nil {
		defer statusRows.Close()
		for statusRows.Next() {
			var st string
			var cnt int
			statusRows.Scan(&st, &cnt)
			byStatus[st] = cnt
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"totalReqs":       totalReqs,
		"headcountGap":    hcNeeded - hcFilled,
		"budgetAllocated": budgetAlloc,
		"budgetSpent":     budgetSpent,
		"criticalCount":   criticalCount,
		"byCategory":      byCategory,
		"byStatus":        byStatus,
	})
}
