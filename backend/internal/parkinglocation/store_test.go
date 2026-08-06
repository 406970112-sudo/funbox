package parkinglocation

import (
	"context"
	"testing"
)

func TestOpenStoreCreatesSchema(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()

	state, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("GetState() error = %v", err)
	}
	if state.SchemaVersion != 1 {
		t.Fatalf("SchemaVersion = %d, want 1", state.SchemaVersion)
	}
	if len(state.Records) != 0 || len(state.FeeRules) != 0 {
		t.Fatalf("expected empty state, got %+v", state)
	}
	if state.Settings.DefaultReminderMinutes != 30 {
		t.Fatalf("default reminder = %d, want 30", state.Settings.DefaultReminderMinutes)
	}
}

func TestSaveStateValidatesRealInput(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()

	state := emptyState()
	state.Records = []Record{
		{
			ID:              "record-1",
			ParkingLotName:  "成都新世纪环球中心",
			FloorLabel:      "B3",
			ZoneLabel:       "C区",
			SpotLabel:       "328号",
			ParkedAt:        1000,
			Status:          "active",
			ReminderMode:    "fixed",
			ReminderMinutes: 30,
			CreatedAt:       1000,
			UpdatedAt:       1000,
		},
	}
	saved, err := store.SaveState(context.Background(), "user-1", state)
	if err != nil {
		t.Fatalf("SaveState() error = %v", err)
	}
	if saved.UpdatedAt <= 0 || len(saved.Records) != 1 {
		t.Fatalf("unexpected saved state: %+v", saved)
	}

	loaded, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("GetState() error = %v", err)
	}
	if loaded.Records[0].ParkingLotName != "成都新世纪环球中心" {
		t.Fatalf("loaded record name = %q", loaded.Records[0].ParkingLotName)
	}
}

func TestSaveStateRejectsRecordWithoutPosition(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()

	state := emptyState()
	state.Records = []Record{
		{
			ID:             "record-1",
			ParkingLotName: "测试停车场",
			ParkedAt:       1000,
			Status:         "active",
			ReminderMode:   "none",
			CreatedAt:      1000,
			UpdatedAt:      1000,
		},
	}
	if _, err := store.SaveState(context.Background(), "user-1", state); err == nil {
		t.Fatal("expected invalid input error")
	}
}

func TestClearStateReturnsEmptyRealState(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()

	state := emptyState()
	state.Records = []Record{
		{
			ID:             "record-1",
			ParkingLotName: "测试停车场",
			FloorLabel:     "B1",
			ParkedAt:       1000,
			Status:         "active",
			ReminderMode:   "none",
			CreatedAt:      1000,
			UpdatedAt:      1000,
		},
	}
	if _, err := store.SaveState(context.Background(), "user-1", state); err != nil {
		t.Fatalf("SaveState() error = %v", err)
	}
	cleared, err := store.ClearState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("ClearState() error = %v", err)
	}
	if len(cleared.Records) != 0 {
		t.Fatalf("expected cleared state, got %+v", cleared)
	}
}
