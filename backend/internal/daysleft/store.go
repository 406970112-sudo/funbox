package daysleft

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
	ErrNotFound          = errors.New("days left record not found")
	ErrInvalidInput      = errors.New("days left invalid input")
	ErrDatabasePathEmpty = errors.New("days left database path is empty")
)

const (
	RecordTypeFixed     = "fixed"
	RecordTypeOpened    = "opened"
	RecordTypeRecurring = "recurring"
	RecordTypeEvent     = "event"

	StatusActive    = "active"
	StatusCompleted = "completed"
	StatusArchived  = "archived"

	SourceUser    = "user"
	SourcePhoto   = "photo"
	SourceScanner = "scanner"
	SourceAPI     = "api"
	SourceImport  = "import"

	CycleDay   = "day"
	CycleWeek  = "week"
	CycleMonth = "month"
	CycleYear  = "year"
)

type Category struct {
	ID                string    `json:"id"`
	UserID            string    `json:"userId"`
	Name              string    `json:"name"`
	Icon              string    `json:"icon"`
	Color             string    `json:"color"`
	ReminderLeadDays  int       `json:"reminderLeadDays"`
	DefaultRecordType string    `json:"defaultRecordType"`
	IsSystem          bool      `json:"isSystem"`
	SortOrder         int       `json:"sortOrder"`
	RecordCount       int       `json:"recordCount"`
	Archived          bool      `json:"archived"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type Record struct {
	ID               string     `json:"id"`
	UserID           string     `json:"userId"`
	CategoryID       string     `json:"categoryId"`
	CategoryName     string     `json:"categoryName"`
	CategoryIcon     string     `json:"categoryIcon"`
	CategoryColor    string     `json:"categoryColor"`
	Name             string     `json:"name"`
	RecordType       string     `json:"recordType"`
	StartDate        string     `json:"startDate"`
	ExpiryDate       string     `json:"expiryDate"`
	ValidityValue    int        `json:"validityValue"`
	ValidityUnit     string     `json:"validityUnit"`
	CycleUnit        string     `json:"cycleUnit"`
	CycleInterval    int        `json:"cycleInterval"`
	ReminderLeadDays int        `json:"reminderLeadDays"`
	RemindAt         string     `json:"remindAt"`
	Note             string     `json:"note"`
	Status           string     `json:"status"`
	RiskLevel        string     `json:"riskLevel"`
	Source           string     `json:"source"`
	EvidenceCount    int        `json:"evidenceCount"`
	Verified         bool       `json:"verified"`
	VerifiedAt       *time.Time `json:"verifiedAt,omitempty"`
	LastRenewedAt    *time.Time `json:"lastRenewedAt,omitempty"`
	DaysLeft         int        `json:"daysLeft"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type Event struct {
	ID                 string    `json:"id"`
	RecordID           string    `json:"recordId"`
	UserID             string    `json:"userId"`
	Action             string    `json:"action"`
	PreviousExpiryDate string    `json:"previousExpiryDate"`
	NewExpiryDate      string    `json:"newExpiryDate"`
	Note               string    `json:"note"`
	EvidenceURL        string    `json:"evidenceUrl"`
	CreatedAt          time.Time `json:"createdAt"`
}

type Evidence struct {
	ID        string    `json:"id"`
	RecordID  string    `json:"recordId"`
	UserID    string    `json:"userId"`
	FileURL   string    `json:"fileUrl"`
	Kind      string    `json:"kind"`
	CreatedAt time.Time `json:"createdAt"`
}

type Reminder struct {
	ID        string    `json:"id"`
	RecordID  string    `json:"recordId"`
	UserID    string    `json:"userId"`
	RemindAt  string    `json:"remindAt"`
	Channel   string    `json:"channel"`
	Status    string    `json:"status"`
	SentAt    *time.Time `json:"sentAt,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	RecordName string   `json:"recordName"`
	DaysLeft  int       `json:"daysLeft"`
}

type Summary struct {
	Date     string   `json:"date"`
	Overdue  int      `json:"overdue"`
	DueToday int      `json:"dueToday"`
	Next7    int      `json:"next7"`
	Next30   int      `json:"next30"`
	Next90   int      `json:"next90"`
	Today    []Record `json:"today"`
	Soon     []Record `json:"soon"`
}

type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type CalendarSnapshot struct {
	Month string     `json:"month"`
	Days  []DayCount `json:"days"`
}

type CategoryCount struct {
	CategoryID string `json:"categoryId"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Icon       string `json:"icon"`
	Count      int    `json:"count"`
}

type StatsSnapshot struct {
	Range       string          `json:"range"`
	Next30      int             `json:"next30"`
	Next90      int             `json:"next90"`
	Overdue     int             `json:"overdue"`
	Completed   int             `json:"completed"`
	Total       int             `json:"total"`
	Rate        float64         `json:"rate"`
	ByCategory  []CategoryCount `json:"byCategory"`
}

type RecordFilter struct {
	CategoryID string
	Status     string
	Query      string
	Sort       string
	Today      string
	Limit      int
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
			return nil, fmt.Errorf("create days left database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open days left database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS days_left_categories (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			icon TEXT NOT NULL DEFAULT 'calendar-clock',
			color TEXT NOT NULL DEFAULT '#4b6bff',
			reminder_lead_days INTEGER NOT NULL DEFAULT 30,
			default_record_type TEXT NOT NULL DEFAULT 'fixed',
			is_system INTEGER NOT NULL DEFAULT 0,
			sort_order INTEGER NOT NULL DEFAULT 0,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_days_left_categories_user
			ON days_left_categories(user_id, sort_order, id)`,
		`CREATE TABLE IF NOT EXISTS days_left_records (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			category_id TEXT NOT NULL REFERENCES days_left_categories(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
			record_type TEXT NOT NULL DEFAULT 'fixed'
				CHECK(record_type IN ('fixed', 'opened', 'recurring', 'event')),
			start_date TEXT,
			expiry_date TEXT NOT NULL,
			validity_value INTEGER NOT NULL DEFAULT 0,
			validity_unit TEXT NOT NULL DEFAULT 'day',
			cycle_unit TEXT NOT NULL DEFAULT 'year',
			cycle_interval INTEGER NOT NULL DEFAULT 1,
			reminder_lead_days INTEGER NOT NULL DEFAULT 30,
			note TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active'
				CHECK(status IN ('active', 'completed', 'archived')),
			risk_level TEXT NOT NULL DEFAULT 'safe',
			source TEXT NOT NULL DEFAULT 'user',
			evidence_count INTEGER NOT NULL DEFAULT 0,
			verified INTEGER NOT NULL DEFAULT 0,
			verified_at INTEGER,
			last_renewed_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_days_left_records_user_due
			ON days_left_records(user_id, status, expiry_date, updated_at)`,
		`CREATE INDEX IF NOT EXISTS idx_days_left_records_category
			ON days_left_records(category_id)`,
		`CREATE TABLE IF NOT EXISTS days_left_events (
			id TEXT PRIMARY KEY,
			record_id TEXT NOT NULL REFERENCES days_left_records(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			previous_expiry_date TEXT,
			new_expiry_date TEXT,
			note TEXT NOT NULL DEFAULT '',
			evidence_url TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_days_left_events_record
			ON days_left_events(record_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS days_left_evidence (
			id TEXT PRIMARY KEY,
			record_id TEXT NOT NULL REFERENCES days_left_records(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			file_url TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'photo',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_days_left_evidence_record
			ON days_left_evidence(record_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS days_left_reminder_dismissals (
			id TEXT PRIMARY KEY,
			record_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			remind_at TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(user_id, record_id, remind_at)
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate days left: %w", err)
		}
	}
	return nil
}

func (s *Store) EnsureDefaultCategories(ctx context.Context, userID string) ([]Category, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM days_left_categories WHERE user_id = ? AND is_system = 1
	`, userID).Scan(&count); err != nil {
		return nil, fmt.Errorf("count days left categories: %w", err)
	}
	if count == 0 {
		now := time.Now().UTC()
		templates := []Category{
			{Name: "证件", Icon: "id-card", Color: "#4b6bff", ReminderLeadDays: 90, DefaultRecordType: RecordTypeFixed},
			{Name: "财务合同", Icon: "credit-card", Color: "#f1a33b", ReminderLeadDays: 30, DefaultRecordType: RecordTypeRecurring},
			{Name: "生活物品", Icon: "package", Color: "#1db991", ReminderLeadDays: 7, DefaultRecordType: RecordTypeOpened},
			{Name: "数字资产", Icon: "server", Color: "#7e5bef", ReminderLeadDays: 30, DefaultRecordType: RecordTypeRecurring},
			{Name: "车辆", Icon: "car", Color: "#18a78f", ReminderLeadDays: 30, DefaultRecordType: RecordTypeFixed},
			{Name: "纪念日", Icon: "cake", Color: "#ff6b8f", ReminderLeadDays: 3, DefaultRecordType: RecordTypeEvent},
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		for i, category := range templates {
			category.ID = uuid.NewString()
			category.UserID = userID
			category.IsSystem = true
			category.SortOrder = i
			category.CreatedAt = now
			category.UpdatedAt = now
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO days_left_categories
					(id, user_id, name, icon, color, reminder_lead_days, default_record_type,
					 is_system, sort_order, archived_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
			`, category.ID, category.UserID, category.Name, category.Icon, category.Color,
				category.ReminderLeadDays, category.DefaultRecordType, category.SortOrder,
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
		SELECT c.id, c.user_id, c.name, c.icon, c.color, c.reminder_lead_days,
			c.default_record_type, c.is_system, c.sort_order, c.archived_at,
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM days_left_records r
				WHERE r.category_id = c.id AND r.status != 'archived') AS record_count
		FROM days_left_categories c
		WHERE c.user_id = ? AND c.archived_at IS NULL
		ORDER BY c.sort_order ASC, c.created_at ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list days left categories: %w", err)
	}
	defer rows.Close()

	items := []Category{}
	for rows.Next() {
		var item Category
		var archivedAt sql.NullInt64
		var isSystem int
		var createdAt, updatedAt int64
		if err := rows.Scan(&item.ID, &item.UserID, &item.Name, &item.Icon, &item.Color,
			&item.ReminderLeadDays, &item.DefaultRecordType, &isSystem, &item.SortOrder,
			&archivedAt, &createdAt, &updatedAt, &item.RecordCount); err != nil {
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
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 40 {
		return Category{}, ErrInvalidInput
	}
	if !validRecordType(input.DefaultRecordType) {
		if input.DefaultRecordType == "" {
			input.DefaultRecordType = RecordTypeFixed
		} else {
			return Category{}, ErrInvalidInput
		}
	}
	if input.ReminderLeadDays < 0 || input.ReminderLeadDays > 365 {
		return Category{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	item := Category{
		ID:                uuid.NewString(),
		UserID:            userID,
		Name:              name,
		Icon:              strings.TrimSpace(input.Icon),
		Color:             strings.TrimSpace(input.Color),
		ReminderLeadDays:  input.ReminderLeadDays,
		DefaultRecordType: input.DefaultRecordType,
		SortOrder:         input.SortOrder,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if item.Icon == "" {
		item.Icon = "calendar-clock"
	}
	if item.Color == "" {
		item.Color = "#4b6bff"
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO days_left_categories
			(id, user_id, name, icon, color, reminder_lead_days, default_record_type,
			 is_system, sort_order, archived_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)
	`, item.ID, item.UserID, item.Name, item.Icon, item.Color, item.ReminderLeadDays,
		item.DefaultRecordType, item.SortOrder, item.CreatedAt.Unix(), item.UpdatedAt.Unix()); err != nil {
		return Category{}, err
	}
	return item, nil
}

func (s *Store) UpdateCategory(ctx context.Context, userID, categoryID string, input CategoryInput) (Category, error) {
	current, err := s.getCategory(ctx, userID, categoryID)
	if err != nil {
		return Category{}, err
	}
	if strings.TrimSpace(input.Name) != "" {
		name := strings.TrimSpace(input.Name)
		if len([]rune(name)) > 40 {
			return Category{}, ErrInvalidInput
		}
		current.Name = name
	}
	if strings.TrimSpace(input.Icon) != "" {
		current.Icon = strings.TrimSpace(input.Icon)
	}
	if strings.TrimSpace(input.Color) != "" {
		current.Color = strings.TrimSpace(input.Color)
	}
	if input.ReminderLeadDays > 0 {
		if input.ReminderLeadDays > 365 {
			return Category{}, ErrInvalidInput
		}
		current.ReminderLeadDays = input.ReminderLeadDays
	}
	if input.DefaultRecordType != "" {
		if !validRecordType(input.DefaultRecordType) {
			return Category{}, ErrInvalidInput
		}
		current.DefaultRecordType = input.DefaultRecordType
	}
	if input.Archived != nil {
		current.Archived = *input.Archived
	}
	current.UpdatedAt = time.Now().UTC()
	archivedAt := sql.NullInt64{}
	if current.Archived {
		archivedAt = sql.NullInt64{Int64: current.UpdatedAt.Unix(), Valid: true}
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE days_left_categories
		SET name = ?, icon = ?, color = ?, reminder_lead_days = ?, default_record_type = ?,
			archived_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, current.Name, current.Icon, current.Color, current.ReminderLeadDays,
		current.DefaultRecordType, archivedAt, current.UpdatedAt.Unix(), categoryID, userID); err != nil {
		return Category{}, err
	}
	return current, nil
}

func (s *Store) DeleteCategory(ctx context.Context, userID, categoryID string) error {
	current, err := s.getCategory(ctx, userID, categoryID)
	if err != nil {
		return err
	}
	if current.IsSystem {
		return ErrInvalidInput
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM days_left_categories WHERE id = ? AND user_id = ?
	`, categoryID, userID); err != nil {
		return err
	}
	return nil
}

func (s *Store) getCategory(ctx context.Context, userID, categoryID string) (Category, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, icon, color, reminder_lead_days, default_record_type,
			is_system, sort_order, archived_at, created_at, updated_at
		FROM days_left_categories WHERE id = ? AND user_id = ?
	`, categoryID, userID)
	var item Category
	var archivedAt sql.NullInt64
	var createdAt, updatedAt int64
	var isSystem int
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.Icon, &item.Color,
		&item.ReminderLeadDays, &item.DefaultRecordType, &isSystem, &item.SortOrder,
		&archivedAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Category{}, ErrNotFound
		}
		return Category{}, err
	}
	item.IsSystem = isSystem == 1
	item.Archived = archivedAt.Valid
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func (s *Store) ListRecords(ctx context.Context, userID string, filter RecordFilter) ([]Record, error) {
	query := `
		SELECT r.id, r.user_id, r.category_id, r.name, r.record_type, r.start_date,
			r.expiry_date, r.validity_value, r.validity_unit, r.cycle_unit,
			r.cycle_interval, r.reminder_lead_days, r.note, r.status, r.risk_level,
			r.source, r.evidence_count, r.verified, r.verified_at, r.last_renewed_at,
			r.created_at, r.updated_at,
			c.name, c.icon, c.color
		FROM days_left_records r
		JOIN days_left_categories c ON c.id = r.category_id
		WHERE r.user_id = ?`
	args := []any{userID}
	clauses := []string{"r.status != 'archived'"}
	if filter.CategoryID != "" {
		clauses = append(clauses, "r.category_id = ?")
		args = append(args, filter.CategoryID)
	}
	if filter.Status == StatusActive {
		clauses = append(clauses, "r.status = 'active'")
	} else if filter.Status == StatusCompleted {
		clauses = append(clauses, "r.status = 'completed'")
	}
	if strings.TrimSpace(filter.Query) != "" {
		clauses = append(clauses, "(r.name LIKE ? ESCAPE '\\' OR r.note LIKE ? ESCAPE '\\' OR r.source LIKE ? ESCAPE '\\')")
		escaped := "%" + escapeLike(strings.TrimSpace(filter.Query)) + "%"
		args = append(args, escaped, escaped, escaped)
	}
	if len(clauses) > 0 {
		query += " AND " + strings.Join(clauses, " AND ")
	}
	switch filter.Sort {
	case "days", "remaining":
		query += " ORDER BY r.expiry_date ASC, r.updated_at DESC"
	case "risk":
		query += " ORDER BY CASE r.risk_level WHEN 'overdue' THEN 0 WHEN '7' THEN 1 WHEN '30' THEN 2 WHEN '90' THEN 3 ELSE 4 END, r.expiry_date ASC"
	case "recent":
		query += " ORDER BY r.updated_at DESC"
	default:
		query += " ORDER BY r.expiry_date ASC, r.updated_at DESC"
	}
	if filter.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list days left records: %w", err)
	}
	defer rows.Close()

	today := filter.Today
	if today == "" {
		today = time.Now().Format("2006-01-02")
	}
	items := []Record{}
	for rows.Next() {
		item, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		decorateRecord(&item, today)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) GetRecord(ctx context.Context, userID, recordID string) (Record, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT r.id, r.user_id, r.category_id, r.name, r.record_type, r.start_date,
			r.expiry_date, r.validity_value, r.validity_unit, r.cycle_unit,
			r.cycle_interval, r.reminder_lead_days, r.note, r.status, r.risk_level,
			r.source, r.evidence_count, r.verified, r.verified_at, r.last_renewed_at,
			r.created_at, r.updated_at,
			c.name, c.icon, c.color
		FROM days_left_records r
		JOIN days_left_categories c ON c.id = r.category_id
		WHERE r.id = ? AND r.user_id = ?
	`, recordID, userID)
	item, err := scanRecord(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, ErrNotFound
		}
		return Record{}, err
	}
	decorateRecord(&item, time.Now().Format("2006-01-02"))
	return item, nil
}

func (s *Store) CreateRecord(ctx context.Context, userID string, input RecordInput) (Record, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 60 {
		return Record{}, ErrInvalidInput
	}
	if !validRecordType(input.RecordType) {
		return Record{}, ErrInvalidInput
	}
	category, err := s.getCategory(ctx, userID, strings.TrimSpace(input.CategoryID))
	if err != nil {
		return Record{}, err
	}
	if input.ReminderLeadDays < 0 || input.ReminderLeadDays > 365 {
		input.ReminderLeadDays = category.ReminderLeadDays
	}
	startDate := stringValue(input.StartDate)
	expiryDate := strings.TrimSpace(stringValue(input.ExpiryDate))
	if input.RecordType == RecordTypeOpened {
		if startDate == "" || input.ValidityValue <= 0 {
			return Record{}, ErrInvalidInput
		}
		if !validDate(startDate) {
			return Record{}, ErrInvalidInput
		}
		expiryDate = addDuration(startDate, input.ValidityValue, input.ValidityUnit)
	} else {
		if expiryDate == "" {
			return Record{}, ErrInvalidInput
		}
		if !validDate(expiryDate) {
			return Record{}, ErrInvalidInput
		}
		if input.RecordType == RecordTypeRecurring {
			if !validCycleUnit(input.CycleUnit) {
				input.CycleUnit = CycleYear
			}
			if input.CycleInterval <= 0 {
				input.CycleInterval = 1
			}
		}
	}
	if startDate != "" && !validDate(startDate) {
		return Record{}, ErrInvalidInput
	}
	source := strings.TrimSpace(input.Source)
	if !validSource(source) {
		source = SourceUser
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = StatusActive
	}
	if status != StatusActive && status != StatusCompleted && status != StatusArchived {
		return Record{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	item := Record{
		ID:               uuid.NewString(),
		UserID:           userID,
		CategoryID:       category.ID,
		CategoryName:     category.Name,
		CategoryIcon:     category.Icon,
		CategoryColor:    category.Color,
		Name:             name,
		RecordType:       input.RecordType,
		StartDate:        startDate,
		ExpiryDate:       expiryDate,
		ValidityValue:    input.ValidityValue,
		ValidityUnit:     strings.TrimSpace(input.ValidityUnit),
		CycleUnit:        strings.TrimSpace(input.CycleUnit),
		CycleInterval:    input.CycleInterval,
		ReminderLeadDays: input.ReminderLeadDays,
		Note:             strings.TrimSpace(input.Note),
		Status:           status,
		RiskLevel:        computeRisk(expiryDate, time.Now().Format("2006-01-02")),
		Source:           source,
		Verified:         input.Verified != nil && *input.Verified,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if input.VerifiedAt != nil && *input.VerifiedAt != "" {
		if verifiedAt, err := parseTime(*input.VerifiedAt); err == nil {
			item.VerifiedAt = &verifiedAt
		}
	}
	if item.ValidityUnit == "" {
		item.ValidityUnit = "day"
	}
	if item.CycleUnit == "" {
		item.CycleUnit = CycleYear
	}
	if item.CycleInterval == 0 {
		item.CycleInterval = 1
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO days_left_records
			(id, user_id, category_id, name, record_type, start_date, expiry_date,
			 validity_value, validity_unit, cycle_unit, cycle_interval, reminder_lead_days,
			 note, status, risk_level, source, evidence_count, verified, verified_at,
			 last_renewed_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
	`, item.ID, item.UserID, item.CategoryID, item.Name, item.RecordType,
		nullString(item.StartDate), item.ExpiryDate, item.ValidityValue, item.ValidityUnit,
		item.CycleUnit, item.CycleInterval, item.ReminderLeadDays, item.Note, item.Status,
		item.RiskLevel, item.Source, boolInt(item.Verified), nullTime(item.VerifiedAt),
		nullTime(item.LastRenewedAt), item.CreatedAt.Unix(), item.UpdatedAt.Unix()); err != nil {
		return Record{}, err
	}
	decorateRecord(&item, time.Now().Format("2006-01-02"))
	return item, nil
}

func (s *Store) UpdateRecord(ctx context.Context, userID, recordID string, input RecordInput) (Record, error) {
	current, err := s.GetRecord(ctx, userID, recordID)
	if err != nil {
		return Record{}, err
	}
	if strings.TrimSpace(input.Name) != "" {
		name := strings.TrimSpace(input.Name)
		if len([]rune(name)) > 60 {
			return Record{}, ErrInvalidInput
		}
		current.Name = name
	}
	if input.CategoryID != "" && input.CategoryID != current.CategoryID {
		category, err := s.getCategory(ctx, userID, input.CategoryID)
		if err != nil {
			return Record{}, err
		}
		current.CategoryID = category.ID
		current.CategoryName = category.Name
		current.CategoryIcon = category.Icon
		current.CategoryColor = category.Color
	}
	if input.RecordType != "" && input.RecordType != current.RecordType {
		if !validRecordType(input.RecordType) {
			return Record{}, ErrInvalidInput
		}
		current.RecordType = input.RecordType
	}
	if input.StartDate != nil {
		start := strings.TrimSpace(*input.StartDate)
		if start != "" && !validDate(start) {
			return Record{}, ErrInvalidInput
		}
		current.StartDate = start
	}
	if input.ExpiryDate != nil {
		expiry := strings.TrimSpace(*input.ExpiryDate)
		if expiry != "" {
			if !validDate(expiry) {
				return Record{}, ErrInvalidInput
			}
			current.ExpiryDate = expiry
		}
	}
	if input.ValidityValue > 0 {
		current.ValidityValue = input.ValidityValue
	}
	if strings.TrimSpace(input.ValidityUnit) != "" {
		current.ValidityUnit = strings.TrimSpace(input.ValidityUnit)
	}
	if strings.TrimSpace(input.CycleUnit) != "" {
		if !validCycleUnit(input.CycleUnit) {
			return Record{}, ErrInvalidInput
		}
		current.CycleUnit = input.CycleUnit
	}
	if input.CycleInterval > 0 {
		current.CycleInterval = input.CycleInterval
	}
	if input.ReminderLeadDays > 0 {
		if input.ReminderLeadDays > 365 {
			return Record{}, ErrInvalidInput
		}
		current.ReminderLeadDays = input.ReminderLeadDays
	}
	if input.Note != "" {
		if len([]rune(strings.TrimSpace(input.Note))) > 500 {
			return Record{}, ErrInvalidInput
		}
		current.Note = strings.TrimSpace(input.Note)
	}
	if input.Status != "" && input.Status != current.Status {
		if input.Status != StatusActive && input.Status != StatusCompleted && input.Status != StatusArchived {
			return Record{}, ErrInvalidInput
		}
		current.Status = input.Status
	}
	if input.Source != "" && input.Source != current.Source {
		if !validSource(input.Source) {
			return Record{}, ErrInvalidInput
		}
		current.Source = input.Source
	}
	if input.Verified != nil {
		current.Verified = *input.Verified
		if *input.Verified && input.VerifiedAt != nil && *input.VerifiedAt != "" {
			if verifiedAt, err := parseTime(*input.VerifiedAt); err == nil {
				current.VerifiedAt = &verifiedAt
			}
		}
	}
	if current.RecordType == RecordTypeOpened && current.StartDate != "" && current.ValidityValue > 0 {
		current.ExpiryDate = addDuration(current.StartDate, current.ValidityValue, current.ValidityUnit)
	}
	current.UpdatedAt = time.Now().UTC()
	current.RiskLevel = computeRisk(current.ExpiryDate, time.Now().Format("2006-01-02"))
	if _, err := s.db.ExecContext(ctx, `
		UPDATE days_left_records
		SET category_id = ?, name = ?, record_type = ?, start_date = ?, expiry_date = ?,
			validity_value = ?, validity_unit = ?, cycle_unit = ?, cycle_interval = ?,
			reminder_lead_days = ?, note = ?, status = ?, risk_level = ?, source = ?,
			verified = ?, verified_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, current.CategoryID, current.Name, current.RecordType, nullString(current.StartDate),
		current.ExpiryDate, current.ValidityValue, current.ValidityUnit, current.CycleUnit,
		current.CycleInterval, current.ReminderLeadDays, current.Note, current.Status,
		current.RiskLevel, current.Source, boolInt(current.Verified), nullTime(current.VerifiedAt),
		current.UpdatedAt.Unix(), recordID, userID); err != nil {
		return Record{}, err
	}
	decorateRecord(&current, time.Now().Format("2006-01-02"))
	return current, nil
}

func (s *Store) DeleteRecord(ctx context.Context, userID, recordID string) error {
	if _, err := s.GetRecord(ctx, userID, recordID); err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM days_left_records WHERE id = ? AND user_id = ?
	`, recordID, userID); err != nil {
		return err
	}
	return nil
}

func (s *Store) RenewRecord(ctx context.Context, userID, recordID string, input RenewInput) (Record, error) {
	current, err := s.GetRecord(ctx, userID, recordID)
	if err != nil {
		return Record{}, err
	}
	newExpiry := strings.TrimSpace(input.NewExpiryDate)
	if newExpiry == "" {
		if current.RecordType == RecordTypeRecurring {
			newExpiry = addDuration(current.ExpiryDate, current.CycleInterval, current.CycleUnit)
		} else {
			return Record{}, ErrInvalidInput
		}
	}
	if !validDate(newExpiry) {
		return Record{}, ErrInvalidInput
	}
	if input.CycleUnit != "" && !validCycleUnit(input.CycleUnit) {
		return Record{}, ErrInvalidInput
	}
	if input.CycleUnit != "" {
		current.CycleUnit = input.CycleUnit
	}
	if input.CycleInterval > 0 {
		current.CycleInterval = input.CycleInterval
	}
	now := time.Now().UTC()
	previous := current.ExpiryDate
	current.ExpiryDate = newExpiry
	current.Status = StatusActive
	current.RiskLevel = computeRisk(newExpiry, time.Now().Format("2006-01-02"))
	current.LastRenewedAt = &now
	current.UpdatedAt = now
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE days_left_records
		SET expiry_date = ?, status = ?, risk_level = ?, cycle_unit = ?, cycle_interval = ?,
			last_renewed_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, current.ExpiryDate, current.Status, current.RiskLevel, current.CycleUnit,
		current.CycleInterval, now.Unix(), now.Unix(), recordID, userID); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, Event{
		ID:                 uuid.NewString(),
		RecordID:           recordID,
		UserID:             userID,
		Action:             "renewed",
		PreviousExpiryDate: previous,
		NewExpiryDate:      newExpiry,
		Note:               strings.TrimSpace(input.Note),
		EvidenceURL:        strings.TrimSpace(input.EvidenceURL),
		CreatedAt:          now,
	}); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	decorateRecord(&current, time.Now().Format("2006-01-02"))
	return current, nil
}

func (s *Store) CompleteRecord(ctx context.Context, userID, recordID string, input CompleteInput) (Record, error) {
	current, err := s.GetRecord(ctx, userID, recordID)
	if err != nil {
		return Record{}, err
	}
	if current.Status == StatusCompleted {
		return current, nil
	}
	now := time.Now().UTC()
	current.Status = StatusCompleted
	current.UpdatedAt = now
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE days_left_records SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?
	`, current.Status, now.Unix(), recordID, userID); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, Event{
		ID:                 uuid.NewString(),
		RecordID:           recordID,
		UserID:             userID,
		Action:             "completed",
		PreviousExpiryDate: current.ExpiryDate,
		NewExpiryDate:      current.ExpiryDate,
		Note:               strings.TrimSpace(input.Note),
		CreatedAt:          now,
	}); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return current, nil
}

func (s *Store) UndoRecord(ctx context.Context, userID, recordID string) (Record, error) {
	if _, err := s.GetRecord(ctx, userID, recordID); err != nil {
		return Record{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT id, record_id, user_id, action, previous_expiry_date, new_expiry_date,
			note, evidence_url, created_at
		FROM days_left_events
		WHERE record_id = ? AND user_id = ?
		ORDER BY created_at DESC LIMIT 1
	`, recordID, userID)
	var lastEvent Event
	var eventCreatedAt int64
	if err := row.Scan(&lastEvent.ID, &lastEvent.RecordID, &lastEvent.UserID, &lastEvent.Action,
		&lastEvent.PreviousExpiryDate, &lastEvent.NewExpiryDate, &lastEvent.Note,
		&lastEvent.EvidenceURL, &eventCreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, ErrInvalidInput
		}
		return Record{}, err
	}
	lastEvent.CreatedAt = time.Unix(eventCreatedAt, 0).UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback()
	if lastEvent.Action == "renewed" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE days_left_records
			SET expiry_date = ?, status = 'active', updated_at = ?
			WHERE id = ? AND user_id = ?
		`, lastEvent.PreviousExpiryDate, time.Now().UTC().Unix(), recordID, userID); err != nil {
			return Record{}, err
		}
	} else if lastEvent.Action == "completed" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE days_left_records SET status = 'active', updated_at = ?
			WHERE id = ? AND user_id = ?
		`, time.Now().UTC().Unix(), recordID, userID); err != nil {
			return Record{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM days_left_events WHERE id = ? AND user_id = ?
	`, lastEvent.ID, userID); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(); err != nil {
		return Record{}, err
	}
	return s.GetRecord(ctx, userID, recordID)
}

func (s *Store) Summary(ctx context.Context, userID, date string) (Summary, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	records, err := s.ListRecords(ctx, userID, RecordFilter{Today: date})
	if err != nil {
		return Summary{}, err
	}
	summary := Summary{Date: date, Today: []Record{}, Soon: []Record{}}
	for _, record := range records {
		if record.Status != StatusActive {
			continue
		}
		switch {
		case record.ExpiryDate < date:
			summary.Overdue++
			summary.Today = append(summary.Today, record)
		case record.ExpiryDate == date:
			summary.DueToday++
			summary.Today = append(summary.Today, record)
		case record.DaysLeft <= 7:
			summary.Next7++
			summary.Soon = append(summary.Soon, record)
		case record.DaysLeft <= 30:
			summary.Next30++
			summary.Soon = append(summary.Soon, record)
		case record.DaysLeft <= 90:
			summary.Next90++
			summary.Soon = append(summary.Soon, record)
		}
	}
	return summary, nil
}

func (s *Store) Calendar(ctx context.Context, userID, month string) (CalendarSnapshot, error) {
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.expiry_date, COUNT(*)
		FROM days_left_records r
		WHERE r.user_id = ? AND r.status = 'active' AND r.expiry_date LIKE ?
		GROUP BY r.expiry_date
		ORDER BY r.expiry_date ASC
	`, userID, month+"%")
	if err != nil {
		return CalendarSnapshot{}, err
	}
	defer rows.Close()
	result := CalendarSnapshot{Month: month, Days: []DayCount{}}
	for rows.Next() {
		var day DayCount
		if err := rows.Scan(&day.Date, &day.Count); err != nil {
			return CalendarSnapshot{}, err
		}
		result.Days = append(result.Days, day)
	}
	return result, rows.Err()
}

func (s *Store) Stats(ctx context.Context, userID, rangeID string) (StatsSnapshot, error) {
	records, err := s.ListRecords(ctx, userID, RecordFilter{})
	if err != nil {
		return StatsSnapshot{}, err
	}
	today := time.Now().Format("2006-01-02")
	stats := StatsSnapshot{Range: rangeID, ByCategory: []CategoryCount{}}
	counts := map[string]*CategoryCount{}
	for _, record := range records {
		if record.Status != StatusActive {
			continue
		}
		stats.Total++
		switch {
		case record.ExpiryDate < today:
			stats.Overdue++
		case record.DaysLeft <= 30:
			stats.Next30++
		case record.DaysLeft <= 90:
			stats.Next90++
		}
		item, ok := counts[record.CategoryID]
		if !ok {
			item = &CategoryCount{
				CategoryID: record.CategoryID,
				Name:       record.CategoryName,
				Color:      record.CategoryColor,
				Icon:       record.CategoryIcon,
			}
			counts[record.CategoryID] = item
		}
		item.Count++
	}
	for _, item := range counts {
		stats.ByCategory = append(stats.ByCategory, *item)
	}
	_ = today
	stats.Completed = 0
	for _, record := range records {
		if record.Status == StatusCompleted {
			stats.Completed++
		}
	}
	if stats.Total+stats.Completed > 0 {
		stats.Rate = float64(stats.Completed) / float64(stats.Total+stats.Completed)
	}
	return stats, nil
}

func (s *Store) ListReminders(ctx context.Context, userID string) ([]Reminder, error) {
	records, err := s.ListRecords(ctx, userID, RecordFilter{})
	if err != nil {
		return nil, err
	}
	today := time.Now().Format("2006-01-02")
	items := []Reminder{}
	for _, record := range records {
		if record.Status != StatusActive || record.ExpiryDate <= today || record.ReminderLeadDays <= 0 {
			continue
		}
		remindAt := addDuration(record.ExpiryDate, -record.ReminderLeadDays, "day")
		var dismissed bool
		if err := s.db.QueryRowContext(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM days_left_reminder_dismissals
				WHERE user_id = ? AND record_id = ? AND remind_at = ?
			)
		`, userID, record.ID, remindAt).Scan(&dismissed); err != nil {
			return nil, err
		}
		if dismissed {
			continue
		}
		reminderID := record.ID + ":" + remindAt
		items = append(items, Reminder{
			ID:         reminderID,
			RecordID:   record.ID,
			UserID:     userID,
			RemindAt:   remindAt,
			Channel:    "app",
			Status:     "pending",
			CreatedAt:  time.Now().UTC(),
			RecordName: record.Name,
			DaysLeft:   record.DaysLeft,
		})
	}
	return items, nil
}

func (s *Store) DismissReminder(ctx context.Context, userID, reminderID string) error {
	parts := strings.SplitN(reminderID, ":", 2)
	if len(parts) != 2 {
		return ErrInvalidInput
	}
	recordID := parts[0]
	remindAt := parts[1]
	if !validDate(remindAt) {
		return ErrInvalidInput
	}
	if _, err := s.GetRecord(ctx, userID, recordID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		INSERT OR IGNORE INTO days_left_reminder_dismissals
			(id, record_id, user_id, remind_at, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, reminderID, recordID, userID, remindAt, now.Unix()); err != nil {
		return err
	}
	return nil
}

func (s *Store) ListEvidence(ctx context.Context, userID, recordID string) ([]Evidence, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, record_id, user_id, file_url, kind, created_at
		FROM days_left_evidence
		WHERE record_id = ? AND user_id = ?
		ORDER BY created_at DESC
	`, recordID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Evidence{}
	for rows.Next() {
		var item Evidence
		var createdAt int64
		if err := rows.Scan(&item.ID, &item.RecordID, &item.UserID, &item.FileURL,
			&item.Kind, &createdAt); err != nil {
			return nil, err
		}
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) AddEvidence(ctx context.Context, userID, recordID, fileURL, kind string) (Evidence, error) {
	if _, err := s.GetRecord(ctx, userID, recordID); err != nil {
		return Evidence{}, err
	}
	now := time.Now().UTC()
	item := Evidence{
		ID:        uuid.NewString(),
		RecordID:  recordID,
		UserID:    userID,
		FileURL:   fileURL,
		Kind:      strings.TrimSpace(kind),
		CreatedAt: now,
	}
	if item.Kind == "" {
		item.Kind = "photo"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Evidence{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO days_left_evidence (id, record_id, user_id, file_url, kind, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, item.ID, item.RecordID, item.UserID, item.FileURL, item.Kind, item.CreatedAt.Unix()); err != nil {
		return Evidence{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE days_left_records
		SET evidence_count = (SELECT COUNT(*) FROM days_left_evidence WHERE record_id = ?),
			updated_at = ?
		WHERE id = ? AND user_id = ?
	`, recordID, now.Unix(), recordID, userID); err != nil {
		return Evidence{}, err
	}
	if err := tx.Commit(); err != nil {
		return Evidence{}, err
	}
	return item, nil
}

func (s *Store) ListEvents(ctx context.Context, userID, recordID string) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, record_id, user_id, action, previous_expiry_date, new_expiry_date,
			note, evidence_url, created_at
		FROM days_left_events
		WHERE record_id = ? AND user_id = ?
		ORDER BY created_at DESC
	`, recordID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Event{}
	for rows.Next() {
		var item Event
		var createdAt int64
		if err := rows.Scan(&item.ID, &item.RecordID, &item.UserID, &item.Action,
			&item.PreviousExpiryDate, &item.NewExpiryDate, &item.Note, &item.EvidenceURL,
			&createdAt); err != nil {
			return nil, err
		}
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRecord(row rowScanner) (Record, error) {
	var item Record
	var startDate, verifiedAt, lastRenewedAt sql.NullString
	var createdAt, updatedAt sql.NullInt64
	var verified int
	err := row.Scan(&item.ID, &item.UserID, &item.CategoryID, &item.Name, &item.RecordType,
		&startDate, &item.ExpiryDate, &item.ValidityValue, &item.ValidityUnit,
		&item.CycleUnit, &item.CycleInterval, &item.ReminderLeadDays, &item.Note,
		&item.Status, &item.RiskLevel, &item.Source, &item.EvidenceCount, &verified,
		&verifiedAt, &lastRenewedAt, &createdAt, &updatedAt, &item.CategoryName,
		&item.CategoryIcon, &item.CategoryColor)
	if err != nil {
		return Record{}, err
	}
	item.StartDate = startDate.String
	item.Verified = verified == 1
	item.CreatedAt = time.Unix(createdAt.Int64, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt.Int64, 0).UTC()
	if verifiedAt.Valid {
		if parsed, err := time.Parse(time.RFC3339, verifiedAt.String); err == nil {
			item.VerifiedAt = &parsed
		}
	}
	if lastRenewedAt.Valid {
		if parsed, err := time.Parse(time.RFC3339, lastRenewedAt.String); err == nil {
			item.LastRenewedAt = &parsed
		}
	}
	return item, nil
}

func decorateRecord(item *Record, today string) {
	item.DaysLeft = daysBetween(today, item.ExpiryDate)
	if item.ReminderLeadDays > 0 && item.ExpiryDate > today {
		item.RemindAt = addDuration(item.ExpiryDate, -item.ReminderLeadDays, "day")
	}
	if item.Status == StatusActive {
		item.RiskLevel = computeRisk(item.ExpiryDate, today)
	}
}

func insertEvent(ctx context.Context, tx *sql.Tx, event Event) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO days_left_events
			(id, record_id, user_id, action, previous_expiry_date, new_expiry_date,
			 note, evidence_url, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.RecordID, event.UserID, event.Action, nullString(event.PreviousExpiryDate),
		nullString(event.NewExpiryDate), event.Note, event.EvidenceURL, event.CreatedAt.Unix())
	return err
}

func validRecordType(value string) bool {
	switch value {
	case RecordTypeFixed, RecordTypeOpened, RecordTypeRecurring, RecordTypeEvent:
		return true
	default:
		return false
	}
}

func validSource(value string) bool {
	switch value {
	case SourceUser, SourcePhoto, SourceScanner, SourceAPI, SourceImport:
		return true
	default:
		return false
	}
}

func validCycleUnit(value string) bool {
	switch value {
	case CycleDay, CycleWeek, CycleMonth, CycleYear:
		return true
	default:
		return false
	}
}

func validDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func daysBetween(from, to string) int {
	fromTime, err1 := time.Parse("2006-01-02", from)
	toTime, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(toTime.Sub(fromTime).Hours() / 24)
}

func addDuration(date string, value int, unit string) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	switch unit {
	case CycleDay:
		parsed = parsed.AddDate(0, 0, value)
	case CycleWeek:
		parsed = parsed.AddDate(0, 0, value*7)
	case CycleMonth:
		parsed = parsed.AddDate(0, value, 0)
	case CycleYear:
		parsed = parsed.AddDate(value, 0, 0)
	default:
		parsed = parsed.AddDate(0, 0, value)
	}
	return parsed.Format("2006-01-02")
}

func computeRisk(expiryDate, today string) string {
	switch {
	case expiryDate < today:
		return "overdue"
	case expiryDate == today:
		return "7"
	case daysBetween(today, expiryDate) <= 7:
		return "7"
	case daysBetween(today, expiryDate) <= 30:
		return "30"
	case daysBetween(today, expiryDate) <= 90:
		return "90"
	default:
		return "safe"
	}
}

func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Format(time.RFC3339)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func parseTime(value string) (time.Time, error) {
	return time.Parse(time.RFC3339, value)
}
