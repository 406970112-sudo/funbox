package cooling

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

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound          = errors.New("cooling item not found")
	ErrInvalidInput      = errors.New("cooling invalid input")
	ErrDatabasePathEmpty = errors.New("cooling database path is empty")
)

type Settings struct {
	UserID                      string    `json:"-"`
	MonthlySalaryCents          int64     `json:"monthlySalaryCents,omitempty"`
	MonthlyWorkHours            float64   `json:"monthlyWorkHours,omitempty"`
	HourlyWageCents             int64     `json:"hourlyWageCents,omitempty"`
	WageSource                  string    `json:"wageSource,omitempty"`
	NotifyBeforeHours           int       `json:"notifyBeforeHours,omitempty"`
	NotificationEnabled         bool      `json:"notificationEnabled"`
	EffectiveHourlyWageCents    *int64    `json:"effectiveHourlyWageCents,omitempty"`
	EffectiveMonthlySalaryCents *int64    `json:"effectiveMonthlySalaryCents,omitempty"`
	UpdatedAt                   time.Time `json:"updatedAt"`
}

type Item struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"userId"`
	Name               string     `json:"name"`
	PriceCents         int64      `json:"priceCents"`
	Currency           string     `json:"currency"`
	SourceType         string     `json:"sourceType"`
	SourceText         string     `json:"sourceText,omitempty"`
	SourceURL          string     `json:"sourceUrl,omitempty"`
	Answers            Answers    `json:"answers"`
	HourlyWageCents    int64      `json:"hourlyWageCents,omitempty"`
	MonthlySalaryCents int64      `json:"monthlySalaryCents,omitempty"`
	EquivalentHours    *float64   `json:"equivalentHours,omitempty"`
	IncomeRatioPercent *float64   `json:"incomeRatioPercent,omitempty"`
	RiskLevel          string     `json:"riskLevel"`
	RiskReasons        []string   `json:"riskReasons"`
	Status             string     `json:"status"`
	CoolEndsAt         time.Time  `json:"coolEndsAt"`
	ExtendCount        int        `json:"extendCount"`
	DecidedAt          *time.Time `json:"decidedAt,omitempty"`
	FinalPriceCents    *int64     `json:"finalPriceCents,omitempty"`
	FinalPurchaseAt    *string    `json:"finalPurchaseAt,omitempty"`
	EvidenceCount      int        `json:"evidenceCount"`
	PreviousStatus     string     `json:"-"`
	PreviousCoolEndsAt time.Time  `json:"-"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

type Event struct {
	ID        string    `json:"id"`
	ItemID    string    `json:"itemId"`
	UserID    string    `json:"userId"`
	Action    string    `json:"action"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type Evidence struct {
	ID           string    `json:"id"`
	ItemID       string    `json:"itemId"`
	UserID       string    `json:"userId"`
	FileURL      string    `json:"fileUrl"`
	OriginalName string    `json:"originalName,omitempty"`
	Size         int64     `json:"size,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type DailyStat struct {
	Date         string `json:"date"`
	CreatedCount int    `json:"createdCount"`
	BoughtCount  int    `json:"boughtCount"`
	DroppedCount int    `json:"droppedCount"`
	AmountCents  int64  `json:"amountCents"`
}

type StatsSnapshot struct {
	TotalCount         int         `json:"totalCount"`
	CoolingCount       int         `json:"coolingCount"`
	PendingCount       int         `json:"pendingCount"`
	BoughtCount        int         `json:"boughtCount"`
	DroppedCount       int         `json:"droppedCount"`
	TotalAmountCents   int64       `json:"totalAmountCents"`
	BoughtAmountCents  int64       `json:"boughtAmountCents"`
	DroppedAmountCents int64       `json:"droppedAmountCents"`
	CompletionRate     float64     `json:"completionRate"`
	AvgEquivalentHours *float64    `json:"avgEquivalentHours,omitempty"`
	Daily              []DailyStat `json:"daily"`
}

type HomeSnapshot struct {
	Stats     StatsSnapshot `json:"stats"`
	Pending   []Item        `json:"pending"`
	Cooling   []Item        `json:"cooling"`
	Recent    []Item        `json:"recent"`
	ServerNow time.Time     `json:"serverNow"`
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
			return nil, fmt.Errorf("create cooling database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open cooling database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS cooling_settings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			monthly_salary_cents INTEGER NOT NULL DEFAULT 0,
			monthly_work_hours REAL NOT NULL DEFAULT 0,
			hourly_wage_cents INTEGER NOT NULL DEFAULT 0,
			wage_source TEXT NOT NULL DEFAULT 'monthly',
			notify_before_hours INTEGER NOT NULL DEFAULT 0,
			notification_enabled INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS cooling_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
			price_cents INTEGER NOT NULL CHECK(price_cents > 0),
			currency TEXT NOT NULL DEFAULT 'CNY',
			source_type TEXT NOT NULL DEFAULT 'manual',
			source_text TEXT NOT NULL DEFAULT '',
			source_url TEXT NOT NULL DEFAULT '',
			answers_json TEXT NOT NULL,
			hourly_wage_cents INTEGER NOT NULL DEFAULT 0,
			monthly_salary_cents INTEGER NOT NULL DEFAULT 0,
			equivalent_hours REAL,
			income_ratio_percent REAL,
			risk_level TEXT NOT NULL DEFAULT 'low',
			status TEXT NOT NULL DEFAULT 'cooling'
				CHECK(status IN ('cooling', 'pending_decision', 'bought', 'dropped')),
			cool_ends_at INTEGER NOT NULL,
			extend_count INTEGER NOT NULL DEFAULT 0,
			decided_at INTEGER,
			final_price_cents INTEGER,
			final_purchase_at TEXT,
			evidence_count INTEGER NOT NULL DEFAULT 0,
			previous_status TEXT NOT NULL DEFAULT '',
			previous_cool_ends_at INTEGER,
			previous_final_price_cents INTEGER,
			previous_final_purchase_at TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooling_items_user_status
			ON cooling_items(user_id, status, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS cooling_events (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES cooling_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooling_events_item
			ON cooling_events(item_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS cooling_evidence (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES cooling_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			file_url TEXT NOT NULL,
			original_name TEXT NOT NULL DEFAULT '',
			size INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooling_evidence_item
			ON cooling_evidence(item_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate cooling: %w", err)
		}
	}
	return nil
}

func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	var settings Settings
	var updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT user_id, monthly_salary_cents, monthly_work_hours, hourly_wage_cents,
			wage_source, notify_before_hours, notification_enabled, updated_at
		FROM cooling_settings WHERE user_id = ?
	`, userID).Scan(
		&settings.UserID,
		&settings.MonthlySalaryCents,
		&settings.MonthlyWorkHours,
		&settings.HourlyWageCents,
		&settings.WageSource,
		&settings.NotifyBeforeHours,
		&settings.NotificationEnabled,
		&updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		settings.UserID = userID
		settings.WageSource = WageMonthly
		settings.UpdatedAt = time.Now().UTC()
		return settings, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("get cooling settings: %w", err)
	}
	settings.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	settings.computeEffective()
	return settings, nil
}

func (s *Store) SaveSettings(ctx context.Context, userID string, input SettingsInput) (Settings, error) {
	current, err := s.GetSettings(ctx, userID)
	if err != nil {
		return Settings{}, err
	}
	settings := Settings{
		UserID:              userID,
		MonthlySalaryCents:  current.MonthlySalaryCents,
		MonthlyWorkHours:    current.MonthlyWorkHours,
		HourlyWageCents:     current.HourlyWageCents,
		WageSource:          strings.TrimSpace(input.WageSource),
		NotifyBeforeHours:   current.NotifyBeforeHours,
		NotificationEnabled: current.NotificationEnabled,
	}
	if input.MonthlySalaryCents > 0 {
		settings.MonthlySalaryCents = input.MonthlySalaryCents
	}
	if input.MonthlyWorkHours > 0 {
		settings.MonthlyWorkHours = input.MonthlyWorkHours
	}
	if input.HourlyWageCents > 0 {
		settings.HourlyWageCents = input.HourlyWageCents
	}
	if input.NotifyBeforeHours > 0 {
		settings.NotifyBeforeHours = input.NotifyBeforeHours
	}
	if settings.WageSource == "" {
		if settings.MonthlySalaryCents > 0 && settings.MonthlyWorkHours > 0 {
			settings.WageSource = WageMonthly
		} else if settings.HourlyWageCents > 0 {
			settings.WageSource = WageHourly
		} else {
			settings.WageSource = WageMonthly
		}
	}
	if input.NotificationEnabled != nil {
		settings.NotificationEnabled = *input.NotificationEnabled
	}
	if settings.WageSource == WageMonthly {
		if settings.MonthlySalaryCents <= 0 || settings.MonthlyWorkHours <= 0 {
			return Settings{}, fmt.Errorf("%w: monthly salary and work hours required", ErrInvalidInput)
		}
		settings.HourlyWageCents = int64(float64(settings.MonthlySalaryCents)/settings.MonthlyWorkHours + 0.5)
	} else if settings.WageSource == WageHourly {
		if settings.HourlyWageCents <= 0 {
			return Settings{}, fmt.Errorf("%w: hourly wage required", ErrInvalidInput)
		}
	} else {
		return Settings{}, fmt.Errorf("%w: invalid wage source", ErrInvalidInput)
	}
	if settings.NotifyBeforeHours < 0 || settings.NotifyBeforeHours > 72 {
		return Settings{}, fmt.Errorf("%w: invalid notify before hours", ErrInvalidInput)
	}
	settings.UpdatedAt = time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO cooling_settings
			(user_id, monthly_salary_cents, monthly_work_hours, hourly_wage_cents,
			 wage_source, notify_before_hours, notification_enabled, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			monthly_salary_cents = excluded.monthly_salary_cents,
			monthly_work_hours = excluded.monthly_work_hours,
			hourly_wage_cents = excluded.hourly_wage_cents,
			wage_source = excluded.wage_source,
			notify_before_hours = excluded.notify_before_hours,
			notification_enabled = excluded.notification_enabled,
			updated_at = excluded.updated_at
	`, settings.UserID, settings.MonthlySalaryCents, settings.MonthlyWorkHours,
		settings.HourlyWageCents, settings.WageSource, settings.NotifyBeforeHours,
		settings.NotificationEnabled, settings.UpdatedAt.Unix())
	if err != nil {
		return Settings{}, fmt.Errorf("save cooling settings: %w", err)
	}
	settings.computeEffective()
	return settings, nil
}

func (s *Settings) computeEffective() {
	if wage, ok := EffectiveHourlyWage(*s); ok {
		value := wage
		s.EffectiveHourlyWageCents = &value
	}
	if s.MonthlySalaryCents > 0 {
		value := s.MonthlySalaryCents
		s.EffectiveMonthlySalaryCents = &value
	}
}

func (s *Store) CreateItem(ctx context.Context, userID string, input ItemInput) (Item, error) {
	if err := ValidateItemInput(input); err != nil {
		return Item{}, err
	}
	settings, err := s.GetSettings(ctx, userID)
	if err != nil {
		return Item{}, err
	}
	now := time.Now().UTC()
	item := Item{
		ID:         uuid.NewString(),
		UserID:     userID,
		Name:       strings.TrimSpace(input.Name),
		PriceCents: input.PriceCents,
		Currency:   strings.ToUpper(strings.TrimSpace(input.Currency)),
		SourceType: strings.TrimSpace(input.SourceType),
		SourceText: strings.TrimSpace(input.SourceText),
		SourceURL:  strings.TrimSpace(input.SourceURL),
		Answers:    input.Answers,
		Status:     StatusCooling,
		CoolEndsAt: now.Add(24 * time.Hour),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if item.Currency == "" {
		item.Currency = "CNY"
	}
	if item.SourceType == "" {
		item.SourceType = SourceManual
	}
	hourly, monthly, equivalent, ratio, risk, reasons := ComputeMetrics(input, settings)
	item.HourlyWageCents = hourly
	item.MonthlySalaryCents = monthly
	item.EquivalentHours = equivalent
	item.IncomeRatioPercent = ratio
	item.RiskLevel = risk
	item.RiskReasons = reasons
	answersJSON, err := json.Marshal(item.Answers)
	if err != nil {
		return Item{}, fmt.Errorf("encode cooling answers: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO cooling_items
			(id, user_id, name, price_cents, currency, source_type, source_text, source_url,
			 answers_json, hourly_wage_cents, monthly_salary_cents, equivalent_hours,
			 income_ratio_percent, risk_level, status, cool_ends_at, extend_count,
			 evidence_count, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
	`, item.ID, item.UserID, item.Name, item.PriceCents, item.Currency, item.SourceType,
		item.SourceText, item.SourceURL, string(answersJSON), item.HourlyWageCents,
		item.MonthlySalaryCents, nullableFloat(item.EquivalentHours),
		nullableFloat(item.IncomeRatioPercent), item.RiskLevel, item.Status,
		item.CoolEndsAt.Unix(), item.ExtendCount, item.CreatedAt.Unix(), item.UpdatedAt.Unix())
	if err != nil {
		return Item{}, fmt.Errorf("insert cooling item: %w", err)
	}
	if err := insertEventTx(ctx, tx, item.ID, userID, "created", "", now); err != nil {
		return Item{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, fmt.Errorf("commit cooling item: %w", err)
	}
	return item, nil
}

func (s *Store) ListItems(ctx context.Context, userID string, filter RecordFilter) ([]Item, error) {
	query := `
		SELECT id, user_id, name, price_cents, currency, source_type, source_text, source_url,
			answers_json, hourly_wage_cents, monthly_salary_cents, equivalent_hours,
			income_ratio_percent, risk_level, status, cool_ends_at, extend_count,
			decided_at, final_price_cents, final_purchase_at, evidence_count,
			previous_status, previous_cool_ends_at, created_at, updated_at
		FROM cooling_items WHERE user_id = ?`
	args := []any{userID}
	if filter.Status != "" {
		query += " AND status = ?"
		args = append(args, filter.Status)
	}
	if strings.TrimSpace(filter.Query) != "" {
		query += " AND name LIKE ?"
		args = append(args, "%"+strings.TrimSpace(filter.Query)+"%")
	}
	query += " ORDER BY created_at DESC"
	if filter.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list cooling items: %w", err)
	}
	defer rows.Close()
	var items []Item
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		item.RiskReasons = riskReasonsFor(item)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []Item{}
	}
	return items, nil
}

func (s *Store) GetItem(ctx context.Context, userID string, itemID string) (Item, error) {
	item, err := s.getItemByID(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	item.RiskReasons = riskReasonsFor(item)
	return item, nil
}

func (s *Store) getItemByID(ctx context.Context, userID string, itemID string) (Item, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, price_cents, currency, source_type, source_text, source_url,
			answers_json, hourly_wage_cents, monthly_salary_cents, equivalent_hours,
			income_ratio_percent, risk_level, status, cool_ends_at, extend_count,
			decided_at, final_price_cents, final_purchase_at, evidence_count,
			previous_status, previous_cool_ends_at, created_at, updated_at
		FROM cooling_items WHERE id = ? AND user_id = ?
	`, itemID, userID)
	item, err := scanItem(row)
	if err != nil {
		return Item{}, err
	}
	return item, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanItem(row scanner) (Item, error) {
	var item Item
	var answersJSON string
	var equivalentHours sql.NullFloat64
	var incomeRatio sql.NullFloat64
	var decidedAt sql.NullInt64
	var finalPrice sql.NullInt64
	var finalPurchaseAt sql.NullString
	var previousStatus string
	var previousCoolEndsAt sql.NullInt64
	var coolEndsAt int64
	var createdAt int64
	var updatedAt int64
	err := row.Scan(
		&item.ID, &item.UserID, &item.Name, &item.PriceCents, &item.Currency,
		&item.SourceType, &item.SourceText, &item.SourceURL, &answersJSON,
		&item.HourlyWageCents, &item.MonthlySalaryCents, &equivalentHours,
		&incomeRatio, &item.RiskLevel, &item.Status, &coolEndsAt, &item.ExtendCount,
		&decidedAt, &finalPrice, &finalPurchaseAt, &item.EvidenceCount,
		&previousStatus, &previousCoolEndsAt, &createdAt, &updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, fmt.Errorf("scan cooling item: %w", err)
	}
	if err := json.Unmarshal([]byte(answersJSON), &item.Answers); err != nil {
		return Item{}, fmt.Errorf("decode cooling answers: %w", err)
	}
	if equivalentHours.Valid {
		value := equivalentHours.Float64
		item.EquivalentHours = &value
	}
	if incomeRatio.Valid {
		value := incomeRatio.Float64
		item.IncomeRatioPercent = &value
	}
	if decidedAt.Valid {
		value := time.Unix(decidedAt.Int64, 0).UTC()
		item.DecidedAt = &value
	}
	if finalPrice.Valid {
		value := finalPrice.Int64
		item.FinalPriceCents = &value
	}
	if finalPurchaseAt.Valid {
		value := finalPurchaseAt.String
		item.FinalPurchaseAt = &value
	}
	item.PreviousStatus = previousStatus
	if previousCoolEndsAt.Valid {
		item.PreviousCoolEndsAt = time.Unix(previousCoolEndsAt.Int64, 0).UTC()
	}
	item.CoolEndsAt = time.Unix(coolEndsAt, 0).UTC()
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func riskReasonsFor(item Item) []string {
	_, reasons := RiskLevel(item.Answers, item.EquivalentHours, item.IncomeRatioPercent)
	return reasons
}

func (s *Store) DecideItem(ctx context.Context, userID string, itemID string, input DecisionInput) (Item, error) {
	action := strings.TrimSpace(input.Action)
	if action != "buy" && action != "drop" {
		return Item{}, fmt.Errorf("%w: invalid decision action", ErrInvalidInput)
	}
	if len([]rune(input.Note)) > 200 {
		return Item{}, fmt.Errorf("%w: note too long", ErrInvalidInput)
	}
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.Status != StatusCooling && item.Status != StatusPendingDecision {
		return Item{}, fmt.Errorf("%w: item already decided", ErrInvalidInput)
	}
	now := time.Now().UTC()
	finalPrice := item.PriceCents
	if input.FinalPriceCents != nil {
		if *input.FinalPriceCents <= 0 || *input.FinalPriceCents > MaxPriceCents {
			return Item{}, fmt.Errorf("%w: invalid final price", ErrInvalidInput)
		}
		finalPrice = *input.FinalPriceCents
	}
	finalPurchaseAt := now.Format("2006-01-02")
	if strings.TrimSpace(input.FinalPurchaseAt) != "" {
		finalPurchaseAt = strings.TrimSpace(input.FinalPurchaseAt)
	}
	newStatus := StatusBought
	eventAction := "decided_buy"
	if item.Status == StatusCooling {
		eventAction = "bought_early"
	}
	if action == "drop" {
		newStatus = StatusDropped
		eventAction = "decided_drop"
		if item.Status == StatusCooling {
			eventAction = "dropped_early"
		}
		finalPrice = item.PriceCents
		finalPurchaseAt = ""
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		UPDATE cooling_items SET
			status = ?, decided_at = ?, final_price_cents = ?, final_purchase_at = ?,
			previous_status = ?, previous_cool_ends_at = ?, previous_final_price_cents = ?,
			previous_final_purchase_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, newStatus, now.Unix(), finalPrice, nullableString(finalPurchaseAt), item.Status,
		item.CoolEndsAt.Unix(), item.PriceCents, nullableString(""), now.Unix(), item.ID, userID)
	if err != nil {
		return Item{}, fmt.Errorf("update cooling decision: %w", err)
	}
	if err := insertEventTx(ctx, tx, item.ID, userID, eventAction, input.Note, now); err != nil {
		return Item{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, fmt.Errorf("commit cooling decision: %w", err)
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) ExtendItem(ctx context.Context, userID string, itemID string) (Item, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.Status != StatusPendingDecision {
		return Item{}, fmt.Errorf("%w: item is not pending decision", ErrInvalidInput)
	}
	if item.ExtendCount >= MaxExtendCount {
		return Item{}, fmt.Errorf("%w: extend limit reached", ErrInvalidInput)
	}
	now := time.Now().UTC()
	newEndsAt := now.Add(24 * time.Hour)
	_, err = s.db.ExecContext(ctx, `
		UPDATE cooling_items SET status = ?, cool_ends_at = ?, extend_count = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, StatusCooling, newEndsAt.Unix(), item.ExtendCount+1, now.Unix(), item.ID, userID)
	if err != nil {
		return Item{}, fmt.Errorf("extend cooling item: %w", err)
	}
	if err := s.insertEvent(ctx, item.ID, userID, "extended", "", now); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) UndoItem(ctx context.Context, userID string, itemID string) (Item, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.Status != StatusBought && item.Status != StatusDropped {
		return Item{}, fmt.Errorf("%w: item has no decision to undo", ErrInvalidInput)
	}
	if item.DecidedAt == nil || time.Since(*item.DecidedAt) > 5*time.Minute {
		return Item{}, fmt.Errorf("%w: undo window expired", ErrInvalidInput)
	}
	previousStatus := item.Status
	if item.PreviousStatus == "" {
		return Item{}, fmt.Errorf("%w: missing previous status", ErrInvalidInput)
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		UPDATE cooling_items SET
			status = ?, cool_ends_at = ?, decided_at = NULL,
			final_price_cents = NULL, final_purchase_at = NULL,
			previous_status = '', previous_cool_ends_at = NULL,
			previous_final_price_cents = NULL, previous_final_purchase_at = NULL,
			updated_at = ?
		WHERE id = ? AND user_id = ?
	`, item.PreviousStatus, item.PreviousCoolEndsAt.Unix(), now.Unix(), item.ID, userID)
	if err != nil {
		return Item{}, fmt.Errorf("undo cooling decision: %w", err)
	}
	if err := s.insertEvent(ctx, item.ID, userID, "undone", "撤销"+previousStatus, now); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) DeleteItem(ctx context.Context, userID string, itemID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM cooling_items WHERE id = ? AND user_id = ?`, itemID, userID)
	if err != nil {
		return fmt.Errorf("delete cooling item: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) MarkExpired(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id FROM cooling_items WHERE status = ? AND cool_ends_at <= ?
	`, StatusCooling, now.Unix())
	if err != nil {
		return 0, fmt.Errorf("query cooling expired items: %w", err)
	}
	defer rows.Close()
	type expiredItem struct {
		itemID string
		userID string
	}
	var expired []expiredItem
	for rows.Next() {
		var item expiredItem
		if err := rows.Scan(&item.itemID, &item.userID); err != nil {
			return 0, err
		}
		expired = append(expired, item)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, item := range expired {
		if _, err := s.db.ExecContext(ctx, `
			UPDATE cooling_items SET status = ?, updated_at = ? WHERE id = ? AND status = ?
		`, StatusPendingDecision, now.Unix(), item.itemID, StatusCooling); err != nil {
			return 0, fmt.Errorf("mark cooling item expired: %w", err)
		}
		if err := s.insertEvent(ctx, item.itemID, item.userID, "notified", "24小时冷静期结束", now); err != nil {
			return 0, err
		}
	}
	return len(expired), nil
}

func (s *Store) Stats(ctx context.Context, userID string) (StatsSnapshot, error) {
	stats := StatsSnapshot{}
	err := s.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) AS total,
			COALESCE(SUM(CASE WHEN status = 'cooling' THEN 1 ELSE 0 END), 0) AS cooling,
			COALESCE(SUM(CASE WHEN status = 'pending_decision' THEN 1 ELSE 0 END), 0) AS pending,
			COALESCE(SUM(CASE WHEN status = 'bought' THEN 1 ELSE 0 END), 0) AS bought,
			COALESCE(SUM(CASE WHEN status = 'dropped' THEN 1 ELSE 0 END), 0) AS dropped,
			COALESCE(SUM(price_cents), 0) AS total_amount,
			COALESCE(SUM(CASE WHEN status = 'bought' THEN COALESCE(final_price_cents, price_cents) ELSE 0 END), 0) AS bought_amount,
			COALESCE(SUM(CASE WHEN status = 'dropped' THEN price_cents ELSE 0 END), 0) AS dropped_amount
		FROM cooling_items WHERE user_id = ?
	`, userID).Scan(
		&stats.TotalCount, &stats.CoolingCount, &stats.PendingCount,
		&stats.BoughtCount, &stats.DroppedCount, &stats.TotalAmountCents,
		&stats.BoughtAmountCents, &stats.DroppedAmountCents,
	)
	if err != nil {
		return stats, fmt.Errorf("cooling stats: %w", err)
	}
	ended := stats.PendingCount + stats.BoughtCount + stats.DroppedCount
	if ended > 0 {
		stats.CompletionRate = float64(stats.BoughtCount+stats.DroppedCount) / float64(ended) * 100
	}
	var avg sql.NullFloat64
	err = s.db.QueryRowContext(ctx, `
		SELECT AVG(equivalent_hours) FROM cooling_items
		WHERE user_id = ? AND status IN ('bought', 'dropped') AND equivalent_hours IS NOT NULL
	`, userID).Scan(&avg)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return stats, fmt.Errorf("cooling average equivalent hours: %w", err)
	}
	if avg.Valid {
		value := avg.Float64
		stats.AvgEquivalentHours = &value
	}
	items, err := s.ListItems(ctx, userID, RecordFilter{})
	if err != nil {
		return stats, err
	}
	byDate := make(map[string]*DailyStat)
	for _, item := range items {
		date := item.CreatedAt.Format("2006-01-02")
		entry := byDate[date]
		if entry == nil {
			entry = &DailyStat{Date: date}
			byDate[date] = entry
		}
		entry.CreatedCount++
		entry.AmountCents += item.PriceCents
		if item.Status == StatusBought {
			entry.BoughtCount++
		}
		if item.Status == StatusDropped {
			entry.DroppedCount++
		}
	}
	now := time.Now().UTC()
	for i := 29; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		entry := byDate[date]
		if entry == nil {
			entry = &DailyStat{Date: date}
		}
		stats.Daily = append(stats.Daily, *entry)
	}
	return stats, nil
}

func (s *Store) Home(ctx context.Context, userID string) (HomeSnapshot, error) {
	stats, err := s.Stats(ctx, userID)
	if err != nil {
		return HomeSnapshot{}, err
	}
	pending, err := s.ListItems(ctx, userID, RecordFilter{Status: StatusPendingDecision, Limit: 20})
	if err != nil {
		return HomeSnapshot{}, err
	}
	cooling, err := s.ListItems(ctx, userID, RecordFilter{Status: StatusCooling, Limit: 20})
	if err != nil {
		return HomeSnapshot{}, err
	}
	recent, err := s.ListItems(ctx, userID, RecordFilter{Limit: 5})
	if err != nil {
		return HomeSnapshot{}, err
	}
	return HomeSnapshot{
		Stats:     stats,
		Pending:   pending,
		Cooling:   cooling,
		Recent:    recent,
		ServerNow: time.Now().UTC(),
	}, nil
}

func (s *Store) AddEvidence(ctx context.Context, userID string, itemID string, fileURL string, originalName string, size int64) (Evidence, error) {
	if _, err := s.GetItem(ctx, userID, itemID); err != nil {
		return Evidence{}, err
	}
	now := time.Now().UTC()
	evidence := Evidence{
		ID:           uuid.NewString(),
		ItemID:       itemID,
		UserID:       userID,
		FileURL:      fileURL,
		OriginalName: originalName,
		Size:         size,
		CreatedAt:    now,
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Evidence{}, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO cooling_evidence (id, item_id, user_id, file_url, original_name, size, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, evidence.ID, evidence.ItemID, evidence.UserID, evidence.FileURL,
		evidence.OriginalName, evidence.Size, evidence.CreatedAt.Unix())
	if err != nil {
		return Evidence{}, fmt.Errorf("insert cooling evidence: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE cooling_items SET evidence_count = (SELECT COUNT(*) FROM cooling_evidence WHERE item_id = ?), updated_at = ?
		WHERE id = ? AND user_id = ?
	`, itemID, now.Unix(), itemID, userID)
	if err != nil {
		return Evidence{}, fmt.Errorf("update cooling evidence count: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Evidence{}, fmt.Errorf("commit cooling evidence: %w", err)
	}
	return evidence, nil
}

func (s *Store) ListEvidence(ctx context.Context, userID string, itemID string) ([]Evidence, error) {
	if _, err := s.GetItem(ctx, userID, itemID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, file_url, original_name, size, created_at
		FROM cooling_evidence WHERE item_id = ? AND user_id = ? ORDER BY created_at DESC
	`, itemID, userID)
	if err != nil {
		return nil, fmt.Errorf("list cooling evidence: %w", err)
	}
	defer rows.Close()
	var items []Evidence
	for rows.Next() {
		var evidence Evidence
		var createdAt int64
		if err := rows.Scan(&evidence.ID, &evidence.ItemID, &evidence.UserID, &evidence.FileURL,
			&evidence.OriginalName, &evidence.Size, &createdAt); err != nil {
			return nil, err
		}
		evidence.CreatedAt = time.Unix(createdAt, 0).UTC()
		items = append(items, evidence)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if items == nil {
		items = []Evidence{}
	}
	return items, nil
}

func (s *Store) ListEvents(ctx context.Context, userID string, itemID string) ([]Event, error) {
	if _, err := s.GetItem(ctx, userID, itemID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, action, note, created_at
		FROM cooling_events WHERE item_id = ? AND user_id = ? ORDER BY created_at DESC
	`, itemID, userID)
	if err != nil {
		return nil, fmt.Errorf("list cooling events: %w", err)
	}
	defer rows.Close()
	var events []Event
	for rows.Next() {
		var event Event
		var createdAt int64
		if err := rows.Scan(&event.ID, &event.ItemID, &event.UserID, &event.Action,
			&event.Note, &createdAt); err != nil {
			return nil, err
		}
		event.CreatedAt = time.Unix(createdAt, 0).UTC()
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if events == nil {
		events = []Event{}
	}
	return events, nil
}

func (s *Store) ClearData(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM cooling_items WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("clear cooling data: %w", err)
	}
	return nil
}

func (s *Store) insertEvent(ctx context.Context, itemID string, userID string, action string, note string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cooling_events (id, item_id, user_id, action, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), itemID, userID, action, note, now.Unix())
	if err != nil {
		return fmt.Errorf("insert cooling event: %w", err)
	}
	return nil
}

func insertEventTx(ctx context.Context, tx *sql.Tx, itemID string, userID string, action string, note string, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO cooling_events (id, item_id, user_id, action, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), itemID, userID, action, note, now.Unix())
	if err != nil {
		return fmt.Errorf("insert cooling event: %w", err)
	}
	return nil
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func (s *Store) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if count, err := s.MarkExpired(ctx, now.UTC()); err != nil {
				// A transient DB error should not stop the scheduler forever.
				continue
			} else if count > 0 {
				_ = count
			}
		}
	}
}
