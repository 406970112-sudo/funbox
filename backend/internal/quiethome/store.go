package quiethome

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
	ErrInvalidInput      = errors.New("quiet home invalid input")
	ErrNotFound          = errors.New("quiet home not found")
	ErrDatabasePathEmpty = errors.New("quiet home database path is empty")
	ErrNotFriend         = errors.New("quiet home contact is not a friend")
	ErrContactNotAgreed  = errors.New("quiet home contact has not agreed")
	ErrActiveTripExists  = errors.New("quiet home active trip already exists")
)

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
			return nil, fmt.Errorf("create quiet home database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open quiet home database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS quiet_home_settings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			settings_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS quiet_home_trips (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			origin_label TEXT NOT NULL,
			destination_label TEXT NOT NULL,
			eta_at TEXT NOT NULL,
			grace_minutes INTEGER NOT NULL,
			self_reminder_enabled INTEGER NOT NULL,
			contact_reminder_enabled INTEGER NOT NULL,
			arrival_detection_enabled INTEGER NOT NULL,
			late_snapshot_enabled INTEGER NOT NULL,
			contact_user_id TEXT,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			checked_in_at TEXT,
			cancelled_at TEXT,
			late_minutes INTEGER
		)`,
		`CREATE INDEX IF NOT EXISTS idx_quiet_home_trips_user_status
			ON quiet_home_trips(user_id, status, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS quiet_home_contacts (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			contact_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status TEXT NOT NULL,
			channels_json TEXT NOT NULL,
			agreed_at TEXT,
			updated_at TEXT NOT NULL,
			UNIQUE(user_id, contact_user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_quiet_home_contacts_user
			ON quiet_home_contacts(user_id, status)`,
		`CREATE TABLE IF NOT EXISTS quiet_home_notifications (
			id TEXT PRIMARY KEY,
			trip_id TEXT NOT NULL REFERENCES quiet_home_trips(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			target_user_id TEXT NOT NULL,
			channel TEXT NOT NULL,
			status TEXT NOT NULL,
			scheduled_at TEXT NOT NULL,
			sent_at TEXT,
			error TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_quiet_home_notifications_due
			ON quiet_home_notifications(status, scheduled_at)`,
		`CREATE INDEX IF NOT EXISTS idx_quiet_home_notifications_trip
			ON quiet_home_notifications(trip_id, type, scheduled_at)`,
		`CREATE TABLE IF NOT EXISTS quiet_home_location_events (
			id TEXT PRIMARY KEY,
			trip_id TEXT NOT NULL REFERENCES quiet_home_trips(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			used_at TEXT NOT NULL,
			purpose TEXT NOT NULL,
			snapshot INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate quiet home: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateTrip(ctx context.Context, userID string, trip Trip) (Trip, error) {
	trip.ID = strings.TrimSpace(trip.ID)
	if trip.ID == "" {
		trip.ID = uuid.NewString()
	}
	now := time.Now().UTC().Format(time.RFC3339)
	trip.UserID = userID
	trip.Status = TripStatusActive
	trip.CreatedAt = now
	trip.UpdatedAt = now
	if trip.ETAAt == "" {
		return Trip{}, fmt.Errorf("%w: eta required", ErrInvalidInput)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO quiet_home_trips (
			id, user_id, origin_label, destination_label, eta_at, grace_minutes,
			self_reminder_enabled, contact_reminder_enabled, arrival_detection_enabled,
			late_snapshot_enabled, contact_user_id, status, created_at, updated_at,
			checked_in_at, cancelled_at, late_minutes
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
	`,
		trip.ID, userID, trip.OriginLabel, trip.DestinationLabel, trip.ETAAt, trip.GraceMinutes,
		boolInt(trip.SelfReminderEnabled), boolInt(trip.ContactReminderEnabled),
		boolInt(trip.ArrivalDetectionEnabled), boolInt(trip.LateSnapshotEnabled),
		nullableText(trip.ContactUserID), trip.Status, trip.CreatedAt, trip.UpdatedAt,
	); err != nil {
		return Trip{}, fmt.Errorf("create quiet home trip: %w", err)
	}
	return trip, nil
}

func (s *Store) GetActiveTrip(ctx context.Context, userID string) (*Trip, error) {
	trip, err := s.GetTripByUserAndStatus(ctx, userID, TripStatusActive)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return trip, err
}

func (s *Store) GetTrip(ctx context.Context, userID, id string) (Trip, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, origin_label, destination_label, eta_at, grace_minutes,
		       self_reminder_enabled, contact_reminder_enabled, arrival_detection_enabled,
		       late_snapshot_enabled, contact_user_id, status, created_at, updated_at,
		       checked_in_at, cancelled_at, late_minutes
		FROM quiet_home_trips
		WHERE id = ? AND user_id = ?
	`, id, userID)
	return scanTrip(row)
}

func (s *Store) GetTripByUserAndStatus(ctx context.Context, userID string, status TripStatus) (*Trip, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, origin_label, destination_label, eta_at, grace_minutes,
		       self_reminder_enabled, contact_reminder_enabled, arrival_detection_enabled,
		       late_snapshot_enabled, contact_user_id, status, created_at, updated_at,
		       checked_in_at, cancelled_at, late_minutes
		FROM quiet_home_trips
		WHERE user_id = ? AND status = ?
		ORDER BY created_at DESC
		LIMIT 1
	`, userID, status)
	trip, err := scanTrip(row)
	if err != nil {
		return nil, err
	}
	return &trip, nil
}

func (s *Store) UpdateTrip(ctx context.Context, trip Trip) (Trip, error) {
	trip.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.ExecContext(ctx, `
		UPDATE quiet_home_trips
		SET origin_label = ?, destination_label = ?, eta_at = ?, grace_minutes = ?,
		    self_reminder_enabled = ?, contact_reminder_enabled = ?,
		    arrival_detection_enabled = ?, late_snapshot_enabled = ?,
		    contact_user_id = ?, status = ?, updated_at = ?, checked_in_at = ?,
		    cancelled_at = ?, late_minutes = ?
		WHERE id = ? AND user_id = ?
	`,
		trip.OriginLabel, trip.DestinationLabel, trip.ETAAt, trip.GraceMinutes,
		boolInt(trip.SelfReminderEnabled), boolInt(trip.ContactReminderEnabled),
		boolInt(trip.ArrivalDetectionEnabled), boolInt(trip.LateSnapshotEnabled),
		nullableText(trip.ContactUserID), trip.Status, trip.UpdatedAt,
		nullableText(pointerString(trip.CheckedInAt)), nullableText(pointerString(trip.CancelledAt)),
		nullableInt(trip.LateMinutes), trip.ID, trip.UserID,
	)
	if err != nil {
		return Trip{}, fmt.Errorf("update quiet home trip: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return Trip{}, fmt.Errorf("%w: trip %s", ErrNotFound, trip.ID)
	}
	return trip, nil
}

func (s *Store) ListHistory(ctx context.Context, userID string) ([]Trip, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, origin_label, destination_label, eta_at, grace_minutes,
		       self_reminder_enabled, contact_reminder_enabled, arrival_detection_enabled,
		       late_snapshot_enabled, contact_user_id, status, created_at, updated_at,
		       checked_in_at, cancelled_at, late_minutes
		FROM quiet_home_trips
		WHERE user_id = ? AND status IN ('checked_in', 'cancelled', 'expired')
		ORDER BY updated_at DESC, created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list quiet home history: %w", err)
	}
	defer rows.Close()
	items := make([]Trip, 0)
	for rows.Next() {
		trip, err := scanTrip(rows)
		if err != nil {
			return nil, fmt.Errorf("scan quiet home history: %w", err)
		}
		items = append(items, trip)
	}
	return items, rows.Err()
}

func (s *Store) ClearHistory(ctx context.Context, userID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM quiet_home_trips
		WHERE user_id = ? AND status IN ('checked_in', 'cancelled', 'expired')
	`, userID); err != nil {
		return fmt.Errorf("clear quiet home history: %w", err)
	}
	return nil
}

func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT settings_json FROM quiet_home_settings WHERE user_id = ?
	`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("get quiet home settings: %w", err)
	}
	var settings Settings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return Settings{}, fmt.Errorf("decode quiet home settings: %w", err)
	}
	return settings, nil
}

func (s *Store) SaveSettings(ctx context.Context, settings Settings) (Settings, error) {
	settings.UpdatedAt = time.Now().UnixMilli()
	raw, err := json.Marshal(settings)
	if err != nil {
		return Settings{}, fmt.Errorf("encode quiet home settings: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO quiet_home_settings (user_id, settings_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			settings_json = excluded.settings_json,
			updated_at = excluded.updated_at
	`, settings.UserID, string(raw), settings.UpdatedAt); err != nil {
		return Settings{}, fmt.Errorf("save quiet home settings: %w", err)
	}
	return settings, nil
}

func (s *Store) ListContacts(ctx context.Context, userID string) ([]Contact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, contact_user_id, status, channels_json, agreed_at, updated_at
		FROM quiet_home_contacts
		WHERE user_id = ? OR contact_user_id = ?
		ORDER BY updated_at DESC
	`, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("list quiet home contacts: %w", err)
	}
	defer rows.Close()
	items := make([]Contact, 0)
	for rows.Next() {
		var item Contact
		var channels string
		var agreedAt sql.NullString
		if err := rows.Scan(
			&item.ID, &item.UserID, &item.ContactUserID, &item.Status,
			&channels, &agreedAt, &item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan quiet home contact: %w", err)
		}
		_ = json.Unmarshal([]byte(channels), &item.Channels)
		if agreedAt.Valid {
			value := agreedAt.String
			item.AgreedAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetContactPair(ctx context.Context, userID, contactUserID string) (Contact, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, contact_user_id, status, channels_json, agreed_at, updated_at
		FROM quiet_home_contacts
		WHERE (user_id = ? AND contact_user_id = ?)
		   OR (user_id = ? AND contact_user_id = ?)
		LIMIT 1
	`, userID, contactUserID, contactUserID, userID)
	var item Contact
	var channels string
	var agreedAt sql.NullString
	if err := row.Scan(
		&item.ID, &item.UserID, &item.ContactUserID, &item.Status,
		&channels, &agreedAt, &item.UpdatedAt,
	); err != nil {
		return Contact{}, err
	}
	_ = json.Unmarshal([]byte(channels), &item.Channels)
	if agreedAt.Valid {
		value := agreedAt.String
		item.AgreedAt = &value
	}
	return item, nil
}

func (s *Store) UpsertContact(ctx context.Context, item Contact) (Contact, error) {
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	if item.Channels == nil {
		item.Channels = []string{"in_app"}
	}
	item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if item.Status == ContactStatusAgreed && item.AgreedAt == nil {
		value := item.UpdatedAt
		item.AgreedAt = &value
	}
	rawChannels, err := json.Marshal(item.Channels)
	if err != nil {
		return Contact{}, fmt.Errorf("encode quiet home channels: %w", err)
	}
	_, err = s.db.ExecContext(
		ctx,
		`INSERT INTO quiet_home_contacts (
			id, user_id, contact_user_id, status, channels_json, agreed_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, contact_user_id) DO UPDATE SET
			status = excluded.status,
			channels_json = excluded.channels_json,
			agreed_at = COALESCE(excluded.agreed_at, quiet_home_contacts.agreed_at),
			updated_at = excluded.updated_at`,
		item.ID,
		item.UserID,
		item.ContactUserID,
		item.Status,
		string(rawChannels),
		nullableText(pointerString(item.AgreedAt)),
		item.UpdatedAt,
	)
	if err != nil {
		return Contact{}, fmt.Errorf("upsert quiet home contact: %w", err)
	}
	return item, nil
}

func (s *Store) DeleteContactPair(ctx context.Context, userID, contactUserID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM quiet_home_contacts
		WHERE (user_id = ? AND contact_user_id = ?)
		   OR (user_id = ? AND contact_user_id = ?)
	`, userID, contactUserID, contactUserID, userID); err != nil {
		return fmt.Errorf("delete quiet home contact: %w", err)
	}
	return nil
}

func (s *Store) ListNotificationsForTrip(ctx context.Context, tripID string) ([]Notification, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, trip_id, type, target_user_id, channel, status, scheduled_at, sent_at, error
		FROM quiet_home_notifications
		WHERE trip_id = ?
		ORDER BY scheduled_at ASC
	`, tripID)
	if err != nil {
		return nil, fmt.Errorf("list quiet home notifications: %w", err)
	}
	defer rows.Close()
	items := make([]Notification, 0)
	for rows.Next() {
		var item Notification
		var sentAt sql.NullString
		var errText sql.NullString
		if err := rows.Scan(
			&item.ID, &item.TripID, &item.Type, &item.TargetUserID, &item.Channel,
			&item.Status, &item.ScheduledAt, &sentAt, &errText,
		); err != nil {
			return nil, fmt.Errorf("scan quiet home notification: %w", err)
		}
		if sentAt.Valid {
			value := sentAt.String
			item.SentAt = &value
		}
		if errText.Valid {
			item.Error = errText.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) AddNotification(ctx context.Context, item Notification) (Notification, error) {
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO quiet_home_notifications (
			id, trip_id, type, target_user_id, channel, status, scheduled_at, sent_at, error
		) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
	`,
		item.ID, item.TripID, item.Type, item.TargetUserID, item.Channel, item.Status, item.ScheduledAt,
	)
	if err != nil {
		return Notification{}, fmt.Errorf("add quiet home notification: %w", err)
	}
	return item, nil
}

func (s *Store) ListDueNotifications(ctx context.Context, now time.Time) ([]Notification, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, trip_id, type, target_user_id, channel, status, scheduled_at, sent_at, error
		FROM quiet_home_notifications
		WHERE status = 'pending' AND scheduled_at <= ?
		ORDER BY scheduled_at ASC
	`, now.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("list due quiet home notifications: %w", err)
	}
	defer rows.Close()
	items := make([]Notification, 0)
	for rows.Next() {
		var item Notification
		var sentAt sql.NullString
		var errText sql.NullString
		if err := rows.Scan(
			&item.ID, &item.TripID, &item.Type, &item.TargetUserID, &item.Channel,
			&item.Status, &item.ScheduledAt, &sentAt, &errText,
		); err != nil {
			return nil, fmt.Errorf("scan due quiet home notification: %w", err)
		}
		if sentAt.Valid {
			value := sentAt.String
			item.SentAt = &value
		}
		if errText.Valid {
			item.Error = errText.String
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) MarkNotification(ctx context.Context, id string, status NotificationStatus, errText string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.ExecContext(ctx, `
		UPDATE quiet_home_notifications
		SET status = ?, sent_at = COALESCE(sent_at, ?), error = ?
		WHERE id = ?
	`, status, now, errText, id)
	if err != nil {
		return fmt.Errorf("mark quiet home notification: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("%w: notification %s", ErrNotFound, id)
	}
	return nil
}

func (s *Store) DeletePendingNotificationsForTrip(ctx context.Context, tripID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM quiet_home_notifications
		WHERE trip_id = ? AND status = 'pending'
	`, tripID); err != nil {
		return fmt.Errorf("delete pending quiet home notifications: %w", err)
	}
	return nil
}

func (s *Store) AddLocationEvent(ctx context.Context, userID, tripID, purpose string, snapshot bool) (LocationEvent, error) {
	item := LocationEvent{
		ID:       uuid.NewString(),
		TripID:   tripID,
		UsedAt:   time.Now().UTC().Format(time.RFC3339),
		Purpose:  purpose,
		Snapshot: snapshot,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO quiet_home_location_events (id, trip_id, user_id, used_at, purpose, snapshot)
		VALUES (?, ?, ?, ?, ?, ?)
	`, item.ID, tripID, userID, item.UsedAt, item.Purpose, boolInt(snapshot)); err != nil {
		return LocationEvent{}, fmt.Errorf("add quiet home location event: %w", err)
	}
	return item, nil
}

func (s *Store) ListLocationEvents(ctx context.Context, userID string) ([]LocationEvent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, trip_id, used_at, purpose, snapshot
		FROM quiet_home_location_events
		WHERE user_id = ?
		ORDER BY used_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list quiet home location events: %w", err)
	}
	defer rows.Close()
	items := make([]LocationEvent, 0)
	for rows.Next() {
		var item LocationEvent
		if err := rows.Scan(&item.ID, &item.TripID, &item.UsedAt, &item.Purpose, &item.Snapshot); err != nil {
			return nil, fmt.Errorf("scan quiet home location event: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ActiveTripCount(ctx context.Context, userID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM quiet_home_trips
		WHERE user_id = ? AND status = 'active'
	`, userID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count quiet home active trips: %w", err)
	}
	return count, nil
}

func (s *Store) ListActiveTrips(ctx context.Context) ([]Trip, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, origin_label, destination_label, eta_at, grace_minutes,
		       self_reminder_enabled, contact_reminder_enabled, arrival_detection_enabled,
		       late_snapshot_enabled, contact_user_id, status, created_at, updated_at,
		       checked_in_at, cancelled_at, late_minutes
		FROM quiet_home_trips
		WHERE status = 'active'
		ORDER BY eta_at ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list active quiet home trips: %w", err)
	}
	defer rows.Close()
	items := make([]Trip, 0)
	for rows.Next() {
		trip, err := scanTrip(rows)
		if err != nil {
			return nil, fmt.Errorf("scan active quiet home trip: %w", err)
		}
		items = append(items, trip)
	}
	return items, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTrip(row scanner) (Trip, error) {
	var item Trip
	var selfReminder int
	var contactReminder int
	var arrivalDetection int
	var lateSnapshot int
	var contactUserID sql.NullString
	var checkedInAt sql.NullString
	var cancelledAt sql.NullString
	var lateMinutes sql.NullInt64
	if err := row.Scan(
		&item.ID, &item.UserID, &item.OriginLabel, &item.DestinationLabel, &item.ETAAt,
		&item.GraceMinutes, &selfReminder, &contactReminder, &arrivalDetection, &lateSnapshot,
		&contactUserID, &item.Status, &item.CreatedAt, &item.UpdatedAt,
		&checkedInAt, &cancelledAt, &lateMinutes,
	); err != nil {
		return Trip{}, err
	}
	item.SelfReminderEnabled = selfReminder != 0
	item.ContactReminderEnabled = contactReminder != 0
	item.ArrivalDetectionEnabled = arrivalDetection != 0
	item.LateSnapshotEnabled = lateSnapshot != 0
	if contactUserID.Valid {
		item.ContactUserID = contactUserID.String
	}
	if checkedInAt.Valid {
		value := checkedInAt.String
		item.CheckedInAt = &value
	}
	if cancelledAt.Valid {
		value := cancelledAt.String
		item.CancelledAt = &value
	}
	if lateMinutes.Valid {
		value := int(lateMinutes.Int64)
		item.LateMinutes = &value
	}
	return item, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
