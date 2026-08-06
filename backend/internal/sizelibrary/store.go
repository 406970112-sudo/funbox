package sizelibrary

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var (
	ErrInvalidInput      = errors.New("size library invalid input")
	ErrDatabasePathEmpty = errors.New("size library database path is empty")
	ErrNotFound          = errors.New("size library state not found")
)

const (
	MaxPersonProfiles    = 30
	MaxRoomProfiles      = 30
	MaxSpaceItemProfiles = 60
	MaxProfiles          = 120
	MaxMeasurements      = 400
	MaxPersonNameLength  = 12
	MaxSpaceNameLength   = 20
	MaxRelationLength    = 12
	MaxNoteLength        = 60
	MaxCustomItems       = 10
	MaxLabelLength       = 20
	MaxTextValueLength   = 40
	MaxIDLength          = 64

	KindPerson  = "person"
	KindRoom    = "room"
	KindDesk    = "desk"
	KindCurtain = "curtain"
)

type Profile struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Relation  string `json:"relation"`
	RoomID    string `json:"roomId"`
	Color     string `json:"color"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type Measurement struct {
	ID           string `json:"id"`
	ProfileID    string `json:"profileId"`
	DimensionKey string `json:"dimensionKey"`
	Label        string `json:"label"`
	Value        string `json:"value"`
	Unit         string `json:"unit"`
	Note         string `json:"note"`
	UpdatedAt    int64  `json:"updatedAt"`
}

type State struct {
	SchemaVersion int           `json:"schemaVersion"`
	Profiles      []Profile     `json:"profiles"`
	Measurements  []Measurement `json:"measurements"`
	UpdatedAt     int64         `json:"updatedAt"`
}

type dimensionMeta struct {
	Key      string
	Label    string
	Kind     string
	Group    string
	Unit     string
	Numeric  bool
	Min      float64
	Max      float64
	Scenario string
}

var dimensionMetaList = []dimensionMeta{
	{Key: "height", Label: "身高", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 30, Max: 250, Scenario: "clothes"},
	{Key: "weight", Label: "体重", Kind: KindPerson, Group: "身体尺寸", Unit: "kg", Numeric: true, Min: 2, Max: 300, Scenario: "clothes"},
	{Key: "chest", Label: "胸围", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 20, Max: 200, Scenario: "clothes"},
	{Key: "waist", Label: "腰围", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 20, Max: 200, Scenario: "clothes"},
	{Key: "hip", Label: "臀围", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 20, Max: 200, Scenario: "clothes"},
	{Key: "shoulder", Label: "肩宽", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 120, Scenario: "clothes"},
	{Key: "sleeve", Label: "臂长", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 120, Scenario: "clothes"},
	{Key: "inseam", Label: "裤内长", Kind: KindPerson, Group: "身体尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 160, Scenario: "clothes"},
	{Key: "clothingSize", Label: "衣服尺码", Kind: KindPerson, Group: "衣物与鞋饰", Scenario: "clothes"},
	{Key: "shoeSize", Label: "鞋码", Kind: KindPerson, Group: "衣物与鞋饰", Scenario: "shoes"},
	{Key: "footLength", Label: "脚长", Kind: KindPerson, Group: "衣物与鞋饰", Unit: "cm", Numeric: true, Min: 5, Max: 40, Scenario: "shoes"},
	{Key: "ringSize", Label: "戒指圈号", Kind: KindPerson, Group: "衣物与鞋饰", Scenario: "ring"},
	{Key: "ringDiameter", Label: "戒指内径", Kind: KindPerson, Group: "衣物与鞋饰", Unit: "mm", Numeric: true, Min: 8, Max: 30, Scenario: "ring"},
	{Key: "roomLength", Label: "房间长", Kind: KindRoom, Group: "房间尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 10000, Scenario: "room"},
	{Key: "roomWidth", Label: "房间宽", Kind: KindRoom, Group: "房间尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 10000, Scenario: "room"},
	{Key: "roomHeight", Label: "房间高", Kind: KindRoom, Group: "房间尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 10000, Scenario: "room"},
	{Key: "deskLength", Label: "桌面长", Kind: KindDesk, Group: "书桌尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "desk"},
	{Key: "deskWidth", Label: "桌面宽", Kind: KindDesk, Group: "书桌尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "desk"},
	{Key: "deskHeight", Label: "桌面高", Kind: KindDesk, Group: "书桌尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "desk"},
	{Key: "windowWidth", Label: "窗户宽", Kind: KindCurtain, Group: "窗帘尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "curtain"},
	{Key: "windowHeight", Label: "窗户高", Kind: KindCurtain, Group: "窗帘尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "curtain"},
	{Key: "curtainWidth", Label: "窗帘宽", Kind: KindCurtain, Group: "窗帘尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "curtain"},
	{Key: "curtainHeight", Label: "窗帘高", Kind: KindCurtain, Group: "窗帘尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "curtain"},
	{Key: "railLength", Label: "轨道长", Kind: KindCurtain, Group: "窗帘尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "curtain"},
	{Key: "dropHeight", Label: "落地高度", Kind: KindCurtain, Group: "窗帘尺寸", Unit: "cm", Numeric: true, Min: 10, Max: 1000, Scenario: "curtain"},
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
			return nil, fmt.Errorf("create size library database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open size library database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS size_library_state (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate size library: %w", err)
		}
	}
	return nil
}

func (s *Store) GetState(ctx context.Context, userID string) (State, error) {
	var stateJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json FROM size_library_state WHERE user_id = ?
	`, userID).Scan(&stateJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return State{
			SchemaVersion: 1,
			Profiles:      []Profile{},
			Measurements:  []Measurement{},
		}, nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get size library state: %w", err)
	}
	var state State
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return State{}, fmt.Errorf("decode size library state: %w", err)
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
		return State{}, fmt.Errorf("encode size library state: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO size_library_state (user_id, state_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			state_json = excluded.state_json,
			updated_at = excluded.updated_at
	`, userID, string(encoded), state.UpdatedAt)
	if err != nil {
		return State{}, fmt.Errorf("save size library state: %w", err)
	}
	return state, nil
}

func (s *Store) ClearState(ctx context.Context, userID string) (State, error) {
	empty := State{
		SchemaVersion: 1,
		Profiles:      []Profile{},
		Measurements:  []Measurement{},
	}
	return s.SaveState(ctx, userID, empty)
}

func ValidateState(state State) error {
	if state.SchemaVersion != 1 {
		return fmt.Errorf("%w: invalid schema version", ErrInvalidInput)
	}
	if len(state.Profiles) > MaxProfiles {
		return fmt.Errorf("%w: too many profiles", ErrInvalidInput)
	}

	profileByID := make(map[string]Profile, len(state.Profiles))
	counts := map[string]int{}
	seenNames := map[string]map[string]bool{}
	for _, profile := range state.Profiles {
		kind := strings.TrimSpace(profile.Kind)
		if !validKind(kind) {
			return fmt.Errorf("%w: invalid profile kind", ErrInvalidInput)
		}
		counts[kind]++
		if kind == KindPerson && counts[kind] > MaxPersonProfiles {
			return fmt.Errorf("%w: too many person profiles", ErrInvalidInput)
		}
		if kind == KindRoom && counts[kind] > MaxRoomProfiles {
			return fmt.Errorf("%w: too many room profiles", ErrInvalidInput)
		}
		if (kind == KindDesk || kind == KindCurtain) && counts[KindDesk]+counts[KindCurtain] > MaxSpaceItemProfiles {
			return fmt.Errorf("%w: too many space items", ErrInvalidInput)
		}
		if profile.ID == "" || len(profile.ID) > MaxIDLength {
			return fmt.Errorf("%w: invalid profile id", ErrInvalidInput)
		}
		if _, exists := profileByID[profile.ID]; exists {
			return fmt.Errorf("%w: duplicate profile id", ErrInvalidInput)
		}
		name := strings.TrimSpace(profile.Name)
		maxName := MaxPersonNameLength
		if kind != KindPerson {
			maxName = MaxSpaceNameLength
		}
		if name == "" || len([]rune(name)) > maxName {
			return fmt.Errorf("%w: invalid profile name", ErrInvalidInput)
		}
		if seenNames[kind] == nil {
			seenNames[kind] = map[string]bool{}
		}
		if seenNames[kind][name] {
			return fmt.Errorf("%w: duplicate profile name", ErrInvalidInput)
		}
		seenNames[kind][name] = true
		if len([]rune(strings.TrimSpace(profile.Relation))) > MaxRelationLength {
			return fmt.Errorf("%w: invalid relation", ErrInvalidInput)
		}
		if len(profile.Color) > 32 {
			return fmt.Errorf("%w: invalid profile color", ErrInvalidInput)
		}
		profileByID[profile.ID] = profile
	}
	for _, profile := range state.Profiles {
		if profile.RoomID == "" {
			continue
		}
		if profile.Kind != KindDesk && profile.Kind != KindCurtain {
			return fmt.Errorf("%w: only desk and curtain can link room", ErrInvalidInput)
		}
		room, exists := profileByID[profile.RoomID]
		if !exists || room.Kind != KindRoom {
			return fmt.Errorf("%w: invalid linked room", ErrInvalidInput)
		}
	}

	if len(state.Measurements) > MaxMeasurements {
		return fmt.Errorf("%w: too many measurements", ErrInvalidInput)
	}
	measurementKeys := map[string]map[string]bool{}
	for _, item := range state.Measurements {
		if item.ID == "" || len(item.ID) > MaxIDLength {
			return fmt.Errorf("%w: invalid measurement id", ErrInvalidInput)
		}
		profile, exists := profileByID[item.ProfileID]
		if !exists {
			return fmt.Errorf("%w: measurement references missing profile", ErrInvalidInput)
		}
		if measurementKeys[item.ProfileID] == nil {
			measurementKeys[item.ProfileID] = map[string]bool{}
		}
		if measurementKeys[item.ProfileID][item.DimensionKey] {
			return fmt.Errorf("%w: duplicate measurement", ErrInvalidInput)
		}
		measurementKeys[item.ProfileID][item.DimensionKey] = true
		label := strings.TrimSpace(item.Label)
		if label == "" || len([]rune(label)) > MaxLabelLength {
			return fmt.Errorf("%w: invalid measurement label", ErrInvalidInput)
		}
		value := strings.TrimSpace(item.Value)
		if value == "" {
			return fmt.Errorf("%w: measurement value is required", ErrInvalidInput)
		}
		note := strings.TrimSpace(item.Note)
		if len([]rune(note)) > MaxNoteLength {
			return fmt.Errorf("%w: measurement note too long", ErrInvalidInput)
		}
		unit := strings.TrimSpace(item.Unit)
		meta := findDimensionMeta(item.DimensionKey, profile.Kind)
		if meta == nil && !strings.HasPrefix(item.DimensionKey, "custom_") {
			return fmt.Errorf("%w: invalid dimension key", ErrInvalidInput)
		}
		if strings.HasPrefix(item.DimensionKey, "custom_") {
			customCount := 0
			for _, other := range state.Measurements {
				if other.ProfileID == item.ProfileID && strings.HasPrefix(other.DimensionKey, "custom_") {
					customCount++
				}
			}
			if customCount > MaxCustomItems {
				return fmt.Errorf("%w: too many custom measurements", ErrInvalidInput)
			}
			if unit != "" && !validUnit(unit) {
				return fmt.Errorf("%w: invalid unit", ErrInvalidInput)
			}
			if len([]rune(value)) > MaxTextValueLength {
				return fmt.Errorf("%w: custom value too long", ErrInvalidInput)
			}
			continue
		}
		if meta.Numeric {
			if !validUnit(unit) {
				return fmt.Errorf("%w: invalid unit", ErrInvalidInput)
			}
			number, err := strconv.ParseFloat(value, 64)
			if err != nil || number < meta.Min || number > meta.Max {
				return fmt.Errorf("%w: measurement value out of range", ErrInvalidInput)
			}
		} else if len([]rune(value)) > MaxTextValueLength {
			return fmt.Errorf("%w: text value too long", ErrInvalidInput)
		}
	}
	return nil
}

func validKind(kind string) bool {
	return kind == KindPerson || kind == KindRoom || kind == KindDesk || kind == KindCurtain
}

func validUnit(unit string) bool {
	switch unit {
	case "cm", "m", "mm", "kg":
		return true
	default:
		return false
	}
}

func findDimensionMeta(key, kind string) *dimensionMeta {
	for i := range dimensionMetaList {
		if dimensionMetaList[i].Key == key && dimensionMetaList[i].Kind == kind {
			return &dimensionMetaList[i]
		}
	}
	return nil
}
