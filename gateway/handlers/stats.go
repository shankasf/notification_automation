package handlers

import (
	"net/http"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

func GetStats(c *gin.Context) {
	managerID := c.Query("managerId")

	// If managerId provided, find their category
	var categoryFilter string
	if managerID != "" {
		db.DB.QueryRow(`SELECT category FROM "SourcingManager" WHERE id = $1`, managerID).Scan(&categoryFilter)
	}

	whereClause := ""
	var args []interface{}
	if categoryFilter != "" {
		whereClause = `WHERE category = $1`
		args = append(args, categoryFilter)
	}

	// Totals
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
		FROM "Requisition" `+whereClause, args...)

	row.Scan(&totalReqs, &hcNeeded, &hcFilled, &budgetAlloc, &budgetSpent, &criticalCount)

	// By category
	catRows, _ := db.DB.Query(`
		SELECT category, COUNT(*) FROM "Requisition" ` + whereClause + ` GROUP BY category`, args...)
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

	// By status
	statusRows, _ := db.DB.Query(`
		SELECT status, COUNT(*) FROM "Requisition" ` + whereClause + ` GROUP BY status`, args...)
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
