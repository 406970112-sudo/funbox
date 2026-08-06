package quiethome

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestServiceCreateCheckInAndScheduler(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()
	service := NewService(store, nil, nil)
	ctx := context.Background()

	now := time.Now().UTC()
	eta := now.Add(30 * time.Minute).Format(time.RFC3339)
	trip, err := service.CreateTrip(ctx, "u1", CreateTripInput{
		OriginLabel:             "公司",
		DestinationLabel:        "我的家",
		ETAAt:                   eta,
		GraceMinutes:            30,
		SelfReminderEnabled:     boolPointer(true),
		ArrivalDetectionEnabled: boolPointer(false),
	})
	if err != nil {
		t.Fatalf("create trip: %v", err)
	}
	if trip.SelfReminderEnabled != true {
		t.Fatalf("expected self reminder enabled")
	}

	afterEta := now.Add(35 * time.Minute)
	if err := service.ProcessDue(ctx, afterEta); err != nil {
		t.Fatalf("process due: %v", err)
	}
	notifications, err := store.ListNotificationsForTrip(ctx, trip.ID)
	if err != nil {
		t.Fatalf("list notifications: %v", err)
	}
	if len(notifications) < 1 {
		t.Fatalf("expected self reminder notifications")
	}
	for _, item := range notifications {
		if item.Status != NotificationPending {
			t.Fatalf("expected pending without hub, got %s", item.Status)
		}
	}

	checked, err := service.CheckIn(ctx, "u1", trip.ID)
	if err != nil {
		t.Fatalf("check in: %v", err)
	}
	if checked.Status != TripStatusCheckedIn || checked.LateMinutes == nil || *checked.LateMinutes < 0 {
		t.Fatalf("unexpected checked trip: %#v", checked)
	}
	active, err := store.GetActiveTrip(ctx, "u1")
	if err != nil || active != nil {
		t.Fatalf("expected no active trip after check in: %#v %v", active, err)
	}
}

func TestServiceRejectsInvalidAndDuplicateTrips(t *testing.T) {
	store := newTestStore(t)
	defer store.Close()
	service := NewService(store, nil, nil)
	ctx := context.Background()

	_, err := service.CreateTrip(ctx, "u1", CreateTripInput{
		OriginLabel:      "公司",
		DestinationLabel: "我的家",
		ETAAt:            "bad-time",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}

	eta := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	if _, err := service.CreateTrip(ctx, "u1", CreateTripInput{
		OriginLabel:      "公司",
		DestinationLabel: "我的家",
		ETAAt:            eta,
	}); err != nil {
		t.Fatalf("create trip: %v", err)
	}
	_, err = service.CreateTrip(ctx, "u1", CreateTripInput{
		OriginLabel:      "公司",
		DestinationLabel: "我的家",
		ETAAt:            time.Now().UTC().Add(2 * time.Hour).Format(time.RFC3339),
	})
	if !errors.Is(err, ErrActiveTripExists) {
		t.Fatalf("expected active trip exists, got %v", err)
	}
}

func boolPointer(value bool) *bool {
	return &value
}
