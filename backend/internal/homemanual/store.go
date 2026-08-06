package homemanual

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const (
	argonMemory      = 64 * 1024
	argonIterations  = 4
	argonParallelism = 4
	argonKeyLength   = 32
	unlockTTL        = 30 * time.Minute

	MaxDevices        = 200
	MaxNetworks       = 20
	MaxContacts       = 50
	MaxReminders      = 200
	MaxNameLength     = 30
	MaxLongTextLength = 2000
	MaxNoteLength     = 500
	MaxModelLength    = 80
	MaxSSIDLength     = 64
	MaxSecretLength   = 128
	MaxPhoneLength    = 20
	MaxWechatLength   = 50
	MaxAddressLength  = 100
	MaxPhotoCount     = 9
	MaxIDLength       = 64
	MaxContactName    = 20
	MaxServiceLength  = 100
	MaxReminderTitle  = 40
)

var (
	ErrInvalidInput      = errors.New("home manual invalid input")
	ErrNotFound          = errors.New("home manual state not found")
	ErrDatabasePathEmpty = errors.New("home manual database path is empty")
	ErrLocked            = errors.New("home manual locked")
	ErrPasswordRequired  = errors.New("home manual password required")
	ErrPasswordInvalid   = errors.New("home manual password invalid")
	ErrPasswordMismatch  = errors.New("home manual password mismatch")
	ErrLockedOut         = errors.New("home manual locked out")
	ErrRemoveWithSecrets = errors.New("home manual remove password with secrets")
)

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type SecurityState struct {
	Enabled   bool  `json:"enabled"`
	UpdatedAt int64 `json:"updatedAt"`
}

type Device struct {
	ID              string   `json:"id"`
	Category        string   `json:"category"`
	Name            string   `json:"name"`
	Brand           string   `json:"brand"`
	Model           string   `json:"model"`
	Room            string   `json:"room"`
	PurchaseDate    string   `json:"purchaseDate"`
	WarrantyEndDate string   `json:"warrantyEndDate"`
	ManualText      string   `json:"manualText"`
	Note            string   `json:"note"`
	PhotoIDs        []string `json:"photoIds"`
	FilterModel     string   `json:"filterModel"`
	FilterQuantity  int      `json:"filterQuantity"`
	FilterChangedAt string   `json:"filterChangedAt"`
	FilterCycleDays int      `json:"filterCycleDays"`
	CreatedAt       int64    `json:"createdAt"`
	UpdatedAt       int64    `json:"updatedAt"`
}

type Network struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	SSID              string `json:"ssid"`
	SecurityType      string `json:"securityType"`
	WiFiPassword      string `json:"wifiPassword"`
	RouterURL         string `json:"routerUrl"`
	RouterAccount     string `json:"routerAccount"`
	RouterPassword    string `json:"routerPassword"`
	BroadbandCarrier  string `json:"broadbandCarrier"`
	BroadbandAccount  string `json:"broadbandAccount"`
	BroadbandPassword string `json:"broadbandPassword"`
	Note              string `json:"note"`
	CreatedAt         int64  `json:"createdAt"`
	UpdatedAt         int64  `json:"updatedAt"`
}

type Contact struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Phone        string `json:"phone"`
	PhoneAlt     string `json:"phoneAlt"`
	Wechat       string `json:"wechat"`
	Address      string `json:"address"`
	ServiceHours string `json:"serviceHours"`
	ServiceScope string `json:"serviceScope"`
	Note         string `json:"note"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

type Reminder struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Title          string `json:"title"`
	TargetDate     string `json:"targetDate"`
	CycleDays      int    `json:"cycleDays"`
	SourceDeviceID string `json:"sourceDeviceId"`
	Note           string `json:"note"`
	Status         string `json:"status"`
	DoneAt         int64  `json:"doneAt"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
}

type State struct {
	SchemaVersion int           `json:"schemaVersion"`
	Security      SecurityState `json:"security"`
	Devices       []Device      `json:"devices"`
	Networks      []Network     `json:"networks"`
	Contacts      []Contact     `json:"contacts"`
	Reminders     []Reminder    `json:"reminders"`
	UpdatedAt     int64         `json:"updatedAt"`
}

type homeManualSession struct {
	UserID    string
	DataKey   []byte
	ExpiresAt time.Time
}

type Store struct {
	db       *sql.DB
	mu       sync.Mutex
	sessions map[string]homeManualSession
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create home manual database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open home manual database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db, sessions: map[string]homeManualSession{}}
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
		`CREATE TABLE IF NOT EXISTS home_manual_vault (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			has_password INTEGER NOT NULL DEFAULT 0,
			password_hash TEXT,
			key_salt TEXT,
			data_key_enc TEXT,
			failed_attempts INTEGER NOT NULL DEFAULT 0,
			locked_until INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS home_manual_state (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			metadata_json TEXT NOT NULL,
			state_json TEXT NOT NULL,
			state_encrypted INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS home_manual_security_events (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_home_manual_security_events_user
			ON home_manual_security_events(user_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate home manual: %w", err)
		}
	}
	return nil
}

func (s *Store) GetState(ctx context.Context, userID string) (State, error) {
	var metadataJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT metadata_json FROM home_manual_state WHERE user_id = ?
	`, userID).Scan(&metadataJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return emptyState(), nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get home manual state: %w", err)
	}
	var state State
	if err := json.Unmarshal([]byte(metadataJSON), &state); err != nil {
		return State{}, fmt.Errorf("decode home manual state: %w", err)
	}
	enabled, err := s.passwordEnabled(ctx, userID)
	if err != nil {
		return State{}, err
	}
	state.Security.Enabled = enabled
	return state, nil
}

func (s *Store) GetFullState(ctx context.Context, userID string, dataKey []byte) (State, error) {
	enabled, err := s.passwordEnabled(ctx, userID)
	if err != nil {
		return State{}, err
	}
	if enabled && len(dataKey) == 0 {
		return State{}, ErrLocked
	}
	var stateJSON string
	var encrypted int
	err = s.db.QueryRowContext(ctx, `
		SELECT state_json, state_encrypted FROM home_manual_state WHERE user_id = ?
	`, userID).Scan(&stateJSON, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return emptyState(), nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get full home manual state: %w", err)
	}
	if encrypted == 1 {
		plain, err := decryptAESGCM(dataKey, stateJSON)
		if err != nil {
			return State{}, fmt.Errorf("decrypt home manual state: %w", err)
		}
		stateJSON = string(plain)
	}
	var state State
	if err := json.Unmarshal([]byte(stateJSON), &state); err != nil {
		return State{}, fmt.Errorf("decode full home manual state: %w", err)
	}
	state.Security.Enabled = enabled
	return state, nil
}

func (s *Store) SaveState(ctx context.Context, userID string, state State, dataKey []byte) (State, error) {
	enabled, err := s.passwordEnabled(ctx, userID)
	if err != nil {
		return State{}, err
	}
	if enabled && len(dataKey) == 0 {
		return State{}, ErrLocked
	}
	state.Security.Enabled = enabled
	if err := validateState(state, enabled); err != nil {
		return State{}, err
	}
	state.UpdatedAt = time.Now().UnixMilli()
	state.Security.UpdatedAt = state.UpdatedAt
	fullJSON, err := json.Marshal(state)
	if err != nil {
		return State{}, fmt.Errorf("encode home manual state: %w", err)
	}
	metadata := SanitizeState(state)
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return State{}, fmt.Errorf("encode home manual metadata: %w", err)
	}
	stored := string(fullJSON)
	encrypted := 0
	if enabled {
		stored, err = encryptAESGCM(dataKey, fullJSON)
		if err != nil {
			return State{}, fmt.Errorf("encrypt home manual state: %w", err)
		}
		encrypted = 1
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO home_manual_state (user_id, metadata_json, state_json, state_encrypted, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			metadata_json = excluded.metadata_json,
			state_json = excluded.state_json,
			state_encrypted = excluded.state_encrypted,
			updated_at = excluded.updated_at
	`, userID, string(metadataJSON), stored, encrypted, state.UpdatedAt)
	if err != nil {
		return State{}, fmt.Errorf("save home manual state: %w", err)
	}
	return state, nil
}

func (s *Store) ClearState(ctx context.Context, userID string, dataKey []byte) (State, error) {
	return s.SaveState(ctx, userID, emptyState(), dataKey)
}

func (s *Store) SetPassword(
	ctx context.Context,
	userID string,
	action string,
	current string,
	next string,
) error {
	enabled, err := s.passwordEnabled(ctx, userID)
	if err != nil {
		return err
	}
	var dataKey []byte
	if enabled {
		row := s.db.QueryRowContext(ctx, `
			SELECT password_hash, key_salt, data_key_enc FROM home_manual_vault WHERE user_id = ?
		`, userID)
		var passwordHash, keySalt, dataKeyEnc string
		if err := row.Scan(&passwordHash, &keySalt, &dataKeyEnc); err != nil {
			return fmt.Errorf("read home manual vault: %w", err)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(current)); err != nil {
			_ = s.logSecurityEvent(ctx, userID, "password_failed")
			return ErrPasswordMismatch
		}
		salt, err := base64.RawStdEncoding.DecodeString(keySalt)
		if err != nil {
			return fmt.Errorf("decode home manual key salt: %w", err)
		}
		dataKey, err = decryptAESGCM(deriveKey(current, salt), dataKeyEnc)
		if err != nil {
			return fmt.Errorf("decrypt home manual data key: %w", err)
		}
	} else {
		dataKey = make([]byte, 32)
		if _, err := rand.Read(dataKey); err != nil {
			return fmt.Errorf("generate home manual data key: %w", err)
		}
	}

	switch action {
	case "set":
		if enabled {
			return ErrPasswordInvalid
		}
	case "change":
		if !enabled {
			return ErrPasswordInvalid
		}
	case "remove":
		if !enabled {
			return ErrPasswordInvalid
		}
		state, err := s.GetFullState(ctx, userID, dataKey)
		if err != nil {
			return err
		}
		if hasSecrets(state) {
			return ErrRemoveWithSecrets
		}
		if err := s.storePlainState(ctx, userID, dataKey); err != nil {
			return err
		}
		if _, err := s.db.ExecContext(ctx, `
			DELETE FROM home_manual_vault WHERE user_id = ?
		`, userID); err != nil {
			return fmt.Errorf("remove home manual password: %w", err)
		}
		return s.logSecurityEvent(ctx, userID, "password_removed")
	default:
		return ErrInvalidInput
	}
	if !validPassword(next) {
		return ErrPasswordInvalid
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash home manual password: %w", err)
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("generate home manual key salt: %w", err)
	}
	key := deriveKey(next, salt)
	encodedDataKey, err := encryptAESGCM(key, dataKey)
	if err != nil {
		return fmt.Errorf("encrypt home manual data key: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO home_manual_vault (
			user_id, has_password, password_hash, key_salt, data_key_enc,
			failed_attempts, locked_until, updated_at
		) VALUES (?, 1, ?, ?, ?, 0, 0, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			has_password = 1,
			password_hash = excluded.password_hash,
			key_salt = excluded.key_salt,
			data_key_enc = excluded.data_key_enc,
			failed_attempts = 0,
			locked_until = 0,
			updated_at = excluded.updated_at
	`, userID, string(hash), base64.RawStdEncoding.EncodeToString(salt), encodedDataKey,
		time.Now().UnixMilli()); err != nil {
		return fmt.Errorf("save home manual password: %w", err)
	}
	if !enabled {
		if err := s.encryptPlainState(ctx, userID, dataKey); err != nil {
			return err
		}
	}
	actionEvent := "password_set"
	if action == "change" {
		actionEvent = "password_changed"
	}
	return s.logSecurityEvent(ctx, userID, actionEvent)
}

func (s *Store) encryptPlainState(ctx context.Context, userID string, dataKey []byte) error {
	var stateJSON string
	var encrypted int
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json, state_encrypted FROM home_manual_state WHERE user_id = ?
	`, userID).Scan(&stateJSON, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read home manual state for encryption: %w", err)
	}
	if encrypted == 1 {
		return nil
	}
	encoded, err := encryptAESGCM(dataKey, []byte(stateJSON))
	if err != nil {
		return fmt.Errorf("encrypt plain home manual state: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE home_manual_state SET state_json = ?, state_encrypted = 1, updated_at = ?
		WHERE user_id = ?
	`, encoded, time.Now().UnixMilli(), userID)
	if err != nil {
		return fmt.Errorf("save encrypted home manual state: %w", err)
	}
	return nil
}

func (s *Store) storePlainState(ctx context.Context, userID string, dataKey []byte) error {
	var stateJSON string
	var encrypted int
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json, state_encrypted FROM home_manual_state WHERE user_id = ?
	`, userID).Scan(&stateJSON, &encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read home manual state for decryption: %w", err)
	}
	if encrypted == 1 {
		plain, err := decryptAESGCM(dataKey, stateJSON)
		if err != nil {
			return fmt.Errorf("decrypt home manual state for removal: %w", err)
		}
		stateJSON = string(plain)
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE home_manual_state SET state_json = ?, state_encrypted = 0, updated_at = ?
		WHERE user_id = ?
	`, stateJSON, time.Now().UnixMilli(), userID)
	if err != nil {
		return fmt.Errorf("save plain home manual state: %w", err)
	}
	return nil
}

func (s *Store) Unlock(ctx context.Context, userID string, password string) (string, int64, error) {
	var hasPassword int
	var passwordHash, keySalt, dataKeyEnc string
	var lockedUntil int64
	err := s.db.QueryRowContext(ctx, `
		SELECT has_password, password_hash, key_salt, data_key_enc, locked_until
		FROM home_manual_vault WHERE user_id = ?
	`, userID).Scan(&hasPassword, &passwordHash, &keySalt, &dataKeyEnc, &lockedUntil)
	if errors.Is(err, sql.ErrNoRows) || hasPassword == 0 {
		return "", 0, ErrPasswordRequired
	}
	if err != nil {
		return "", 0, fmt.Errorf("read home manual unlock state: %w", err)
	}
	if lockedUntil > time.Now().UnixMilli() {
		return "", 0, ErrLockedOut
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		if err := s.recordFailedAttempt(ctx, userID); err != nil {
			return "", 0, err
		}
		_ = s.logSecurityEvent(ctx, userID, "unlock_failed")
		return "", 0, ErrPasswordMismatch
	}
	salt, err := base64.RawStdEncoding.DecodeString(keySalt)
	if err != nil {
		return "", 0, fmt.Errorf("decode home manual key salt: %w", err)
	}
	dataKey, err := decryptAESGCM(deriveKey(password, salt), dataKeyEnc)
	if err != nil {
		return "", 0, fmt.Errorf("decrypt home manual data key: %w", err)
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", 0, fmt.Errorf("generate home manual unlock token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	s.mu.Lock()
	s.sessions[token] = homeManualSession{
		UserID:    userID,
		DataKey:   dataKey,
		ExpiresAt: time.Now().Add(unlockTTL),
	}
	s.mu.Unlock()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE home_manual_vault SET failed_attempts = 0, locked_until = 0, updated_at = ?
		WHERE user_id = ?
	`, time.Now().UnixMilli(), userID); err != nil {
		return "", 0, fmt.Errorf("reset home manual lockout: %w", err)
	}
	if err := s.logSecurityEvent(ctx, userID, "unlock"); err != nil {
		return "", 0, err
	}
	return token, int64(unlockTTL / time.Second), nil
}

func (s *Store) Lock(ctx context.Context, userID string, token string) error {
	s.mu.Lock()
	for existingToken, session := range s.sessions {
		if session.UserID == userID && (token == "" || existingToken == token) {
			delete(s.sessions, existingToken)
		}
	}
	s.mu.Unlock()
	if token != "" {
		_ = s.logSecurityEvent(ctx, userID, "lock")
	}
	return nil
}

func (s *Store) GetDataKey(ctx context.Context, userID string, token string) ([]byte, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrLocked
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for existingToken, session := range s.sessions {
		if session.ExpiresAt.Before(now) {
			delete(s.sessions, existingToken)
		}
	}
	session, ok := s.sessions[token]
	if !ok || session.UserID != userID {
		return nil, ErrLocked
	}
	return session.DataKey, nil
}

func (s *Store) recordFailedAttempt(ctx context.Context, userID string) error {
	var failed int
	var lockedUntil int64
	if err := s.db.QueryRowContext(ctx, `
		SELECT failed_attempts, locked_until FROM home_manual_vault WHERE user_id = ?
	`, userID).Scan(&failed, &lockedUntil); err != nil {
		return fmt.Errorf("read home manual attempts: %w", err)
	}
	failed++
	if failed >= 5 {
		lockedUntil = time.Now().Add(5 * time.Minute).UnixMilli()
		failed = 0
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE home_manual_vault SET failed_attempts = ?, locked_until = ?, updated_at = ?
		WHERE user_id = ?
	`, failed, lockedUntil, time.Now().UnixMilli(), userID)
	if err != nil {
		return fmt.Errorf("save home manual lockout: %w", err)
	}
	return nil
}

func (s *Store) passwordEnabled(ctx context.Context, userID string) (bool, error) {
	var hasPassword int
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(has_password, 0) FROM home_manual_vault WHERE user_id = ?
	`, userID).Scan(&hasPassword)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read home manual password state: %w", err)
	}
	return hasPassword == 1, nil
}

func (s *Store) logSecurityEvent(ctx context.Context, userID string, action string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO home_manual_security_events (id, user_id, action, created_at)
		VALUES (?, ?, ?, ?)
	`, uuid.NewString(), userID, action, time.Now().UnixMilli())
	return err
}

func emptyState() State {
	return State{
		SchemaVersion: 1,
		Devices:       []Device{},
		Networks:      []Network{},
		Contacts:      []Contact{},
		Reminders:     []Reminder{},
	}
}

func SanitizeState(state State) State {
	sanitized := state
	sanitized.Networks = make([]Network, len(state.Networks))
	for index, item := range state.Networks {
		sanitized.Networks[index] = item
		sanitized.Networks[index].WiFiPassword = ""
		sanitized.Networks[index].RouterAccount = ""
		sanitized.Networks[index].RouterPassword = ""
		sanitized.Networks[index].BroadbandAccount = ""
		sanitized.Networks[index].BroadbandPassword = ""
	}
	sanitized.Contacts = make([]Contact, len(state.Contacts))
	for index, item := range state.Contacts {
		sanitized.Contacts[index] = item
		sanitized.Contacts[index].Phone = ""
		sanitized.Contacts[index].PhoneAlt = ""
		sanitized.Contacts[index].Wechat = ""
		sanitized.Contacts[index].Address = ""
	}
	return sanitized
}

func validateState(state State, passwordEnabled bool) error {
	if state.SchemaVersion != 1 {
		return fmt.Errorf("%w: invalid schema", ErrInvalidInput)
	}
	if len(state.Devices) > MaxDevices {
		return fmt.Errorf("%w: too many devices", ErrInvalidInput)
	}
	if len(state.Networks) > MaxNetworks {
		return fmt.Errorf("%w: too many networks", ErrInvalidInput)
	}
	if len(state.Contacts) > MaxContacts {
		return fmt.Errorf("%w: too many contacts", ErrInvalidInput)
	}
	if len(state.Reminders) > MaxReminders {
		return fmt.Errorf("%w: too many reminders", ErrInvalidInput)
	}
	deviceIDs := map[string]bool{}
	for _, device := range state.Devices {
		if !validID(device.ID) || deviceIDs[device.ID] {
			return fmt.Errorf("%w: invalid device id", ErrInvalidInput)
		}
		deviceIDs[device.ID] = true
		if err := validateName(device.Name, MaxNameLength); err != nil {
			return err
		}
		if len([]rune(device.Brand)) > MaxNameLength {
			return fmt.Errorf("%w: brand too long", ErrInvalidInput)
		}
		if len([]rune(device.Model)) > MaxModelLength {
			return fmt.Errorf("%w: model too long", ErrInvalidInput)
		}
		if len([]rune(device.Room)) > MaxNameLength {
			return fmt.Errorf("%w: room too long", ErrInvalidInput)
		}
		if err := optionalDate(device.PurchaseDate); err != nil {
			return err
		}
		if err := optionalDate(device.WarrantyEndDate); err != nil {
			return err
		}
		if len([]rune(device.ManualText)) > MaxLongTextLength {
			return fmt.Errorf("%w: manual text too long", ErrInvalidInput)
		}
		if len([]rune(device.Note)) > MaxNoteLength {
			return fmt.Errorf("%w: device note too long", ErrInvalidInput)
		}
		if len(device.PhotoIDs) > MaxPhotoCount {
			return fmt.Errorf("%w: too many photos", ErrInvalidInput)
		}
		if device.FilterQuantity < 0 {
			return fmt.Errorf("%w: invalid filter quantity", ErrInvalidInput)
		}
		if device.FilterCycleDays < 0 {
			return fmt.Errorf("%w: invalid filter cycle", ErrInvalidInput)
		}
		if err := optionalDate(device.FilterChangedAt); err != nil {
			return err
		}
	}
	networkIDs := map[string]bool{}
	for _, network := range state.Networks {
		if !validID(network.ID) || networkIDs[network.ID] {
			return fmt.Errorf("%w: invalid network id", ErrInvalidInput)
		}
		networkIDs[network.ID] = true
		if err := validateName(network.Name, MaxNameLength); err != nil {
			return err
		}
		if len([]rune(network.SSID)) > MaxSSIDLength {
			return fmt.Errorf("%w: ssid too long", ErrInvalidInput)
		}
		if network.SecurityType != "" && !validNetworkSecurity(network.SecurityType) {
			return fmt.Errorf("%w: invalid network security", ErrInvalidInput)
		}
		if len([]rune(network.RouterURL)) > 200 {
			return fmt.Errorf("%w: router url too long", ErrInvalidInput)
		}
		if len([]rune(network.BroadbandCarrier)) > MaxNameLength {
			return fmt.Errorf("%w: carrier too long", ErrInvalidInput)
		}
		if len([]rune(network.Note)) > MaxNoteLength {
			return fmt.Errorf("%w: network note too long", ErrInvalidInput)
		}
		if !passwordEnabled && hasNetworkSecrets(network) {
			return ErrPasswordRequired
		}
	}
	contactIDs := map[string]bool{}
	for _, contact := range state.Contacts {
		if !validID(contact.ID) || contactIDs[contact.ID] {
			return fmt.Errorf("%w: invalid contact id", ErrInvalidInput)
		}
		contactIDs[contact.ID] = true
		if err := validateName(contact.Name, MaxContactName); err != nil {
			return err
		}
		if !validContactKind(contact.Kind) {
			return fmt.Errorf("%w: invalid contact kind", ErrInvalidInput)
		}
		if len([]rune(contact.Phone)) > MaxPhoneLength || len([]rune(contact.PhoneAlt)) > MaxPhoneLength {
			return fmt.Errorf("%w: phone too long", ErrInvalidInput)
		}
		if len([]rune(contact.Wechat)) > MaxWechatLength {
			return fmt.Errorf("%w: wechat too long", ErrInvalidInput)
		}
		if len([]rune(contact.Address)) > MaxAddressLength {
			return fmt.Errorf("%w: address too long", ErrInvalidInput)
		}
		if len([]rune(contact.ServiceHours)) > MaxServiceLength ||
			len([]rune(contact.ServiceScope)) > MaxServiceLength ||
			len([]rune(contact.Note)) > MaxNoteLength {
			return fmt.Errorf("%w: contact text too long", ErrInvalidInput)
		}
		if !passwordEnabled && hasContactSecrets(contact) {
			return ErrPasswordRequired
		}
	}
	reminderIDs := map[string]bool{}
	for _, reminder := range state.Reminders {
		if !validID(reminder.ID) || reminderIDs[reminder.ID] {
			return fmt.Errorf("%w: invalid reminder id", ErrInvalidInput)
		}
		reminderIDs[reminder.ID] = true
		if err := validateName(reminder.Title, MaxReminderTitle); err != nil {
			return err
		}
		if !validReminderKind(reminder.Kind) || !datePattern.MatchString(reminder.TargetDate) {
			return fmt.Errorf("%w: invalid reminder", ErrInvalidInput)
		}
		if reminder.CycleDays < 0 || len([]rune(reminder.Note)) > MaxNoteLength {
			return fmt.Errorf("%w: invalid reminder rule", ErrInvalidInput)
		}
		if reminder.Status != "pending" && reminder.Status != "done" {
			return fmt.Errorf("%w: invalid reminder status", ErrInvalidInput)
		}
	}
	return nil
}

func validID(value string) bool {
	return strings.TrimSpace(value) != "" && len(value) <= MaxIDLength
}

func validateName(value string, max int) error {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > max {
		return fmt.Errorf("%w: invalid name", ErrInvalidInput)
	}
	return nil
}

func optionalDate(value string) error {
	if value == "" {
		return nil
	}
	if !datePattern.MatchString(value) {
		return fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}
	return nil
}

func validNetworkSecurity(value string) bool {
	switch value {
	case "WPA2", "WPA3", "WEP", "open":
		return true
	default:
		return false
	}
}

func validContactKind(value string) bool {
	switch value {
	case "property", "broadband", "landlord", "custom":
		return true
	default:
		return false
	}
}

func validReminderKind(value string) bool {
	switch value {
	case "warranty", "filter", "maintenance", "custom":
		return true
	default:
		return false
	}
}

func validPassword(value string) bool {
	if utf8.RuneCountInString(value) < 6 || utf8.RuneCountInString(value) > 32 {
		return false
	}
	hasLetter := false
	hasDigit := false
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') {
			hasLetter = true
		}
		if char >= '0' && char <= '9' {
			hasDigit = true
		}
	}
	return hasLetter && hasDigit
}

func hasSecrets(state State) bool {
	for _, network := range state.Networks {
		if hasNetworkSecrets(network) {
			return true
		}
	}
	for _, contact := range state.Contacts {
		if hasContactSecrets(contact) {
			return true
		}
	}
	return false
}

func hasNetworkSecrets(network Network) bool {
	return network.WiFiPassword != "" ||
		network.RouterAccount != "" ||
		network.RouterPassword != "" ||
		network.BroadbandAccount != "" ||
		network.BroadbandPassword != ""
}

func hasContactSecrets(contact Contact) bool {
	return contact.Phone != "" ||
		contact.PhoneAlt != "" ||
		contact.Wechat != "" ||
		contact.Address != ""
}

func deriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
}

func encryptAESGCM(key []byte, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
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
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptAESGCM(key []byte, encoded string) ([]byte, error) {
	sealed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
}
