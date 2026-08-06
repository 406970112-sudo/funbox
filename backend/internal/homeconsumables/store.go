package homeconsumables

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound          = errors.New("home consumables record not found")
	ErrInvalidInput      = errors.New("home consumables invalid input")
	ErrInsufficientStock = errors.New("home consumables insufficient stock")
	ErrDatabasePathEmpty = errors.New("home consumables database path is empty")
)

const (
	EventTypePurchase = "purchase"
	EventTypeReplace  = "replace"
	EventTypeConsume  = "consume"
	EventTypeCount    = "count"

	StatusActive   = "active"
	StatusArchived = "archived"

	SourceUser   = "user"
	SourceImport = "import"

	ChannelApp = "app"
	ChannelWeb = "web"
)

type Category struct {
	ID               string    `json:"id"`
	UserID           string    `json:"userId"`
	Name             string    `json:"name"`
	Icon             string    `json:"icon"`
	Color            string    `json:"color"`
	DefaultUnit      string    `json:"defaultUnit"`
	DefaultRemindDays int      `json:"defaultRemindDays"`
	IsSystem         bool      `json:"isSystem"`
	SortOrder        int       `json:"sortOrder"`
	ItemCount        int       `json:"itemCount"`
	Archived         bool      `json:"archived"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Item struct {
	ID                    string     `json:"id"`
	UserID                string     `json:"userId"`
	CategoryID            string     `json:"categoryId"`
	CategoryName          string     `json:"categoryName"`
	CategoryIcon          string     `json:"categoryIcon"`
	CategoryColor         string     `json:"categoryColor"`
	Name                  string     `json:"name"`
	Unit                  string     `json:"unit"`
	CurrentStock          *float64   `json:"currentStock,omitempty"`
	StockConfirmedAt      *time.Time `json:"stockConfirmedAt,omitempty"`
	CurrentCycleStartedAt *time.Time `json:"currentCycleStartedAt,omitempty"`
	RemindDays            int        `json:"remindDays"`
	Note                  string     `json:"note"`
	Status                string     `json:"status"`
	Source                string     `json:"source"`
	EventCount            int        `json:"eventCount"`
	Prediction            Prediction `json:"prediction"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

type Event struct {
	ID          string     `json:"id"`
	ItemID      string     `json:"itemId"`
	UserID      string     `json:"userId"`
	ItemName    string     `json:"itemName,omitempty"`
	EventType   string     `json:"eventType"`
	Quantity    float64    `json:"quantity"`
	StockBefore *float64   `json:"stockBefore,omitempty"`
	StockAfter  *float64   `json:"stockAfter,omitempty"`
	OccurredAt  time.Time  `json:"occurredAt"`
	Source      string     `json:"source"`
	Note        string     `json:"note"`
	EvidenceURL string     `json:"evidenceUrl,omitempty"`
	UndoneAt    *time.Time `json:"undoneAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type Reminder struct {
	ID            string    `json:"id"`
	ItemID        string    `json:"itemId"`
	ItemName      string    `json:"itemName"`
	RemainingDays int       `json:"remainingDays"`
	RemindAt      string    `json:"remindAt"`
	Channel       string    `json:"channel"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
}

type Summary struct {
	Date         string `json:"date"`
	NeedRestock  int    `json:"needRestock"`
	Within7      int    `json:"within7"`
	Within30     int    `json:"within30"`
	UnknownStock int    `json:"unknownStock"`
	NoData       int    `json:"noData"`
	TotalItems   int    `json:"totalItems"`
	Items        []Item `json:"items"`
}

type ShoppingList struct {
	Date  string `json:"date"`
	Items []Item `json:"items"`
}

type ItemStat struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Unit              string   `json:"unit"`
	CurrentStock      *float64 `json:"currentStock,omitempty"`
	RemainingDays     *int     `json:"remainingDays,omitempty"`
	AvgCycleDays      *float64 `json:"avgCycleDays,omitempty"`
	SampleCount       int      `json:"sampleCount"`
	Recent30Consumed  float64  `json:"recent30Consumed"`
	Recent30Purchases float64  `json:"recent30Purchases"`
}

type StatsSnapshot struct {
	Range              string     `json:"range"`
	TotalItems         int        `json:"totalItems"`
	NeedRestock        int        `json:"needRestock"`
	Recent30Consumed   float64    `json:"recent30Consumed"`
	Recent30Purchases  float64    `json:"recent30Purchases"`
	AvgCycleDays       *float64   `json:"avgCycleDays,omitempty"`
	PredictionAccuracy *string    `json:"predictionAccuracy,omitempty"`
	Items              []ItemStat `json:"items"`
}

type ItemFilter struct {
	CategoryID string
	State      string
	Query      string
	Sort       string
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
			return nil, fmt.Errorf("create home consumables database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open home consumables database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS home_consumables_categories (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			icon TEXT NOT NULL DEFAULT 'package',
			color TEXT NOT NULL DEFAULT '#4b6bff',
			default_unit TEXT NOT NULL DEFAULT '件',
			default_remind_days INTEGER NOT NULL DEFAULT 7,
			is_system INTEGER NOT NULL DEFAULT 0,
			sort_order INTEGER NOT NULL DEFAULT 0,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_consumables_categories_user
			ON home_consumables_categories(user_id, sort_order, id)`,
		`CREATE TABLE IF NOT EXISTS home_consumables_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			category_id TEXT NOT NULL REFERENCES home_consumables_categories(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
			unit TEXT NOT NULL CHECK(length(unit) BETWEEN 1 AND 20),
			current_stock REAL,
			stock_confirmed_at INTEGER,
			current_cycle_started_at INTEGER,
			remind_days INTEGER NOT NULL DEFAULT 7,
			note TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
			source TEXT NOT NULL DEFAULT 'user',
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_consumables_items_user
			ON home_consumables_items(user_id, status, updated_at)`,
		`CREATE TABLE IF NOT EXISTS home_consumables_events (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES home_consumables_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			event_type TEXT NOT NULL CHECK(event_type IN ('purchase', 'replace', 'consume', 'count')),
			quantity REAL NOT NULL,
			stock_before REAL,
			stock_after REAL,
			occurred_at INTEGER NOT NULL,
			source TEXT NOT NULL DEFAULT 'user',
			note TEXT NOT NULL DEFAULT '',
			evidence_url TEXT NOT NULL DEFAULT '',
			undone_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_consumables_events_item
			ON home_consumables_events(item_id, occurred_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_home_consumables_events_user
			ON home_consumables_events(user_id, occurred_at DESC)`,
		`CREATE TABLE IF NOT EXISTS home_consumables_reminder_dismissals (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			remind_at TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(user_id, item_id, remind_at)
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate home consumables: %w", err)
		}
	}
	return nil
}

func (s *Store) EnsureDefaultCategories(ctx context.Context, userID string) ([]Category, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM home_consumables_categories WHERE user_id = ? AND is_system = 1
	`, userID).Scan(&count); err != nil {
		return nil, fmt.Errorf("count home consumables categories: %w", err)
	}
	if count == 0 {
		now := time.Now().UTC()
		templates := []Category{
			{Name: "抽纸", Icon: "box", Color: "#4b6bff", DefaultUnit: "包", DefaultRemindDays: 3},
			{Name: "洗衣液", Icon: "bottle-tonic-outline", Color: "#4b6bff", DefaultUnit: "瓶", DefaultRemindDays: 7},
			{Name: "洗发水", Icon: "shampoo", Color: "#f1a33b", DefaultUnit: "瓶", DefaultRemindDays: 7},
			{Name: "垃圾袋", Icon: "recycle", Color: "#1db991", DefaultUnit: "卷", DefaultRemindDays: 5},
			{Name: "猫粮", Icon: "cat", Color: "#f1a33b", DefaultUnit: "kg", DefaultRemindDays: 7},
			{Name: "狗粮", Icon: "dog", Color: "#f1a33b", DefaultUnit: "kg", DefaultRemindDays: 7},
			{Name: "矿泉水", Icon: "water", Color: "#4b6bff", DefaultUnit: "箱", DefaultRemindDays: 3},
			{Name: "隐形眼镜", Icon: "eye-outline", Color: "#7e5bef", DefaultUnit: "盒", DefaultRemindDays: 7},
			{Name: "净水器滤芯", Icon: "water-filter", Color: "#1db991", DefaultUnit: "支", DefaultRemindDays: 14},
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		for index, category := range templates {
			category.ID = uuid.NewString()
			category.UserID = userID
			category.IsSystem = true
			category.SortOrder = index
			category.CreatedAt = now
			category.UpdatedAt = now
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO home_consumables_categories
					(id, user_id, name, icon, color, default_unit, default_remind_days,
					 is_system, sort_order, archived_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
			`, category.ID, category.UserID, category.Name, category.Icon, category.Color,
				category.DefaultUnit, category.DefaultRemindDays, category.SortOrder,
				category.CreatedAt.Unix(), category.UpdatedAt.Unix()); err != nil {
				return nil, err
			}
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
	}
	return s.ListCategories(ctx, userID)
}

func (s *Store) ListCategories(ctx context.Context, userID string) ([]Category, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.user_id, c.name, c.icon, c.color, c.default_unit,
			c.default_remind_days, c.is_system, c.sort_order, c.archived_at,
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM home_consumables_items i
				WHERE i.category_id = c.id AND i.archived_at IS NULL) AS item_count
		FROM home_consumables_categories c
		WHERE c.user_id = ? AND c.archived_at IS NULL
		ORDER BY c.sort_order ASC, c.created_at ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list home consumables categories: %w", err)
	}
	defer rows.Close()

	items := []Category{}
	for rows.Next() {
		var item Category
		var archivedAt sql.NullInt64
		var isSystem int
		var createdAt, updatedAt int64
		if err := rows.Scan(&item.ID, &item.UserID, &item.Name, &item.Icon, &item.Color,
			&item.DefaultUnit, &item.DefaultRemindDays, &isSystem, &item.SortOrder,
			&archivedAt, &createdAt, &updatedAt, &item.ItemCount); err != nil {
			return nil, err
		}
		item.Archived = archivedAt.Valid
		item.IsSystem = isSystem == 1
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) CreateCategory(ctx context.Context, userID string, input CategoryInput) (Category, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 40 {
		return Category{}, ErrInvalidInput
	}
	if input.Icon == "" {
		input.Icon = "package"
	}
	if input.Color == "" {
		input.Color = "#4b6bff"
	}
	if input.DefaultUnit == "" {
		input.DefaultUnit = "件"
	}
	if input.DefaultRemindDays <= 0 {
		input.DefaultRemindDays = 7
	}
	now := time.Now().UTC()
	category := Category{
		ID:                uuid.NewString(),
		UserID:            userID,
		Name:              input.Name,
		Icon:              input.Icon,
		Color:             input.Color,
		DefaultUnit:       input.DefaultUnit,
		DefaultRemindDays: input.DefaultRemindDays,
		SortOrder:         input.SortOrder,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO home_consumables_categories
			(id, user_id, name, icon, color, default_unit, default_remind_days,
			 is_system, sort_order, archived_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)
	`, category.ID, category.UserID, category.Name, category.Icon, category.Color,
		category.DefaultUnit, category.DefaultRemindDays, category.SortOrder,
		category.CreatedAt.Unix(), category.UpdatedAt.Unix()); err != nil {
		return Category{}, err
	}
	return category, nil
}

func (s *Store) UpdateCategory(ctx context.Context, userID string, categoryID string, input CategoryInput) (Category, error) {
	category, err := s.getCategory(ctx, userID, categoryID)
	if err != nil {
		return Category{}, err
	}
	if input.Name != "" {
		input.Name = strings.TrimSpace(input.Name)
		if input.Name == "" || len([]rune(input.Name)) > 40 {
			return Category{}, ErrInvalidInput
		}
		category.Name = input.Name
	}
	if input.Icon != "" {
		category.Icon = input.Icon
	}
	if input.Color != "" {
		category.Color = input.Color
	}
	if input.DefaultUnit != "" {
		category.DefaultUnit = input.DefaultUnit
	}
	if input.DefaultRemindDays > 0 {
		category.DefaultRemindDays = input.DefaultRemindDays
	}
	if input.Archived != nil {
		category.Archived = *input.Archived
	}
	category.UpdatedAt = time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		UPDATE home_consumables_categories
		SET name = ?, icon = ?, color = ?, default_unit = ?,
			default_remind_days = ?, sort_order = ?, archived_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, category.Name, category.Icon, category.Color, category.DefaultUnit,
		category.DefaultRemindDays, category.SortOrder, nullInt64If(category.Archived, category.UpdatedAt.Unix()),
		category.UpdatedAt.Unix(), categoryID, userID)
	if err != nil {
		return Category{}, err
	}
	return s.getCategory(ctx, userID, categoryID)
}

func (s *Store) DeleteCategory(ctx context.Context, userID string, categoryID string) error {
	category, err := s.getCategory(ctx, userID, categoryID)
	if err != nil {
		return err
	}
	if category.IsSystem {
		return ErrInvalidInput
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		UPDATE home_consumables_categories
		SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?
	`, now.Unix(), now.Unix(), categoryID, userID)
	return err
}

func (s *Store) getCategory(ctx context.Context, userID string, categoryID string) (Category, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT c.id, c.user_id, c.name, c.icon, c.color, c.default_unit,
			c.default_remind_days, c.is_system, c.sort_order, c.archived_at,
			c.created_at, c.updated_at
		FROM home_consumables_categories c
		WHERE c.id = ? AND c.user_id = ? AND c.archived_at IS NULL
	`, categoryID, userID)
	var item Category
	var archivedAt sql.NullInt64
	var isSystem int
	var createdAt, updatedAt int64
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.Icon, &item.Color,
		&item.DefaultUnit, &item.DefaultRemindDays, &isSystem, &item.SortOrder,
		&archivedAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		return Category{}, err
	}
	item.Archived = archivedAt.Valid
	item.IsSystem = isSystem == 1
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}
