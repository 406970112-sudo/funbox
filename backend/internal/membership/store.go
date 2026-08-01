package membership

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

const (
	DefaultVIPPriceCents  = 200
	DefaultSVIPPriceCents = 500
	DefaultPaymentNote    = "转账请备注您的注册手机号，方便管理员核对开通；付款后请点击「我已支付」并等待人工开通。"
)

type Settings struct {
	PaymentQRFile    string
	PaymentNote      string
	VIPPriceCents    int
	SVIPPriceCents   int
	UpdatedBy        string
	UpdatedByName    string
	UpdatedByUsername string
	UpdatedAt        time.Time
}

type Change struct {
	ID                  string
	Action              string
	Detail              string
	OperatorID          string
	OperatorDisplayName string
	OperatorUsername    string
	CreatedAt           time.Time
}

type ChangesPage struct {
	Changes []Change
	Total   int
	Limit   int
	Offset  int
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	if strings.TrimSpace(databasePath) == "" {
		return nil, errors.New("database path is required")
	}

	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create membership database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open membership database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS membership_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			payment_qr_file TEXT NOT NULL DEFAULT '',
			payment_note TEXT NOT NULL DEFAULT '',
			vip_price_cents INTEGER NOT NULL DEFAULT 200,
			svip_price_cents INTEGER NOT NULL DEFAULT 500,
			updated_by TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
		`INSERT OR IGNORE INTO membership_settings (id) VALUES (1)`,
		`CREATE TABLE IF NOT EXISTS membership_payment_changes (
			id TEXT PRIMARY KEY,
			operator_id TEXT NOT NULL REFERENCES users(id),
			action TEXT NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_membership_payment_changes_created
			ON membership_payment_changes(created_at DESC, id DESC)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run membership database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) Get(ctx context.Context) (Settings, error) {
	var settings Settings
	var updatedAt int64
	err := s.db.QueryRowContext(
		ctx,
		`SELECT m.payment_qr_file, m.payment_note, m.vip_price_cents, m.svip_price_cents,
		        m.updated_by, m.updated_at
		 FROM membership_settings m
		 WHERE m.id = 1`,
	).Scan(
		&settings.PaymentQRFile,
		&settings.PaymentNote,
		&settings.VIPPriceCents,
		&settings.SVIPPriceCents,
		&settings.UpdatedBy,
		&updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{
			PaymentNote:    DefaultPaymentNote,
			VIPPriceCents:  DefaultVIPPriceCents,
			SVIPPriceCents: DefaultSVIPPriceCents,
		}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("read membership settings: %w", err)
	}
	settings.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if settings.PaymentNote == "" {
		settings.PaymentNote = DefaultPaymentNote
	}
	if settings.VIPPriceCents <= 0 {
		settings.VIPPriceCents = DefaultVIPPriceCents
	}
	if settings.SVIPPriceCents <= 0 {
		settings.SVIPPriceCents = DefaultSVIPPriceCents
	}
	if settings.UpdatedBy != "" {
		if err := s.db.QueryRowContext(
			ctx,
			`SELECT display_name, username FROM users WHERE id = ?`,
			settings.UpdatedBy,
		).Scan(&settings.UpdatedByName, &settings.UpdatedByUsername); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Settings{}, fmt.Errorf("read membership settings operator: %w", err)
		}
	}
	return settings, nil
}

func (s *Store) SetPaymentQR(ctx context.Context, operatorID, qrFile string) (Settings, error) {
	return s.update(ctx, operatorID, "qr_upload", "上传收款二维码", &qrFile, nil)
}

func (s *Store) SetPaymentNote(ctx context.Context, operatorID, note string) (Settings, error) {
	return s.update(ctx, operatorID, "note_update", "更新转账备注要求", nil, &note)
}

func (s *Store) ClearPaymentQR(ctx context.Context, operatorID string) (Settings, error) {
	empty := ""
	return s.update(ctx, operatorID, "qr_remove", "移除收款二维码", &empty, nil)
}

func (s *Store) update(
	ctx context.Context,
	operatorID string,
	action string,
	detail string,
	qrFile *string,
	note *string,
) (Settings, error) {
	now := time.Now().UTC().Unix()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Settings{}, fmt.Errorf("begin membership update: %w", err)
	}
	defer tx.Rollback()

	setParts := []string{"updated_by = ?", "updated_at = ?"}
	args := make([]any, 0, 4)
	if qrFile != nil {
		setParts = append([]string{"payment_qr_file = ?"}, setParts...)
		args = append(args, *qrFile)
	}
	if note != nil {
		setParts = append([]string{"payment_note = ?"}, setParts...)
		args = append(args, *note)
	}
	args = append(args, operatorID, now)

	statement := `UPDATE membership_settings SET ` + strings.Join(setParts, ", ") + ` WHERE id = 1`
	if _, err := tx.ExecContext(ctx, statement, args...); err != nil {
		return Settings{}, fmt.Errorf("update membership settings: %w", err)
	}

	changeID := uuid.NewString()
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO membership_payment_changes (id, operator_id, action, detail, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		changeID,
		operatorID,
		action,
		detail,
		now,
	); err != nil {
		return Settings{}, fmt.Errorf("insert membership change: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return Settings{}, fmt.Errorf("commit membership update: %w", err)
	}
	return s.Get(ctx)
}

func (s *Store) ListChanges(ctx context.Context, limit, offset int) (ChangesPage, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM membership_payment_changes`,
	).Scan(&total); err != nil {
		return ChangesPage{}, fmt.Errorf("count membership changes: %w", err)
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT c.id, c.action, c.detail, c.created_at,
		        c.operator_id, u.display_name, u.username
		 FROM membership_payment_changes c
		 JOIN users u ON u.id = c.operator_id
		 ORDER BY c.created_at DESC, c.rowid DESC
		 LIMIT ? OFFSET ?`,
		limit,
		offset,
	)
	if err != nil {
		return ChangesPage{}, fmt.Errorf("list membership changes: %w", err)
	}
	defer rows.Close()

	changes := make([]Change, 0, limit)
	for rows.Next() {
		var change Change
		var createdAt int64
		if err := rows.Scan(
			&change.ID,
			&change.Action,
			&change.Detail,
			&createdAt,
			&change.OperatorID,
			&change.OperatorDisplayName,
			&change.OperatorUsername,
		); err != nil {
			return ChangesPage{}, fmt.Errorf("scan membership change: %w", err)
		}
		change.CreatedAt = time.Unix(createdAt, 0).UTC()
		changes = append(changes, change)
	}
	if err := rows.Err(); err != nil {
		return ChangesPage{}, fmt.Errorf("iterate membership changes: %w", err)
	}

	return ChangesPage{Changes: changes, Total: total, Limit: limit, Offset: offset}, nil
}
