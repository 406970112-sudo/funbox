package homerecommendation

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

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	if strings.TrimSpace(databasePath) == "" {
		return nil, errors.New("database path is required")
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create home recommendation database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open home recommendation database: %w", err)
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
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS home_recommendation_slots (
			id TEXT PRIMARY KEY,
			feature_id TEXT NOT NULL,
			feature_kind TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			starts_on TEXT,
			ends_on TEXT,
			weekdays TEXT NOT NULL DEFAULT '[]',
			title_override TEXT NOT NULL DEFAULT '',
			description_override TEXT NOT NULL DEFAULT '',
			cta_label_override TEXT NOT NULL DEFAULT '',
			created_by TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_by TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_recommendation_slots_order
			ON home_recommendation_slots(sort_order, enabled)`,
		`CREATE TABLE IF NOT EXISTS home_recommendation_events (
			id TEXT PRIMARY KEY,
			slot_id TEXT NOT NULL,
			feature_id TEXT NOT NULL DEFAULT '',
			user_id TEXT NOT NULL,
			event_date TEXT NOT NULL,
			event_type TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE (user_id, event_date, slot_id, event_type)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_recommendation_events_slot
			ON home_recommendation_events(slot_id, event_date)`,
		`CREATE TABLE IF NOT EXISTS home_recommendation_audit_log (
			id TEXT PRIMARY KEY,
			admin_id TEXT NOT NULL,
			action TEXT NOT NULL,
			slot_id TEXT NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_recommendation_audit_created
			ON home_recommendation_audit_log(created_at DESC)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run home recommendation migration: %w", err)
		}
	}
	if err := s.ensureEventFeatureIDColumn(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureEventFeatureIDColumn() error {
	rows, err := s.db.Query(`PRAGMA table_info(home_recommendation_events)`)
	if err != nil {
		return fmt.Errorf("inspect home recommendation events table: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return fmt.Errorf("scan home recommendation events column: %w", err)
		}
		if name == "feature_id" {
			return nil
		}
	}
	if _, err := s.db.Exec(
		`ALTER TABLE home_recommendation_events ADD COLUMN feature_id TEXT NOT NULL DEFAULT ''`,
	); err != nil {
		return fmt.Errorf("add home recommendation event feature column: %w", err)
	}
	return nil
}

func (s *Store) CreateSlot(
	ctx context.Context,
	slot Slot,
) (Slot, error) {
	weekdaysJSON, err := json.Marshal(slot.Weekdays)
	if err != nil {
		return Slot{}, fmt.Errorf("marshal slot weekdays: %w", err)
	}
	now := time.Now().UTC()
	if slot.ID == "" {
		slot.ID = uuid.NewString()
	}
	slot.CreatedAt = now
	slot.UpdatedAt = now

	_, err = s.db.ExecContext(
		ctx,
		`INSERT INTO home_recommendation_slots (
			id, feature_id, feature_kind, enabled, sort_order, starts_on, ends_on, weekdays,
			title_override, description_override, cta_label_override,
			created_by, created_at, updated_by, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		slot.ID,
		slot.FeatureID,
		slot.FeatureKind,
		boolToInt(slot.Enabled),
		slot.SortOrder,
		slot.StartsOn,
		slot.EndsOn,
		string(weekdaysJSON),
		slot.TitleOverride,
		slot.DescriptionOverride,
		slot.CTALabelOverride,
		slot.CreatedBy,
		slot.CreatedAt.Unix(),
		slot.UpdatedBy,
		slot.UpdatedAt.Unix(),
	)
	if err != nil {
		return Slot{}, fmt.Errorf("insert home recommendation slot: %w", err)
	}
	return slot, nil
}

func (s *Store) UpdateSlot(
	ctx context.Context,
	slot Slot,
) (Slot, error) {
	weekdaysJSON, err := json.Marshal(slot.Weekdays)
	if err != nil {
		return Slot{}, fmt.Errorf("marshal slot weekdays: %w", err)
	}
	slot.UpdatedAt = time.Now().UTC()

	result, err := s.db.ExecContext(
		ctx,
		`UPDATE home_recommendation_slots
		 SET feature_id = ?, feature_kind = ?, enabled = ?, sort_order = ?,
		     starts_on = ?, ends_on = ?, weekdays = ?,
		     title_override = ?, description_override = ?, cta_label_override = ?,
		     updated_by = ?, updated_at = ?
		 WHERE id = ?`,
		slot.FeatureID,
		slot.FeatureKind,
		boolToInt(slot.Enabled),
		slot.SortOrder,
		slot.StartsOn,
		slot.EndsOn,
		string(weekdaysJSON),
		slot.TitleOverride,
		slot.DescriptionOverride,
		slot.CTALabelOverride,
		slot.UpdatedBy,
		slot.UpdatedAt.Unix(),
		slot.ID,
	)
	if err != nil {
		return Slot{}, fmt.Errorf("update home recommendation slot: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Slot{}, fmt.Errorf("read home recommendation update result: %w", err)
	}
	if affected == 0 {
		return Slot{}, ErrSlotNotFound
	}
	return slot, nil
}

func (s *Store) DeleteSlot(ctx context.Context, slotID string) error {
	result, err := s.db.ExecContext(
		ctx,
		`DELETE FROM home_recommendation_slots WHERE id = ?`,
		slotID,
	)
	if err != nil {
		return fmt.Errorf("delete home recommendation slot: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read home recommendation delete result: %w", err)
	}
	if affected == 0 {
		return ErrSlotNotFound
	}
	return nil
}

func (s *Store) ListSlots(ctx context.Context) ([]Slot, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, feature_id, feature_kind, enabled, sort_order, starts_on, ends_on, weekdays,
		        title_override, description_override, cta_label_override,
		        created_by, created_at, updated_by, updated_at
		 FROM home_recommendation_slots
		 ORDER BY sort_order ASC, rowid ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list home recommendation slots: %w", err)
	}
	defer rows.Close()

	slots := make([]Slot, 0, 16)
	for rows.Next() {
		slot, err := scanSlot(rows)
		if err != nil {
			return nil, err
		}
		slots = append(slots, slot)
	}
	return slots, rows.Err()
}

func (s *Store) GetSlot(ctx context.Context, slotID string) (Slot, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT id, feature_id, feature_kind, enabled, sort_order, starts_on, ends_on, weekdays,
		        title_override, description_override, cta_label_override,
		        created_by, created_at, updated_by, updated_at
		 FROM home_recommendation_slots
		 WHERE id = ?`,
		slotID,
	)
	slot, err := scanSlot(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Slot{}, ErrSlotNotFound
	}
	if err != nil {
		return Slot{}, fmt.Errorf("get home recommendation slot: %w", err)
	}
	return slot, nil
}

func (s *Store) ReorderSlots(ctx context.Context, orders map[string]int, adminID string) error {
	now := time.Now().UTC().Unix()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin home recommendation reorder: %w", err)
	}
	defer tx.Rollback()

	for slotID, order := range orders {
		result, err := tx.ExecContext(
			ctx,
			`UPDATE home_recommendation_slots
			 SET sort_order = ?, updated_by = ?, updated_at = ?
			 WHERE id = ?`,
			order,
			adminID,
			now,
			slotID,
		)
		if err != nil {
			return fmt.Errorf("reorder home recommendation slot: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read home recommendation reorder result: %w", err)
		}
		if affected == 0 {
			return ErrSlotNotFound
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit home recommendation reorder: %w", err)
	}
	return nil
}

func (s *Store) EnabledSlotCount(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM home_recommendation_slots WHERE enabled = 1`,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count enabled home recommendation slots: %w", err)
	}
	return count, nil
}

func (s *Store) RecordEvent(
	ctx context.Context,
	slotID string,
	featureID string,
	userID string,
	eventDate string,
	eventType string,
) error {
	now := time.Now().UTC()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO home_recommendation_events (
			id, slot_id, feature_id, user_id, event_date, event_type, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		uuid.NewString(),
		slotID,
		featureID,
		userID,
		eventDate,
		eventType,
		now.Unix(),
	)
	if err != nil {
		return fmt.Errorf("record home recommendation event: %w", err)
	}
	return nil
}

func (s *Store) Stats(ctx context.Context, sinceDate string) ([]SlotStats, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT slot_id,
		        MAX(feature_id),
		        SUM(CASE WHEN event_type = 'view' THEN 1 ELSE 0 END),
		        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END)
		 FROM home_recommendation_events
		 WHERE event_date >= ?
		 GROUP BY slot_id
		 ORDER BY SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) DESC,
		          MAX(feature_id) DESC`,
		sinceDate,
	)
	if err != nil {
		return nil, fmt.Errorf("list home recommendation stats: %w", err)
	}
	defer rows.Close()

	stats := make([]SlotStats, 0, 16)
	for rows.Next() {
		var item SlotStats
		var views int
		var clicks int
		if err := rows.Scan(&item.SlotID, &item.FeatureID, &views, &clicks); err != nil {
			return nil, fmt.Errorf("scan home recommendation stats: %w", err)
		}
		item.Views = views
		item.Clicks = clicks
		if views > 0 {
			item.ClickRate = float64(clicks) / float64(views)
		}
		stats = append(stats, item)
	}
	return stats, rows.Err()
}

func (s *Store) AppendAudit(
	ctx context.Context,
	adminID string,
	action string,
	slotID string,
	detail string,
) error {
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO home_recommendation_audit_log (
			id, admin_id, action, slot_id, detail, created_at
		) VALUES (?, ?, ?, ?, ?, ?)`,
		uuid.NewString(),
		adminID,
		action,
		slotID,
		detail,
		time.Now().UTC().Unix(),
	)
	if err != nil {
		return fmt.Errorf("append home recommendation audit: %w", err)
	}
	return nil
}

func (s *Store) AuditLog(ctx context.Context, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, admin_id, action, slot_id, detail, created_at
		 FROM home_recommendation_audit_log
		 ORDER BY created_at DESC, rowid DESC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list home recommendation audit: %w", err)
	}
	defer rows.Close()

	entries := make([]AuditEntry, 0, limit)
	for rows.Next() {
		var entry AuditEntry
		var createdAt int64
		if err := rows.Scan(
			&entry.ID,
			&entry.AdminID,
			&entry.Action,
			&entry.SlotID,
			&entry.Detail,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan home recommendation audit: %w", err)
		}
		entry.CreatedAt = time.Unix(createdAt, 0).UTC()
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSlot(scanner rowScanner) (Slot, error) {
	var slot Slot
	var enabled int
	var createdAt int64
	var updatedAt int64
	var weekdaysJSON string
	if err := scanner.Scan(
		&slot.ID,
		&slot.FeatureID,
		&slot.FeatureKind,
		&enabled,
		&slot.SortOrder,
		&slot.StartsOn,
		&slot.EndsOn,
		&weekdaysJSON,
		&slot.TitleOverride,
		&slot.DescriptionOverride,
		&slot.CTALabelOverride,
		&slot.CreatedBy,
		&createdAt,
		&slot.UpdatedBy,
		&updatedAt,
	); err != nil {
		return Slot{}, err
	}
	slot.Enabled = enabled == 1
	slot.CreatedAt = time.Unix(createdAt, 0).UTC()
	slot.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if err := json.Unmarshal([]byte(weekdaysJSON), &slot.Weekdays); err != nil {
		return Slot{}, fmt.Errorf("decode slot weekdays: %w", err)
	}
	return slot, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
