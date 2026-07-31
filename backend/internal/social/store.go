package social

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	ErrAlreadyFriends       = errors.New("users are already friends")
	ErrConversationNotFound = errors.New("conversation not found")
	ErrForbidden            = errors.New("operation is forbidden")
	ErrMessageInvalid       = errors.New("message is invalid")
	ErrNotFound             = errors.New("social record not found")
	ErrRequestExists        = errors.New("friend request already exists")
	ErrSelfRequest          = errors.New("cannot add yourself")
)

type UserSummary struct {
	ID          string
	Username    string
	DisplayName string
	AvatarFile  string
}

type FriendRequest struct {
	ID        string
	Sender    UserSummary
	Recipient UserSummary
	Status    string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type FriendRequests struct {
	Incoming []FriendRequest
	Outgoing []FriendRequest
}

type Friend struct {
	User      UserSummary
	CreatedAt time.Time
}

type Message struct {
	ID              string
	ConversationID  string
	SenderID        string
	ClientMessageID string
	Body            string
	CreatedAt       time.Time
	Read            bool
}

type Conversation struct {
	ID          string
	Peer        UserSummary
	LastMessage *Message
	UnreadCount int
	UpdatedAt   time.Time
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
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open social database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS friend_requests (
			id TEXT PRIMARY KEY,
			sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(sender_id, recipient_id),
			CHECK(sender_id <> recipient_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_status
			ON friend_requests(recipient_id, status, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS friendships (
			user_one_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			user_two_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(user_one_id, user_two_id),
			CHECK(user_one_id < user_two_id)
		)`,
		`CREATE TABLE IF NOT EXISTS conversations (
			id TEXT PRIMARY KEY,
			user_one_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			user_two_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(user_one_id, user_two_id),
			CHECK(user_one_id < user_two_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
			ON conversations(updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			client_message_id TEXT NOT NULL,
			body TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(sender_id, client_message_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
			ON messages(conversation_id, created_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS conversation_reads (
			conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			last_read_at INTEGER NOT NULL,
			PRIMARY KEY(conversation_id, user_id)
		)`,
	}
	statements = append(statements, gameSocialMigrationStatements()...)

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run social database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) SearchUsers(ctx context.Context, currentUserID string, query string) ([]UserSummary, error) {
	normalized := strings.ToLower(strings.TrimSpace(query))
	if normalized == "" {
		return []UserSummary{}, nil
	}
	escaped := escapeLike(normalized)

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, username, display_name, avatar_file
		 FROM users
		 WHERE id <> ?
		   AND (LOWER(username) LIKE ? ESCAPE '\' OR LOWER(display_name) LIKE ? ESCAPE '\')
		 ORDER BY CASE WHEN username = ? COLLATE NOCASE THEN 0 ELSE 1 END,
		          username COLLATE NOCASE
		 LIMIT 20`,
		currentUserID,
		escaped+"%",
		"%"+escaped+"%",
		normalized,
	)
	if err != nil {
		return nil, fmt.Errorf("search users: %w", err)
	}
	defer rows.Close()

	result := make([]UserSummary, 0)
	for rows.Next() {
		var account UserSummary
		if err := rows.Scan(&account.ID, &account.Username, &account.DisplayName, &account.AvatarFile); err != nil {
			return nil, fmt.Errorf("scan searched user: %w", err)
		}
		result = append(result, account)
	}
	return result, rows.Err()
}

func (s *Store) CreateFriendRequest(
	ctx context.Context,
	senderID string,
	recipientID string,
) (FriendRequest, error) {
	if senderID == recipientID {
		return FriendRequest{}, ErrSelfRequest
	}
	one, two := orderedUsers(senderID, recipientID)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FriendRequest{}, fmt.Errorf("begin friend request: %w", err)
	}
	defer tx.Rollback()

	var recipientExists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id = ?`, recipientID).Scan(&recipientExists); err != nil {
		return FriendRequest{}, fmt.Errorf("check friend request recipient: %w", err)
	}
	if recipientExists == 0 {
		return FriendRequest{}, ErrNotFound
	}

	var friendshipExists int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM friendships WHERE user_one_id = ? AND user_two_id = ?`,
		one,
		two,
	).Scan(&friendshipExists); err != nil {
		return FriendRequest{}, fmt.Errorf("check friendship: %w", err)
	}
	if friendshipExists > 0 {
		return FriendRequest{}, ErrAlreadyFriends
	}

	var reversePending int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM friend_requests
		 WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'`,
		recipientID,
		senderID,
	).Scan(&reversePending); err != nil {
		return FriendRequest{}, fmt.Errorf("check reverse friend request: %w", err)
	}
	if reversePending > 0 {
		return FriendRequest{}, ErrRequestExists
	}

	var existingID string
	var existingStatus string
	err = tx.QueryRowContext(
		ctx,
		`SELECT id, status FROM friend_requests WHERE sender_id = ? AND recipient_id = ?`,
		senderID,
		recipientID,
	).Scan(&existingID, &existingStatus)
	now := time.Now().UTC()
	nowMillis := now.UnixMilli()
	requestID := uuid.NewString()
	switch {
	case errors.Is(err, sql.ErrNoRows):
		_, err = tx.ExecContext(
			ctx,
			`INSERT INTO friend_requests
			 (id, sender_id, recipient_id, status, created_at, updated_at)
			 VALUES (?, ?, ?, 'pending', ?, ?)`,
			requestID,
			senderID,
			recipientID,
			nowMillis,
			nowMillis,
		)
	case err != nil:
		return FriendRequest{}, fmt.Errorf("read existing friend request: %w", err)
	case existingStatus == "pending" || existingStatus == "accepted":
		return FriendRequest{}, ErrRequestExists
	default:
		requestID = existingID
		_, err = tx.ExecContext(
			ctx,
			`UPDATE friend_requests
			 SET status = 'pending', created_at = ?, updated_at = ? WHERE id = ?`,
			nowMillis,
			nowMillis,
			requestID,
		)
	}
	if err != nil {
		return FriendRequest{}, fmt.Errorf("write friend request: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return FriendRequest{}, fmt.Errorf("commit friend request: %w", err)
	}
	return s.getFriendRequest(ctx, requestID)
}

func (s *Store) ListFriendRequests(ctx context.Context, userID string) (FriendRequests, error) {
	incoming, err := s.listFriendRequests(ctx, "recipient_id", userID)
	if err != nil {
		return FriendRequests{}, err
	}
	outgoing, err := s.listFriendRequests(ctx, "sender_id", userID)
	if err != nil {
		return FriendRequests{}, err
	}
	return FriendRequests{Incoming: incoming, Outgoing: outgoing}, nil
}

func (s *Store) RespondToFriendRequest(
	ctx context.Context,
	requestID string,
	userID string,
	accept bool,
) (FriendRequest, *Conversation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FriendRequest{}, nil, fmt.Errorf("begin friend request response: %w", err)
	}
	defer tx.Rollback()

	var senderID string
	var recipientID string
	var status string
	err = tx.QueryRowContext(
		ctx,
		`SELECT sender_id, recipient_id, status FROM friend_requests WHERE id = ?`,
		requestID,
	).Scan(&senderID, &recipientID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return FriendRequest{}, nil, ErrNotFound
	}
	if err != nil {
		return FriendRequest{}, nil, fmt.Errorf("read friend request: %w", err)
	}
	if recipientID != userID {
		return FriendRequest{}, nil, ErrForbidden
	}
	if status != "pending" {
		return FriendRequest{}, nil, ErrRequestExists
	}

	now := time.Now().UTC()
	nowMillis := now.UnixMilli()
	nextStatus := "rejected"
	if accept {
		nextStatus = "accepted"
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?`,
		nextStatus,
		nowMillis,
		requestID,
	); err != nil {
		return FriendRequest{}, nil, fmt.Errorf("update friend request: %w", err)
	}

	var conversationID string
	if accept {
		one, two := orderedUsers(senderID, recipientID)
		if _, err := tx.ExecContext(
			ctx,
			`INSERT OR IGNORE INTO friendships (user_one_id, user_two_id, created_at)
			 VALUES (?, ?, ?)`,
			one,
			two,
			nowMillis,
		); err != nil {
			return FriendRequest{}, nil, fmt.Errorf("create friendship: %w", err)
		}

		conversationID = uuid.NewString()
		if _, err := tx.ExecContext(
			ctx,
			`INSERT OR IGNORE INTO conversations
			 (id, user_one_id, user_two_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)`,
			conversationID,
			one,
			two,
			nowMillis,
			nowMillis,
		); err != nil {
			return FriendRequest{}, nil, fmt.Errorf("create conversation: %w", err)
		}
		if err := tx.QueryRowContext(
			ctx,
			`SELECT id FROM conversations WHERE user_one_id = ? AND user_two_id = ?`,
			one,
			two,
		).Scan(&conversationID); err != nil {
			return FriendRequest{}, nil, fmt.Errorf("read conversation: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return FriendRequest{}, nil, fmt.Errorf("commit friend request response: %w", err)
	}
	request, err := s.getFriendRequest(ctx, requestID)
	if err != nil {
		return FriendRequest{}, nil, err
	}
	if !accept {
		return request, nil, nil
	}
	conversation, err := s.GetConversation(ctx, conversationID, userID)
	return request, &conversation, err
}

func (s *Store) ListFriends(ctx context.Context, userID string) ([]Friend, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT u.id, u.username, u.display_name, u.avatar_file, f.created_at
		 FROM friendships f
		 JOIN users u ON u.id = CASE
		   WHEN f.user_one_id = ? THEN f.user_two_id ELSE f.user_one_id END
		 WHERE f.user_one_id = ? OR f.user_two_id = ?
		 ORDER BY u.display_name COLLATE NOCASE, u.username COLLATE NOCASE`,
		userID,
		userID,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list friends: %w", err)
	}
	defer rows.Close()

	result := make([]Friend, 0)
	for rows.Next() {
		var friend Friend
		var createdAt int64
		if err := rows.Scan(
			&friend.User.ID,
			&friend.User.Username,
			&friend.User.DisplayName,
			&friend.User.AvatarFile,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan friend: %w", err)
		}
		friend.CreatedAt = time.UnixMilli(createdAt).UTC()
		result = append(result, friend)
	}
	return result, rows.Err()
}

func (s *Store) ListFriendIDs(ctx context.Context, userID string) ([]string, error) {
	friends, err := s.ListFriends(ctx, userID)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(friends))
	for _, friend := range friends {
		result = append(result, friend.User.ID)
	}
	return result, nil
}

func (s *Store) ListConversations(ctx context.Context, userID string) ([]Conversation, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT
		   c.id, c.updated_at,
		   u.id, u.username, u.display_name, u.avatar_file,
		   lm.id, lm.sender_id, lm.client_message_id, lm.body, lm.created_at,
		   CASE WHEN lm.id IS NULL THEN 0 ELSE
		     COALESCE((SELECT MAX(cr.last_read_at) >= lm.created_at
		               FROM conversation_reads cr
		               WHERE cr.conversation_id = c.id AND cr.user_id <> ?), 0)
		   END,
		   (SELECT COUNT(*)
		    FROM messages unread
		    WHERE unread.conversation_id = c.id
		      AND unread.sender_id <> ?
		      AND unread.created_at > COALESCE(
		        (SELECT cr.last_read_at FROM conversation_reads cr
		         WHERE cr.conversation_id = c.id AND cr.user_id = ?), 0))
		 FROM conversations c
		 JOIN users u ON u.id = CASE
		   WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
		 LEFT JOIN messages lm ON lm.id = (
		   SELECT latest.id FROM messages latest
		   WHERE latest.conversation_id = c.id
		   ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1)
		 WHERE c.user_one_id = ? OR c.user_two_id = ?
		 ORDER BY COALESCE(lm.created_at, c.updated_at) DESC, c.id DESC`,
		userID,
		userID,
		userID,
		userID,
		userID,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list conversations: %w", err)
	}
	defer rows.Close()

	result := make([]Conversation, 0)
	for rows.Next() {
		conversation, err := scanConversation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, conversation)
	}
	return result, rows.Err()
}

func (s *Store) GetConversation(
	ctx context.Context,
	conversationID string,
	userID string,
) (Conversation, error) {
	conversations, err := s.ListConversations(ctx, userID)
	if err != nil {
		return Conversation{}, err
	}
	for _, conversation := range conversations {
		if conversation.ID == conversationID {
			return conversation, nil
		}
	}
	return Conversation{}, ErrConversationNotFound
}

func (s *Store) ListMessages(
	ctx context.Context,
	conversationID string,
	userID string,
	before int64,
	limit int,
) ([]Message, error) {
	peerID, err := s.conversationPeer(ctx, conversationID, userID)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	if before <= 0 {
		before = time.Now().UTC().Add(time.Second).UnixMilli()
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id,
		        m.body, m.created_at,
		        COALESCE((SELECT cr.last_read_at >= m.created_at
		                  FROM conversation_reads cr
		                  WHERE cr.conversation_id = m.conversation_id
		                    AND cr.user_id = ?), 0)
		 FROM messages m
		 WHERE m.conversation_id = ? AND m.created_at < ?
		 ORDER BY m.created_at DESC, m.id DESC
		 LIMIT ?`,
		peerID,
		conversationID,
		before,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	result := make([]Message, 0)
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	slices.Reverse(result)
	return result, nil
}

func (s *Store) SendMessage(
	ctx context.Context,
	conversationID string,
	senderID string,
	clientMessageID string,
	body string,
) (Message, string, error) {
	normalizedBody := strings.TrimSpace(body)
	if strings.TrimSpace(clientMessageID) == "" || utf8.RuneCountInString(normalizedBody) < 1 || utf8.RuneCountInString(normalizedBody) > 2000 {
		return Message{}, "", ErrMessageInvalid
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, "", fmt.Errorf("begin message: %w", err)
	}
	defer tx.Rollback()

	peerID, err := conversationPeerFrom(tx.QueryRowContext(ctx,
		`SELECT user_one_id, user_two_id FROM conversations WHERE id = ?`,
		conversationID,
	), senderID)
	if err != nil {
		return Message{}, "", err
	}

	var existing Message
	var existingCreatedAt int64
	err = tx.QueryRowContext(
		ctx,
		`SELECT id, conversation_id, sender_id, client_message_id, body, created_at
		 FROM messages WHERE sender_id = ? AND client_message_id = ?`,
		senderID,
		clientMessageID,
	).Scan(
		&existing.ID,
		&existing.ConversationID,
		&existing.SenderID,
		&existing.ClientMessageID,
		&existing.Body,
		&existingCreatedAt,
	)
	if err == nil {
		existing.CreatedAt = time.UnixMilli(existingCreatedAt).UTC()
		return existing, peerID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Message{}, "", fmt.Errorf("read existing message: %w", err)
	}

	now := time.Now().UTC()
	created := Message{
		ID:              uuid.NewString(),
		ConversationID:  conversationID,
		SenderID:        senderID,
		ClientMessageID: clientMessageID,
		Body:            normalizedBody,
		CreatedAt:       now,
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO messages
		 (id, conversation_id, sender_id, client_message_id, body, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		created.ID,
		created.ConversationID,
		created.SenderID,
		created.ClientMessageID,
		created.Body,
		created.CreatedAt.UnixMilli(),
	); err != nil {
		return Message{}, "", fmt.Errorf("insert message: %w", err)
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE conversations SET updated_at = ? WHERE id = ?`,
		created.CreatedAt.UnixMilli(),
		conversationID,
	); err != nil {
		return Message{}, "", fmt.Errorf("update conversation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Message{}, "", fmt.Errorf("commit message: %w", err)
	}
	return created, peerID, nil
}

func (s *Store) MarkConversationRead(
	ctx context.Context,
	conversationID string,
	userID string,
) (time.Time, string, error) {
	peerID, err := s.conversationPeer(ctx, conversationID, userID)
	if err != nil {
		return time.Time{}, "", err
	}
	readAt := time.Now().UTC()
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(conversation_id, user_id) DO UPDATE SET
		 last_read_at = MAX(conversation_reads.last_read_at, excluded.last_read_at)`,
		conversationID,
		userID,
		readAt.UnixMilli(),
	); err != nil {
		return time.Time{}, "", fmt.Errorf("mark conversation read: %w", err)
	}
	return readAt, peerID, nil
}

func (s *Store) getFriendRequest(ctx context.Context, requestID string) (FriendRequest, error) {
	row := s.db.QueryRowContext(ctx, friendRequestSelect+` WHERE fr.id = ?`, requestID)
	return scanFriendRequest(row)
}

func (s *Store) listFriendRequests(
	ctx context.Context,
	ownerColumn string,
	userID string,
) ([]FriendRequest, error) {
	if ownerColumn != "recipient_id" && ownerColumn != "sender_id" {
		return nil, errors.New("invalid friend request owner column")
	}
	rows, err := s.db.QueryContext(
		ctx,
		friendRequestSelect+` WHERE fr.`+ownerColumn+` = ?
		 ORDER BY CASE fr.status WHEN 'pending' THEN 0 ELSE 1 END, fr.updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list friend requests: %w", err)
	}
	defer rows.Close()

	result := make([]FriendRequest, 0)
	for rows.Next() {
		request, err := scanFriendRequest(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, request)
	}
	return result, rows.Err()
}

func (s *Store) conversationPeer(ctx context.Context, conversationID string, userID string) (string, error) {
	return conversationPeerFrom(s.db.QueryRowContext(
		ctx,
		`SELECT user_one_id, user_two_id FROM conversations WHERE id = ?`,
		conversationID,
	), userID)
}

type rowScanner interface {
	Scan(...any) error
}

func conversationPeerFrom(row rowScanner, userID string) (string, error) {
	var one string
	var two string
	if err := row.Scan(&one, &two); errors.Is(err, sql.ErrNoRows) {
		return "", ErrConversationNotFound
	} else if err != nil {
		return "", fmt.Errorf("read conversation members: %w", err)
	}
	if userID == one {
		return two, nil
	}
	if userID == two {
		return one, nil
	}
	return "", ErrForbidden
}

const friendRequestSelect = `SELECT
	fr.id, fr.status, fr.created_at, fr.updated_at,
	sender.id, sender.username, sender.display_name, sender.avatar_file,
	recipient.id, recipient.username, recipient.display_name, recipient.avatar_file
	FROM friend_requests fr
	JOIN users sender ON sender.id = fr.sender_id
	JOIN users recipient ON recipient.id = fr.recipient_id`

func scanFriendRequest(row rowScanner) (FriendRequest, error) {
	var request FriendRequest
	var createdAt int64
	var updatedAt int64
	err := row.Scan(
		&request.ID,
		&request.Status,
		&createdAt,
		&updatedAt,
		&request.Sender.ID,
		&request.Sender.Username,
		&request.Sender.DisplayName,
		&request.Sender.AvatarFile,
		&request.Recipient.ID,
		&request.Recipient.Username,
		&request.Recipient.DisplayName,
		&request.Recipient.AvatarFile,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return FriendRequest{}, ErrNotFound
	}
	if err != nil {
		return FriendRequest{}, fmt.Errorf("scan friend request: %w", err)
	}
	request.CreatedAt = time.UnixMilli(createdAt).UTC()
	request.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return request, nil
}

func scanConversation(row rowScanner) (Conversation, error) {
	var conversation Conversation
	var updatedAt int64
	var messageID sql.NullString
	var senderID sql.NullString
	var clientMessageID sql.NullString
	var body sql.NullString
	var createdAt sql.NullInt64
	var read bool
	if err := row.Scan(
		&conversation.ID,
		&updatedAt,
		&conversation.Peer.ID,
		&conversation.Peer.Username,
		&conversation.Peer.DisplayName,
		&conversation.Peer.AvatarFile,
		&messageID,
		&senderID,
		&clientMessageID,
		&body,
		&createdAt,
		&read,
		&conversation.UnreadCount,
	); err != nil {
		return Conversation{}, fmt.Errorf("scan conversation: %w", err)
	}
	conversation.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	if messageID.Valid {
		conversation.LastMessage = &Message{
			ID:              messageID.String,
			ConversationID:  conversation.ID,
			SenderID:        senderID.String,
			ClientMessageID: clientMessageID.String,
			Body:            body.String,
			CreatedAt:       time.UnixMilli(createdAt.Int64).UTC(),
			Read:            read,
		}
	}
	return conversation, nil
}

func scanMessage(row rowScanner) (Message, error) {
	var message Message
	var createdAt int64
	if err := row.Scan(
		&message.ID,
		&message.ConversationID,
		&message.SenderID,
		&message.ClientMessageID,
		&message.Body,
		&createdAt,
		&message.Read,
	); err != nil {
		return Message{}, fmt.Errorf("scan message: %w", err)
	}
	message.CreatedAt = time.UnixMilli(createdAt).UTC()
	return message, nil
}

func orderedUsers(first string, second string) (string, string) {
	if first < second {
		return first, second
	}
	return second, first
}

func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}
