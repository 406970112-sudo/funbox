package whodoesit

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

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
		Participants: []Participant{
			{ID: "p1", Name: "阿伟", CreatedAt: 100},
			{ID: "p2", Name: "小红", CreatedAt: 200},
		},
		Settings: Settings{
			TaskMode:   TaskModeCustom,
			CustomTask: "去洗碗",
		},
		Records: []Record{
			{
				ID:               "r1",
				CreatedAt:        time.Now().UnixMilli(),
				ParticipantNames: []string{"阿伟", "小红"},
				WinnerName:       "小红",
				TaskText:         "去洗碗",
				TaskMode:         TaskModeCustom,
				ParticipantCount: 2,
			},
		},
	}

	saved, err := store.SaveState(context.Background(), "user-1", state)
	if err != nil {
		t.Fatalf("save state: %v", err)
	}
	if saved.UpdatedAt <= 0 {
		t.Fatalf("expected updatedAt to be set")
	}

	loaded, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("get state: %v", err)
	}
	if len(loaded.Participants) != 2 || loaded.Participants[1].Name != "小红" {
		t.Fatalf("unexpected loaded participants: %#v", loaded.Participants)
	}
	if loaded.Settings.CustomTask != "去洗碗" {
		t.Fatalf("unexpected settings: %#v", loaded.Settings)
	}
	if len(loaded.Records) != 1 || loaded.Records[0].WinnerName != "小红" {
		t.Fatalf("unexpected records: %#v", loaded.Records)
	}
}

func TestClearRecordsKeepsParticipants(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsersTable(t, store.db)

	state := State{
		Participants: []Participant{
			{ID: "p1", Name: "阿伟", CreatedAt: 1},
			{ID: "p2", Name: "小红", CreatedAt: 2},
		},
		Settings:     Settings{TaskMode: TaskModePersonOnly},
		Records: []Record{
			{
				ID:               "r1",
				CreatedAt:        time.Now().UnixMilli(),
				ParticipantNames: []string{"阿伟", "小红"},
				WinnerName:       "小红",
				TaskMode:         TaskModePersonOnly,
				ParticipantCount: 2,
			},
		},
	}
	if _, err := store.SaveState(context.Background(), "user-1", state); err != nil {
		t.Fatalf("save state: %v", err)
	}
	cleared, err := store.ClearRecords(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("clear records: %v", err)
	}
	if len(cleared.Records) != 0 {
		t.Fatalf("expected records cleared, got %#v", cleared.Records)
	}
	if len(cleared.Participants) != 2 {
		t.Fatalf("expected participants kept, got %#v", cleared.Participants)
	}
}

func TestValidateRejectsDuplicateNames(t *testing.T) {
	state := State{
		Participants: []Participant{
			{ID: "p1", Name: "阿伟", CreatedAt: 1},
			{ID: "p2", Name: " 阿伟 ", CreatedAt: 2},
		},
		Settings: Settings{TaskMode: TaskModePersonOnly},
	}
	err := ValidateState(state)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate name error, got %v", err)
	}
}

func TestValidateRejectsTooManyParticipants(t *testing.T) {
	participants := make([]Participant, 0, MaxParticipants+1)
	for i := 0; i < MaxParticipants+1; i++ {
		participants = append(participants, Participant{ID: "p", Name: "名", CreatedAt: 1})
	}
	state := State{
		Participants: participants,
		Settings:     Settings{TaskMode: TaskModePersonOnly},
	}
	if err := ValidateState(state); err == nil {
		t.Fatalf("expected too many participants error")
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
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'wheel-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}
