package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

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

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
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

		// Snapshot connections under lock
		h.mu.RLock()
		targets := make([]*websocket.Conn, 0)
		for conn := range h.connections[msg.ManagerID] {
			targets = append(targets, conn)
		}
		if msg.ManagerID != "admin" {
			for conn := range h.connections["admin"] {
				targets = append(targets, conn)
			}
		}
		h.mu.RUnlock()

		for _, conn := range targets {
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				slog.Warn("ws_write_error", "error", err)
				h.removeConn(msg.ManagerID, conn)
				conn.Close()
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
	h.broadcast <- BroadcastMsg{
		ManagerID: managerID,
		Type:      msgType,
		Payload:   payload,
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

// WebSocket endpoint: /ws/notifications?managerId=xxx
func HandleWebSocket(c *gin.Context) {
	managerID := c.Query("managerId")
	if managerID == "" {
		managerID = "admin"
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		slog.Error("ws_upgrade_error", "error", err)
		return
	}

	NotifHub.addConn(managerID, conn)
	slog.Info("ws_connected", "managerId", managerID)

	// Send welcome message
	conn.WriteJSON(gin.H{
		"type":    "connected",
		"payload": gin.H{"managerId": managerID},
	})

	// Read loop (keeps connection alive, handles client messages)
	defer func() {
		NotifHub.removeConn(managerID, conn)
		conn.Close()
		slog.Info("ws_disconnected", "managerId", managerID)
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}
