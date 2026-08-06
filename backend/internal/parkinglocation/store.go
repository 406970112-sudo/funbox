package parkinglocation

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
	ErrInvalidInput      = errors.New("parking location invalid input")
	ErrDatabasePathEmpty = errors.New("parking location database path is empty")
	ErrNotFound          = errors.New("parking location state not found")
)

const (
	SchemaVersion          = 1
	MaxRecords             = 200
	MaxFeeRules            = 50
	MaxSearchHistory       = 10
	MaxParkingLotName      = 40
	MaxPositionLabel       = 20
	MaxLandmarkNote        = 40
	MaxNoteLength          = 300
	MaxSourceNoteLength    = 100
	MaxIDLength            = 64
	MaxPhotosPerRecord     = 6
	MaxPhotoURLLength      = 2000
	DefaultReminderMinutes = 30
)

type Photo struct {
	ID        string `json:"id"`
	URI       string `json:"uri"`
	TakenAt   int64  `json:"takenAt"`
	IsCover   bool   `json:"isCover"`
	SortOrder int    `json:"sortOrder"`
}

type Record struct {
	ID                string   `json:"id"`
	ParkingLotName    string   `json:"parkingLotName"`
	MapPOIID          string   `json:"mapPoiId"`
	MapPOIName        string   `json:"mapPoiName"`
	Latitude          *float64 `json:"latitude"`
	Longitude         *float64 `json:"longitude"`
	AccuracyM         *float64 `json:"accuracyM"`
	FloorLabel        string   `json:"floorLabel"`
	ZoneLabel         string   `json:"zoneLabel"`
	SpotLabel         string   `json:"spotLabel"`
	LandmarkNote      string   `json:"landmarkNote"`
	Note              string   `json:"note"`
	ParkedAt          int64    `json:"parkedAt"`
	LeaveAt           *int64   `json:"leaveAt"`
	Status            string   `json:"status"`
	FeeRuleID         string   `json:"feeRuleId"`
	ReminderMinutes   int      `json:"reminderMinutes"`
	ReminderMode      string   `json:"reminderMode"`
	EstimatedFeeCents *int64   `json:"estimatedFeeCents"`
	ActualFeeCents    *int64   `json:"actualFeeCents"`
	PhotoCount        int      `json:"photoCount"`
	CoverPhotoURI     string   `json:"coverPhotoUri"`
	Photos            []Photo  `json:"photos"`
	CreatedAt         int64    `json:"createdAt"`
	UpdatedAt         int64    `json:"updatedAt"`
}

type FeeRule struct {
	ID                    string `json:"id"`
	ParkingLotName        string `json:"parkingLotName"`
	FreeMinutes           *int   `json:"freeMinutes"`
	FirstRuleMinutes      *int   `json:"firstRuleMinutes"`
	FirstRuleAmountCents  *int64 `json:"firstRuleAmountCents"`
	SubsequentMinutes     *int   `json:"subsequentMinutes"`
	SubsequentAmountCents *int64 `json:"subsequentAmountCents"`
	MaxDayAmountCents     *int64 `json:"maxDayAmountCents"`
	SourceNote            string `json:"sourceNote"`
	CreatedAt             int64  `json:"createdAt"`
	UpdatedAt             int64  `json:"updatedAt"`
}

type Settings struct {
	DefaultReminderMinutes int   `json:"defaultReminderMinutes"`
	RuleBoundaryEnabled    bool  `json:"ruleBoundaryEnabled"`
	CancelOnLeave          bool  `json:"cancelOnLeave"`
	UpdatedAt              int64 `json:"updatedAt"`
}

type State struct {
	SchemaVersion int       `json:"schemaVersion"`
	Records       []Record  `json:"records"`
	FeeRules      []FeeRule `json:"feeRules"`
	Settings      Settings  `json:"settings"`
	SearchHistory []string  `json:"searchHistory"`
	UpdatedAt     int64     `json:"updatedAt"`
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
			return nil, fmt.Errorf("create parking location database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open parking location database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS parking_location_state (
			user_id TEXT PRIMARY KEY,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate parking location: %w", err)
		}
	}
	return nil
}

func (s *Store) GetState(ctx context.Context, userID string) (State, error) {
	var stateJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json FROM parking_location_state WHERE user_id = ?
	`, userID).Scan(&stateJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return emptyState(), nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get parking location state: %w", err)
	}
	var state State
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return State{}, fmt.Errorf("decode parking location state: %w", err)
	}
	normalizeState(&state)
	return state, nil
}

func (s *Store) SaveState(ctx context.Context, userID string, state State) (State, error) {
	normalizeState(&state)
	if err := ValidateState(state); err != nil {
		return State{}, err
	}
	state.UpdatedAt = time.Now().UnixMilli()
	encoded, err := json.Marshal(state)
	if err != nil {
		return State{}, fmt.Errorf("encode parking location state: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO parking_location_state (user_id, state_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			state_json = excluded.state_json,
			updated_at = excluded.updated_at
	`, userID, string(encoded), state.UpdatedAt)
	if err != nil {
		return State{}, fmt.Errorf("save parking location state: %w", err)
	}
	return state, nil
}

func (s *Store) ClearState(ctx context.Context, userID string) (State, error) {
	return s.SaveState(ctx, userID, emptyState())
}

func emptyState() State {
	return State{
		SchemaVersion: SchemaVersion,
		Records:       []Record{},
		FeeRules:      []FeeRule{},
		Settings: Settings{
			DefaultReminderMinutes: DefaultReminderMinutes,
			RuleBoundaryEnabled:    true,
			CancelOnLeave:          true,
		},
		SearchHistory: []string{},
	}
}

func normalizeState(state *State) {
	if state == nil {
		return
	}
	if state.Records == nil {
		state.Records = []Record{}
	}
	if state.FeeRules == nil {
		state.FeeRules = []FeeRule{}
	}
	if state.SearchHistory == nil {
		state.SearchHistory = []string{}
	}
	if state.Settings.DefaultReminderMinutes <= 0 {
		state.Settings.DefaultReminderMinutes = DefaultReminderMinutes
	}
}

func ValidateState(state State) error {
	if state.SchemaVersion != SchemaVersion {
		return fmt.Errorf("%w: invalid schema version", ErrInvalidInput)
	}
	if len(state.Records) > MaxRecords {
		return fmt.Errorf("%w: too many records", ErrInvalidInput)
	}
	recordIDs := map[string]bool{}
	ruleIDs := map[string]bool{}
	for _, rule := range state.FeeRules {
		if len(state.FeeRules) > MaxFeeRules {
			return fmt.Errorf("%w: too many fee rules", ErrInvalidInput)
		}
		if err := validateFeeRule(rule); err != nil {
			return err
		}
		if ruleIDs[rule.ID] {
			return fmt.Errorf("%w: duplicate fee rule id", ErrInvalidInput)
		}
		ruleIDs[rule.ID] = true
	}
	for _, record := range state.Records {
		if err := validateRecord(record); err != nil {
			return err
		}
		if recordIDs[record.ID] {
			return fmt.Errorf("%w: duplicate record id", ErrInvalidInput)
		}
		recordIDs[record.ID] = true
		if record.FeeRuleID != "" && !ruleIDs[record.FeeRuleID] {
			return fmt.Errorf("%w: record references missing fee rule", ErrInvalidInput)
		}
	}
	for _, query := range state.SearchHistory {
		if strings.TrimSpace(query) == "" {
			return fmt.Errorf("%w: empty search history", ErrInvalidInput)
		}
	}
	if len(state.SearchHistory) > MaxSearchHistory {
		return fmt.Errorf("%w: too many search history items", ErrInvalidInput)
	}
	if state.Settings.DefaultReminderMinutes < 1 || state.Settings.DefaultReminderMinutes > 1440 {
		return fmt.Errorf("%w: invalid default reminder minutes", ErrInvalidInput)
	}
	return nil
}

func validateFeeRule(rule FeeRule) error {
	if rule.ID == "" || len(rule.ID) > MaxIDLength {
		return fmt.Errorf("%w: invalid fee rule id", ErrInvalidInput)
	}
	name := strings.TrimSpace(rule.ParkingLotName)
	if name == "" || len([]rune(name)) > MaxParkingLotName {
		return fmt.Errorf("%w: invalid fee rule parking lot name", ErrInvalidInput)
	}
	if rule.FreeMinutes != nil && (*rule.FreeMinutes < 0 || *rule.FreeMinutes > 1440*30) {
		return fmt.Errorf("%w: invalid free minutes", ErrInvalidInput)
	}
	if rule.FirstRuleMinutes != nil && (*rule.FirstRuleMinutes < 1 || *rule.FirstRuleMinutes > 1440*30) {
		return fmt.Errorf("%w: invalid first rule minutes", ErrInvalidInput)
	}
	if rule.FirstRuleAmountCents != nil && *rule.FirstRuleAmountCents < 0 {
		return fmt.Errorf("%w: invalid first rule amount", ErrInvalidInput)
	}
	if rule.SubsequentMinutes != nil && (*rule.SubsequentMinutes < 1 || *rule.SubsequentMinutes > 1440*30) {
		return fmt.Errorf("%w: invalid subsequent minutes", ErrInvalidInput)
	}
	if rule.SubsequentAmountCents != nil && *rule.SubsequentAmountCents < 0 {
		return fmt.Errorf("%w: invalid subsequent amount", ErrInvalidInput)
	}
	if rule.MaxDayAmountCents != nil && *rule.MaxDayAmountCents < 0 {
		return fmt.Errorf("%w: invalid max day amount", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(rule.SourceNote))) > MaxSourceNoteLength {
		return fmt.Errorf("%w: invalid source note", ErrInvalidInput)
	}
	return nil
}

func validateRecord(record Record) error {
	if record.ID == "" || len(record.ID) > MaxIDLength {
		return fmt.Errorf("%w: invalid record id", ErrInvalidInput)
	}
	name := strings.TrimSpace(record.ParkingLotName)
	if name == "" || len([]rune(name)) > MaxParkingLotName {
		return fmt.Errorf("%w: invalid parking lot name", ErrInvalidInput)
	}
	positionCount := 0
	if strings.TrimSpace(record.FloorLabel) != "" {
		positionCount++
	}
	if strings.TrimSpace(record.ZoneLabel) != "" {
		positionCount++
	}
	if strings.TrimSpace(record.SpotLabel) != "" {
		positionCount++
	}
	if positionCount == 0 {
		return fmt.Errorf("%w: floor zone or spot is required", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.FloorLabel))) > MaxPositionLabel {
		return fmt.Errorf("%w: invalid floor label", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.ZoneLabel))) > MaxPositionLabel {
		return fmt.Errorf("%w: invalid zone label", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.SpotLabel))) > MaxPositionLabel {
		return fmt.Errorf("%w: invalid spot label", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.LandmarkNote))) > MaxLandmarkNote {
		return fmt.Errorf("%w: invalid landmark note", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.Note))) > MaxNoteLength {
		return fmt.Errorf("%w: invalid note", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.MapPOIName))) > MaxParkingLotName {
		return fmt.Errorf("%w: invalid map poi name", ErrInvalidInput)
	}
	if record.ParkedAt <= 0 {
		return fmt.Errorf("%w: invalid parked at", ErrInvalidInput)
	}
	if record.LeaveAt != nil && *record.LeaveAt < record.ParkedAt {
		return fmt.Errorf("%w: leave at before parked at", ErrInvalidInput)
	}
	if record.Status != "active" && record.Status != "left" {
		return fmt.Errorf("%w: invalid record status", ErrInvalidInput)
	}
	if record.Status == "left" && record.LeaveAt == nil {
		return fmt.Errorf("%w: left record requires leave at", ErrInvalidInput)
	}
	if record.ReminderMode != "none" && record.ReminderMode != "fixed" && record.ReminderMode != "rule_boundary" {
		return fmt.Errorf("%w: invalid reminder mode", ErrInvalidInput)
	}
	if record.ReminderMinutes < 0 || record.ReminderMinutes > 1440 {
		return fmt.Errorf("%w: invalid reminder minutes", ErrInvalidInput)
	}
	if record.EstimatedFeeCents != nil && *record.EstimatedFeeCents < 0 {
		return fmt.Errorf("%w: invalid estimated fee", ErrInvalidInput)
	}
	if record.ActualFeeCents != nil && *record.ActualFeeCents < 0 {
		return fmt.Errorf("%w: invalid actual fee", ErrInvalidInput)
	}
	if len(record.Photos) > MaxPhotosPerRecord {
		return fmt.Errorf("%w: too many photos", ErrInvalidInput)
	}
	photoIDs := map[string]bool{}
	for _, photo := range record.Photos {
		if photo.ID == "" || len(photo.ID) > MaxIDLength {
			return fmt.Errorf("%w: invalid photo id", ErrInvalidInput)
		}
		if photoIDs[photo.ID] {
			return fmt.Errorf("%w: duplicate photo id", ErrInvalidInput)
		}
		photoIDs[photo.ID] = true
		if photo.URI == "" || len(photo.URI) > MaxPhotoURLLength {
			return fmt.Errorf("%w: invalid photo uri", ErrInvalidInput)
		}
	}
	return nil
}
