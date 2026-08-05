package whodoesit

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrInvalidInput      = errors.New("who does it invalid input")
	ErrDatabasePathEmpty = errors.New("who does it database path is empty")
	ErrNotFound          = errors.New("who does it state not found")
)

const (
	MaxParticipants    = 36
	MinParticipants    = 2
	MaxNameLength      = 12
	MaxTaskLength      = 20
	MaxRecords         = 1000
	TaskModePersonOnly = "person-only"
	TaskModeCustom     = "custom"
	TaskModeRecent     = "recent"
)

type Participant struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
}

type Settings struct {
	TaskMode             string `json:"taskMode"`
	CustomTask           string `json:"customTask"`
	SelectedRecentTaskID string `json:"selectedRecentTaskId,omitempty"`
}

type Record struct {
	ID               string   `json:"id"`
	CreatedAt        int64    `json:"createdAt"`
	ParticipantNames []string `json:"participantNames"`
	WinnerName       string   `json:"winnerName"`
	TaskText         string   `json:"taskText,omitempty"`
	TaskMode         string   `json:"taskMode"`
	ParticipantCount int      `json:"participantCount"`
}

type State struct {
	Participants []Participant `json:"participants"`
	Settings     Settings      `json:"settings"`
	Records      []Record      `json:"records"`
	UpdatedAt    int64         `json:"updatedAt"`
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create who does it database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open who does it database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS who_does_it_state (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate who does it: %w", err)
		}
	}
	return nil
}

func (s *Store) GetState(ctx context.Context, userID string) (State, error) {
	var stateJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json FROM who_does_it_state WHERE user_id = ?
	`, userID).Scan(&stateJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return State{}, nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get who does it state: %w", err)
	}
	var state State
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return State{}, fmt.Errorf("decode who does it state: %w", err)
	}
	return state, nil
}

func (s *Store) SaveState(ctx context.Context, userID string, state State) (State, error) {
	if err := ValidateState(state); err != nil {
		return State{}, err
	}
	state.UpdatedAt = time.Now().UnixMilli()
	encoded, err := json.Marshal(state)
	if err != nil {
		return State{}, fmt.Errorf("encode who does it state: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO who_does_it_state (user_id, state_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			state_json = excluded.state_json,
			updated_at = excluded.updated_at
	`, userID, string(encoded), state.UpdatedAt)
	if err != nil {
		return State{}, fmt.Errorf("save who does it state: %w", err)
	}
	return state, nil
}

func (s *Store) ClearRecords(ctx context.Context, userID string) (State, error) {
	state, err := s.GetState(ctx, userID)
	if err != nil {
		return State{}, err
	}
	state.Records = []Record{}
	return s.SaveState(ctx, userID, state)
}

func ValidateState(state State) error {
	if len(state.Participants) > MaxParticipants {
		return fmt.Errorf("%w: too many participants", ErrInvalidInput)
	}
	seenNames := make(map[string]bool, len(state.Participants))
	for _, participant := range state.Participants {
		name := strings.TrimSpace(participant.Name)
		if name == "" || len([]rune(name)) > MaxNameLength {
			return fmt.Errorf("%w: invalid participant name", ErrInvalidInput)
		}
		if seenNames[name] {
			return fmt.Errorf("%w: duplicate participant name", ErrInvalidInput)
		}
		seenNames[name] = true
		if participant.ID == "" || len(participant.ID) > 64 {
			return fmt.Errorf("%w: invalid participant id", ErrInvalidInput)
		}
	}

	switch state.Settings.TaskMode {
	case TaskModePersonOnly, TaskModeCustom, TaskModeRecent:
	default:
		return fmt.Errorf("%w: invalid task mode", ErrInvalidInput)
	}
	if state.Settings.TaskMode == TaskModeCustom && strings.TrimSpace(state.Settings.CustomTask) == "" {
		return fmt.Errorf("%w: custom task required", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(state.Settings.CustomTask))) > MaxTaskLength {
		return fmt.Errorf("%w: task too long", ErrInvalidInput)
	}

	if len(state.Records) > MaxRecords {
		return fmt.Errorf("%w: too many records", ErrInvalidInput)
	}
	for _, record := range state.Records {
		if record.ID == "" || len(record.ID) > 64 {
			return fmt.Errorf("%w: invalid record id", ErrInvalidInput)
		}
		if len(record.ParticipantNames) < MinParticipants || len(record.ParticipantNames) > MaxParticipants {
			return fmt.Errorf("%w: invalid record participant count", ErrInvalidInput)
		}
		if record.ParticipantCount != len(record.ParticipantNames) {
			return fmt.Errorf("%w: record count mismatch", ErrInvalidInput)
		}
		recordNames := make(map[string]bool, len(record.ParticipantNames))
		foundWinner := false
		for _, name := range record.ParticipantNames {
			trimmed := strings.TrimSpace(name)
			if trimmed == "" || len([]rune(trimmed)) > MaxNameLength || recordNames[trimmed] {
				return fmt.Errorf("%w: invalid record participant", ErrInvalidInput)
			}
			recordNames[trimmed] = true
			if trimmed == record.WinnerName {
				foundWinner = true
			}
		}
		if !foundWinner {
			return fmt.Errorf("%w: winner missing from participants", ErrInvalidInput)
		}
		switch record.TaskMode {
		case TaskModePersonOnly, TaskModeCustom, TaskModeRecent:
		default:
			return fmt.Errorf("%w: invalid record task mode", ErrInvalidInput)
		}
		if len([]rune(strings.TrimSpace(record.TaskText))) > MaxTaskLength {
			return fmt.Errorf("%w: record task too long", ErrInvalidInput)
		}
		if record.CreatedAt <= 0 {
			return fmt.Errorf("%w: invalid record time", ErrInvalidInput)
		}
	}
	return nil
}
