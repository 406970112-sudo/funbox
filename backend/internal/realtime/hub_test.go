package realtime

import (
	"errors"
	"testing"
)

func TestRealtimeTicketIsSingleUse(t *testing.T) {
	hub := NewHub()
	ticket, expiresAt, err := hub.IssueTicket("user-1")
	if err != nil {
		t.Fatalf("issue ticket: %v", err)
	}
	if ticket == "" || expiresAt.IsZero() {
		t.Fatalf("invalid issued ticket: %q, %v", ticket, expiresAt)
	}

	userID, err := hub.ConsumeTicket(ticket)
	if err != nil || userID != "user-1" {
		t.Fatalf("consume ticket = %q, %v", userID, err)
	}
	if _, err := hub.ConsumeTicket(ticket); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("second ticket use error = %v", err)
	}
}
