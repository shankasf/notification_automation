package handlers

import (
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func ListRequisitions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "25"))
	if pageSize > 100 {
		pageSize = 100
	}
	if page < 1 {
		page = 1
	}

	category := c.Query("category")
	status := c.Query("status")
	priority := c.Query("priority")
	search := c.Query("search")
	sort := c.DefaultQuery("sort", "updatedAt_desc")

	conditions := []string{}
	args := []interface{}{}
	argIdx := 1

	// For managers, force their category filter from auth context (ignore user-supplied category)
	role, _ := c.Get("user_role")
	roleStr, _ := role.(string)
	authManagerID, _ := c.Get("manager_id")
	authManagerIDStr, _ := authManagerID.(string)

	if strings.EqualFold(roleStr, "admin") {
		// Admins can filter by any category (or see all)
		if category != "" {
			conditions = append(conditions, fmt.Sprintf(`category = $%d`, argIdx))
			args = append(args, category)
			argIdx++
		}
	} else if authManagerIDStr != "" {
		// Managers: force filter to their own category
		var managerCat string
		db.DB.QueryRow(`SELECT category FROM "SourcingManager" WHERE id = $1`, authManagerIDStr).Scan(&managerCat)
		if managerCat != "" {
			conditions = append(conditions, fmt.Sprintf(`category = $%d`, argIdx))
			args = append(args, managerCat)
			argIdx++
		}
	} else if category != "" {
		conditions = append(conditions, fmt.Sprintf(`category = $%d`, argIdx))
		args = append(args, category)
		argIdx++
	}
	if status != "" {
		conditions = append(conditions, fmt.Sprintf(`status = $%d`, argIdx))
		args = append(args, status)
		argIdx++
	}
	if priority != "" {
		conditions = append(conditions, fmt.Sprintf(`priority = $%d`, argIdx))
		args = append(args, priority)
		argIdx++
	}
	if search != "" {
		conditions = append(conditions, fmt.Sprintf(
			`("requisitionId" ILIKE $%d OR "roleTitle" ILIKE $%d OR vendor ILIKE $%d OR team ILIKE $%d)`,
			argIdx, argIdx, argIdx, argIdx))
		args = append(args, "%"+search+"%")
		argIdx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Sort whitelist
	orderBy := `"updatedAt" DESC`
	sortMap := map[string]string{
		"updatedAt_desc":     `"updatedAt" DESC`,
		"updatedAt_asc":      `"updatedAt" ASC`,
		"billRateHourly_desc": `"billRateHourly" DESC`,
		"billRateHourly_asc":  `"billRateHourly" ASC`,
		"requisitionId_asc":   `"requisitionId" ASC`,
		"requisitionId_desc":  `"requisitionId" DESC`,
		"status_asc":          `status ASC`,
		"priority_asc":        `priority ASC`,
	}
	if s, ok := sortMap[sort]; ok {
		orderBy = s
	}

	// Count
	var total int
	countArgs := make([]interface{}, len(args))
	copy(countArgs, args)
	db.DB.QueryRow(`SELECT COUNT(*) FROM "Requisition" `+where, countArgs...).Scan(&total)

	// Fetch
	offset := (page - 1) * pageSize
	args = append(args, pageSize, offset)

	query := fmt.Sprintf(`
		SELECT id, "requisitionId", team, department, "roleTitle", category,
			"headcountNeeded", "headcountFilled", vendor, "billRateHourly",
			location, status, priority, "budgetAllocated", "budgetSpent",
			"startDate", "endDate", notes, "createdAt", "updatedAt"
		FROM "Requisition" %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d
	`, where, orderBy, argIdx, argIdx+1)

	rows, err := db.DB.Query(query, args...)
	if err != nil {
		slog.Error("list_requisitions_error", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query hiring requests"})
		return
	}
	defer rows.Close()

	reqs := []gin.H{}
	for rows.Next() {
		var id, reqID, team, dept, role, cat, vendor, loc, st, pri string
		var hcNeeded, hcFilled int
		var rate, budgetAlloc, budgetSpent float64
		var startDate, endDate *time.Time
		var notes *string
		var createdAt, updatedAt time.Time

		if err := rows.Scan(&id, &reqID, &team, &dept, &role, &cat,
			&hcNeeded, &hcFilled, &vendor, &rate,
			&loc, &st, &pri, &budgetAlloc, &budgetSpent,
			&startDate, &endDate, &notes, &createdAt, &updatedAt); err != nil {
			slog.Error("list_requisitions_scan_error", "error", err)
			continue
		}

		reqs = append(reqs, gin.H{
			"id": id, "requisitionId": reqID, "team": team, "department": dept,
			"roleTitle": role, "category": cat, "headcountNeeded": hcNeeded,
			"headcountFilled": hcFilled, "vendor": vendor, "billRateHourly": rate,
			"location": loc, "status": st, "priority": pri,
			"budgetAllocated": budgetAlloc, "budgetSpent": budgetSpent,
			"startDate": startDate, "endDate": endDate, "notes": notes,
			"createdAt": createdAt, "updatedAt": updatedAt,
		})
	}

	totalPages := (total + pageSize - 1) / pageSize
	c.JSON(http.StatusOK, gin.H{
		"requisitions": reqs,
		"total":        total,
		"page":         page,
		"pageSize":     pageSize,
		"totalPages":   totalPages,
	})
}

func GetRequisition(c *gin.Context) {
	paramID := c.Param("id")

	var id, reqID, team, dept, role, cat, vendor, loc, st, pri string
	var hcNeeded, hcFilled int
	var rate, budgetAlloc, budgetSpent float64
	var startDate, endDate *time.Time
	var notes *string
	var createdAt, updatedAt time.Time

	err := db.DB.QueryRow(`
		SELECT id, "requisitionId", team, department, "roleTitle", category,
			"headcountNeeded", "headcountFilled", vendor, "billRateHourly",
			location, status, priority, "budgetAllocated", "budgetSpent",
			"startDate", "endDate", notes, "createdAt", "updatedAt"
		FROM "Requisition" WHERE id = $1
	`, paramID).Scan(&id, &reqID, &team, &dept, &role, &cat,
		&hcNeeded, &hcFilled, &vendor, &rate,
		&loc, &st, &pri, &budgetAlloc, &budgetSpent,
		&startDate, &endDate, &notes, &createdAt, &updatedAt)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Hiring request not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id": id, "requisitionId": reqID, "team": team, "department": dept,
		"roleTitle": role, "category": cat, "headcountNeeded": hcNeeded,
		"headcountFilled": hcFilled, "vendor": vendor, "billRateHourly": rate,
		"location": loc, "status": st, "priority": pri,
		"budgetAllocated": budgetAlloc, "budgetSpent": budgetSpent,
		"startDate": startDate, "endDate": endDate, "notes": notes,
		"createdAt": createdAt, "updatedAt": updatedAt,
	})
}

type CreateReqBody struct {
	Team            string  `json:"team" binding:"required"`
	Department      string  `json:"department" binding:"required"`
	RoleTitle       string  `json:"roleTitle" binding:"required"`
	Category        string  `json:"category" binding:"required"`
	HeadcountNeeded int     `json:"headcountNeeded" binding:"required"`
	Vendor          string  `json:"vendor" binding:"required"`
	BillRateHourly  float64 `json:"billRateHourly" binding:"required"`
	Location        string  `json:"location" binding:"required"`
	Status          string  `json:"status"`
	Priority        string  `json:"priority"`
	BudgetAllocated float64 `json:"budgetAllocated"`
	Notes           *string `json:"notes"`
}

// getChangedBy reads the user identity from the X-Changed-By header, falling back to "user".
func getChangedBy(c *gin.Context) string {
	if v := c.GetHeader("X-Changed-By"); v != "" {
		return v
	}
	return "user"
}

// checkManagerAuth verifies that the authenticated user is authorized to
// modify a requisition in the given category. Uses the JWT-derived role and
// managerId from the Gin context — never user-supplied query params.
func checkManagerAuth(c *gin.Context, reqCategory string) bool {
	role, _ := c.Get("user_role")
	if role == "ADMIN" || role == "admin" {
		return true // admins can access everything
	}
	// Managers: look up their category and verify it matches
	managerID, _ := c.Get("manager_id")
	if managerID == nil || managerID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Manager ID not found in session"})
		return false
	}
	var managerCategory string
	err := db.DB.QueryRow(`SELECT category FROM "SourcingManager" WHERE id = $1`, managerID).Scan(&managerCategory)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Could not verify manager category"})
		return false
	}
	if managerCategory != reqCategory {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only modify requisitions in your category"})
		return false
	}
	return true
}

func CreateRequisition(c *gin.Context) {
	var body CreateReqBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Role-based auth: managers can only create in their category
	if !checkManagerAuth(c, body.Category) {
		return
	}

	if body.Status == "" {
		body.Status = "OPEN"
	}
	if body.Priority == "" {
		body.Priority = "MEDIUM"
	}
	if body.BudgetAllocated == 0 {
		body.BudgetAllocated = body.BillRateHourly * float64(body.HeadcountNeeded) * 2080
	}

	// Generate requisition ID
	abbrevMap := map[string]string{
		"ENGINEERING_CONTRACTORS": "ENG", "CONTENT_TRUST_SAFETY": "CTS",
		"DATA_OPERATIONS": "DOP", "MARKETING_CREATIVE": "MKT", "CORPORATE_SERVICES": "COR",
	}
	abbrev := abbrevMap[body.Category]
	if abbrev == "" {
		abbrev = "GEN"
	}
	var maxNum int
	db.DB.QueryRow(`
		SELECT COALESCE(MAX(CAST(SUBSTRING("requisitionId" FROM '[0-9]+$') AS INTEGER)), 0)
		FROM "Requisition" WHERE category = $1
	`, body.Category).Scan(&maxNum)
	reqID := fmt.Sprintf("REQ-%s-%03d", abbrev, maxNum+1)

	id := uuid.New().String()
	now := time.Now()

	_, err := db.DB.Exec(`
		INSERT INTO "Requisition" (id, "requisitionId", team, department, "roleTitle", category,
			"headcountNeeded", "headcountFilled", vendor, "billRateHourly", location,
			status, priority, "budgetAllocated", "budgetSpent", notes, "createdAt", "updatedAt")
		VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,0,$14,$15,$15)
	`, id, reqID, body.Team, body.Department, body.RoleTitle, body.Category,
		body.HeadcountNeeded, body.Vendor, body.BillRateHourly, body.Location,
		body.Status, body.Priority, body.BudgetAllocated, body.Notes, now)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Create change record
	changedBy := getChangedBy(c)
	changeID := uuid.New().String()
	db.DB.Exec(`
		INSERT INTO "RequisitionChange" (id, "requisitionId", "changeType", "changedBy", summary, "createdAt")
		VALUES ($1, $2, 'CREATED', $3, $4, $5)
	`, changeID, id, changedBy, fmt.Sprintf("New hiring request %s created: %s at %s", reqID, body.RoleTitle, body.Location), now)

	// Broadcast via WebSocket + create in-app notification
	var managerID string
	db.DB.QueryRow(`SELECT id FROM "SourcingManager" WHERE category = $1`, body.Category).Scan(&managerID)
	if managerID != "" {
		NotifHub.Broadcast(managerID, "change", gin.H{
			"requisitionId": reqID,
			"changeType":    "CREATED",
			"message":       fmt.Sprintf("New hiring request: %s - %s", reqID, body.RoleTitle),
		})

		// Create in-app notification
		notifID := uuid.New().String()
		msg := fmt.Sprintf("New hiring request: %s - %s", reqID, body.RoleTitle)
		db.DB.Exec(`
			INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
			VALUES ($1, $2, 'CHANGE_SUMMARY', 'Hiring Request Created', $3, false, NOW())
		`, notifID, managerID, msg)

		NotifHub.Broadcast(managerID, "notification", gin.H{
			"id":      notifID,
			"title":   "Hiring Request Created",
			"message": msg,
		})

		// Send email for new hiring request (uses status_change rule)
		NotifyManagerEmail(managerID, "STATUS_CHANGE",
			fmt.Sprintf("New Hiring Request: %s - %s", reqID, body.RoleTitle),
			fmt.Sprintf("A new hiring request %s has been created: %s at %s", reqID, body.RoleTitle, body.Location),
		)
	}

	// SNS notification
	PublishChange(ChangeEvent{
		Type:          "CREATED",
		RequisitionID: reqID,
		RoleTitle:     body.RoleTitle,
		Category:      body.Category,
		Summary:       fmt.Sprintf("New hiring request %s created: %s at %s", reqID, body.RoleTitle, body.Location),
		ChangedBy:     changedBy,
	})

	c.JSON(http.StatusCreated, gin.H{
		"id": id, "requisitionId": reqID,
	})
}

type UpdateReqBody struct {
	Status          *string  `json:"status"`
	Priority        *string  `json:"priority"`
	HeadcountNeeded *int     `json:"headcountNeeded"`
	HeadcountFilled *int     `json:"headcountFilled"`
	BillRateHourly  *float64 `json:"billRateHourly"`
	BudgetAllocated *float64 `json:"budgetAllocated"`
	BudgetSpent     *float64 `json:"budgetSpent"`
	Vendor          *string  `json:"vendor"`
	Location        *string  `json:"location"`
	Notes           *string  `json:"notes"`
}

func UpdateRequisition(c *gin.Context) {
	id := c.Param("id")

	var body UpdateReqBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	changedBy := getChangedBy(c)

	// Get current values for change tracking
	var oldStatus, oldPriority, oldVendor, oldLocation, category, reqIDStr string
	var oldHcNeeded, oldHcFilled int
	var oldRate, oldBudgetAlloc, oldBudgetSpent float64

	err := db.DB.QueryRow(`
		SELECT status, priority, "headcountNeeded", "headcountFilled",
			"billRateHourly", "budgetAllocated", "budgetSpent",
			vendor, location, category, "requisitionId"
		FROM "Requisition" WHERE id = $1
	`, id).Scan(&oldStatus, &oldPriority, &oldHcNeeded, &oldHcFilled,
		&oldRate, &oldBudgetAlloc, &oldBudgetSpent, &oldVendor, &oldLocation, &category, &reqIDStr)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Hiring request not found"})
		return
	}
	if err != nil {
		slog.Error("update_requisition_query_error", "error", err, "id", id)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hiring request"})
		return
	}

	// Role-based auth: managers can only edit their own category
	if !checkManagerAuth(c, category) {
		return
	}

	// Build SET clauses
	sets := []string{`"updatedAt" = NOW()`}
	args := []interface{}{}
	argIdx := 1
	changes := []gin.H{}

	track := func(field, changeType, oldVal, newVal string) {
		if oldVal != newVal {
			chID := uuid.New().String()
			db.DB.Exec(`
				INSERT INTO "RequisitionChange" (id, "requisitionId", "changeType", "fieldChanged", "oldValue", "newValue", "changedBy", "createdAt")
				VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
			`, chID, id, changeType, field, oldVal, newVal, changedBy)
			changes = append(changes, gin.H{"field": field, "old": oldVal, "new": newVal, "type": changeType})
		}
	}

	if body.Status != nil {
		sets = append(sets, fmt.Sprintf(`status = $%d`, argIdx))
		args = append(args, *body.Status)
		argIdx++
		track("status", "STATUS_CHANGE", oldStatus, *body.Status)
	}
	if body.Priority != nil {
		sets = append(sets, fmt.Sprintf(`priority = $%d`, argIdx))
		args = append(args, *body.Priority)
		argIdx++
		track("priority", "UPDATED", oldPriority, *body.Priority)
	}
	if body.HeadcountNeeded != nil {
		sets = append(sets, fmt.Sprintf(`"headcountNeeded" = $%d`, argIdx))
		args = append(args, *body.HeadcountNeeded)
		argIdx++
		track("headcountNeeded", "HEADCOUNT_CHANGE", fmt.Sprint(oldHcNeeded), fmt.Sprint(*body.HeadcountNeeded))
	}
	if body.HeadcountFilled != nil {
		sets = append(sets, fmt.Sprintf(`"headcountFilled" = $%d`, argIdx))
		args = append(args, *body.HeadcountFilled)
		argIdx++
		track("headcountFilled", "HEADCOUNT_CHANGE", fmt.Sprint(oldHcFilled), fmt.Sprint(*body.HeadcountFilled))
	}
	if body.BillRateHourly != nil {
		sets = append(sets, fmt.Sprintf(`"billRateHourly" = $%d`, argIdx))
		args = append(args, *body.BillRateHourly)
		argIdx++
		track("billRateHourly", "RATE_CHANGE", fmt.Sprintf("%.2f", oldRate), fmt.Sprintf("%.2f", *body.BillRateHourly))
	}
	if body.BudgetAllocated != nil {
		sets = append(sets, fmt.Sprintf(`"budgetAllocated" = $%d`, argIdx))
		args = append(args, *body.BudgetAllocated)
		argIdx++
		track("budgetAllocated", "BUDGET_CHANGE", fmt.Sprintf("%.2f", oldBudgetAlloc), fmt.Sprintf("%.2f", *body.BudgetAllocated))
	}
	if body.BudgetSpent != nil {
		sets = append(sets, fmt.Sprintf(`"budgetSpent" = $%d`, argIdx))
		args = append(args, *body.BudgetSpent)
		argIdx++
		track("budgetSpent", "BUDGET_CHANGE", fmt.Sprintf("%.2f", oldBudgetSpent), fmt.Sprintf("%.2f", *body.BudgetSpent))
	}
	if body.Vendor != nil {
		sets = append(sets, fmt.Sprintf(`vendor = $%d`, argIdx))
		args = append(args, *body.Vendor)
		argIdx++
		track("vendor", "UPDATED", oldVendor, *body.Vendor)
	}
	if body.Location != nil {
		sets = append(sets, fmt.Sprintf(`location = $%d`, argIdx))
		args = append(args, *body.Location)
		argIdx++
		track("location", "UPDATED", oldLocation, *body.Location)
	}
	if body.Notes != nil {
		sets = append(sets, fmt.Sprintf(`notes = $%d`, argIdx))
		args = append(args, *body.Notes)
		argIdx++
	}

	args = append(args, id)
	query := fmt.Sprintf(`UPDATE "Requisition" SET %s WHERE id = $%d`, strings.Join(sets, ", "), argIdx)

	if _, err := db.DB.Exec(query, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Broadcast changes via WebSocket
	if len(changes) > 0 {
		var managerID string
		db.DB.QueryRow(`SELECT id FROM "SourcingManager" WHERE category = $1`, category).Scan(&managerID)
		if managerID != "" {
			NotifHub.Broadcast(managerID, "change", gin.H{
				"requisitionId": reqIDStr,
				"changes":       changes,
				"message":       fmt.Sprintf("%s updated: %d field(s) changed", reqIDStr, len(changes)),
			})

			// Create notification
			notifID := uuid.New().String()
			msg := fmt.Sprintf("%s: %d field(s) updated", reqIDStr, len(changes))
			db.DB.Exec(`
				INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
				VALUES ($1, $2, 'CHANGE_SUMMARY', 'Hiring Request Updated', $3, false, NOW())
			`, notifID, managerID, msg)

			NotifHub.Broadcast(managerID, "notification", gin.H{
				"id":      notifID,
				"title":   "Hiring Request Updated",
				"message": msg,
			})

			// Send email based on NotificationRule preferences
			for _, ch := range changes {
				changeType := fmt.Sprint(ch["type"])
				field := fmt.Sprint(ch["field"])
				oldVal := fmt.Sprint(ch["old"])
				newVal := fmt.Sprint(ch["new"])
				emailBody := fmt.Sprintf("%s — %s changed from %s to %s", reqIDStr, field, oldVal, newVal)
				emailSubject := fmt.Sprintf("%s Updated: %s", reqIDStr, field)
				NotifyManagerEmail(managerID, changeType, emailSubject, emailBody)
			}
		}

		// SNS notification
		var snsChanges []FieldChange
		for _, ch := range changes {
			snsChanges = append(snsChanges, FieldChange{
				Field:    fmt.Sprint(ch["field"]),
				OldValue: fmt.Sprint(ch["old"]),
				NewValue: fmt.Sprint(ch["new"]),
			})
		}

		// Get roleTitle for the notification
		var roleTitle string
		db.DB.QueryRow(`SELECT "roleTitle" FROM "Requisition" WHERE id = $1`, id).Scan(&roleTitle)

		PublishChange(ChangeEvent{
			Type:          "UPDATED",
			RequisitionID: reqIDStr,
			RoleTitle:     roleTitle,
			Category:      category,
			Changes:       snsChanges,
			Summary:       fmt.Sprintf("%s: %d field(s) updated", reqIDStr, len(changes)),
			ChangedBy:     changedBy,
		})
	}

	c.JSON(http.StatusOK, gin.H{"updated": true, "changes": len(changes)})
}

func DeleteRequisition(c *gin.Context) {
	id := c.Param("id")
	changedBy := getChangedBy(c)

	// Get details before deletion for the SNS notification
	var reqIDStr, roleTitle, category string
	db.DB.QueryRow(`SELECT "requisitionId", "roleTitle", category FROM "Requisition" WHERE id = $1`, id).
		Scan(&reqIDStr, &roleTitle, &category)

	// Role-based auth
	if !checkManagerAuth(c, category) {
		return
	}

	result, err := db.DB.Exec(`DELETE FROM "Requisition" WHERE id = $1`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		return
	}

	// Broadcast delete via WebSocket + create in-app notification
	var managerID string
	db.DB.QueryRow(`SELECT id FROM "SourcingManager" WHERE category = $1`, category).Scan(&managerID)
	if managerID != "" {
		NotifHub.Broadcast(managerID, "change", gin.H{
			"requisitionId": reqIDStr,
			"changeType":    "DELETED",
			"message":       fmt.Sprintf("Hiring request %s (%s) was deleted by %s", reqIDStr, roleTitle, changedBy),
		})

		// Create in-app notification
		notifID := uuid.New().String()
		msg := fmt.Sprintf("Hiring request %s (%s) was deleted", reqIDStr, roleTitle)
		db.DB.Exec(`
			INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
			VALUES ($1, $2, 'CHANGE_SUMMARY', 'Hiring Request Deleted', $3, false, NOW())
		`, notifID, managerID, msg)

		NotifHub.Broadcast(managerID, "notification", gin.H{
			"id":      notifID,
			"title":   "Hiring Request Deleted",
			"message": msg,
		})

		// Send email for deletion (uses status_change rule)
		NotifyManagerEmail(managerID, "STATUS_CHANGE",
			fmt.Sprintf("Hiring Request Deleted: %s", reqIDStr),
			fmt.Sprintf("Hiring request %s (%s) has been deleted by %s", reqIDStr, roleTitle, changedBy),
		)
	}

	// SNS notification
	if reqIDStr != "" {
		PublishChange(ChangeEvent{
			Type:          "DELETED",
			RequisitionID: reqIDStr,
			RoleTitle:     roleTitle,
			Category:      category,
			Summary:       fmt.Sprintf("Hiring request %s (%s) has been deleted", reqIDStr, roleTitle),
			ChangedBy:     changedBy,
		})
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}
