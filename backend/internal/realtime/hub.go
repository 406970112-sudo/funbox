package realtime

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var ErrTicketInvalid = errors.New("realtime ticket is invalid")

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data,omitempty"`
}

type ticket struct {
	ExpiresAt time.Time
	UserID    string
}

type client struct {
	conn   *websocket.Conn
	hub    *Hub
	send   chan []byte
	userID string
}

type Hub struct {
	clients map[string]map[*client]struct{}
	mu      sync.RWMutex
	tickets map[string]ticket
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*client]struct{}),
		tickets: make(map[string]ticket),
	}
}

func (h *Hub) IssueTicket(userID string) (string, time.Time, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", time.Time{}, err
	}
	value := base64.RawURLEncoding.EncodeToString(random)
	expiresAt := time.Now().UTC().Add(time.Minute)

	h.mu.Lock()
	h.removeExpiredTicketsLocked(time.Now().UTC())
	h.tickets[value] = ticket{ExpiresAt: expiresAt, UserID: userID}
	h.mu.Unlock()
	return value, expiresAt, nil
}

func (h *Hub) ConsumeTicket(value string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now().UTC()
	h.removeExpiredTicketsLocked(now)
	issued, ok := h.tickets[value]
	if !ok || !issued.ExpiresAt.After(now) {
		return "", ErrTicketInvalid
	}
	delete(h.tickets, value)
	return issued.UserID, nil
}

func (h *Hub) IsOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}

func (h *Hub) Publish(userID string, event Event) {
	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for connected := range h.clients[userID] {
		select {
		case connected.send <- payload:
		default:
			// REST history is the recovery path when a slow client misses a live event.
		}
	}
}

func (h *Hub) ServeWS(
	w http.ResponseWriter,
	r *http.Request,
	userID string,
	onPresence func(userID string, online bool),
) error {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(_ *http.Request) bool {
			return true
		},
	}
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return err
	}
	connected := &client{
		conn:   connection,
		hub:    h,
		send:   make(chan []byte, 64),
		userID: userID,
	}
	becameOnline := h.register(connected)
	if becameOnline && onPresence != nil {
		onPresence(userID, true)
	}

	go connected.writePump()
	connected.readPump(onPresence)
	return nil
}

func (h *Hub) register(connected *client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	wasOffline := len(h.clients[connected.userID]) == 0
	if h.clients[connected.userID] == nil {
		h.clients[connected.userID] = make(map[*client]struct{})
	}
	h.clients[connected.userID][connected] = struct{}{}
	return wasOffline
}

func (h *Hub) unregister(connected *client) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	connections := h.clients[connected.userID]
	if connections == nil {
		return false
	}
	if _, ok := connections[connected]; !ok {
		return false
	}
	delete(connections, connected)
	close(connected.send)
	if len(connections) == 0 {
		delete(h.clients, connected.userID)
		return true
	}
	return false
}

func (h *Hub) removeExpiredTicketsLocked(now time.Time) {
	for value, issued := range h.tickets {
		if !issued.ExpiresAt.After(now) {
			delete(h.tickets, value)
		}
	}
}

func (c *client) readPump(onPresence func(userID string, online bool)) {
	defer func() {
		becameOffline := c.hub.unregister(c)
		_ = c.conn.Close()
		if becameOffline && onPresence != nil {
			onPresence(c.userID, false)
		}
	}()
	c.conn.SetReadLimit(4096)
	_ = c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case payload, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
