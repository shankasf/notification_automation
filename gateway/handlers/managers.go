package handlers

import (
	"net/http"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

func GetManagers(c *gin.Context) {
	rows, err := db.DB.Query(`
		SELECT m.id, m.name, m.email, m.category, m."avatarUrl",
			COALESCE(r.total, 0) as total_reqs,
			COALESCE(r.hc_gap, 0) as hc_gap,
			COALESCE(n.unread, 0) as unread
		FROM "SourcingManager" m
		LEFT JOIN (
			SELECT category, COUNT(*) as total,
				SUM("headcountNeeded") - SUM("headcountFilled") as hc_gap
			FROM "Requisition"
			WHERE status NOT IN ('COMPLETED', 'CANCELLED')
			GROUP BY category
		) r ON r.category = m.category
		LEFT JOIN (
			SELECT "managerId", COUNT(*) as unread
			FROM "Notification" WHERE "isRead" = false
			GROUP BY "managerId"
		) n ON n."managerId" = m.id
		ORDER BY m.name
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var managers []gin.H
	for rows.Next() {
		var id, name, email, category string
		var avatarUrl *string
		var totalReqs, hcGap, unread int

		if err := rows.Scan(&id, &name, &email, &category, &avatarUrl, &totalReqs, &hcGap, &unread); err != nil {
			continue
		}

		m := gin.H{
			"id":                  id,
			"name":                name,
			"email":               email,
			"category":            category,
			"avatarUrl":           avatarUrl,
			"totalReqs":           totalReqs,
			"headcountGap":        hcGap,
			"unreadNotifications": unread,
		}
		managers = append(managers, m)
	}

	if managers == nil {
		managers = []gin.H{}
	}
	c.JSON(http.StatusOK, managers)
}
