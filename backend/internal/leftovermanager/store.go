package leftovermanager

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound          = errors.New("leftover manager not found")
	ErrInvalidInput      = errors.New("leftover manager invalid input")
	ErrDatabasePathEmpty = errors.New("leftover manager database path is empty")
)

const (
	MaxNameLength          = 40
	MaxMerchantLength      = 30
	MaxNoteLength          = 60
	MaxRemainingTextLength = 20
	MaxTags                = 8
	MaxTagLength           = 8
	MaxPhotos              = 3
	MaxListItems           = 200
	MaxEventsPerItem       = 100

	SourceLeftover   = "leftover"
	SourceTakeout    = "takeout"
	SourceOpened     = "opened"
	SourceIngredient = "ingredient"

	ZoneFridge  = "fridge"
	ZoneFreezer = "freezer"
	ZoneDoor    = "door"
	ZoneDrawer  = "drawer"

	StatusActive    = "active"
	StatusEaten     = "eaten"
	StatusDiscarded = "discarded"

	EventCreated   = "created"
	EventEdited    = "edited"
	EventReheated  = "reheated"
	EventEaten     = "eaten"
	EventDiscarded = "discarded"
	EventDeleted   = "deleted"
)

var supportedSourceTypes = map[string]bool{
	SourceLeftover:   true,
	SourceTakeout:    true,
	SourceOpened:     true,
	SourceIngredient: true,
}

var supportedZones = map[string]bool{
	ZoneFridge:  true,
	ZoneFreezer: true,
	ZoneDoor:    true,
	ZoneDrawer:  true,
}

type Item struct {
	ID                string   `json:"id"`
	UserID            string   `json:"userId"`
	Name              string   `json:"name"`
	SourceType        string   `json:"sourceType"`
	Merchant          string   `json:"merchant"`
	EnteredFridgeAt   int64    `json:"enteredFridgeAt"`
	ExpectedConsumeAt int64    `json:"expectedConsumeAt"`
	StoredZone        string   `json:"storedZone"`
	RemainingPercent  int      `json:"remainingPercent"`
	RemainingText     string   `json:"remainingText"`
	ReheatCount       int      `json:"reheatCount"`
	Tags              []string `json:"tags"`
	CostCents         int64    `json:"costCents"`
	Notes             string   `json:"notes"`
	Status            string   `json:"status"`
	EatenAt           *int64   `json:"eatenAt,omitempty"`
	DiscardedAt       *int64   `json:"discardedAt,omitempty"`
	DiscardReason     string   `json:"discardReason,omitempty"`
	PhotoCount        int      `json:"photoCount"`
	CoverPhotoURL     string   `json:"coverPhotoUrl,omitempty"`
	CreatedAt         int64    `json:"createdAt"`
	UpdatedAt         int64    `json:"updatedAt"`
}

type ItemDetail struct {
	Item
	Photos []Photo `json:"photos"`
	Events []Event `json:"events"`
}

type Photo struct {
	ID        string `json:"id"`
	ItemID    string `json:"itemId"`
	UserID    string `json:"userId"`
	FileURL   string `json:"fileUrl"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
}

type Event struct {
	ID         string `json:"id"`
	ItemID     string `json:"itemId"`
	UserID     string `json:"userId"`
	EventType  string `json:"eventType"`
	Note       string `json:"note"`
	HappenedAt int64  `json:"happenedAt"`
}

type Settings struct {
	UserID              string `json:"userId"`
	RemindBeforeHours   int    `json:"remindBeforeHours"`
	Daily09Enabled      bool   `json:"daily09Enabled"`
	Evening19Enabled    bool   `json:"evening19Enabled"`
	NotificationEnabled bool   `json:"notificationEnabled"`
	UpdatedAt           int64  `json:"updatedAt"`
}

type ItemInput struct {
	Name              string   `json:"name"`
	SourceType        string   `json:"sourceType"`
	Merchant          string   `json:"merchant"`
	EnteredFridgeAt   int64    `json:"enteredFridgeAt"`
	ExpectedConsumeAt int64    `json:"expectedConsumeAt"`
	StoredZone        string   `json:"storedZone"`
	RemainingPercent  int      `json:"remainingPercent"`
	RemainingText     string   `json:"remainingText"`
	ReheatCount       int      `json:"reheatCount"`
	Tags              []string `json:"tags"`
	CostCents         int64    `json:"costCents"`
	Notes             string   `json:"notes"`
}

type SettingsInput struct {
	RemindBeforeHours   int  `json:"remindBeforeHours"`
	Daily09Enabled      bool `json:"daily09Enabled"`
	Evening19Enabled    bool `json:"evening19Enabled"`
	NotificationEnabled bool `json:"notificationEnabled"`
}

type RecipeIngredient struct {
	Keyword  string `json:"keyword"`
	Label    string `json:"label"`
	Quantity string `json:"quantity"`
}

type Recipe struct {
	ID               string             `json:"id"`
	Name             string             `json:"name"`
	MainIngredients  []RecipeIngredient `json:"mainIngredients"`
	Seasonings       []string           `json:"seasonings"`
	EstimatedMinutes int                `json:"estimatedMinutes"`
	Steps            []string           `json:"steps"`
	Source           string             `json:"source"`
}

type RecipeMatchedItem struct {
	ItemID         string `json:"itemId"`
	Name           string `json:"name"`
	RemainingText  string `json:"remainingText"`
	ExpiringWithin bool   `json:"expiringWithin"`
}

type RecipeMatch struct {
	RecipeID         string              `json:"recipeId"`
	Name             string              `json:"name"`
	MatchPercent     int                 `json:"matchPercent"`
	MatchedCount     int                 `json:"matchedCount"`
	TotalCount       int                 `json:"totalCount"`
	EstimatedMinutes int                 `json:"estimatedMinutes"`
	Source           string              `json:"source"`
	MatchedItems     []RecipeMatchedItem `json:"matchedItems"`
	Missing          []string            `json:"missing"`
	ExpiringCount    int                 `json:"expiringCount"`
}

type HomeSummary struct {
	ActiveCount       int   `json:"activeCount"`
	TodayCount        int   `json:"todayCount"`
	ExpiredCount      int   `json:"expiredCount"`
	ThisWeekEaten     int   `json:"thisWeekEaten"`
	ThisWeekDiscarded int   `json:"thisWeekDiscarded"`
	AvoidWasteCents   int64 `json:"avoidWasteCents"`
	WasteCents        int64 `json:"wasteCents"`
}

type HomePayload struct {
	Summary     HomeSummary   `json:"summary"`
	Priority    []Item        `json:"priority"`
	Suggestions []RecipeMatch `json:"suggestions"`
	ServerNow   int64         `json:"serverNow"`
	Settings    Settings      `json:"settings"`
}

type HistoryPayload struct {
	Items     []Item      `json:"items"`
	Summary   HomeSummary `json:"summary"`
	ServerNow int64       `json:"serverNow"`
}

type ExportSnapshot struct {
	ExportedAt int64    `json:"exportedAt"`
	Items      []Item   `json:"items"`
	Events     []Event  `json:"events"`
	Photos     []Photo  `json:"photos"`
	Settings   Settings `json:"settings"`
	Recipes    []Recipe `json:"recipes"`
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
			return nil, fmt.Errorf("create leftover manager database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open leftover manager database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS leftover_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			source_type TEXT NOT NULL,
			merchant TEXT NOT NULL DEFAULT '',
			entered_fridge_at INTEGER NOT NULL,
			expected_consume_at INTEGER NOT NULL,
			stored_zone TEXT NOT NULL DEFAULT 'fridge',
			remaining_percent INTEGER NOT NULL,
			remaining_text TEXT NOT NULL DEFAULT '',
			reheat_count INTEGER NOT NULL DEFAULT 0,
			tags_json TEXT NOT NULL DEFAULT '[]',
			cost_cents INTEGER NOT NULL DEFAULT 0,
			notes TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active',
			eaten_at INTEGER,
			discarded_at INTEGER,
			discard_reason TEXT NOT NULL DEFAULT '',
			cover_photo_id TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_leftover_items_user_status
			ON leftover_items(user_id, status, expected_consume_at)`,
		`CREATE TABLE IF NOT EXISTS leftover_events (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES leftover_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			happened_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_leftover_events_item
			ON leftover_events(item_id, happened_at DESC)`,
		`CREATE TABLE IF NOT EXISTS leftover_photos (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES leftover_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			file_url TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_leftover_photos_item
			ON leftover_photos(item_id, sort_order, created_at)`,
		`CREATE TABLE IF NOT EXISTS leftover_settings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			remind_before_hours INTEGER NOT NULL DEFAULT 2,
			daily09_enabled INTEGER NOT NULL DEFAULT 0,
			evening19_enabled INTEGER NOT NULL DEFAULT 0,
			notification_enabled INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate leftover manager: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateItem(ctx context.Context, userID string, input ItemInput) (Item, error) {
	if err := validateItemInput(input); err != nil {
		return Item{}, err
	}
	name := strings.TrimSpace(input.Name)
	var duplicate int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM leftover_items
		WHERE user_id = ? AND name = ? AND status = ?
	`, userID, name, StatusActive).Scan(&duplicate); err != nil {
		return Item{}, fmt.Errorf("check leftover duplicate: %w", err)
	}
	if duplicate > 0 {
		return Item{}, fmt.Errorf("%w: duplicate active name", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	item := Item{
		ID:                uuid.NewString(),
		UserID:            userID,
		Name:              name,
		SourceType:        input.SourceType,
		Merchant:          strings.TrimSpace(input.Merchant),
		EnteredFridgeAt:   input.EnteredFridgeAt,
		ExpectedConsumeAt: input.ExpectedConsumeAt,
		StoredZone:        input.StoredZone,
		RemainingPercent:  input.RemainingPercent,
		RemainingText:     strings.TrimSpace(input.RemainingText),
		ReheatCount:       input.ReheatCount,
		Tags:              normalizeTags(input.Tags),
		CostCents:         input.CostCents,
		Notes:             strings.TrimSpace(input.Notes),
		Status:            StatusActive,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	if err := insertItem(ctx, tx, item); err != nil {
		return Item{}, err
	}
	if err := insertEvent(ctx, tx, Event{
		ID: uuid.NewString(), ItemID: item.ID, UserID: userID,
		EventType: EventCreated, HappenedAt: now,
	}); err != nil {
		return Item{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *Store) UpdateItem(ctx context.Context, userID, itemID string, input ItemInput) (Item, error) {
	current, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if err := validateItemInput(input); err != nil {
		return Item{}, err
	}
	name := strings.TrimSpace(input.Name)
	var duplicate int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM leftover_items
		WHERE user_id = ? AND name = ? AND status = ? AND id <> ?
	`, userID, name, StatusActive, itemID).Scan(&duplicate); err != nil {
		return Item{}, fmt.Errorf("check leftover duplicate: %w", err)
	}
	if duplicate > 0 {
		return Item{}, fmt.Errorf("%w: duplicate active name", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	tagsJSON, err := json.Marshal(normalizeTags(input.Tags))
	if err != nil {
		return Item{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE leftover_items
		SET name = ?, source_type = ?, merchant = ?, entered_fridge_at = ?,
			expected_consume_at = ?, stored_zone = ?, remaining_percent = ?,
			remaining_text = ?, reheat_count = ?, tags_json = ?, cost_cents = ?,
			notes = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, name, input.SourceType, strings.TrimSpace(input.Merchant), input.EnteredFridgeAt,
		input.ExpectedConsumeAt, input.StoredZone, input.RemainingPercent,
		strings.TrimSpace(input.RemainingText), input.ReheatCount, string(tagsJSON),
		input.CostCents, strings.TrimSpace(input.Notes), now, itemID, userID)
	if err != nil {
		return Item{}, fmt.Errorf("update leftover item: %w", err)
	}
	_ = s.addEvent(ctx, userID, itemID, EventEdited, now, "")
	updated, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	_ = current
	return updated, nil
}

func (s *Store) DeleteItem(ctx context.Context, userID, itemID string) error {
	if _, err := s.GetItem(ctx, userID, itemID); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	_ = s.addEvent(ctx, userID, itemID, EventDeleted, now, "")
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM leftover_items WHERE id = ? AND user_id = ?
	`, itemID, userID); err != nil {
		return fmt.Errorf("delete leftover item: %w", err)
	}
	return nil
}

func (s *Store) GetItem(ctx context.Context, userID, itemID string) (Item, error) {
	return s.getItem(ctx, userID, itemID)
}

func (s *Store) GetItemDetail(ctx context.Context, userID, itemID string) (ItemDetail, error) {
	item, err := s.getItem(ctx, userID, itemID)
	if err != nil {
		return ItemDetail{}, err
	}
	photos, err := s.ListPhotos(ctx, userID, itemID)
	if err != nil {
		return ItemDetail{}, err
	}
	events, err := s.ListEvents(ctx, userID, itemID)
	if err != nil {
		return ItemDetail{}, err
	}
	return ItemDetail{Item: item, Photos: photos, Events: events}, nil
}

func (s *Store) ListItems(ctx context.Context, userID string) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, name, source_type, merchant, entered_fridge_at,
			expected_consume_at, stored_zone, remaining_percent, remaining_text,
			reheat_count, tags_json, cost_cents, notes, status, eaten_at,
			discarded_at, discard_reason, created_at, updated_at,
			(SELECT p.file_url FROM leftover_photos p
				WHERE p.id = leftover_items.cover_photo_id) AS cover_photo_url,
			(SELECT COUNT(*) FROM leftover_photos p
				WHERE p.item_id = leftover_items.id AND p.user_id = leftover_items.user_id) AS photo_count
		FROM leftover_items
		WHERE user_id = ?
		ORDER BY
			CASE status WHEN 'active' THEN 0 ELSE 1 END,
			expected_consume_at ASC,
			created_at DESC
		LIMIT ?
	`, userID, MaxListItems)
	if err != nil {
		return nil, fmt.Errorf("list leftover items: %w", err)
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) Home(ctx context.Context, userID string) (HomePayload, error) {
	items, err := s.ListItems(ctx, userID)
	if err != nil {
		return HomePayload{}, err
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return HomePayload{}, err
	}
	now := time.Now().UnixMilli()
	summary := buildSummary(items, now)
	priority := make([]Item, 0, len(items))
	for _, item := range items {
		if item.Status == StatusActive {
			priority = append(priority, item)
		}
	}
	sort.SliceStable(priority, func(i, j int) bool {
		return priority[i].ExpectedConsumeAt < priority[j].ExpectedConsumeAt
	})
	suggestions := BuildSuggestions(RecipeLibrary, items, now)
	return HomePayload{
		Summary:     summary,
		Priority:    priority,
		Suggestions: suggestions,
		ServerNow:   now,
		Settings:    settings,
	}, nil
}

func (s *Store) History(ctx context.Context, userID string) (HistoryPayload, error) {
	items, err := s.ListItems(ctx, userID)
	if err != nil {
		return HistoryPayload{}, err
	}
	now := time.Now().UnixMilli()
	history := make([]Item, 0, len(items))
	for _, item := range items {
		if item.Status == StatusEaten || item.Status == StatusDiscarded {
			history = append(history, item)
		}
	}
	return HistoryPayload{
		Items:     history,
		Summary:   buildSummary(items, now),
		ServerNow: now,
	}, nil
}

func (s *Store) MarkEaten(ctx context.Context, userID, itemID string) (Item, error) {
	item, err := s.getItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.Status != StatusActive {
		return Item{}, fmt.Errorf("%w: item is not active", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE leftover_items SET status = ?, eaten_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, StatusEaten, now, now, itemID, userID); err != nil {
		return Item{}, fmt.Errorf("mark leftover eaten: %w", err)
	}
	_ = s.addEvent(ctx, userID, itemID, EventEaten, now, "")
	return s.getItem(ctx, userID, itemID)
}

func (s *Store) MarkDiscarded(ctx context.Context, userID, itemID, reason string) (Item, error) {
	item, err := s.getItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.Status != StatusActive {
		return Item{}, fmt.Errorf("%w: item is not active", ErrInvalidInput)
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len([]rune(reason)) > MaxNoteLength {
		return Item{}, ErrInvalidInput
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE leftover_items SET status = ?, discarded_at = ?, discard_reason = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, StatusDiscarded, now, reason, now, itemID, userID); err != nil {
		return Item{}, fmt.Errorf("mark leftover discarded: %w", err)
	}
	_ = s.addEvent(ctx, userID, itemID, EventDiscarded, now, reason)
	return s.getItem(ctx, userID, itemID)
}

func (s *Store) Reheat(ctx context.Context, userID, itemID string) (Item, error) {
	item, err := s.getItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.Status != StatusActive {
		return Item{}, fmt.Errorf("%w: item is not active", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE leftover_items SET reheat_count = reheat_count + 1, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, now, itemID, userID); err != nil {
		return Item{}, fmt.Errorf("reheat leftover: %w", err)
	}
	_ = s.addEvent(ctx, userID, itemID, EventReheated, now, "")
	return s.getItem(ctx, userID, itemID)
}

func (s *Store) AddPhoto(ctx context.Context, userID, itemID, fileURL string) (Photo, error) {
	item, err := s.getItem(ctx, userID, itemID)
	if err != nil {
		return Photo{}, err
	}
	if item.PhotoCount >= MaxPhotos {
		return Photo{}, fmt.Errorf("%w: too many photos", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	photo := Photo{
		ID:        uuid.NewString(),
		ItemID:    itemID,
		UserID:    userID,
		FileURL:   fileURL,
		SortOrder: item.PhotoCount,
		CreatedAt: now,
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Photo{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO leftover_photos (id, item_id, user_id, file_url, sort_order, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, photo.ID, photo.ItemID, photo.UserID, photo.FileURL, photo.SortOrder, photo.CreatedAt); err != nil {
		return Photo{}, fmt.Errorf("add leftover photo: %w", err)
	}
	if item.CoverPhotoURL == "" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE leftover_items SET cover_photo_id = ?, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, photo.ID, now, itemID, userID); err != nil {
			return Photo{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Photo{}, err
	}
	return photo, nil
}

func (s *Store) DeletePhoto(ctx context.Context, userID, itemID, photoID string) error {
	item, err := s.getItem(ctx, userID, itemID)
	if err != nil {
		return err
	}
	photo, err := s.getPhoto(ctx, userID, photoID)
	if err != nil {
		return err
	}
	if photo.ItemID != itemID {
		return ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM leftover_photos WHERE id = ? AND item_id = ? AND user_id = ?
	`, photoID, itemID, userID); err != nil {
		return fmt.Errorf("delete leftover photo: %w", err)
	}
	if item.CoverPhotoURL != "" {
		cover := sql.NullString{}
		_ = tx.QueryRowContext(ctx, `
			SELECT file_url FROM leftover_photos
			WHERE item_id = ? AND user_id = ?
			ORDER BY sort_order ASC, created_at ASC LIMIT 1
		`, itemID, userID).Scan(&cover.String)
		if cover.Valid && cover.String != "" {
			if _, err := tx.ExecContext(ctx, `
				UPDATE leftover_items SET cover_photo_id = ? WHERE id = ? AND user_id = ?
			`, cover.String, itemID, userID); err != nil {
				return err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `
				UPDATE leftover_items SET cover_photo_id = NULL WHERE id = ? AND user_id = ?
			`, itemID, userID); err != nil {
				return err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ListPhotos(ctx context.Context, userID, itemID string) ([]Photo, error) {
	if _, err := s.getItem(ctx, userID, itemID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, file_url, sort_order, created_at
		FROM leftover_photos
		WHERE item_id = ? AND user_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, itemID, userID)
	if err != nil {
		return nil, fmt.Errorf("list leftover photos: %w", err)
	}
	defer rows.Close()
	photos := []Photo{}
	for rows.Next() {
		var photo Photo
		if err := rows.Scan(&photo.ID, &photo.ItemID, &photo.UserID, &photo.FileURL,
			&photo.SortOrder, &photo.CreatedAt); err != nil {
			return nil, err
		}
		photos = append(photos, photo)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return photos, nil
}

func (s *Store) GetPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	return s.getPhoto(ctx, userID, photoID)
}

func (s *Store) ListEvents(ctx context.Context, userID, itemID string) ([]Event, error) {
	if _, err := s.getItem(ctx, userID, itemID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, event_type, note, happened_at
		FROM leftover_events
		WHERE item_id = ? AND user_id = ?
		ORDER BY happened_at DESC, rowid DESC
		LIMIT ?
	`, itemID, userID, MaxEventsPerItem)
	if err != nil {
		return nil, fmt.Errorf("list leftover events: %w", err)
	}
	defer rows.Close()
	events := []Event{}
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.ItemID, &event.UserID, &event.EventType,
			&event.Note, &event.HappenedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	var settings Settings
	var daily, evening, notification int
	err := s.db.QueryRowContext(ctx, `
		SELECT user_id, remind_before_hours, daily09_enabled, evening19_enabled,
			notification_enabled, updated_at
		FROM leftover_settings WHERE user_id = ?
	`, userID).Scan(&settings.UserID, &settings.RemindBeforeHours,
		&daily, &evening, &notification, &settings.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{UserID: userID, RemindBeforeHours: 2}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("get leftover settings: %w", err)
	}
	settings.Daily09Enabled = daily == 1
	settings.Evening19Enabled = evening == 1
	settings.NotificationEnabled = notification == 1
	return settings, nil
}

func (s *Store) UpdateSettings(ctx context.Context, userID string, input SettingsInput) (Settings, error) {
	if input.RemindBeforeHours < 1 || input.RemindBeforeHours > 24 {
		return Settings{}, ErrInvalidInput
	}
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO leftover_settings
			(user_id, remind_before_hours, daily09_enabled, evening19_enabled, notification_enabled, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			remind_before_hours = excluded.remind_before_hours,
			daily09_enabled = excluded.daily09_enabled,
			evening19_enabled = excluded.evening19_enabled,
			notification_enabled = excluded.notification_enabled,
			updated_at = excluded.updated_at
	`, userID, input.RemindBeforeHours, boolInt(input.Daily09Enabled),
		boolInt(input.Evening19Enabled), boolInt(input.NotificationEnabled), now)
	if err != nil {
		return Settings{}, fmt.Errorf("update leftover settings: %w", err)
	}
	return s.GetSettings(ctx, userID)
}

func (s *Store) Export(ctx context.Context, userID string) (ExportSnapshot, error) {
	items, err := s.ListItems(ctx, userID)
	if err != nil {
		return ExportSnapshot{}, err
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return ExportSnapshot{}, err
	}
	events := []Event{}
	photos := []Photo{}
	for _, item := range items {
		itemEvents, err := s.ListEvents(ctx, userID, item.ID)
		if err != nil {
			return ExportSnapshot{}, err
		}
		events = append(events, itemEvents...)
		itemPhotos, err := s.ListPhotos(ctx, userID, item.ID)
		if err != nil {
			return ExportSnapshot{}, err
		}
		photos = append(photos, itemPhotos...)
	}
	return ExportSnapshot{
		ExportedAt: time.Now().UnixMilli(),
		Items:      items,
		Events:     events,
		Photos:     photos,
		Settings:   settings,
		Recipes:    RecipeLibrary,
	}, nil
}

func (s *Store) ClearData(ctx context.Context, userID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM leftover_items WHERE user_id = ?
	`, userID); err != nil {
		return fmt.Errorf("clear leftover items: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM leftover_settings WHERE user_id = ?
	`, userID); err != nil {
		return fmt.Errorf("clear leftover settings: %w", err)
	}
	return nil
}

func (s *Store) addEvent(ctx context.Context, userID, itemID, eventType string, happenedAt int64, note string) error {
	return s.insertEvent(ctx, Event{
		ID: uuid.NewString(), ItemID: itemID, UserID: userID,
		EventType: eventType, Note: note, HappenedAt: happenedAt,
	})
}

func (s *Store) insertEvent(ctx context.Context, event Event) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO leftover_events (id, item_id, user_id, event_type, note, happened_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, event.ID, event.ItemID, event.UserID, event.EventType, event.Note, event.HappenedAt)
	if err != nil {
		return fmt.Errorf("insert leftover event: %w", err)
	}
	return nil
}

func insertEvent(ctx context.Context, tx *sql.Tx, event Event) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO leftover_events (id, item_id, user_id, event_type, note, happened_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, event.ID, event.ItemID, event.UserID, event.EventType, event.Note, event.HappenedAt)
	if err != nil {
		return fmt.Errorf("insert leftover event: %w", err)
	}
	return nil
}

func insertItem(ctx context.Context, tx *sql.Tx, item Item) error {
	tagsJSON, err := json.Marshal(item.Tags)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO leftover_items
			(id, user_id, name, source_type, merchant, entered_fridge_at,
			 expected_consume_at, stored_zone, remaining_percent, remaining_text,
			 reheat_count, tags_json, cost_cents, notes, status, eaten_at,
			 discarded_at, discard_reason, cover_photo_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', NULL, ?, ?)
	`, item.ID, item.UserID, item.Name, item.SourceType, item.Merchant, item.EnteredFridgeAt,
		item.ExpectedConsumeAt, item.StoredZone, item.RemainingPercent, item.RemainingText,
		item.ReheatCount, string(tagsJSON), item.CostCents, item.Notes, item.Status,
		item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return fmt.Errorf("insert leftover item: %w", err)
	}
	return nil
}

func (s *Store) getItem(ctx context.Context, userID, itemID string) (Item, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, source_type, merchant, entered_fridge_at,
			expected_consume_at, stored_zone, remaining_percent, remaining_text,
			reheat_count, tags_json, cost_cents, notes, status, eaten_at,
			discarded_at, discard_reason, created_at, updated_at,
			(SELECT p.file_url FROM leftover_photos p
				WHERE p.id = leftover_items.cover_photo_id) AS cover_photo_url,
			(SELECT COUNT(*) FROM leftover_photos p
				WHERE p.item_id = leftover_items.id AND p.user_id = leftover_items.user_id) AS photo_count
		FROM leftover_items
		WHERE id = ? AND user_id = ?
	`, itemID, userID)
	return scanItem(row)
}

func (s *Store) getPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	var photo Photo
	err := s.db.QueryRowContext(ctx, `
		SELECT id, item_id, user_id, file_url, sort_order, created_at
		FROM leftover_photos WHERE id = ? AND user_id = ?
	`, photoID, userID).Scan(&photo.ID, &photo.ItemID, &photo.UserID,
		&photo.FileURL, &photo.SortOrder, &photo.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, fmt.Errorf("get leftover photo: %w", err)
	}
	return photo, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanItem(row rowScanner) (Item, error) {
	var item Item
	var tagsJSON string
	var coverPhotoURL sql.NullString
	var eatenAt, discardedAt sql.NullInt64
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.SourceType, &item.Merchant,
		&item.EnteredFridgeAt, &item.ExpectedConsumeAt, &item.StoredZone, &item.RemainingPercent,
		&item.RemainingText, &item.ReheatCount, &tagsJSON, &item.CostCents, &item.Notes,
		&item.Status, &eatenAt, &discardedAt, &item.DiscardReason,
		&item.CreatedAt, &item.UpdatedAt, &coverPhotoURL, &item.PhotoCount); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Item{}, ErrNotFound
		}
		return Item{}, err
	}
	if eatenAt.Valid {
		value := eatenAt.Int64
		item.EatenAt = &value
	}
	if discardedAt.Valid {
		value := discardedAt.Int64
		item.DiscardedAt = &value
	}
	if err := json.Unmarshal([]byte(tagsJSON), &item.Tags); err != nil {
		item.Tags = []string{}
	}
	if coverPhotoURL.Valid {
		item.CoverPhotoURL = coverPhotoURL.String
	}
	return item, nil
}

func buildSummary(items []Item, now int64) HomeSummary {
	summary := HomeSummary{}
	weekStart := now - 7*24*60*60*1000
	for _, item := range items {
		if item.Status == StatusActive {
			summary.ActiveCount++
			if item.ExpectedConsumeAt < now {
				summary.ExpiredCount++
			}
			if item.ExpectedConsumeAt <= now+24*60*60*1000 {
				summary.TodayCount++
			}
		}
		if item.Status == StatusEaten {
			if item.EatenAt != nil && *item.EatenAt >= weekStart {
				summary.ThisWeekEaten++
			}
			summary.AvoidWasteCents += item.CostCents
		}
		if item.Status == StatusDiscarded {
			if item.DiscardedAt != nil && *item.DiscardedAt >= weekStart {
				summary.ThisWeekDiscarded++
			}
			summary.WasteCents += item.CostCents
		}
	}
	return summary
}

func validateItemInput(input ItemInput) error {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > MaxNameLength {
		return fmt.Errorf("%w: invalid name", ErrInvalidInput)
	}
	if !supportedSourceTypes[input.SourceType] {
		return fmt.Errorf("%w: invalid source type", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(input.Merchant))) > MaxMerchantLength {
		return fmt.Errorf("%w: invalid merchant", ErrInvalidInput)
	}
	if input.EnteredFridgeAt <= 0 || input.ExpectedConsumeAt <= input.EnteredFridgeAt {
		return fmt.Errorf("%w: invalid time", ErrInvalidInput)
	}
	if !supportedZones[input.StoredZone] {
		return fmt.Errorf("%w: invalid zone", ErrInvalidInput)
	}
	if input.RemainingPercent < 1 || input.RemainingPercent > 100 {
		return fmt.Errorf("%w: invalid remaining", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(input.RemainingText))) > MaxRemainingTextLength {
		return fmt.Errorf("%w: invalid remaining text", ErrInvalidInput)
	}
	if input.ReheatCount < 0 || input.ReheatCount > 20 {
		return fmt.Errorf("%w: invalid reheat count", ErrInvalidInput)
	}
	if input.CostCents < 0 {
		return fmt.Errorf("%w: invalid cost", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(input.Notes))) > MaxNoteLength {
		return fmt.Errorf("%w: invalid notes", ErrInvalidInput)
	}
	tags := normalizeTags(input.Tags)
	if len(tags) > MaxTags {
		return fmt.Errorf("%w: too many tags", ErrInvalidInput)
	}
	return nil
}

func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if tag == "" || len([]rune(tag)) > MaxTagLength || seen[tag] {
			continue
		}
		seen[tag] = true
		result = append(result, tag)
	}
	return result
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
