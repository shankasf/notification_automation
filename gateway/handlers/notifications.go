// File: notifications.go
// Provides endpoints for listing and marking notifications as read.
// Notifications are created by various subsystems (CSV import, anomaly detection,
// requisition CRUD) and stored in the Notification table. Each notification
// belongs to a specific manager via managerId.
package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
)

// ListNotifications returns a paginated list of notifications, optionally
// filtered by managerId, notification type, and unread-only flag.
func ListNotifications(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "25"))
	if pageSize > 100 {
		pageSize = 100
	}

	managerID := c.Query("managerId")
	nType := c.Query("type")
	unreadOnly := c.Query("unreadOnly")

	conditions := []string{}
	args := []interface{}{}
	argIdx := 1

	if managerID != "" {
		conditions = append(conditions, fmt.Sprintf(`"managerId" = $%d`, argIdx))
		args = append(args, managerID)
		argIdx++
	}
	if nType != "" {
		conditions = append(conditions, fmt.Sprintf(`type = $%d`, argIdx))
		args = append(args, nType)
		argIdx++
	}
	if unreadOnly == "true" {
		conditions = append(conditions, `"isRead" = false`)
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	db.DB.QueryRow(`SELECT COUNT(*) FROM "Notification" `+where, countArgs...).Scan(&total)

	offset := (page - 1) * pageSize
	args = append(args, pageSize, offset)

	query := fmt.Sprintf(`
		SELECT id, "managerId", type, title, message, "isRead", "createdAt"
		FROM "Notification" %s
		ORDER BY "createdAt" DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	notifs := []gin.H{}
	for rows.Next() {
		var id, manID, ntype, title, message string
		var isRead bool
		var createdAt time.Time

		rows.Scan(&id, &manID, &ntype, &title, &message, &isRead, &createdAt)
		notifs = append(notifs, gin.H{
			"id":        id,
			"managerId": manID,
			"type":      ntype,
			"title":     title,
			"message":   message,
			"isRead":    isRead,
			"createdAt": createdAt,
		})
	}

	totalPages := (total + pageSize - 1) / pageSize
	c.JSON(http.StatusOK, gin.H{
		"notifications": notifs,
		"total":         total,
		"page":          page,
		"pageSize":      pageSize,
		"totalPages":    totalPages,
	})
}

// MarkReadBody supports two modes: mark specific notifications by ID, or
// mark all notifications as read (optionally scoped to a manager).
type MarkReadBody struct {
	IDs     []string `json:"ids"`
	MarkAll bool     `json:"markAll"`
}

// MarkNotificationsRead handles PUT /api/notifications. Supports bulk mark-read
// by IDs or mark-all (scoped to a manager if managerId query param is provided).
func MarkNotificationsRead(c *gin.Context) {
	var body MarkReadBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if body.MarkAll {
		// When managerId is present, scope the update to that manager's notifications.
		// Otherwise (admin view), mark all unread notifications system-wide.
		managerID := c.Query("managerId")
		if managerID != "" {
			db.DB.Exec(`UPDATE "Notification" SET "isRead" = true WHERE "managerId" = $1`, managerID)
		} else {
			db.DB.Exec(`UPDATE "Notification" SET "isRead" = true WHERE "isRead" = false`)
		}
		c.JSON(http.StatusOK, gin.H{"updated": true})
		return
	}

	if len(body.IDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No IDs provided"})
		return
	}

	// Build dynamic IN clause with positional parameters to avoid SQL injection
	placeholders := make([]string, len(body.IDs))
	args := make([]interface{}, len(body.IDs))
	for i, id := range body.IDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(`UPDATE "Notification" SET "isRead" = true WHERE id IN (%s)`,
		strings.Join(placeholders, ", "))
	db.DB.Exec(query, args...)

	c.JSON(http.StatusOK, gin.H{"updated": len(body.IDs)})
}
