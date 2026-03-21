package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"metasource-gateway/middleware"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Hub manages WebSocket connections per manager
type Hub struct {
	mu          sync.RWMutex
	connections map[string]map[*websocket.Conn]bool // managerId -> set of connections
	broadcast   chan BroadcastMsg
}

type BroadcastMsg struct {
	ManagerID string      `json:"managerId"`
	Type      string      `json:"type"` // "notification", "change", "refresh"
	Payload   interface{} `json:"payload"`
}

var NotifHub = &Hub{
	connections: make(map[string]map[*websocket.Conn]bool),
	broadcast:   make(chan BroadcastMsg, 256),
}

var allowedOrigins = map[string]bool{
	"https://meta.callsphere.tech": true,
	"http://localhost:3000":         true,
	"http://localhost:8080":         true,
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true // allow non-browser clients (curl, Postman)
		}
		// Exact match against allowed origins
		if allowedOrigins[origin] {
			return true
		}
		// Allow any localhost port for development
		if strings.HasPrefix(origin, "http://localhost:") {
			return true
		}
		slog.Warn("ws_origin_rejected", "origin", origin)
		return false
	},
}

func init() {
	go NotifHub.run()
}

func (h *Hub) run() {
	for msg := range h.broadcast {
		data, err := json.Marshal(msg)
		if err != nil {
			slog.Error("ws_marshal_error", "error", err)
			continue
		}

		// Snapshot connections with their owner IDs under lock
		type connOwner struct {
			conn    *websocket.Conn
			ownerID string
		}
		h.mu.RLock()
		targets := make([]connOwner, 0)
		for conn := range h.connections[msg.ManagerID] {
			targets = append(targets, connOwner{conn, msg.ManagerID})
		}
		if msg.ManagerID != "admin" {
			for conn := range h.connections["admin"] {
				targets = append(targets, connOwner{conn, "admin"})
			}
		}
		h.mu.RUnlock()

		for _, t := range targets {
			if err := t.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				slog.Warn("ws_write_error", "error", err)
				h.removeConn(t.ownerID, t.conn)
				t.conn.Close()
			}
		}
	}
}

func (h *Hub) addConn(managerID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.connections[managerID] == nil {
		h.connections[managerID] = make(map[*websocket.Conn]bool)
	}
	h.connections[managerID][conn] = true
}

func (h *Hub) removeConn(managerID string, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if cs, ok := h.connections[managerID]; ok {
		delete(cs, conn)
		if len(cs) == 0 {
			delete(h.connections, managerID)
		}
	}
}

func (h *Hub) Broadcast(managerID, msgType string, payload interface{}) {
	select {
	case h.broadcast <- BroadcastMsg{
		ManagerID: managerID,
		Type:      msgType,
		Payload:   payload,
	}:
	default:
		slog.Warn("websocket_broadcast_dropped", "managerId", managerID, "event", msgType)
	}
}

func (h *Hub) ConnCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	total := 0
	for _, cs := range h.connections {
		total += len(cs)
	}
	return total
}

// WebSocket endpoint: /ws/notifications?token=<jwt>
// The token is validated and the managerId is derived from the authenticated
// user's role in the database, not from user-supplied input.
func HandleWebSocket(c *gin.Context) {
	tokenStr := c.Query("token")
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing token parameter"})
		return
	}

	email, _, role, managerID, err := middleware.ValidateTokenString(tokenStr)
	if err != nil {
		slog.Warn("ws_auth_failed", "error", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
		return
	}

	// Determine the hub key: admins subscribe as "admin", managers use their managerId
	hubKey := managerID
	if strings.EqualFold(role, "admin") {
		hubKey = "admin"
	}
	if hubKey == "" {
		hubKey = "admin" // fallback for users without a managerId
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("ws_upgrade_error", "error", err)
		return
	}

	slog.Info("ws_connected", "email", email, "role", role, "managerId", hubKey)

	// Send welcome message BEFORE adding to hub to avoid concurrent writes
	// (gorilla/websocket allows only one concurrent writer)
	conn.WriteJSON(gin.H{
		"type":    "connected",
		"payload": gin.H{"email": email, "role": role, "managerId": hubKey},
	})

	NotifHub.addConn(hubKey, conn)

	// Read loop (keeps connection alive, handles client messages)
	defer func() {
		NotifHub.removeConn(hubKey, conn)
		conn.Close()
		slog.Info("ws_disconnected", "email", email, "managerId", hubKey)
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}
