package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// DataUpload handles POST /api/data-upload — accepts any file, forwards to AI pipeline
func DataUpload(pythonURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
			return
		}
		defer file.Close()

		// Read file content
		data, err := io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
			return
		}

		// Detect file type from extension
		ext := strings.TrimPrefix(filepath.Ext(header.Filename), ".")
		if ext == "" {
			ext = "txt"
		}

		jobID := uuid.New().String()
		slog.Info("data_upload_started", "job_id", jobID, "file", header.Filename, "type", ext, "size", len(data))

		// Build request to Python AI service
		body := map[string]interface{}{
			"jobId":    jobID,
			"fileType": ext,
		}

		// For binary files (xlsx), base64 encode; for text, send as string
		if ext == "xlsx" || ext == "xls" {
			body["fileContent"] = ""
			body["rawBytes"] = base64.StdEncoding.EncodeToString(data)
		} else {
			body["fileContent"] = string(data)
		}

		jsonBody, _ := json.Marshal(body)

		client := &http.Client{Timeout: 300 * time.Second} // 5 min timeout for large files
		resp, err := client.Post(
			pythonURL+"/api/ai/upload/process",
			"application/json",
			strings.NewReader(string(jsonBody)),
		)
		if err != nil {
			slog.Error("data_upload_ai_failed", "job_id", jobID, "error", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "AI pipeline unavailable", "jobId": jobID})
			return
		}
		defer resp.Body.Close()

		var result map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&result)

		slog.Info("data_upload_completed", "job_id", jobID, "result", result)

		// Broadcast completion notification
		if created, ok := result["created"].(float64); ok && created > 0 {
			NotifHub.Broadcast("admin", "change", gin.H{
				"changeType": "BULK_IMPORT",
				"message":    fmt.Sprintf("AI pipeline imported %d hiring requests from %s", int(created), header.Filename),
			})
		}

		c.JSON(resp.StatusCode, result)
	}
}

// UploadProgress handles POST /api/data-upload/progress — receives progress from Python, broadcasts via WebSocket
func UploadProgress(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	// Broadcast to all admin WebSocket connections
	NotifHub.Broadcast("admin", "upload_progress", body)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
