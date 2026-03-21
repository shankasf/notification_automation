package handlers

import (
	"encoding/csv"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"metasource-gateway/db"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func UploadCSV(c *gin.Context) {
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	headers, err := reader.Read()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid CSV file"})
		return
	}

	// Normalize headers
	colMap := map[string]int{}
	aliases := map[string][]string{
		"roleTitle":       {"role_title", "role", "title", "position", "job_title"},
		"category":        {"category", "cat"},
		"team":            {"team"},
		"department":      {"department", "dept"},
		"vendor":          {"vendor", "supplier"},
		"billRateHourly":  {"bill_rate_hourly", "bill_rate", "rate", "hourly_rate"},
		"headcountNeeded": {"headcount_needed", "headcount", "hc_needed", "positions"},
		"location":        {"location", "loc", "city"},
		"status":          {"status"},
		"priority":        {"priority"},
	}

	for i, h := range headers {
		normalized := strings.ToLower(strings.TrimSpace(h))
		normalized = strings.ReplaceAll(normalized, " ", "_")
		for field, aliasList := range aliases {
			for _, alias := range aliasList {
				if normalized == alias {
					colMap[field] = i
					break
				}
			}
		}
	}

	// Check required columns
	for _, req := range []string{"roleTitle", "category", "vendor", "billRateHourly"} {
		if _, ok := colMap[req]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   fmt.Sprintf("Missing required column: %s", req),
				"headers": headers,
			})
			return
		}
	}

	changedBy := getChangedBy(c)
	created := 0
	errors := []string{}
	now := time.Now()

	// Normalize human-readable category aliases to DB enum values
	categoryAliases := map[string]string{
		"engineering": "ENGINEERING_CONTRACTORS", "eng": "ENGINEERING_CONTRACTORS",
		"engineering contractors": "ENGINEERING_CONTRACTORS", "tech": "ENGINEERING_CONTRACTORS",
		"software": "ENGINEERING_CONTRACTORS",
		"content": "CONTENT_TRUST_SAFETY", "cts": "CONTENT_TRUST_SAFETY",
		"content & trust safety": "CONTENT_TRUST_SAFETY", "trust safety": "CONTENT_TRUST_SAFETY",
		"content_trust_safety": "CONTENT_TRUST_SAFETY",
		"data": "DATA_OPERATIONS", "dop": "DATA_OPERATIONS",
		"data operations": "DATA_OPERATIONS", "data ops": "DATA_OPERATIONS",
		"data_operations": "DATA_OPERATIONS",
		"marketing": "MARKETING_CREATIVE", "mkt": "MARKETING_CREATIVE",
		"marketing & creative": "MARKETING_CREATIVE", "marketing creative": "MARKETING_CREATIVE",
		"marketing_creative": "MARKETING_CREATIVE",
		"corporate": "CORPORATE_SERVICES", "cor": "CORPORATE_SERVICES",
		"corporate services": "CORPORATE_SERVICES", "corporate_services": "CORPORATE_SERVICES",
	}

	abbrevMap := map[string]string{
		"ENGINEERING_CONTRACTORS": "ENG", "CONTENT_TRUST_SAFETY": "CTS",
		"DATA_OPERATIONS": "DOP", "MARKETING_CREATIVE": "MKT", "CORPORATE_SERVICES": "COR",
	}

	// Track per-category created counts for correct reqID sequencing
	catCreatedCounts := map[string]int{}

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			errors = append(errors, fmt.Sprintf("Row parse error: %v", err))
			continue
		}

		getCol := func(field string) string {
			if idx, ok := colMap[field]; ok && idx < len(record) {
				return strings.TrimSpace(record[idx])
			}
			return ""
		}

		rawCat := getCol("category")
		cat := rawCat
		// Normalize category: try alias lookup first, then accept if already a valid enum
		if mapped, ok := categoryAliases[strings.ToLower(strings.TrimSpace(rawCat))]; ok {
			cat = mapped
		}
		rate, _ := strconv.ParseFloat(getCol("billRateHourly"), 64)
		hc, _ := strconv.Atoi(getCol("headcountNeeded"))
		if hc == 0 {
			hc = 1
		}

		abbrev := abbrevMap[cat]
		if abbrev == "" {
			errors = append(errors, fmt.Sprintf("Row: Invalid category %q", rawCat))
			continue
		}
		var maxNum int
		db.DB.QueryRow(`
			SELECT COALESCE(MAX(CAST(SUBSTRING("requisitionId" FROM '[0-9]+$') AS INTEGER)), 0)
			FROM "Requisition" WHERE category = $1
		`, cat).Scan(&maxNum)
		reqID := fmt.Sprintf("REQ-%s-%03d", abbrev, maxNum+1+catCreatedCounts[cat])

		id := uuid.New().String()
		status := getCol("status")
		if status == "" {
			status = "OPEN"
		}
		priority := getCol("priority")
		if priority == "" {
			priority = "MEDIUM"
		}
		team := getCol("team")
		if team == "" {
			team = "Unassigned"
		}
		dept := getCol("department")
		if dept == "" {
			dept = "General"
		}
		loc := getCol("location")
		if loc == "" {
			loc = "Remote"
		}
		budget := rate * float64(hc) * 2080

		_, err = db.DB.Exec(`
			INSERT INTO "Requisition" (id, "requisitionId", team, department, "roleTitle", category,
				"headcountNeeded", "headcountFilled", vendor, "billRateHourly", location,
				status, priority, "budgetAllocated", "budgetSpent", "createdAt", "updatedAt")
			VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,0,$14,$14)
		`, id, reqID, team, dept, getCol("roleTitle"), cat,
			hc, getCol("vendor"), rate, loc, status, priority, budget, now)

		if err != nil {
			errors = append(errors, fmt.Sprintf("Row insert error: %v", err))
			continue
		}

		// Change record
		chID := uuid.New().String()
		db.DB.Exec(`
			INSERT INTO "RequisitionChange" (id, "requisitionId", "changeType", "changedBy", summary, "createdAt")
			VALUES ($1, $2, 'BULK_IMPORT', $3, $4, $5)
		`, chID, id, changedBy, fmt.Sprintf("Imported from CSV: %s - %s", reqID, getCol("roleTitle")), now)

		created++
		catCreatedCounts[cat]++
	}

	// Notify affected managers
	catCounts := map[string]int{}
	// We'll count created per category from the data
	rows, _ := db.DB.Query(`
		SELECT r.category, m.id, COUNT(*)
		FROM "RequisitionChange" rc
		JOIN "Requisition" r ON rc."requisitionId" = r.id
		JOIN "SourcingManager" m ON m.category = r.category
		WHERE rc."changeType" = 'BULK_IMPORT' AND rc."createdAt" >= $1 - interval '5 seconds'
		GROUP BY r.category, m.id
	`, now)
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var cat, mid string
			var cnt int
			if err := rows.Scan(&cat, &mid, &cnt); err != nil {
				slog.Error("upload_notify_scan_error", "error", err)
				continue
			}
			catCounts[cat] = cnt

			notifID := uuid.New().String()
			msg := fmt.Sprintf("CSV import: %d new hiring requests added to your category", cnt)
			db.DB.Exec(`
				INSERT INTO "Notification" (id, "managerId", type, title, message, "isRead", "createdAt")
				VALUES ($1, $2, 'CHANGE_SUMMARY', 'Bulk Import Complete', $3, false, NOW())
			`, notifID, mid, msg)

			NotifHub.Broadcast(mid, "notification", gin.H{
				"id":      notifID,
				"title":   "Bulk Import Complete",
				"message": msg,
			})
		}
	}

	// SNS notification for bulk import
	PublishChange(ChangeEvent{
		Type:          "BULK_IMPORT",
		RequisitionID: "BULK",
		RoleTitle:     "CSV Import",
		Category:      "ALL",
		Summary:       fmt.Sprintf("Bulk CSV import completed: %d created, %d errors", created, len(errors)),
		ChangedBy:     changedBy,
	})

	slog.Info("csv_upload", "created", created, "errors", len(errors))
	c.JSON(http.StatusOK, gin.H{
		"created": created,
		"errors":  errors,
	})
}
