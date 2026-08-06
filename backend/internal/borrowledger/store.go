package borrowledger

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
	ErrInvalidInput      = errors.New("borrow ledger invalid input")
	ErrDatabasePathEmpty = errors.New("borrow ledger database path is empty")
	ErrNotFound          = errors.New("borrow ledger state not found")
)

const (
	MaxRecords           = 1000
	MaxIDLength          = 64
	MaxPersonNameLength  = 20
	MaxItemTitleLength   = 60
	MaxPlatformLength    = 30
	MaxAccountNameLength = 80
	MaxNoteLength        = 500
	MaxCurrencyLength    = 12
	MaxAvatarURLLength   = 512
	MaxFriendIDLength    = 64

	KindLendOut  = "lend_out"
	KindBorrowIn = "borrow_in"
	KindPaidFor  = "paid_for"

	SubjectItem    = "item"
	SubjectMoney   = "money"
	SubjectAccount = "account"

	RemindNone         = "none"
	RemindBefore1Day   = "before_1d"
	RemindBefore3Days  = "before_3d"
	RemindBefore7Days  = "before_7d"
	RemindOnDue        = "on_due"
	RemindDailyOverdue = "daily_overdue"
)

type Counterparty struct {
	FriendID  string `json:"friendId"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

type Record struct {
	ID           string       `json:"id"`
	Kind         string       `json:"kind"`
	SubjectType  string       `json:"subjectType"`
	Title        string       `json:"title"`
	Amount       *float64     `json:"amount,omitempty"`
	Currency     string       `json:"currency"`
	Platform     string       `json:"platform"`
	AccountName  string       `json:"accountName"`
	Counterparty Counterparty `json:"counterparty"`
	LentAt       string       `json:"lentAt"`
	DueAt        string       `json:"dueAt"`
	RemindRule   string       `json:"remindRule"`
	ReturnedAt   string       `json:"returnedAt"`
	SettledAt    string       `json:"settledAt"`
	Note         string       `json:"note"`
	CreatedAt    int64        `json:"createdAt"`
	UpdatedAt    int64        `json:"updatedAt"`
}

type State struct {
	SchemaVersion int      `json:"schemaVersion"`
	Records       []Record `json:"records"`
	UpdatedAt     int64    `json:"updatedAt"`
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
			return nil, fmt.Errorf("create borrow ledger database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open borrow ledger database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS borrow_ledger_state (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate borrow ledger: %w", err)
		}
	}
	return nil
}

func (s *Store) GetState(ctx context.Context, userID string) (State, error) {
	var stateJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json FROM borrow_ledger_state WHERE user_id = ?
	`, userID).Scan(&stateJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return State{
			SchemaVersion: 1,
			Records:       []Record{},
		}, nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get borrow ledger state: %w", err)
	}
	var state State
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return State{}, fmt.Errorf("decode borrow ledger state: %w", err)
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
		return State{}, fmt.Errorf("encode borrow ledger state: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO borrow_ledger_state (user_id, state_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			state_json = excluded.state_json,
			updated_at = excluded.updated_at
	`, userID, string(encoded), state.UpdatedAt)
	if err != nil {
		return State{}, fmt.Errorf("save borrow ledger state: %w", err)
	}
	return state, nil
}

func (s *Store) ClearState(ctx context.Context, userID string) (State, error) {
	empty := State{
		SchemaVersion: 1,
		Records:       []Record{},
	}
	return s.SaveState(ctx, userID, empty)
}

func ValidateState(state State) error {
	if state.SchemaVersion != 1 {
		return fmt.Errorf("%w: invalid schema version", ErrInvalidInput)
	}
	if len(state.Records) > MaxRecords {
		return fmt.Errorf("%w: too many records", ErrInvalidInput)
	}
	seen := make(map[string]bool, len(state.Records))
	for _, record := range state.Records {
		if err := validateRecord(record); err != nil {
			return err
		}
		if seen[record.ID] {
			return fmt.Errorf("%w: duplicate record id", ErrInvalidInput)
		}
		seen[record.ID] = true
	}
	return nil
}

func validateRecord(record Record) error {
	if record.ID == "" || len(record.ID) > MaxIDLength {
		return fmt.Errorf("%w: invalid record id", ErrInvalidInput)
	}
	if !validKind(record.Kind) {
		return fmt.Errorf("%w: invalid record kind", ErrInvalidInput)
	}
	if !validSubjectType(record.SubjectType) {
		return fmt.Errorf("%w: invalid subject type", ErrInvalidInput)
	}
	if record.Kind == KindPaidFor && record.SubjectType != SubjectMoney {
		return fmt.Errorf("%w: paid_for requires money subject", ErrInvalidInput)
	}

	name := strings.TrimSpace(record.Counterparty.Name)
	if name == "" || len([]rune(name)) > MaxPersonNameLength {
		return fmt.Errorf("%w: invalid counterparty name", ErrInvalidInput)
	}
	if len(record.Counterparty.FriendID) > MaxFriendIDLength {
		return fmt.Errorf("%w: invalid friend id", ErrInvalidInput)
	}
	if len(record.Counterparty.AvatarURL) > MaxAvatarURLLength {
		return fmt.Errorf("%w: invalid avatar url", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.Title))) > MaxItemTitleLength {
		return fmt.Errorf("%w: invalid title", ErrInvalidInput)
	}

	switch record.SubjectType {
	case SubjectItem:
		if strings.TrimSpace(record.Title) == "" {
			return fmt.Errorf("%w: item title is required", ErrInvalidInput)
		}
		if record.Amount != nil {
			return fmt.Errorf("%w: item cannot have amount", ErrInvalidInput)
		}
	case SubjectMoney:
		if record.Amount == nil || *record.Amount <= 0 || *record.Amount > 1e15 {
			return fmt.Errorf("%w: invalid amount", ErrInvalidInput)
		}
		currency := strings.TrimSpace(record.Currency)
		if currency == "" || len([]rune(currency)) > MaxCurrencyLength {
			return fmt.Errorf("%w: invalid currency", ErrInvalidInput)
		}
		if strings.TrimSpace(record.Platform) != "" || strings.TrimSpace(record.AccountName) != "" {
			return fmt.Errorf("%w: money cannot have platform or account", ErrInvalidInput)
		}
	case SubjectAccount:
		platform := strings.TrimSpace(record.Platform)
		accountName := strings.TrimSpace(record.AccountName)
		if platform == "" || len([]rune(platform)) > MaxPlatformLength {
			return fmt.Errorf("%w: invalid platform", ErrInvalidInput)
		}
		if accountName == "" || len([]rune(accountName)) > MaxAccountNameLength {
			return fmt.Errorf("%w: invalid account name", ErrInvalidInput)
		}
		if record.Amount != nil {
			return fmt.Errorf("%w: account cannot have amount", ErrInvalidInput)
		}
	}

	if !validDateKey(record.LentAt) {
		return fmt.Errorf("%w: invalid lent date", ErrInvalidInput)
	}
	if record.DueAt != "" && !validDateKey(record.DueAt) {
		return fmt.Errorf("%w: invalid due date", ErrInvalidInput)
	}
	if record.ReturnedAt != "" && !validDateKey(record.ReturnedAt) {
		return fmt.Errorf("%w: invalid returned date", ErrInvalidInput)
	}
	if record.SettledAt != "" && !validDateKey(record.SettledAt) {
		return fmt.Errorf("%w: invalid settled date", ErrInvalidInput)
	}
	if !validRemindRule(record.RemindRule) {
		return fmt.Errorf("%w: invalid remind rule", ErrInvalidInput)
	}
	if len([]rune(strings.TrimSpace(record.Note))) > MaxNoteLength {
		return fmt.Errorf("%w: note too long", ErrInvalidInput)
	}
	return nil
}

func validKind(kind string) bool {
	return kind == KindLendOut || kind == KindBorrowIn || kind == KindPaidFor
}

func validSubjectType(subjectType string) bool {
	return subjectType == SubjectItem || subjectType == SubjectMoney || subjectType == SubjectAccount
}

func validRemindRule(rule string) bool {
	switch rule {
	case RemindNone, RemindBefore1Day, RemindBefore3Days, RemindBefore7Days, RemindOnDue, RemindDailyOverdue:
		return true
	default:
		return false
	}
}

func validDateKey(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}
