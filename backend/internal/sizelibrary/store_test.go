package sizelibrary

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestStoreSavesAndLoadsState(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsersTable(t, store.db)

	state := State{
		SchemaVersion: 1,
		Profiles: []Profile{
			{ID: "p1", Kind: KindPerson, Name: "我", Relation: "本人", Color: "#4b6bff", CreatedAt: 100},
			{ID: "p2", Kind: KindRoom, Name: "主卧", Color: "#18a78f", CreatedAt: 200},
		},
		Measurements: []Measurement{
			{ID: "m1", ProfileID: "p1", DimensionKey: "height", Label: "身高", Value: "168", Unit: "cm", Note: "", UpdatedAt: 300},
			{ID: "m2", ProfileID: "p2", DimensionKey: "roomLength", Label: "房间长", Value: "360", Unit: "cm", UpdatedAt: 400},
		},
	}
	saved, err := store.SaveState(context.Background(), "user-1", state)
	if err != nil {
		t.Fatalf("save state: %v", err)
	}
	if saved.UpdatedAt <= 0 || len(saved.Profiles) != 2 {
		t.Fatalf("unexpected saved state: %+v", saved)
	}

	loaded, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("get state: %v", err)
	}
	if len(loaded.Profiles) != 2 || len(loaded.Measurements) != 2 {
		t.Fatalf("unexpected loaded state: %+v", loaded)
	}
}

func TestClearStateKeepsSchema(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsersTable(t, store.db)

	state := State{
		SchemaVersion: 1,
		Profiles: []Profile{
			{ID: "p1", Kind: KindPerson, Name: "我", Color: "#4b6bff", CreatedAt: 1},
		},
	}
	if _, err := store.SaveState(context.Background(), "user-1", state); err != nil {
		t.Fatalf("save state: %v", err)
	}
	cleared, err := store.ClearState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("clear state: %v", err)
	}
	if cleared.SchemaVersion != 1 || len(cleared.Profiles) != 0 || len(cleared.Measurements) != 0 {
		t.Fatalf("unexpected cleared state: %+v", cleared)
	}
}

func TestValidateRejectsDuplicateProfileName(t *testing.T) {
	state := State{
		SchemaVersion: 1,
		Profiles: []Profile{
			{ID: "p1", Kind: KindPerson, Name: "妈妈", Color: "#4b6bff"},
			{ID: "p2", Kind: KindPerson, Name: " 妈妈 ", Color: "#18a78f"},
		},
	}
	err := ValidateState(state)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate name error, got %v", err)
	}
}

func TestValidateRejectsInvalidMeasurementRange(t *testing.T) {
	state := State{
		SchemaVersion: 1,
		Profiles: []Profile{
			{ID: "p1", Kind: KindPerson, Name: "我", Color: "#4b6bff"},
		},
		Measurements: []Measurement{
			{ID: "m1", ProfileID: "p1", DimensionKey: "height", Label: "身高", Value: "999", Unit: "cm"},
		},
	}
	err := ValidateState(state)
	if err == nil || !strings.Contains(err.Error(), "range") {
		t.Fatalf("expected range error, got %v", err)
	}
}

func TestValidateAcceptsLinkedRoomWhenRoomComesLater(t *testing.T) {
	state := State{
		SchemaVersion: 1,
		Profiles: []Profile{
			{ID: "desk1", Kind: KindDesk, Name: "书房书桌", RoomID: "room1", Color: "#18a78f"},
			{ID: "room1", Kind: KindRoom, Name: "书房", Color: "#4b6bff"},
		},
	}
	if err := ValidateState(state); err != nil {
		t.Fatalf("expected linked room accepted, got %v", err)
	}
}

func createUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'size-library-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}
