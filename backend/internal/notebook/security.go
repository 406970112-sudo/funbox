package notebook

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

const (
	notebookArgonMemory      = 64 * 1024
	notebookArgonIterations  = 4
	notebookArgonParallelism = 4
	notebookArgonKeyLength   = 32
	notebookSessionKeyLength = 32
)

var notebookMediaMagic = []byte("FBNOTE1")

type notebookSession struct {
	UserID    string
	DataKey   []byte
	ExpiresAt time.Time
}

type notebookSecurityRecord struct {
	PasswordHash    string
	KeySalt         string
	DataKeyEnc      string
	PasswordVersion int
}

type encryptedNotePayload struct {
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Checklist []ChecklistItem `json:"checklist"`
	Tags      []string        `json:"tags"`
}

func validNotebookPassword(password string) bool {
	length := utf8.RuneCountInString(password)
	return length >= MinNotebookPasswordRunes && length <= MaxNotebookPasswordRunes
}

func (s *Store) SecurityStatus(ctx context.Context, userID string, token string) (SecurityStatus, error) {
	status := SecurityStatus{}
	count, err := s.EncryptedNoteCount(ctx, userID)
	if err != nil {
		return status, err
	}
	status.EncryptedNoteCount = count
	record, err := s.loadSecurityRecord(ctx, userID)
	if errors.Is(err, ErrPasswordNotSet) {
		return status, nil
	}
	if err != nil {
		return status, err
	}
	status.HasPassword = true
	status.PasswordVersion = record.PasswordVersion
	if token == "" {
		return status, nil
	}
	session, err := s.sessionFromToken(userID, token)
	if err != nil {
		return status, nil
	}
	status.Unlocked = true
	expiresAt := session.ExpiresAt
	status.ExpiresAt = &expiresAt
	return status, nil
}

func (s *Store) EncryptedNoteCount(ctx context.Context, userID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM notebook_notes
		WHERE owner_id = ? AND encrypted = 1 AND status = 'active'
	`, userID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count encrypted notebook notes: %w", err)
	}
	return count, nil
}

func (s *Store) SetPassword(ctx context.Context, userID string, input PasswordInput) (SecurityStatus, error) {
	action := strings.TrimSpace(input.Action)
	if action == "" {
		action = "set"
	}
	if action != "set" && action != "change" {
		return SecurityStatus{}, ErrInvalidInput
	}
	record, err := s.loadSecurityRecord(ctx, userID)
	hasPassword := err == nil
	if err != nil && !errors.Is(err, ErrPasswordNotSet) {
		return SecurityStatus{}, err
	}
	if !validNotebookPassword(input.New) {
		return SecurityStatus{}, ErrPasswordInvalid
	}
	if action == "set" && hasPassword {
		return SecurityStatus{}, ErrPasswordAlreadySet
	}
	if action == "change" && !hasPassword {
		return SecurityStatus{}, ErrPasswordNotSet
	}

	var dataKey []byte
	if action == "set" {
		dataKey = make([]byte, notebookSessionKeyLength)
		if _, err := rand.Read(dataKey); err != nil {
			return SecurityStatus{}, fmt.Errorf("generate notebook data key: %w", err)
		}
	} else {
		if err := bcrypt.CompareHashAndPassword([]byte(record.PasswordHash), notebookPasswordHashInput(input.Current)); err != nil {
			return SecurityStatus{}, ErrPasswordMismatch
		}
		dataKey, err = decryptNotebookSecret(input.Current, record.KeySalt, record.DataKeyEnc)
		if err != nil {
			return SecurityStatus{}, fmt.Errorf("decrypt notebook data key: %w", err)
		}
	}

	passwordHash, err := bcrypt.GenerateFromPassword(notebookPasswordHashInput(input.New), bcrypt.DefaultCost)
	if err != nil {
		return SecurityStatus{}, fmt.Errorf("hash notebook password: %w", err)
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return SecurityStatus{}, fmt.Errorf("generate notebook password salt: %w", err)
	}
	key := deriveNotebookKey(input.New, salt)
	dataKeyEnc, err := encryptNotebookBytes(key, dataKey)
	if err != nil {
		return SecurityStatus{}, fmt.Errorf("wrap notebook data key: %w", err)
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SecurityStatus{}, fmt.Errorf("begin notebook password update: %w", err)
	}
	defer tx.Rollback()
	if action == "set" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO notebook_security (
				owner_id, password_hash, key_salt, data_key_enc, password_version, created_at, updated_at
			) VALUES (?, ?, ?, ?, 1, ?, ?)
		`, userID, string(passwordHash), base64.RawStdEncoding.EncodeToString(salt),
			base64.RawStdEncoding.EncodeToString(dataKeyEnc), now.UnixMilli(), now.UnixMilli())
	} else {
		_, err = tx.ExecContext(ctx, `
			UPDATE notebook_security
			SET password_hash = ?, key_salt = ?, data_key_enc = ?, password_version = password_version + 1, updated_at = ?
			WHERE owner_id = ?
		`, string(passwordHash), base64.RawStdEncoding.EncodeToString(salt),
			base64.RawStdEncoding.EncodeToString(dataKeyEnc), now.UnixMilli(), userID)
	}
	if err != nil {
		return SecurityStatus{}, fmt.Errorf("save notebook password: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return SecurityStatus{}, fmt.Errorf("commit notebook password update: %w", err)
	}
	s.clearSessions(userID)
	return s.SecurityStatus(ctx, userID, "")
}

func (s *Store) Unlock(ctx context.Context, userID string, password string) (string, int, error) {
	record, err := s.loadSecurityRecord(ctx, userID)
	if err != nil {
		return "", 0, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(record.PasswordHash), notebookPasswordHashInput(password)); err != nil {
		return "", 0, ErrPasswordMismatch
	}
	dataKey, err := decryptNotebookSecret(password, record.KeySalt, record.DataKeyEnc)
	if err != nil {
		return "", 0, fmt.Errorf("decrypt notebook data key: %w", err)
	}
	tokenBytes := make([]byte, notebookSessionKeyLength)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", 0, fmt.Errorf("generate notebook unlock token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	expiresAt := time.Now().UTC().Add(NotebookUnlockTTL)
	s.mu.Lock()
	s.pruneExpiredSessionsLocked(time.Now().UTC())
	s.sessions[token] = notebookSession{
		UserID:    userID,
		DataKey:   append([]byte(nil), dataKey...),
		ExpiresAt: expiresAt,
	}
	s.mu.Unlock()
	return token, int(NotebookUnlockTTL.Seconds()), nil
}

func (s *Store) Lock(userID string, token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token = strings.TrimSpace(token)
	for existingToken, session := range s.sessions {
		if session.UserID != userID {
			continue
		}
		if token == "" || existingToken == token {
			delete(s.sessions, existingToken)
		}
	}
}

func (s *Store) GetDataKey(userID string, token string) ([]byte, error) {
	session, err := s.sessionFromToken(userID, token)
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), session.DataKey...), nil
}

func (s *Store) sessionFromToken(userID string, token string) (notebookSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return notebookSession{}, ErrLocked
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredSessionsLocked(now)
	session, ok := s.sessions[token]
	if !ok || session.UserID != userID || !session.ExpiresAt.After(now) {
		delete(s.sessions, token)
		return notebookSession{}, ErrLocked
	}
	return notebookSession{
		UserID:    session.UserID,
		DataKey:   append([]byte(nil), session.DataKey...),
		ExpiresAt: session.ExpiresAt,
	}, nil
}

func (s *Store) pruneExpiredSessionsLocked(now time.Time) {
	for token, session := range s.sessions {
		if !session.ExpiresAt.After(now) {
			delete(s.sessions, token)
		}
	}
}

func (s *Store) clearSessions(userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for token, session := range s.sessions {
		if session.UserID == userID {
			delete(s.sessions, token)
		}
	}
}

func (s *Store) loadSecurityRecord(ctx context.Context, userID string) (notebookSecurityRecord, error) {
	var record notebookSecurityRecord
	err := s.db.QueryRowContext(ctx, `
		SELECT password_hash, key_salt, data_key_enc, password_version
		FROM notebook_security WHERE owner_id = ?
	`, userID).Scan(&record.PasswordHash, &record.KeySalt, &record.DataKeyEnc, &record.PasswordVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return notebookSecurityRecord{}, ErrPasswordNotSet
	}
	if err != nil {
		return notebookSecurityRecord{}, fmt.Errorf("load notebook security: %w", err)
	}
	return record, nil
}

func (s *Store) ResetEncryption(ctx context.Context, userID string, confirmation string) ([]string, error) {
	if strings.TrimSpace(confirmation) != "DELETE" {
		return nil, ErrResetConfirmation
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.stored_name
		FROM notebook_media m
		JOIN notebook_notes n ON n.id = m.note_id AND n.owner_id = m.owner_id
		WHERE n.owner_id = ? AND n.encrypted = 1
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list encrypted notebook media for reset: %w", err)
	}
	storedNames := []string{}
	for rows.Next() {
		var storedName string
		if err := rows.Scan(&storedName); err != nil {
			rows.Close()
			return nil, err
		}
		storedNames = append(storedNames, storedName)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin notebook encryption reset: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM notebook_notes WHERE owner_id = ? AND encrypted = 1`, userID); err != nil {
		return nil, fmt.Errorf("delete encrypted notebook notes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM notebook_security WHERE owner_id = ?`, userID); err != nil {
		return nil, fmt.Errorf("delete notebook security: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit notebook encryption reset: %w", err)
	}
	s.clearSessions(userID)
	return storedNames, nil
}

func notebookPasswordHashInput(password string) []byte {
	digest := sha256.Sum256([]byte(password))
	return digest[:]
}

func deriveNotebookKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, notebookArgonIterations, notebookArgonMemory, notebookArgonParallelism, notebookArgonKeyLength)
}

func decryptNotebookSecret(password, encodedSalt, encodedSecret string) ([]byte, error) {
	salt, err := base64.RawStdEncoding.DecodeString(encodedSalt)
	if err != nil {
		return nil, err
	}
	secret, err := base64.RawStdEncoding.DecodeString(encodedSecret)
	if err != nil {
		return nil, err
	}
	key := deriveNotebookKey(password, salt)
	return decryptNotebookBytes(key, secret)
}

func encryptNotebookBytes(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func decryptNotebookBytes(key, sealed []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("invalid notebook ciphertext")
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
}

func newNoteEncryption(masterKey []byte, title, body string, checklist []ChecklistItem, tags []string) (payload string, wrappedKey string, err error) {
	noteKey := make([]byte, notebookSessionKeyLength)
	if _, err := rand.Read(noteKey); err != nil {
		return "", "", err
	}
	encodedPayload, err := sealNotePayload(noteKey, title, body, checklist, tags)
	if err != nil {
		return "", "", err
	}
	encodedKey, err := encryptNotebookBytes(masterKey, noteKey)
	if err != nil {
		return "", "", err
	}
	return encodedPayload, base64.RawStdEncoding.EncodeToString(encodedKey), nil
}

func reencryptNotePayload(masterKey []byte, wrappedKey, title, body string, checklist []ChecklistItem, tags []string) (string, error) {
	encodedKey, err := base64.RawStdEncoding.DecodeString(wrappedKey)
	if err != nil {
		return "", err
	}
	noteKey, err := decryptNotebookBytes(masterKey, encodedKey)
	if err != nil {
		return "", err
	}
	return sealNotePayload(noteKey, title, body, checklist, tags)
}

func sealNotePayload(noteKey []byte, title, body string, checklist []ChecklistItem, tags []string) (string, error) {
	plain, err := json.Marshal(encryptedNotePayload{Title: title, Body: body, Checklist: checklist, Tags: tags})
	if err != nil {
		return "", err
	}
	encodedPayload, err := encryptNotebookBytes(noteKey, plain)
	if err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(encodedPayload), nil
}

func encryptNotebookMedia(key, plaintext []byte) ([]byte, error) {
	sealed, err := encryptNotebookBytes(key, plaintext)
	if err != nil {
		return nil, err
	}
	result := make([]byte, 0, len(notebookMediaMagic)+len(sealed))
	result = append(result, notebookMediaMagic...)
	result = append(result, sealed...)
	return result, nil
}

func decryptNotebookMedia(key, contents []byte) ([]byte, error) {
	if len(contents) < len(notebookMediaMagic) || string(contents[:len(notebookMediaMagic)]) != string(notebookMediaMagic) {
		return nil, errors.New("invalid encrypted notebook media")
	}
	return decryptNotebookBytes(key, contents[len(notebookMediaMagic):])
}

func decryptNoteContent(item *Note, masterKey []byte) error {
	if item == nil || !item.Encrypted {
		return nil
	}
	wrappedKey, err := base64.RawStdEncoding.DecodeString(item.noteKeyEnc)
	if err != nil {
		return fmt.Errorf("decode notebook note key: %w", err)
	}
	noteKey, err := decryptNotebookBytes(masterKey, wrappedKey)
	if err != nil {
		return fmt.Errorf("decrypt notebook note key: %w", err)
	}
	sealed, err := base64.RawStdEncoding.DecodeString(item.encryptedPayload)
	if err != nil {
		return fmt.Errorf("decode notebook encrypted payload: %w", err)
	}
	plain, err := decryptNotebookBytes(noteKey, sealed)
	if err != nil {
		return fmt.Errorf("decrypt notebook note payload: %w", err)
	}
	var payload encryptedNotePayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		return fmt.Errorf("decode notebook note payload: %w", err)
	}
	item.Title = payload.Title
	item.Body = payload.Body
	item.Checklist = payload.Checklist
	item.Tags = payload.Tags
	if item.Checklist == nil {
		item.Checklist = []ChecklistItem{}
	}
	if item.Tags == nil {
		item.Tags = []string{}
	}
	item.Locked = false
	return nil
}

func redactEncryptedNote(item *Note) {
	if item == nil || !item.Encrypted {
		return
	}
	item.Title = ""
	item.Body = ""
	item.Checklist = []ChecklistItem{}
	item.Tags = []string{}
	item.Media = []Media{}
	item.Locked = true
}
