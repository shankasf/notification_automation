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

func ListChanges(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "25"))
	if pageSize > 100 {
		pageSize = 100
	}
	if page < 1 {
		page = 1
	}

	managerID := c.Query("managerId")
	reqFilter := c.Query("requisitionId")
	changeType := c.Query("changeType")
	dateFrom := c.Query("dateFrom")
	dateTo := c.Query("dateTo")

	conditions := []string{}
	args := []interface{}{}
	argIdx := 1

	if reqFilter != "" {
		conditions = append(conditions, fmt.Sprintf(`rc."requisitionId" = $%d`, argIdx))
		args = append(args, reqFilter)
		argIdx++
	}
	if changeType != "" {
		conditions = append(conditions, fmt.Sprintf(`rc."changeType" = $%d`, argIdx))
		args = append(args, changeType)
		argIdx++
	}
	if dateFrom != "" {
		conditions = append(conditions, fmt.Sprintf(`rc."createdAt" >= $%d`, argIdx))
		args = append(args, dateFrom)
		argIdx++
	}
	if dateTo != "" {
		conditions = append(conditions, fmt.Sprintf(`rc."createdAt" <= $%d::date + interval '1 day'`, argIdx))
		args = append(args, dateTo)
		argIdx++
	}
	if managerID != "" {
		var cat string
		db.DB.QueryRow(`SELECT category FROM "SourcingManager" WHERE id = $1`, managerID).Scan(&cat)
		if cat != "" {
			conditions = append(conditions, fmt.Sprintf(`r.category = $%d`, argIdx))
			args = append(args, cat)
			argIdx++
		}
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Count
	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	db.DB.QueryRow(`
		SELECT COUNT(*) FROM "RequisitionChange" rc
		JOIN "Requisition" r ON rc."requisitionId" = r.id
	`+where, countArgs...).Scan(&total)

	// Fetch
	offset := (page - 1) * pageSize
	args = append(args, pageSize, offset)

	query := fmt.Sprintf(`
		SELECT rc.id, rc."requisitionId", rc."changeType", rc."fieldChanged",
			rc."oldValue", rc."newValue", rc."changedBy", rc.summary, rc."createdAt",
			r."requisitionId", r."roleTitle", r.category
		FROM "RequisitionChange" rc
		JOIN "Requisition" r ON rc."requisitionId" = r.id
		%s
		ORDER BY rc."createdAt" DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	changes := []gin.H{}
	for rows.Next() {
		var id, reqUUID, chType, changedBy, rReqID, rRole, rCat string
		var fieldChanged, oldVal, newVal, summary *string
		var createdAt time.Time

		rows.Scan(&id, &reqUUID, &chType, &fieldChanged,
			&oldVal, &newVal, &changedBy, &summary, &createdAt,
			&rReqID, &rRole, &rCat)

		changes = append(changes, gin.H{
			"id":            id,
			"requisitionId": reqUUID,
			"changeType":    chType,
			"fieldChanged":  fieldChanged,
			"oldValue":      oldVal,
			"newValue":      newVal,
			"changedBy":     changedBy,
			"summary":       summary,
			"createdAt":     createdAt,
			"requisition": gin.H{
				"requisitionId": rReqID,
				"roleTitle":     rRole,
				"category":      rCat,
			},
		})
	}

	totalPages := (total + pageSize - 1) / pageSize
	c.JSON(http.StatusOK, gin.H{
		"changes":    changes,
		"total":      total,
		"page":       page,
		"pageSize":   pageSize,
		"totalPages": totalPages,
	})
}
