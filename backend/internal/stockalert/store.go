package stockalert

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
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
	db  *sql.DB
	key []byte
}

func OpenStore(databasePath string, secret string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create stock alert database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open stock alert database: %w", err)
	}
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	sum := sha256.Sum256([]byte(secret))
	store.key = sum[:]
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS stock_watch_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			symbol_code TEXT NOT NULL,
			name TEXT NOT NULL,
			market TEXT NOT NULL,
			secid TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			reminder_types TEXT NOT NULL DEFAULT 'buy,sell,stop',
			analysis_id TEXT,
			valid_until TEXT,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_analyses (
			id TEXT PRIMARY KEY,
			watch_item_id TEXT NOT NULL,
			model TEXT NOT NULL,
			data_end_date TEXT NOT NULL,
			buy_trigger REAL NOT NULL,
			buy_low REAL NOT NULL,
			buy_high REAL NOT NULL,
			sell_trigger REAL NOT NULL,
			sell_low REAL NOT NULL,
			sell_high REAL NOT NULL,
			stop_loss REAL NOT NULL,
			valid_trading_days INTEGER NOT NULL,
			reasons_json TEXT NOT NULL,
			summary TEXT NOT NULL,
			conditions_json TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_alert_events (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			watch_item_id TEXT NOT NULL,
			symbol_code TEXT NOT NULL,
			name TEXT NOT NULL,
			direction TEXT NOT NULL,
			signal_strength TEXT NOT NULL,
			trigger_time TEXT NOT NULL,
			trigger_price REAL NOT NULL,
			avg_price REAL NOT NULL,
			conditions_json TEXT NOT NULL,
			pushed INTEGER NOT NULL DEFAULT 0,
			pushed_message TEXT NOT NULL DEFAULT '',
			read_at TEXT,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_alert_settings (
			user_id TEXT PRIMARY KEY,
			sendkey_encrypted TEXT NOT NULL DEFAULT '',
			reminder_enabled INTEGER NOT NULL DEFAULT 1,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS stock_reminders (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			watch_item_id TEXT NOT NULL,
			symbol_code TEXT NOT NULL,
			name TEXT NOT NULL,
			rule_type TEXT NOT NULL,
			direction TEXT NOT NULL,
			threshold REAL NOT NULL DEFAULT 0,
			time_range TEXT NOT NULL DEFAULT '09:30-15:00',
			valid_days INTEGER NOT NULL DEFAULT 5,
			channels TEXT NOT NULL DEFAULT '["app","serverchan"]',
			enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(context.Background(), statement); err != nil {
			return fmt.Errorf("migrate stock alert database: %w", err)
		}
	}
	if err := s.ensureColumn("stock_alert_events", "reminder_id", "TEXT"); err != nil {
		return err
	}
	if err := s.ensureColumn("stock_alert_events", "reminder_label", "TEXT"); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureColumn(table string, column string, columnType string) error {
	rows, err := s.db.QueryContext(context.Background(), `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name == column {
			return rows.Err()
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = s.db.ExecContext(context.Background(),
		`ALTER TABLE `+table+` ADD COLUMN `+column+` `+columnType)
	return err
}

func (s *Store) CountWatchItems(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM stock_watch_items WHERE user_id = ?`, userID,
	).Scan(&count)
	return count, err
}

func (s *Store) AddWatchItem(ctx context.Context, item WatchItem) error {
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	item.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO stock_watch_items (
			id, user_id, symbol_code, name, market, secid, enabled, reminder_types, analysis_id, valid_until, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		item.ID,
		item.UserID,
		item.SymbolCode,
		item.Name,
		item.Market,
		item.SecID,
		boolToInt(item.Enabled),
		strings.Join(item.ReminderTypes, ","),
		item.AnalysisIDOrEmpty(),
		item.ValidUntil,
		item.CreatedAt.Format(time.RFC3339),
	)
	return err
}

func (s *Store) ListWatchItems(ctx context.Context, userID string) ([]WatchItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, symbol_code, name, market, secid, enabled, reminder_types, analysis_id, valid_until, created_at
		FROM stock_watch_items WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]WatchItem, 0)
	for rows.Next() {
		item, err := scanWatchItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListAllWatchItems(ctx context.Context) ([]WatchItem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, symbol_code, name, market, secid, enabled, reminder_types, analysis_id, valid_until, created_at
		FROM stock_watch_items ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]WatchItem, 0)
	for rows.Next() {
		item, err := scanWatchItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetWatchItem(ctx context.Context, userID string, symbolCode string) (WatchItem, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, symbol_code, name, market, secid, enabled, reminder_types, analysis_id, valid_until, created_at
		FROM stock_watch_items WHERE user_id = ? AND symbol_code = ?`, userID, symbolCode)
	item, err := scanWatchItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return WatchItem{}, ErrNotFound
	}
	return item, err
}

func (s *Store) UpdateWatchItem(ctx context.Context, userID string, symbolCode string, enabled *bool, reminderTypes []string) (WatchItem, error) {
	item, err := s.GetWatchItem(ctx, userID, symbolCode)
	if err != nil {
		return WatchItem{}, err
	}
	if enabled != nil {
		item.Enabled = *enabled
	}
	if len(reminderTypes) > 0 {
		item.ReminderTypes = reminderTypes
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE stock_watch_items SET enabled = ?, reminder_types = ? WHERE id = ?`,
		boolToInt(item.Enabled), strings.Join(item.ReminderTypes, ","), item.ID,
	)
	return item, err
}

func (s *Store) DeleteWatchItem(ctx context.Context, userID string, symbolCode string) error {
	item, err := s.GetWatchItem(ctx, userID, symbolCode)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM stock_watch_items WHERE id = ?`, item.ID); err != nil {
		return err
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM stock_analyses WHERE watch_item_id = ?`, item.ID)
	_, _ = s.db.ExecContext(ctx, `DELETE FROM stock_reminders WHERE watch_item_id = ?`, item.ID)
	return nil
}

func (s *Store) ListReminders(ctx context.Context, userID string) ([]Reminder, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, watch_item_id, symbol_code, name, rule_type, direction, threshold,
			time_range, valid_days, channels, enabled, created_at, updated_at
		FROM stock_reminders WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reminders := make([]Reminder, 0)
	for rows.Next() {
		reminder, err := scanReminder(rows)
		if err != nil {
			return nil, err
		}
		reminders = append(reminders, reminder)
	}
	return reminders, rows.Err()
}

func (s *Store) ListRemindersByWatchItem(ctx context.Context, userID string, watchItemID string) ([]Reminder, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, watch_item_id, symbol_code, name, rule_type, direction, threshold,
			time_range, valid_days, channels, enabled, created_at, updated_at
		FROM stock_reminders WHERE user_id = ? AND watch_item_id = ? ORDER BY created_at DESC`,
		userID, watchItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reminders := make([]Reminder, 0)
	for rows.Next() {
		reminder, err := scanReminder(rows)
		if err != nil {
			return nil, err
		}
		reminders = append(reminders, reminder)
	}
	return reminders, rows.Err()
}

func (s *Store) GetReminder(ctx context.Context, userID string, reminderID string) (Reminder, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, watch_item_id, symbol_code, name, rule_type, direction, threshold,
			time_range, valid_days, channels, enabled, created_at, updated_at
		FROM stock_reminders WHERE id = ? AND user_id = ?`, reminderID, userID)
	reminder, err := scanReminder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Reminder{}, ErrNotFound
	}
	return reminder, err
}

func (s *Store) CreateReminder(ctx context.Context, reminder Reminder) error {
	channels, _ := marshalStringList(reminder.Channels)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO stock_reminders (
			id, user_id, watch_item_id, symbol_code, name, rule_type, direction, threshold,
			time_range, valid_days, channels, enabled, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		reminder.ID, reminder.UserID, reminder.WatchItemID, reminder.SymbolCode, reminder.Name,
		reminder.RuleType, reminder.Direction, reminder.Threshold, reminder.TimeRange,
		reminder.ValidDays, channels, boolToInt(reminder.Enabled),
		reminder.CreatedAt.Format(time.RFC3339), reminder.UpdatedAt.Format(time.RFC3339),
	)
	return err
}

func (s *Store) UpdateReminder(ctx context.Context, reminder Reminder) error {
	channels, _ := marshalStringList(reminder.Channels)
	_, err := s.db.ExecContext(ctx, `
		UPDATE stock_reminders SET
			rule_type = ?, direction = ?, threshold = ?, time_range = ?, valid_days = ?,
			channels = ?, enabled = ?, updated_at = ?
		WHERE id = ? AND user_id = ?`,
		reminder.RuleType, reminder.Direction, reminder.Threshold, reminder.TimeRange,
		reminder.ValidDays, channels, boolToInt(reminder.Enabled),
		reminder.UpdatedAt.Format(time.RFC3339), reminder.ID, reminder.UserID,
	)
	return err
}

func (s *Store) DeleteReminder(ctx context.Context, userID string, reminderID string) error {
	result, err := s.db.ExecContext(ctx,
		`DELETE FROM stock_reminders WHERE id = ? AND user_id = ?`, reminderID, userID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AttachAnalysis(ctx context.Context, watchItemID string, analysis Analysis, validUntil string) error {
	analysis.ID = uuid.NewString()
	analysis.CreatedAt = time.Now()
	conditions, _ := marshalConditions(analysis.Rule)
	reasons, _ := marshalStringList(analysis.Rule.Reasons)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		DELETE FROM stock_analyses WHERE watch_item_id = ?`, watchItemID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO stock_analyses (
			id, watch_item_id, model, data_end_date, buy_trigger, buy_low, buy_high,
			sell_trigger, sell_low, sell_high, stop_loss, valid_trading_days,
			reasons_json, summary, conditions_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		analysis.ID,
		watchItemID,
		analysis.Model,
		analysis.DataEndDate,
		analysis.Rule.BuyTrigger,
		analysis.Rule.BuyReferenceLow,
		analysis.Rule.BuyReferenceHigh,
		analysis.Rule.SellTrigger,
		analysis.Rule.SellReferenceLow,
		analysis.Rule.SellReferenceHigh,
		analysis.Rule.StopLoss,
		analysis.Rule.ValidTradingDays,
		reasons,
		analysis.Rule.Summary,
		conditions,
		analysis.CreatedAt.Format(time.RFC3339),
	)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE stock_watch_items SET analysis_id = ?, valid_until = ? WHERE id = ?`,
		analysis.ID, validUntil, watchItemID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CountAnalysesToday(ctx context.Context, userID string, date string) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM stock_analyses a
		JOIN stock_watch_items w ON a.watch_item_id = w.id
		WHERE w.user_id = ? AND substr(a.created_at, 1, 10) = ?`,
		userID, date,
	).Scan(&count)
	return count, err
}

func (s *Store) GetAnalysis(ctx context.Context, watchItemID string) (*Analysis, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, watch_item_id, model, data_end_date, buy_trigger, buy_low, buy_high,
			sell_trigger, sell_low, sell_high, stop_loss, valid_trading_days,
			reasons_json, summary, conditions_json, created_at
		FROM stock_analyses WHERE watch_item_id = ?`, watchItemID)
	analysis, err := scanAnalysis(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &analysis, err
}

func (s *Store) AddEvent(ctx context.Context, event AlertEvent) error {
	conditions, _ := marshalStringList(event.Conditions)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO stock_alert_events (
			id, user_id, watch_item_id, reminder_id, reminder_label, symbol_code, name, direction, signal_strength,
			trigger_time, trigger_price, avg_price, conditions_json, pushed, pushed_message, read_at, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.ID,
		event.UserID,
		event.WatchItemID,
		nullableString(event.ReminderID),
		nullableString(event.ReminderLabel),
		event.SymbolCode,
		event.Name,
		event.Direction,
		event.SignalStrength,
		event.TriggerTime.Format(time.RFC3339),
		event.TriggerPrice,
		event.AvgPrice,
		conditions,
		boolToInt(event.Pushed),
		event.PushedMessage,
		nullableTime(event.ReadAt),
		event.CreatedAt.Format(time.RFC3339),
	)
	return err
}

func (s *Store) HasReminderEventOnDate(ctx context.Context, reminderID string, date string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM stock_alert_events
		WHERE reminder_id = ? AND substr(trigger_time, 1, 10) = ?`,
		reminderID, date,
	).Scan(&count)
	return count > 0, err
}

func (s *Store) HasConfirmedEventOnDate(ctx context.Context, watchItemID string, direction string, date string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM stock_alert_events
		WHERE watch_item_id = ? AND direction = ? AND signal_strength = ?
			AND substr(trigger_time, 1, 10) = ?`,
		watchItemID, direction, StrengthConfirmed, date,
	).Scan(&count)
	return count > 0, err
}

func (s *Store) HasEventWithin(ctx context.Context, watchItemID string, direction string, minutes int) (bool, error) {
	var count int
	since := time.Now().Add(-time.Duration(minutes) * time.Minute).Format(time.RFC3339)
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM stock_alert_events
		WHERE watch_item_id = ? AND direction = ? AND created_at >= ?`,
		watchItemID, direction, since,
	).Scan(&count)
	return count > 0, err
}

func (s *Store) UpdateEventPush(ctx context.Context, eventID string, pushed bool, message string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE stock_alert_events SET pushed = ?, pushed_message = ? WHERE id = ?`,
		boolToInt(pushed), message, eventID,
	)
	return err
}

func (s *Store) ListEvents(ctx context.Context, userID string, limit int) ([]AlertEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, watch_item_id, reminder_id, reminder_label, symbol_code, name, direction, signal_strength,
			trigger_time, trigger_price, avg_price, conditions_json, pushed, pushed_message, read_at, created_at
		FROM stock_alert_events WHERE user_id = ? ORDER BY trigger_time DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]AlertEvent, 0)
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) MarkEventsRead(ctx context.Context, userID string, eventIDs []string) error {
	if len(eventIDs) == 0 {
		_, err := s.db.ExecContext(ctx,
			`UPDATE stock_alert_events SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
			time.Now().Format(time.RFC3339), userID)
		return err
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(eventIDs)), ",")
	args := make([]any, 0, len(eventIDs)+2)
	now := time.Now().Format(time.RFC3339)
	args = append(args, now, userID)
	for _, id := range eventIDs {
		args = append(args, id)
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE stock_alert_events SET read_at = ?
		WHERE user_id = ? AND id IN (`+placeholders+`)`, args...)
	return err
}

func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	var encrypted string
	var enabled bool
	var updated string
	err := s.db.QueryRowContext(ctx, `
		SELECT sendkey_encrypted, reminder_enabled, updated_at FROM stock_alert_settings WHERE user_id = ?`,
		userID,
	).Scan(&encrypted, &enabled, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{UserID: userID, ReminderEnabled: true}, nil
	}
	if err != nil {
		return Settings{}, err
	}
	plain, err := s.decrypt(encrypted)
	if err != nil {
		return Settings{}, err
	}
	settings := Settings{
		UserID:          userID,
		ReminderEnabled: enabled,
	}
	if plain != "" {
		settings.SendKeyBound = true
		settings.SendKeyMasked = maskSendKey(plain)
	}
	parsed, _ := time.Parse(time.RFC3339, updated)
	settings.UpdatedAt = parsed
	return settings, nil
}

func (s *Store) SaveSettings(ctx context.Context, userID string, sendKey string, reminderEnabled bool) error {
	encrypted, err := s.encrypt(sendKey)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO stock_alert_settings (user_id, sendkey_encrypted, reminder_enabled, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			sendkey_encrypted = excluded.sendkey_encrypted,
			reminder_enabled = excluded.reminder_enabled,
			updated_at = excluded.updated_at`,
		userID, encrypted, boolToInt(reminderEnabled), time.Now().Format(time.RFC3339),
	)
	return err
}

func (s *Store) SendKey(ctx context.Context, userID string) (string, error) {
	var encrypted string
	err := s.db.QueryRowContext(ctx,
		`SELECT sendkey_encrypted FROM stock_alert_settings WHERE user_id = ?`, userID,
	).Scan(&encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if encrypted == "" {
		return "", nil
	}
	return s.decrypt(encrypted)
}

func (s *Store) encrypt(plain string) (string, error) {
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (s *Store) decrypt(encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted sendkey")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanWatchItem(row rowScanner) (WatchItem, error) {
	var item WatchItem
	var enabled int
	var reminderTypes string
	var analysisID sql.NullString
	var validUntil sql.NullString
	var createdAt string
	err := row.Scan(
		&item.ID, &item.UserID, &item.SymbolCode, &item.Name, &item.Market, &item.SecID,
		&enabled, &reminderTypes, &analysisID, &validUntil, &createdAt,
	)
	if err != nil {
		return WatchItem{}, err
	}
	item.Enabled = enabled == 1
	item.ReminderTypes = splitReminderTypes(reminderTypes)
	item.ValidUntil = validUntil.String
	item.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	return item, nil
}

func scanAnalysis(row rowScanner) (Analysis, error) {
	var analysis Analysis
	var reasons string
	var conditions string
	var createdAt string
	err := row.Scan(
		&analysis.ID, &analysis.WatchItemID, &analysis.Model, &analysis.DataEndDate,
		&analysis.Rule.BuyTrigger, &analysis.Rule.BuyReferenceLow, &analysis.Rule.BuyReferenceHigh,
		&analysis.Rule.SellTrigger, &analysis.Rule.SellReferenceLow, &analysis.Rule.SellReferenceHigh,
		&analysis.Rule.StopLoss, &analysis.Rule.ValidTradingDays,
		&reasons, &analysis.Rule.Summary, &conditions, &createdAt,
	)
	if err != nil {
		return Analysis{}, err
	}
	analysis.Rule.Reasons = unmarshalStringList(reasons)
	analysis.Rule.BuyConditions, analysis.Rule.SellConditions = unmarshalConditions(conditions)
	analysis.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	return analysis, nil
}

func scanEvent(row rowScanner) (AlertEvent, error) {
	var event AlertEvent
	var conditions string
	var pushed int
	var reminderID sql.NullString
	var reminderLabel sql.NullString
	var readAt sql.NullString
	var triggerTime string
	var createdAt string
	err := row.Scan(
		&event.ID, &event.UserID, &event.WatchItemID, &reminderID, &reminderLabel, &event.SymbolCode, &event.Name,
		&event.Direction, &event.SignalStrength, &triggerTime, &event.TriggerPrice, &event.AvgPrice,
		&conditions, &pushed, &event.PushedMessage, &readAt, &createdAt,
	)
	if err != nil {
		return AlertEvent{}, err
	}
	event.Conditions = unmarshalStringList(conditions)
	event.Pushed = pushed == 1
	event.ReminderID = reminderID.String
	event.ReminderLabel = reminderLabel.String
	event.TriggerTime, _ = time.Parse(time.RFC3339, triggerTime)
	event.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	if readAt.Valid && readAt.String != "" {
		parsed, _ := time.Parse(time.RFC3339, readAt.String)
		event.ReadAt = &parsed
	}
	return event, nil
}

func scanReminder(row rowScanner) (Reminder, error) {
	var reminder Reminder
	var channels string
	var enabled int
	var createdAt string
	var updatedAt string
	err := row.Scan(
		&reminder.ID, &reminder.UserID, &reminder.WatchItemID, &reminder.SymbolCode, &reminder.Name,
		&reminder.RuleType, &reminder.Direction, &reminder.Threshold, &reminder.TimeRange,
		&reminder.ValidDays, &channels, &enabled, &createdAt, &updatedAt,
	)
	if err != nil {
		return Reminder{}, err
	}
	reminder.Channels = unmarshalStringList(channels)
	reminder.Enabled = enabled == 1
	reminder.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
	reminder.UpdatedAt, _ = time.Parse(time.RFC3339, updatedAt)
	return reminder, nil
}

func (w WatchItem) AnalysisIDOrEmpty() string {
	if w.Analysis == nil {
		return ""
	}
	return w.Analysis.ID
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func splitReminderTypes(raw string) []string {
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			result = append(result, part)
		}
	}
	return result
}

func nullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Format(time.RFC3339)
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func marshalStringList(values []string) (string, error) {
	raw, err := jsonMarshal(values)
	return string(raw), err
}

func unmarshalStringList(raw string) []string {
	var result []string
	if raw == "" {
		return result
	}
	_ = jsonUnmarshal([]byte(raw), &result)
	return result
}

func marshalConditions(rule SignalRule) (string, error) {
	return marshalStringList(append(append([]string{}, rule.BuyConditions...), rule.SellConditions...))
}

func unmarshalConditions(raw string) (buy []string, sell []string) {
	all := unmarshalStringList(raw)
	if len(all) <= 3 {
		return all, nil
	}
	return all[:3], all[3:]
}

func maskSendKey(key string) string {
	if len(key) <= 8 {
		return "****"
	}
	return key[:4] + "****" + key[len(key)-4:]
}
