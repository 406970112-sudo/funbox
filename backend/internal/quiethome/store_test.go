package quiethome

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestStoreTripLifecycle(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()
	ctx := context.Background()

	eta := time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339)
	trip, err := store.CreateTrip(ctx, "u1", Trip{
		OriginLabel:             "公司",
		DestinationLabel:        "我的家",
		ETAAt:                   eta,
		GraceMinutes:            30,
		SelfReminderEnabled:     true,
		ContactReminderEnabled:  false,
		ArrivalDetectionEnabled: true,
		LateSnapshotEnabled:     false,
	})
	if err != nil {
		t.Fatalf("create trip: %v", err)
	}
	if trip.Status != TripStatusActive {
		t.Fatalf("expected active trip, got %s", trip.Status)
	}

	active, err := store.GetActiveTrip(ctx, "u1")
	if err != nil || active == nil || active.ID != trip.ID {
		t.Fatalf("expected active trip, got %v %v", active, err)
	}

	checkedAt := time.Now().UTC().Format(time.RFC3339)
	lateMinutes := 8
	trip.Status = TripStatusCheckedIn
	trip.CheckedInAt = &checkedAt
	trip.LateMinutes = &lateMinutes
	if _, err := store.UpdateTrip(ctx, trip); err != nil {
		t.Fatalf("check in trip: %v", err)
	}

	history, err := store.ListHistory(ctx, "u1")
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	if len(history) != 1 || history[0].CheckedInAt == nil || *history[0].LateMinutes != 8 {
		t.Fatalf("unexpected history: %#v", history)
	}

	if err := store.ClearHistory(ctx, "u1"); err != nil {
		t.Fatalf("clear history: %v", err)
	}
	history, _ = store.ListHistory(ctx, "u1")
	if len(history) != 0 {
		t.Fatalf("expected empty history after clear")
	}
}

func TestStoreSettingsContactsAndNotifications(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()
	ctx := context.Background()

	settings := Settings{
		UserID:        "u1",
		DefaultHome:   "我的家",
		GraceMinutes:  30,
		RetentionDays: 30,
	}
	saved, err := store.SaveSettings(ctx, settings)
	if err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if saved.UpdatedAt == 0 {
		t.Fatalf("expected updatedAt")
	}
	loaded, err := store.GetSettings(ctx, "u1")
	if err != nil || loaded.DefaultHome != "我的家" {
		t.Fatalf("load settings: %#v %v", loaded, err)
	}

	contact, err := store.UpsertContact(ctx, Contact{
		UserID:        "u1",
		ContactUserID: "u2",
		Status:        ContactStatusAgreed,
		Channels:      []string{"in_app"},
	})
	if err != nil {
		t.Fatalf("upsert contact: %v", err)
	}
	pair, err := store.GetContactPair(ctx, "u1", "u2")
	if err != nil || pair.Status != ContactStatusAgreed {
		t.Fatalf("get contact pair: %#v %v", pair, err)
	}
	if contact.AgreedAt == nil {
		t.Fatalf("expected agreedAt")
	}

	eta := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	trip, err := store.CreateTrip(ctx, "u1", Trip{
		OriginLabel:             "公司",
		DestinationLabel:        "我的家",
		ETAAt:                   eta,
		GraceMinutes:            30,
		SelfReminderEnabled:     true,
		ContactReminderEnabled:  true,
		ArrivalDetectionEnabled: false,
		ContactUserID:           "u2",
	})
	if err != nil {
		t.Fatalf("create trip with contact: %v", err)
	}
	if _, err := store.AddNotification(ctx, Notification{
		TripID:       trip.ID,
		Type:         NotificationSelfReminder,
		TargetUserID: "u1",
		Channel:      "in_app",
		Status:       NotificationPending,
		ScheduledAt:  eta,
	}); err != nil {
		t.Fatalf("add notification: %v", err)
	}
	items, err := store.ListNotificationsForTrip(ctx, trip.ID)
	if err != nil || len(items) != 1 {
		t.Fatalf("list notifications: %#v %v", items, err)
	}
	if err := store.MarkNotification(ctx, items[0].ID, NotificationSent, ""); err != nil {
		t.Fatalf("mark notification: %v", err)
	}
	due, err := store.ListDueNotifications(ctx, time.Now().UTC().Add(-time.Minute))
	if err != nil || len(due) != 0 {
		t.Fatalf("expected no pending due notifications: %#v %v", due, err)
	}
}

func TestStoreLocationEvents(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()
	ctx := context.Background()

	eta := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	trip, err := store.CreateTrip(ctx, "u1", Trip{
		OriginLabel:             "公司",
		DestinationLabel:        "我的家",
		ETAAt:                   eta,
		GraceMinutes:            30,
		SelfReminderEnabled:     true,
		ArrivalDetectionEnabled: true,
	})
	if err != nil {
		t.Fatalf("create trip: %v", err)
	}
	event, err := store.AddLocationEvent(ctx, "u1", trip.ID, "only-this-trip", false)
	if err != nil {
		t.Fatalf("add location event: %v", err)
	}
	if event.Snapshot {
		t.Fatalf("expected non-snapshot location event")
	}
	events, err := store.ListLocationEvents(ctx, "u1")
	if err != nil || len(events) != 1 {
		t.Fatalf("list location events: %#v %v", events, err)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "quiet-home.db")
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}
	if _, err := raw.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			display_name TEXT NOT NULL,
			avatar_file TEXT,
			role TEXT NOT NULL
		);
		INSERT INTO users (id, username, display_name, avatar_file, role) VALUES
			('u1', 'u1', '用户一', '', 'normal'),
			('u2', 'u2', '用户二', '', 'normal');
	`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	_ = raw.Close()
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("open quiet home store: %v", err)
	}
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return store
}
