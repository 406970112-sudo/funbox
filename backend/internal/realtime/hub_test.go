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

func TestPresenceTracksTheLastConnectedDevice(t *testing.T) {
	hub := NewHub()
	phone := &client{hub: hub, send: make(chan []byte, 1), userID: "user-1"}
	laptop := &client{hub: hub, send: make(chan []byte, 1), userID: "user-1"}

	if becameOnline := hub.register(phone); !becameOnline {
		t.Fatal("first device did not transition the user online")
	}
	if becameOnline := hub.register(laptop); becameOnline {
		t.Fatal("second device emitted a duplicate online transition")
	}
	if !hub.IsOnline("user-1") {
		t.Fatal("user is offline while devices are connected")
	}

	if becameOffline := hub.unregister(phone); becameOffline {
		t.Fatal("disconnecting one device transitioned the user offline")
	}
	if !hub.IsOnline("user-1") {
		t.Fatal("user is offline while another device remains connected")
	}

	if becameOffline := hub.unregister(laptop); !becameOffline {
		t.Fatal("last device did not transition the user offline")
	}
	if hub.IsOnline("user-1") {
		t.Fatal("user remains online after the last device disconnects")
	}
}
