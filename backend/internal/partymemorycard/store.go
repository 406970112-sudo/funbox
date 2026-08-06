package partymemorycard

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
	ErrNotFound          = errors.New("party memory card not found")
	ErrInvalidInput      = errors.New("party memory card invalid input")
	ErrDatabasePathEmpty = errors.New("party memory card database path empty")
	ErrForbidden         = errors.New("party memory card forbidden")
	ErrParticipantLimit  = errors.New("party memory card participant limit")
)

const (
	MaxTitleLength        = 40
	MaxVenueNameLength    = 60
	MaxVenueAddressLength = 120
	MaxParticipantName    = 40
	MaxDishNameLength     = 40
	MaxNoteLength         = 100
	MinParticipants       = 2
	MaxParticipants       = 50
	MaxPhotos             = 30
	MaxListCards          = 200
)

var supportedDimensions = map[string]bool{
	"parking":  true,
	"taste":    true,
	"ambience": true,
	"service":  true,
	"location": true,
	"other":    true,
}

type Card struct {
	ID                  string         `json:"id"`
	OwnerUserID         string         `json:"ownerUserId"`
	Title               string         `json:"title"`
	PartyDate           time.Time      `json:"partyDate"`
	VenueName           string         `json:"venueName"`
	VenueAddress        string         `json:"venueAddress"`
	HostType            string         `json:"hostType"`
	HostParticipantID   string         `json:"hostParticipantId,omitempty"`
	HostParticipantName string         `json:"hostParticipantName"`
	TotalAmountCents    *int64         `json:"totalAmountCents,omitempty"`
	ExpenseVisibility   string         `json:"expenseVisibility"`
	CardStatus          string         `json:"cardStatus"`
	ShareMode           string         `json:"shareMode"`
	ParticipantCount    int            `json:"participantCount"`
	PhotoCount          int            `json:"photoCount"`
	DishCount           int            `json:"dishCount"`
	AgainVotes          map[string]int `json:"againVotes"`
	CoverPhotoID        string         `json:"coverPhotoId,omitempty"`
	CoverPhotoURL       string         `json:"coverPhotoUrl,omitempty"`
	Archived            bool           `json:"archived"`
	CanEdit             bool           `json:"canEdit"`
	CanCollaborate      bool           `json:"canCollaborate"`
	CreatedAt           time.Time      `json:"createdAt"`
	UpdatedAt           time.Time      `json:"updatedAt"`
}

type Participant struct {
	ID           string    `json:"id"`
	CardID       string    `json:"cardId"`
	UserID       *string   `json:"userId,omitempty"`
	Name         string    `json:"name"`
	Kind         string    `json:"kind"`
	InviteStatus string    `json:"inviteStatus"`
	CanEdit      bool      `json:"canEdit"`
	SortOrder    int       `json:"sortOrder"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Photo struct {
	ID        string     `json:"id"`
	CardID    string     `json:"cardId"`
	UserID    string     `json:"userId"`
	FileURL   string     `json:"fileUrl"`
	Kind      string     `json:"kind"`
	TakenAt   *time.Time `json:"takenAt,omitempty"`
	SortOrder int        `json:"sortOrder"`
	CreatedAt time.Time  `json:"createdAt"`
}

type Dish struct {
	ID              string    `json:"id"`
	CardID          string    `json:"cardId"`
	CreatedByUserID string    `json:"createdByUserId"`
	Name            string    `json:"name"`
	PriceCents      *int64    `json:"priceCents,omitempty"`
	LikeCount       int       `json:"likeCount"`
	OkCount         int       `json:"okCount"`
	NoCount         int       `json:"noCount"`
	SortOrder       int       `json:"sortOrder"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type DishVote struct {
	ID            string    `json:"id"`
	DishID        string    `json:"dishId"`
	ParticipantID string    `json:"participantId"`
	Rating        string    `json:"rating"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type VenueNote struct {
	ID              string    `json:"id"`
	CardID          string    `json:"cardId"`
	ParticipantID   string    `json:"participantId"`
	ParticipantName string    `json:"participantName"`
	Dimension       string    `json:"dimension"`
	Content         string    `json:"content"`
	CreatedAt       time.Time `json:"createdAt"`
}

type AgainVote struct {
	ID              string    `json:"id"`
	CardID          string    `json:"cardId"`
	ParticipantID   string    `json:"participantId"`
	ParticipantName string    `json:"participantName"`
	Vote            string    `json:"vote"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type ActivityEvent struct {
	ID        string          `json:"id"`
	CardID    string          `json:"cardId"`
	UserID    string          `json:"userId"`
	Action    string          `json:"action"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}

type CardDetail struct {
	Card
	Participants []Participant   `json:"participants"`
	Photos       []Photo         `json:"photos"`
	Dishes       []Dish          `json:"dishes"`
	VenueNotes   []VenueNote     `json:"venueNotes"`
	AgainVotes   []AgainVote     `json:"againVotes"`
	Activities   []ActivityEvent `json:"activities"`
}

type Summary struct {
	TotalCards       int    `json:"totalCards"`
	TotalPhotos      int    `json:"totalPhotos"`
	TotalAmountCents int64  `json:"totalAmountCents"`
	RecentCards      []Card `json:"recentCards"`
}

type CardFilter struct {
	Query    string
	HostType string
	HasPhoto string
	Again    string
	Sort     string
	Limit    int
}

type ParticipantInput struct {
	ClientID string  `json:"clientId,omitempty"`
	UserID   *string `json:"userId,omitempty"`
	Name     string  `json:"name"`
	Kind     string  `json:"kind,omitempty"`
}

type CardInput struct {
	Title             string             `json:"title"`
	PartyDate         string             `json:"partyDate"`
	VenueName         string             `json:"venueName"`
	VenueAddress      string             `json:"venueAddress"`
	HostType          string             `json:"hostType"`
	HostParticipantID string             `json:"hostParticipantId,omitempty"`
	TotalAmountCents  *int64             `json:"totalAmountCents,omitempty"`
	ExpenseVisibility string             `json:"expenseVisibility"`
	ShareMode         string             `json:"shareMode"`
	Participants      []ParticipantInput `json:"participants"`
}

type ParticipantUpdateInput struct {
	InviteStatus string `json:"inviteStatus,omitempty"`
	CanEdit      *bool  `json:"canEdit,omitempty"`
}

type DishInput struct {
	Name       string `json:"name"`
	PriceCents *int64 `json:"priceCents,omitempty"`
}

type DishVoteInput struct {
	Rating string `json:"rating"`
}

type VenueNoteInput struct {
	Dimension string `json:"dimension"`
	Content   string `json:"content"`
}

type AgainVoteInput struct {
	Vote string `json:"vote"`
}

type NextPrep struct {
	HasPrevious   bool          `json:"hasPrevious"`
	Card          *Card         `json:"card,omitempty"`
	Participants  []Participant `json:"participants,omitempty"`
	Dishes        []Dish        `json:"dishes,omitempty"`
	VenueNotes    []VenueNote   `json:"venueNotes,omitempty"`
	AgainVotes    []AgainVote   `json:"againVotes,omitempty"`
	CanSeeExpense bool          `json:"canSeeExpense"`
}

type ExportSnapshot struct {
	ExportedAt time.Time    `json:"exportedAt"`
	Cards      []CardDetail `json:"cards"`
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
			return nil, fmt.Errorf("create party memory card database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open party memory card database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS party_cards (
			id TEXT PRIMARY KEY,
			owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title TEXT NOT NULL DEFAULT '',
			party_date INTEGER NOT NULL,
			venue_name TEXT NOT NULL CHECK(length(venue_name) BETWEEN 1 AND 60),
			venue_address TEXT NOT NULL DEFAULT '',
			host_type TEXT NOT NULL DEFAULT 'member',
			host_participant_id TEXT,
			total_amount_cents INTEGER,
			expense_visibility TEXT NOT NULL DEFAULT 'participants',
			card_status TEXT NOT NULL DEFAULT 'recording',
			share_mode TEXT NOT NULL DEFAULT 'private',
			cover_photo_id TEXT,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_cards_owner_date
			ON party_cards(owner_user_id, party_date DESC, id)`,
		`CREATE TABLE IF NOT EXISTS party_participants (
			id TEXT PRIMARY KEY,
			card_id TEXT NOT NULL REFERENCES party_cards(id) ON DELETE CASCADE,
			user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			kind TEXT NOT NULL DEFAULT 'manual',
			invite_status TEXT NOT NULL DEFAULT 'joined',
			can_edit INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_participants_card
			ON party_participants(card_id, sort_order, id)`,
		`CREATE INDEX IF NOT EXISTS idx_party_participants_user
			ON party_participants(user_id, card_id)`,
		`CREATE TABLE IF NOT EXISTS party_photos (
			id TEXT PRIMARY KEY,
			card_id TEXT NOT NULL REFERENCES party_cards(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			file_url TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'photo',
			taken_at INTEGER,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_photos_card
			ON party_photos(card_id, sort_order, created_at)`,
		`CREATE TABLE IF NOT EXISTS party_dishes (
			id TEXT PRIMARY KEY,
			card_id TEXT NOT NULL REFERENCES party_cards(id) ON DELETE CASCADE,
			created_by_user_id TEXT NOT NULL,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			price_cents INTEGER,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_dishes_card
			ON party_dishes(card_id, sort_order, id)`,
		`CREATE TABLE IF NOT EXISTS party_dish_votes (
			id TEXT PRIMARY KEY,
			dish_id TEXT NOT NULL REFERENCES party_dishes(id) ON DELETE CASCADE,
			participant_id TEXT NOT NULL REFERENCES party_participants(id) ON DELETE CASCADE,
			rating TEXT NOT NULL CHECK(rating IN ('like', 'ok', 'no')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(dish_id, participant_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_dish_votes_dish
			ON party_dish_votes(dish_id, rating)`,
		`CREATE TABLE IF NOT EXISTS party_venue_notes (
			id TEXT PRIMARY KEY,
			card_id TEXT NOT NULL REFERENCES party_cards(id) ON DELETE CASCADE,
			participant_id TEXT NOT NULL REFERENCES party_participants(id) ON DELETE CASCADE,
			dimension TEXT NOT NULL,
			content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 100),
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_venue_notes_card
			ON party_venue_notes(card_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS party_again_votes (
			id TEXT PRIMARY KEY,
			card_id TEXT NOT NULL REFERENCES party_cards(id) ON DELETE CASCADE,
			participant_id TEXT NOT NULL REFERENCES party_participants(id) ON DELETE CASCADE,
			vote TEXT NOT NULL CHECK(vote IN ('want', 'neutral', 'not')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(card_id, participant_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_again_votes_card
			ON party_again_votes(card_id, vote)`,
		`CREATE TABLE IF NOT EXISTS party_activity_events (
			id TEXT PRIMARY KEY,
			card_id TEXT NOT NULL REFERENCES party_cards(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_party_activity_events_card
			ON party_activity_events(card_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate party memory card: %w", err)
		}
	}
	return nil
}

func (s *Store) Summary(ctx context.Context, userID string) (Summary, error) {
	cards, err := s.ListCards(ctx, userID, CardFilter{Sort: "recent", Limit: MaxListCards})
	if err != nil {
		return Summary{}, err
	}
	recent := cards
	if len(recent) > 5 {
		recent = recent[:5]
	}
	summary := Summary{
		TotalCards:  len(cards),
		RecentCards: recent,
	}
	for _, card := range cards {
		summary.TotalPhotos += card.PhotoCount
		if card.TotalAmountCents != nil {
			summary.TotalAmountCents += *card.TotalAmountCents
		}
	}
	return summary, nil
}

func (s *Store) ListCards(ctx context.Context, userID string, filter CardFilter) ([]Card, error) {
	limit := filter.Limit
	if limit <= 0 || limit > MaxListCards {
		limit = MaxListCards
	}
	where := []string{`(
		c.owner_user_id = ?
		OR (
			c.share_mode = 'shared'
			AND EXISTS (
				SELECT 1 FROM party_participants p
				WHERE p.card_id = c.id AND p.user_id = ?
			)
		)
	)`, "c.archived_at IS NULL"}
	args := []any{userID, userID}
	if q := strings.TrimSpace(filter.Query); q != "" {
		pattern := "%" + q + "%"
		where = append(where, `(
			c.venue_name LIKE ? OR c.venue_address LIKE ? OR c.title LIKE ?
			OR EXISTS (SELECT 1 FROM party_participants p WHERE p.card_id = c.id AND p.name LIKE ?)
			OR EXISTS (SELECT 1 FROM party_dishes d WHERE d.card_id = c.id AND d.name LIKE ?)
			OR EXISTS (SELECT 1 FROM party_venue_notes n WHERE n.card_id = c.id AND n.content LIKE ?)
		)`)
		args = append(args, pattern, pattern, pattern, pattern, pattern, pattern)
	}
	if filter.HostType != "" {
		where = append(where, "c.host_type = ?")
		args = append(args, filter.HostType)
	}
	if filter.HasPhoto == "true" {
		where = append(where, "EXISTS (SELECT 1 FROM party_photos ph WHERE ph.card_id = c.id)")
	}
	if filter.Again == "want" {
		where = append(where, `EXISTS (
			SELECT 1 FROM party_again_votes v
			JOIN party_participants p ON p.id = v.participant_id
			WHERE v.card_id = c.id AND v.vote = 'want'
		)`)
	}
	order := "c.party_date DESC"
	switch filter.Sort {
	case "oldest":
		order = "c.party_date ASC"
	case "amount":
		order = "COALESCE(c.total_amount_cents, 0) DESC"
	case "photos":
		order = "(SELECT COUNT(*) FROM party_photos ph WHERE ph.card_id = c.id) DESC"
	}
	query := `
		SELECT c.id, c.owner_user_id, c.title, c.party_date, c.venue_name, c.venue_address,
			c.host_type, c.host_participant_id, c.total_amount_cents, c.expense_visibility,
			c.card_status, c.share_mode, c.cover_photo_id, c.archived_at, c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM party_participants p WHERE p.card_id = c.id) AS participant_count,
			(SELECT COUNT(*) FROM party_photos ph WHERE ph.card_id = c.id) AS photo_count,
			(SELECT COUNT(*) FROM party_dishes d WHERE d.card_id = c.id) AS dish_count,
			(SELECT p.name FROM party_participants p WHERE p.id = c.host_participant_id) AS host_name
		FROM party_cards c
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY ` + order + `
		LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list party memory cards: %w", err)
	}
	cards := []Card{}
	for rows.Next() {
		card, err := scanCard(rows, userID)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		cards = append(cards, card)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	for i := range cards {
		cards[i].AgainVotes, err = s.againVoteSummary(ctx, cards[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return cards, nil
}

func (s *Store) GetCard(ctx context.Context, userID, cardID string) (Card, error) {
	card, err := s.getCardRow(ctx, userID, cardID)
	if err != nil {
		return Card{}, err
	}
	photos, err := s.listPhotos(ctx, cardID)
	if err != nil {
		return Card{}, err
	}
	if card.CoverPhotoID != "" {
		for _, photo := range photos {
			if photo.ID == card.CoverPhotoID {
				card.CoverPhotoURL = photo.FileURL
				break
			}
		}
	} else if len(photos) > 0 {
		card.CoverPhotoURL = photos[0].FileURL
	}
	card.AgainVotes, err = s.againVoteSummary(ctx, cardID)
	if err != nil {
		return Card{}, err
	}
	return card, nil
}

func (s *Store) GetCardDetail(ctx context.Context, userID, cardID string) (CardDetail, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	participants, err := s.ListParticipants(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	photos, err := s.ListPhotos(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	dishes, err := s.ListDishes(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	notes, err := s.ListVenueNotes(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	votes, err := s.ListAgainVotes(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	activities, err := s.ListActivities(ctx, userID, cardID)
	if err != nil {
		return CardDetail{}, err
	}
	return CardDetail{
		Card:         card,
		Participants: participants,
		Photos:       photos,
		Dishes:       dishes,
		VenueNotes:   notes,
		AgainVotes:   votes,
		Activities:   activities,
	}, nil
}

func (s *Store) CreateCard(ctx context.Context, userID string, input CardInput) (Card, error) {
	partyDate, err := parsePartyDate(input.PartyDate)
	if err != nil {
		return Card{}, ErrInvalidInput
	}
	venueName := strings.TrimSpace(input.VenueName)
	if venueName == "" || len([]rune(venueName)) > MaxVenueNameLength {
		return Card{}, ErrInvalidInput
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = venueName + "聚餐"
	}
	if len([]rune(title)) > MaxTitleLength {
		return Card{}, ErrInvalidInput
	}
	participants, err := normalizeParticipants(input.Participants)
	if err != nil {
		return Card{}, err
	}
	hostType := strings.TrimSpace(input.HostType)
	hostParticipantID := strings.TrimSpace(input.HostParticipantID)
	if hostType == "" {
		hostType = "member"
	}
	if hostType != "member" && hostType != "aa" && hostType != "other" {
		return Card{}, ErrInvalidInput
	}
	if hostType == "member" && hostParticipantID == "" {
		return Card{}, ErrInvalidInput
	}
	if hostParticipantID != "" && !hasClientParticipant(participants, hostParticipantID) {
		return Card{}, ErrInvalidInput
	}
	expenseVisibility := strings.TrimSpace(input.ExpenseVisibility)
	if expenseVisibility == "" {
		expenseVisibility = "participants"
	}
	if expenseVisibility != "owner" && expenseVisibility != "participants" {
		return Card{}, ErrInvalidInput
	}
	shareMode := strings.TrimSpace(input.ShareMode)
	if shareMode == "" {
		shareMode = "private"
	}
	if shareMode != "private" && shareMode != "shared" {
		return Card{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	cardID := uuid.NewString()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Card{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO party_cards
			(id, owner_user_id, title, party_date, venue_name, venue_address, host_type,
			 host_participant_id, total_amount_cents, expense_visibility, card_status,
			 share_mode, archived_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recording', ?, NULL, ?, ?)
	`, cardID, userID, title, partyDate.Unix(), venueName, strings.TrimSpace(input.VenueAddress),
		hostType, nullableString(hostParticipantID), input.TotalAmountCents, expenseVisibility,
		shareMode, now.Unix(), now.Unix()); err != nil {
		return Card{}, fmt.Errorf("create party memory card: %w", err)
	}
	insertedByClient := map[string]string{}
	for index, participant := range participants {
		participantID := uuid.NewString()
		canEdit := participant.UserID != nil
		participantKind := "manual"
		if participant.UserID != nil {
			participantKind = "friend"
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO party_participants
				(id, card_id, user_id, name, kind, invite_status, can_edit, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 'joined', ?, ?, ?, ?)
		`, participantID, cardID, nullableStringID(participant.UserID), participant.Name,
			participantKind, boolInt(canEdit), index, now.Unix(), now.Unix()); err != nil {
			return Card{}, fmt.Errorf("create party participant: %w", err)
		}
		if participant.ClientID != "" {
			insertedByClient[participant.ClientID] = participantID
		}
	}
	if hostType == "member" {
		resolvedHostID, ok := insertedByClient[hostParticipantID]
		if !ok {
			return Card{}, ErrInvalidInput
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE party_cards SET host_participant_id = ? WHERE id = ?
		`, resolvedHostID, cardID); err != nil {
			return Card{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Card{}, err
	}
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Card{}, err
	}
	_ = s.recordActivity(ctx, userID, cardID, "card_created", map[string]any{"venueName": venueName})
	return card, nil
}

func (s *Store) UpdateCard(ctx context.Context, userID, cardID string, input CardInput) (Card, error) {
	current, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Card{}, err
	}
	if current.OwnerUserID != userID {
		return Card{}, ErrForbidden
	}
	if strings.TrimSpace(input.Title) == "" {
		input.Title = current.Title
	}
	if strings.TrimSpace(input.VenueName) == "" {
		input.VenueName = current.VenueName
	}
	if strings.TrimSpace(input.PartyDate) == "" {
		input.PartyDate = current.PartyDate.Format(time.RFC3339)
	}
	if strings.TrimSpace(input.HostType) == "" {
		input.HostType = current.HostType
	}
	if input.HostParticipantID == "" {
		input.HostParticipantID = current.HostParticipantID
	}
	if input.TotalAmountCents == nil && current.TotalAmountCents != nil {
		input.TotalAmountCents = current.TotalAmountCents
	}
	if input.ExpenseVisibility == "" {
		input.ExpenseVisibility = current.ExpenseVisibility
	}
	if input.ShareMode == "" {
		input.ShareMode = current.ShareMode
	}
	partyDate, err := parsePartyDate(input.PartyDate)
	if err != nil {
		return Card{}, ErrInvalidInput
	}
	venueName := strings.TrimSpace(input.VenueName)
	if venueName == "" || len([]rune(venueName)) > MaxVenueNameLength {
		return Card{}, ErrInvalidInput
	}
	hostType := input.HostType
	if hostType != "member" && hostType != "aa" && hostType != "other" {
		return Card{}, ErrInvalidInput
	}
	if hostType == "member" {
		if _, err := s.getParticipant(ctx, userID, input.HostParticipantID); err != nil {
			return Card{}, ErrInvalidInput
		}
	}
	if input.ExpenseVisibility != "owner" && input.ExpenseVisibility != "participants" {
		return Card{}, ErrInvalidInput
	}
	if input.ShareMode != "private" && input.ShareMode != "shared" {
		return Card{}, ErrInvalidInput
	}
	now := time.Now().UTC().Unix()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE party_cards SET title = ?, party_date = ?, venue_name = ?, venue_address = ?,
			host_type = ?, host_participant_id = ?, total_amount_cents = ?,
			expense_visibility = ?, share_mode = ?, updated_at = ?
		WHERE id = ? AND owner_user_id = ? AND archived_at IS NULL
	`, strings.TrimSpace(input.Title), partyDate.Unix(), venueName, strings.TrimSpace(input.VenueAddress),
		hostType, nullableString(input.HostParticipantID), input.TotalAmountCents,
		input.ExpenseVisibility, input.ShareMode, now, cardID, userID); err != nil {
		return Card{}, fmt.Errorf("update party memory card: %w", err)
	}
	_ = s.recordActivity(ctx, userID, cardID, "card_updated", map[string]any{"venueName": venueName})
	return s.GetCard(ctx, userID, cardID)
}

func (s *Store) DeleteCard(ctx context.Context, userID, cardID string) error {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return err
	}
	if card.OwnerUserID != userID {
		return ErrForbidden
	}
	now := time.Now().UTC().Unix()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE party_cards SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?
	`, now, now, cardID, userID); err != nil {
		return fmt.Errorf("delete party memory card: %w", err)
	}
	return nil
}

func (s *Store) AddParticipant(ctx context.Context, userID, cardID string, input ParticipantInput) (Participant, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Participant{}, err
	}
	if card.OwnerUserID != userID {
		return Participant{}, ErrForbidden
	}
	if card.ParticipantCount >= MaxParticipants {
		return Participant{}, ErrParticipantLimit
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > MaxParticipantName {
		return Participant{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	participant := Participant{
		ID:           uuid.NewString(),
		CardID:       cardID,
		Name:         name,
		Kind:         "manual",
		InviteStatus: "joined",
		CanEdit:      false,
		SortOrder:    card.ParticipantCount,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if input.UserID != nil && strings.TrimSpace(*input.UserID) != "" {
		userIDValue := strings.TrimSpace(*input.UserID)
		participant.UserID = &userIDValue
		participant.Kind = "friend"
		participant.CanEdit = true
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO party_participants
			(id, card_id, user_id, name, kind, invite_status, can_edit, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, participant.ID, cardID, nullableStringID(participant.UserID), participant.Name,
		participant.Kind, participant.InviteStatus, boolInt(participant.CanEdit),
		participant.SortOrder, now.Unix(), now.Unix()); err != nil {
		return Participant{}, fmt.Errorf("add party participant: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE party_cards SET updated_at = ? WHERE id = ?`, now.Unix(), cardID)
	_ = s.recordActivity(ctx, userID, cardID, "participant_added", map[string]any{"name": participant.Name})
	return s.getParticipant(ctx, userID, participant.ID)
}

func (s *Store) UpdateParticipant(ctx context.Context, userID, cardID, participantID string, input ParticipantUpdateInput) (Participant, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Participant{}, err
	}
	participant, err := s.getParticipant(ctx, userID, participantID)
	if err != nil {
		return Participant{}, err
	}
	if participant.CardID != cardID {
		return Participant{}, ErrNotFound
	}
	if card.OwnerUserID != userID && !(participant.UserID != nil && *participant.UserID == userID) {
		return Participant{}, ErrForbidden
	}
	inviteStatus := strings.TrimSpace(input.InviteStatus)
	if inviteStatus == "" {
		inviteStatus = participant.InviteStatus
	}
	if inviteStatus != "joined" && inviteStatus != "pending" && inviteStatus != "declined" {
		return Participant{}, ErrInvalidInput
	}
	canEdit := participant.CanEdit
	if input.CanEdit != nil {
		canEdit = *input.CanEdit
	}
	if card.OwnerUserID != userID && inviteStatus == "declined" {
		canEdit = false
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE party_participants SET invite_status = ?, can_edit = ?, updated_at = ?
		WHERE id = ? AND card_id = ?
	`, inviteStatus, boolInt(canEdit), time.Now().UTC().Unix(), participantID, cardID); err != nil {
		return Participant{}, fmt.Errorf("update party participant: %w", err)
	}
	_ = s.recordActivity(ctx, userID, cardID, "participant_updated", map[string]any{
		"name": participant.Name, "inviteStatus": inviteStatus,
	})
	return s.getParticipant(ctx, userID, participantID)
}

func (s *Store) RemoveParticipant(ctx context.Context, userID, cardID, participantID string) error {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return err
	}
	participant, err := s.getParticipant(ctx, userID, participantID)
	if err != nil {
		return err
	}
	if participant.CardID != cardID {
		return ErrNotFound
	}
	if card.OwnerUserID != userID && !(participant.UserID != nil && *participant.UserID == userID) {
		return ErrForbidden
	}
	now := time.Now().UTC().Unix()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if card.HostParticipantID == participantID {
		if _, err := tx.ExecContext(ctx, `
			UPDATE party_cards SET host_type = 'other', host_participant_id = NULL, updated_at = ?
			WHERE id = ?
		`, now, cardID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM party_participants WHERE id = ? AND card_id = ?
	`, participantID, cardID); err != nil {
		return fmt.Errorf("remove party participant: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	_ = s.recordActivity(ctx, userID, cardID, "participant_removed", map[string]any{"name": participant.Name})
	return nil
}

func (s *Store) ListParticipants(ctx context.Context, userID, cardID string) ([]Participant, error) {
	if _, err := s.GetCard(ctx, userID, cardID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, card_id, user_id, name, kind, invite_status, can_edit, sort_order, created_at, updated_at
		FROM party_participants
		WHERE card_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list party participants: %w", err)
	}
	defer rows.Close()
	participants := []Participant{}
	for rows.Next() {
		participant, err := scanParticipant(rows)
		if err != nil {
			return nil, err
		}
		participants = append(participants, participant)
	}
	return participants, rows.Err()
}

func (s *Store) AddPhoto(ctx context.Context, userID, cardID, fileURL, kind string, takenAt int64, cover bool) (Photo, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Photo{}, err
	}
	if !card.CanCollaborate {
		return Photo{}, ErrForbidden
	}
	if card.PhotoCount >= MaxPhotos {
		return Photo{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	photo := Photo{
		ID:        uuid.NewString(),
		CardID:    cardID,
		UserID:    userID,
		FileURL:   fileURL,
		Kind:      kind,
		SortOrder: card.PhotoCount,
		CreatedAt: now,
	}
	if takenAt > 0 {
		value := time.Unix(takenAt, 0).UTC()
		photo.TakenAt = &value
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Photo{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO party_photos (id, card_id, user_id, file_url, kind, taken_at, sort_order, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, photo.ID, photo.CardID, photo.UserID, photo.FileURL, photo.Kind,
		nullableUnix(takenAt), photo.SortOrder, photo.CreatedAt.Unix()); err != nil {
		return Photo{}, fmt.Errorf("add party photo: %w", err)
	}
	if cover || card.CoverPhotoID == "" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE party_cards SET cover_photo_id = ?, updated_at = ? WHERE id = ?
		`, photo.ID, now.Unix(), cardID); err != nil {
			return Photo{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Photo{}, err
	}
	_ = s.recordActivity(ctx, userID, cardID, "photo_added", map[string]any{"photoId": photo.ID})
	return photo, nil
}

func (s *Store) DeletePhoto(ctx context.Context, userID, cardID, photoID string) error {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return err
	}
	photo, err := s.getPhoto(ctx, userID, photoID)
	if err != nil {
		return err
	}
	if photo.CardID != cardID {
		return ErrNotFound
	}
	if card.OwnerUserID != userID && photo.UserID != userID {
		return ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM party_photos WHERE id = ? AND card_id = ?
	`, photoID, cardID); err != nil {
		return fmt.Errorf("delete party photo: %w", err)
	}
	if card.CoverPhotoID == photoID {
		coverID := sql.NullString{}
		_ = tx.QueryRowContext(ctx, `
			SELECT id FROM party_photos WHERE card_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1
		`, cardID).Scan(&coverID.String)
		if coverID.String != "" {
			coverID.Valid = true
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE party_cards SET cover_photo_id = ?, updated_at = ? WHERE id = ?
		`, coverID, time.Now().UTC().Unix(), cardID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	_ = s.recordActivity(ctx, userID, cardID, "photo_removed", map[string]any{"photoId": photoID})
	return nil
}

func (s *Store) ListPhotos(ctx context.Context, userID, cardID string) ([]Photo, error) {
	if _, err := s.getCardRow(ctx, userID, cardID); err != nil {
		return nil, err
	}
	return s.listPhotos(ctx, cardID)
}

func (s *Store) listPhotos(ctx context.Context, cardID string) ([]Photo, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, card_id, user_id, file_url, kind, taken_at, sort_order, created_at
		FROM party_photos WHERE card_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list party photos: %w", err)
	}
	defer rows.Close()
	photos := []Photo{}
	for rows.Next() {
		photo, err := scanPhoto(rows)
		if err != nil {
			return nil, err
		}
		photos = append(photos, photo)
	}
	return photos, rows.Err()
}

func (s *Store) CreateDish(ctx context.Context, userID, cardID string, input DishInput) (Dish, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Dish{}, err
	}
	if !card.CanCollaborate {
		return Dish{}, ErrForbidden
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > MaxDishNameLength {
		return Dish{}, ErrInvalidInput
	}
	if input.PriceCents != nil && *input.PriceCents < 0 {
		return Dish{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	dish := Dish{
		ID:              uuid.NewString(),
		CardID:          cardID,
		CreatedByUserID: userID,
		Name:            name,
		PriceCents:      input.PriceCents,
		SortOrder:       card.DishCount,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO party_dishes
			(id, card_id, created_by_user_id, name, price_cents, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, dish.ID, dish.CardID, dish.CreatedByUserID, dish.Name, dish.PriceCents,
		dish.SortOrder, dish.CreatedAt.Unix(), dish.UpdatedAt.Unix()); err != nil {
		return Dish{}, fmt.Errorf("create party dish: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE party_cards SET updated_at = ? WHERE id = ?`, now.Unix(), cardID)
	_ = s.recordActivity(ctx, userID, cardID, "dish_added", map[string]any{"name": dish.Name})
	return s.getDish(ctx, userID, dish.ID)
}

func (s *Store) UpdateDish(ctx context.Context, userID, cardID, dishID string, input DishInput) (Dish, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return Dish{}, err
	}
	dish, err := s.getDish(ctx, userID, dishID)
	if err != nil {
		return Dish{}, err
	}
	if dish.CardID != cardID {
		return Dish{}, ErrNotFound
	}
	if card.OwnerUserID != userID && dish.CreatedByUserID != userID {
		return Dish{}, ErrForbidden
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > MaxDishNameLength {
		return Dish{}, ErrInvalidInput
	}
	if input.PriceCents != nil && *input.PriceCents < 0 {
		return Dish{}, ErrInvalidInput
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE party_dishes SET name = ?, price_cents = ?, updated_at = ? WHERE id = ?
	`, name, input.PriceCents, time.Now().UTC().Unix(), dishID); err != nil {
		return Dish{}, fmt.Errorf("update party dish: %w", err)
	}
	return s.getDish(ctx, userID, dishID)
}

func (s *Store) DeleteDish(ctx context.Context, userID, cardID, dishID string) error {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return err
	}
	dish, err := s.getDish(ctx, userID, dishID)
	if err != nil {
		return err
	}
	if dish.CardID != cardID {
		return ErrNotFound
	}
	if card.OwnerUserID != userID && dish.CreatedByUserID != userID {
		return ErrForbidden
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM party_dishes WHERE id = ?`, dishID); err != nil {
		return fmt.Errorf("delete party dish: %w", err)
	}
	_ = s.recordActivity(ctx, userID, cardID, "dish_removed", map[string]any{"name": dish.Name})
	return nil
}

func (s *Store) ListDishes(ctx context.Context, userID, cardID string) ([]Dish, error) {
	if _, err := s.GetCard(ctx, userID, cardID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT d.id, d.card_id, d.created_by_user_id, d.name, d.price_cents, d.sort_order,
			d.created_at, d.updated_at,
			(SELECT COUNT(*) FROM party_dish_votes v WHERE v.dish_id = d.id AND v.rating = 'like') AS like_count,
			(SELECT COUNT(*) FROM party_dish_votes v WHERE v.dish_id = d.id AND v.rating = 'ok') AS ok_count,
			(SELECT COUNT(*) FROM party_dish_votes v WHERE v.dish_id = d.id AND v.rating = 'no') AS no_count
		FROM party_dishes d
		WHERE d.card_id = ?
		ORDER BY d.sort_order ASC, d.created_at ASC
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list party dishes: %w", err)
	}
	defer rows.Close()
	dishes := []Dish{}
	for rows.Next() {
		dish, err := scanDish(rows)
		if err != nil {
			return nil, err
		}
		dishes = append(dishes, dish)
	}
	return dishes, rows.Err()
}

func (s *Store) VoteDish(ctx context.Context, userID, cardID, dishID string, input DishVoteInput) (DishVote, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return DishVote{}, err
	}
	if !card.CanCollaborate {
		return DishVote{}, ErrForbidden
	}
	dish, err := s.getDish(ctx, userID, dishID)
	if err != nil {
		return DishVote{}, err
	}
	if dish.CardID != cardID {
		return DishVote{}, ErrNotFound
	}
	rating := strings.TrimSpace(input.Rating)
	if rating != "like" && rating != "ok" && rating != "no" {
		return DishVote{}, ErrInvalidInput
	}
	participant, err := s.participantForUser(ctx, cardID, userID)
	if err != nil {
		return DishVote{}, err
	}
	if !participant.CanEdit {
		return DishVote{}, ErrForbidden
	}
	now := time.Now().UTC()
	var voteID string
	err = s.db.QueryRowContext(ctx, `
		SELECT id FROM party_dish_votes WHERE dish_id = ? AND participant_id = ?
	`, dishID, participant.ID).Scan(&voteID)
	if errors.Is(err, sql.ErrNoRows) {
		voteID = uuid.NewString()
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO party_dish_votes (id, dish_id, participant_id, rating, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, voteID, dishID, participant.ID, rating, now.Unix(), now.Unix()); err != nil {
			return DishVote{}, fmt.Errorf("create party dish vote: %w", err)
		}
	} else if err != nil {
		return DishVote{}, err
	} else {
		if _, err := s.db.ExecContext(ctx, `
			UPDATE party_dish_votes SET rating = ?, updated_at = ? WHERE id = ?
		`, rating, now.Unix(), voteID); err != nil {
			return DishVote{}, fmt.Errorf("update party dish vote: %w", err)
		}
	}
	_ = s.recordActivity(ctx, userID, cardID, "dish_voted", map[string]any{
		"dishId": dishID, "dishName": dish.Name, "rating": rating,
	})
	return s.getDishVote(ctx, userID, voteID)
}

func (s *Store) AddVenueNote(ctx context.Context, userID, cardID string, input VenueNoteInput) (VenueNote, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return VenueNote{}, err
	}
	if !card.CanCollaborate {
		return VenueNote{}, ErrForbidden
	}
	dimension := strings.TrimSpace(input.Dimension)
	content := strings.TrimSpace(input.Content)
	if !supportedDimensions[dimension] || content == "" || len([]rune(content)) > MaxNoteLength {
		return VenueNote{}, ErrInvalidInput
	}
	participant, err := s.participantForUser(ctx, cardID, userID)
	if err != nil {
		return VenueNote{}, err
	}
	now := time.Now().UTC()
	note := VenueNote{
		ID:              uuid.NewString(),
		CardID:          cardID,
		ParticipantID:   participant.ID,
		ParticipantName: participant.Name,
		Dimension:       dimension,
		Content:         content,
		CreatedAt:       now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO party_venue_notes (id, card_id, participant_id, dimension, content, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, note.ID, note.CardID, note.ParticipantID, note.Dimension, note.Content, now.Unix()); err != nil {
		return VenueNote{}, fmt.Errorf("add party venue note: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE party_cards SET updated_at = ? WHERE id = ?`, now.Unix(), cardID)
	_ = s.recordActivity(ctx, userID, cardID, "venue_note_added", map[string]any{
		"dimension": dimension, "content": content,
	})
	return note, nil
}

func (s *Store) DeleteVenueNote(ctx context.Context, userID, cardID, noteID string) error {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return err
	}
	note, err := s.getVenueNote(ctx, userID, noteID)
	if err != nil {
		return err
	}
	if note.CardID != cardID {
		return ErrNotFound
	}
	participant, err := s.getParticipant(ctx, userID, note.ParticipantID)
	if err != nil {
		return err
	}
	if card.OwnerUserID != userID && !(participant.UserID != nil && *participant.UserID == userID) {
		return ErrForbidden
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM party_venue_notes WHERE id = ?`, noteID); err != nil {
		return fmt.Errorf("delete party venue note: %w", err)
	}
	_ = s.recordActivity(ctx, userID, cardID, "venue_note_removed", map[string]any{"content": note.Content})
	return nil
}

func (s *Store) ListVenueNotes(ctx context.Context, userID, cardID string) ([]VenueNote, error) {
	if _, err := s.GetCard(ctx, userID, cardID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT n.id, n.card_id, n.participant_id, p.name, n.dimension, n.content, n.created_at
		FROM party_venue_notes n
		JOIN party_participants p ON p.id = n.participant_id
		WHERE n.card_id = ?
		ORDER BY n.created_at DESC, n.id DESC
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list party venue notes: %w", err)
	}
	defer rows.Close()
	notes := []VenueNote{}
	for rows.Next() {
		var note VenueNote
		var createdAt int64
		if err := rows.Scan(&note.ID, &note.CardID, &note.ParticipantID, &note.ParticipantName,
			&note.Dimension, &note.Content, &createdAt); err != nil {
			return nil, err
		}
		note.CreatedAt = time.Unix(createdAt, 0).UTC()
		notes = append(notes, note)
	}
	return notes, rows.Err()
}

func (s *Store) AddAgainVote(ctx context.Context, userID, cardID string, input AgainVoteInput) (AgainVote, error) {
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return AgainVote{}, err
	}
	if !card.CanCollaborate {
		return AgainVote{}, ErrForbidden
	}
	vote := strings.TrimSpace(input.Vote)
	if vote != "want" && vote != "neutral" && vote != "not" {
		return AgainVote{}, ErrInvalidInput
	}
	participant, err := s.participantForUser(ctx, cardID, userID)
	if err != nil {
		return AgainVote{}, err
	}
	now := time.Now().UTC()
	var voteID string
	err = s.db.QueryRowContext(ctx, `
		SELECT id FROM party_again_votes WHERE card_id = ? AND participant_id = ?
	`, cardID, participant.ID).Scan(&voteID)
	if errors.Is(err, sql.ErrNoRows) {
		voteID = uuid.NewString()
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO party_again_votes (id, card_id, participant_id, vote, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, voteID, cardID, participant.ID, vote, now.Unix(), now.Unix()); err != nil {
			return AgainVote{}, fmt.Errorf("create party again vote: %w", err)
		}
	} else if err != nil {
		return AgainVote{}, err
	} else {
		if _, err := s.db.ExecContext(ctx, `
			UPDATE party_again_votes SET vote = ?, updated_at = ? WHERE id = ?
		`, vote, now.Unix(), voteID); err != nil {
			return AgainVote{}, fmt.Errorf("update party again vote: %w", err)
		}
	}
	_ = s.recordActivity(ctx, userID, cardID, "again_voted", map[string]any{"vote": vote})
	return s.getAgainVote(ctx, userID, voteID)
}

func (s *Store) ListAgainVotes(ctx context.Context, userID, cardID string) ([]AgainVote, error) {
	if _, err := s.GetCard(ctx, userID, cardID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT v.id, v.card_id, v.participant_id, p.name, v.vote, v.created_at, v.updated_at
		FROM party_again_votes v
		JOIN party_participants p ON p.id = v.participant_id
		WHERE v.card_id = ?
		ORDER BY v.updated_at DESC, v.id DESC
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list party again votes: %w", err)
	}
	defer rows.Close()
	votes := []AgainVote{}
	for rows.Next() {
		vote, err := scanAgainVote(rows)
		if err != nil {
			return nil, err
		}
		votes = append(votes, vote)
	}
	return votes, rows.Err()
}

func (s *Store) ListActivities(ctx context.Context, userID, cardID string) ([]ActivityEvent, error) {
	if _, err := s.GetCard(ctx, userID, cardID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, card_id, user_id, action, payload_json, created_at
		FROM party_activity_events
		WHERE card_id = ?
		ORDER BY created_at DESC, id DESC
	`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list party activities: %w", err)
	}
	defer rows.Close()
	activities := []ActivityEvent{}
	for rows.Next() {
		var event ActivityEvent
		var payload string
		var createdAt int64
		if err := rows.Scan(&event.ID, &event.CardID, &event.UserID, &event.Action,
			&payload, &createdAt); err != nil {
			return nil, err
		}
		event.Payload = json.RawMessage(payload)
		event.CreatedAt = time.Unix(createdAt, 0).UTC()
		activities = append(activities, event)
	}
	return activities, rows.Err()
}

func (s *Store) GetNextPrep(ctx context.Context, userID string) (NextPrep, error) {
	cards, err := s.ListCards(ctx, userID, CardFilter{Sort: "recent", Limit: 1})
	if err != nil {
		return NextPrep{}, err
	}
	if len(cards) == 0 {
		return NextPrep{HasPrevious: false}, nil
	}
	cardID := cards[0].ID
	card, err := s.GetCard(ctx, userID, cardID)
	if err != nil {
		return NextPrep{}, err
	}
	participants, err := s.ListParticipants(ctx, userID, cardID)
	if err != nil {
		return NextPrep{}, err
	}
	dishes, err := s.ListDishes(ctx, userID, cardID)
	if err != nil {
		return NextPrep{}, err
	}
	notes, err := s.ListVenueNotes(ctx, userID, cardID)
	if err != nil {
		return NextPrep{}, err
	}
	votes, err := s.ListAgainVotes(ctx, userID, cardID)
	if err != nil {
		return NextPrep{}, err
	}
	topDishes := []Dish{}
	for _, dish := range dishes {
		if len(topDishes) >= 5 {
			break
		}
		topDishes = append(topDishes, dish)
	}
	return NextPrep{
		HasPrevious:   true,
		Card:          &card,
		Participants:  participants,
		Dishes:        topDishes,
		VenueNotes:    notes,
		AgainVotes:    votes,
		CanSeeExpense: card.TotalAmountCents != nil,
	}, nil
}

func (s *Store) Export(ctx context.Context, userID string) (ExportSnapshot, error) {
	cards, err := s.ListCards(ctx, userID, CardFilter{Sort: "recent", Limit: MaxListCards})
	if err != nil {
		return ExportSnapshot{}, err
	}
	details := []CardDetail{}
	for _, card := range cards {
		detail, err := s.GetCardDetail(ctx, userID, card.ID)
		if err != nil {
			return ExportSnapshot{}, err
		}
		details = append(details, detail)
	}
	return ExportSnapshot{
		ExportedAt: time.Now().UTC(),
		Cards:      details,
	}, nil
}

func (s *Store) getCardRow(ctx context.Context, userID, cardID string) (Card, error) {
	var card Card
	var archivedAt sql.NullInt64
	var partyDate, createdAt, updatedAt int64
	var hostParticipantID sql.NullString
	var hostName sql.NullString
	var coverPhotoID sql.NullString
	var totalAmount sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT c.id, c.owner_user_id, c.title, c.party_date, c.venue_name, c.venue_address,
			c.host_type, c.host_participant_id, c.total_amount_cents, c.expense_visibility,
			c.card_status, c.share_mode, c.cover_photo_id, c.archived_at, c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM party_participants p WHERE p.card_id = c.id) AS participant_count,
			(SELECT COUNT(*) FROM party_photos ph WHERE ph.card_id = c.id) AS photo_count,
			(SELECT COUNT(*) FROM party_dishes d WHERE d.card_id = c.id) AS dish_count,
			(SELECT p.name FROM party_participants p WHERE p.id = c.host_participant_id) AS host_name
		FROM party_cards c
		WHERE c.id = ? AND c.archived_at IS NULL
	`, cardID).Scan(&card.ID, &card.OwnerUserID, &card.Title, &partyDate, &card.VenueName,
		&card.VenueAddress, &card.HostType, &hostParticipantID, &totalAmount,
		&card.ExpenseVisibility, &card.CardStatus, &card.ShareMode, &coverPhotoID,
		&archivedAt, &createdAt, &updatedAt, &card.ParticipantCount, &card.PhotoCount,
		&card.DishCount, &hostName)
	if errors.Is(err, sql.ErrNoRows) {
		return Card{}, ErrNotFound
	}
	if err != nil {
		return Card{}, fmt.Errorf("get party memory card row: %w", err)
	}
	card.HostParticipantID = hostParticipantID.String
	card.HostParticipantName = hostName.String
	card.CoverPhotoID = coverPhotoID.String
	if totalAmount.Valid {
		value := totalAmount.Int64
		card.TotalAmountCents = &value
	}
	card.Archived = archivedAt.Valid
	card.PartyDate = time.Unix(partyDate, 0).UTC()
	card.CreatedAt = time.Unix(createdAt, 0).UTC()
	card.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if !s.canAccessCard(ctx, userID, cardID) {
		return Card{}, ErrNotFound
	}
	card.CanEdit = card.OwnerUserID == userID
	card.CanCollaborate = card.CanEdit
	if !card.CanEdit {
		participant, err := s.participantForUser(ctx, cardID, userID)
		if err == nil && participant.CanEdit {
			card.CanCollaborate = true
		}
	}
	if card.OwnerUserID != userID && card.ExpenseVisibility == "owner" {
		card.TotalAmountCents = nil
	}
	return card, nil
}

func (s *Store) canAccessCard(ctx context.Context, userID, cardID string) bool {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM party_cards c
		WHERE c.id = ? AND c.archived_at IS NULL AND (
			c.owner_user_id = ?
			OR (
				c.share_mode = 'shared'
				AND EXISTS (
					SELECT 1 FROM party_participants p
					WHERE p.card_id = c.id AND p.user_id = ?
				)
			)
		)
	`, cardID, userID, userID).Scan(&count)
	return err == nil && count > 0
}

func (s *Store) getParticipant(ctx context.Context, userID, participantID string) (Participant, error) {
	var participant Participant
	var userIDValue sql.NullString
	var canEdit int
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, card_id, user_id, name, kind, invite_status, can_edit, sort_order, created_at, updated_at
		FROM party_participants WHERE id = ?
	`, participantID).Scan(&participant.ID, &participant.CardID, &userIDValue,
		&participant.Name, &participant.Kind, &participant.InviteStatus, &canEdit,
		&participant.SortOrder, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Participant{}, ErrNotFound
	}
	if err != nil {
		return Participant{}, fmt.Errorf("get party participant: %w", err)
	}
	if userIDValue.Valid {
		value := userIDValue.String
		participant.UserID = &value
	}
	participant.CanEdit = canEdit == 1
	participant.CreatedAt = time.Unix(createdAt, 0).UTC()
	participant.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return participant, nil
}

func (s *Store) participantForUser(ctx context.Context, cardID, userID string) (Participant, error) {
	var participant Participant
	var userIDValue sql.NullString
	var canEdit int
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, card_id, user_id, name, kind, invite_status, can_edit, sort_order, created_at, updated_at
		FROM party_participants
		WHERE card_id = ? AND user_id = ?
		ORDER BY sort_order ASC LIMIT 1
	`, cardID, userID).Scan(&participant.ID, &participant.CardID, &userIDValue,
		&participant.Name, &participant.Kind, &participant.InviteStatus, &canEdit,
		&participant.SortOrder, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Participant{}, ErrForbidden
	}
	if err != nil {
		return Participant{}, fmt.Errorf("get party participant by user: %w", err)
	}
	if userIDValue.Valid {
		value := userIDValue.String
		participant.UserID = &value
	}
	participant.CanEdit = canEdit == 1
	participant.CreatedAt = time.Unix(createdAt, 0).UTC()
	participant.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return participant, nil
}

func (s *Store) getPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	var photo Photo
	var takenAt sql.NullInt64
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, card_id, user_id, file_url, kind, taken_at, sort_order, created_at
		FROM party_photos WHERE id = ?
	`, photoID).Scan(&photo.ID, &photo.CardID, &photo.UserID, &photo.FileURL, &photo.Kind,
		&takenAt, &photo.SortOrder, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, fmt.Errorf("get party photo: %w", err)
	}
	if takenAt.Valid {
		value := time.Unix(takenAt.Int64, 0).UTC()
		photo.TakenAt = &value
	}
	photo.CreatedAt = time.Unix(createdAt, 0).UTC()
	return photo, nil
}

func (s *Store) GetPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	return s.getPhoto(ctx, userID, photoID)
}

func (s *Store) getDish(ctx context.Context, userID, dishID string) (Dish, error) {
	var dish Dish
	var price sql.NullInt64
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT d.id, d.card_id, d.created_by_user_id, d.name, d.price_cents, d.sort_order,
			d.created_at, d.updated_at,
			(SELECT COUNT(*) FROM party_dish_votes v WHERE v.dish_id = d.id AND v.rating = 'like') AS like_count,
			(SELECT COUNT(*) FROM party_dish_votes v WHERE v.dish_id = d.id AND v.rating = 'ok') AS ok_count,
			(SELECT COUNT(*) FROM party_dish_votes v WHERE v.dish_id = d.id AND v.rating = 'no') AS no_count
		FROM party_dishes d WHERE d.id = ?
	`, dishID).Scan(&dish.ID, &dish.CardID, &dish.CreatedByUserID, &dish.Name, &price,
		&dish.SortOrder, &createdAt, &updatedAt, &dish.LikeCount, &dish.OkCount, &dish.NoCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Dish{}, ErrNotFound
	}
	if err != nil {
		return Dish{}, fmt.Errorf("get party dish: %w", err)
	}
	if price.Valid {
		value := price.Int64
		dish.PriceCents = &value
	}
	dish.CreatedAt = time.Unix(createdAt, 0).UTC()
	dish.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return dish, nil
}

func (s *Store) getDishVote(ctx context.Context, userID, voteID string) (DishVote, error) {
	var vote DishVote
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, dish_id, participant_id, rating, created_at, updated_at
		FROM party_dish_votes WHERE id = ?
	`, voteID).Scan(&vote.ID, &vote.DishID, &vote.ParticipantID, &vote.Rating,
		&createdAt, &updatedAt)
	if err != nil {
		return DishVote{}, err
	}
	vote.CreatedAt = time.Unix(createdAt, 0).UTC()
	vote.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return vote, nil
}

func (s *Store) getVenueNote(ctx context.Context, userID, noteID string) (VenueNote, error) {
	var note VenueNote
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, card_id, participant_id, dimension, content, created_at
		FROM party_venue_notes WHERE id = ?
	`, noteID).Scan(&note.ID, &note.CardID, &note.ParticipantID, &note.Dimension,
		&note.Content, &createdAt)
	if err != nil {
		return VenueNote{}, err
	}
	note.CreatedAt = time.Unix(createdAt, 0).UTC()
	return note, nil
}

func (s *Store) getAgainVote(ctx context.Context, userID, voteID string) (AgainVote, error) {
	var vote AgainVote
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT v.id, v.card_id, v.participant_id, p.name, v.vote, v.created_at, v.updated_at
		FROM party_again_votes v
		JOIN party_participants p ON p.id = v.participant_id
		WHERE v.id = ?
	`, voteID).Scan(&vote.ID, &vote.CardID, &vote.ParticipantID, &vote.ParticipantName,
		&vote.Vote, &createdAt, &updatedAt)
	if err != nil {
		return AgainVote{}, err
	}
	vote.CreatedAt = time.Unix(createdAt, 0).UTC()
	vote.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return vote, nil
}

func (s *Store) againVoteSummary(ctx context.Context, cardID string) (map[string]int, error) {
	result := map[string]int{"want": 0, "neutral": 0, "not": 0}
	rows, err := s.db.QueryContext(ctx, `
		SELECT vote, COUNT(*) FROM party_again_votes WHERE card_id = ? GROUP BY vote
	`, cardID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var vote string
		var count int
		if err := rows.Scan(&vote, &count); err != nil {
			return nil, err
		}
		result[vote] = count
	}
	return result, rows.Err()
}

func (s *Store) recordActivity(ctx context.Context, userID, cardID, action string, payload map[string]any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO party_activity_events (id, card_id, user_id, action, payload_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), cardID, userID, action, string(encoded), time.Now().UTC().Unix())
	return err
}

func normalizeParticipants(inputs []ParticipantInput) ([]ParticipantInput, error) {
	if len(inputs) < MinParticipants || len(inputs) > MaxParticipants {
		return nil, ErrInvalidInput
	}
	seen := map[string]bool{}
	normalized := make([]ParticipantInput, 0, len(inputs))
	for _, input := range inputs {
		name := strings.TrimSpace(input.Name)
		if name == "" || len([]rune(name)) > MaxParticipantName {
			return nil, ErrInvalidInput
		}
		key := name
		if input.UserID != nil && strings.TrimSpace(*input.UserID) != "" {
			key = "user:" + strings.TrimSpace(*input.UserID)
		}
		if seen[key] {
			return nil, ErrInvalidInput
		}
		seen[key] = true
		normalized = append(normalized, ParticipantInput{
			ClientID: input.ClientID,
			UserID:   input.UserID,
			Name:     name,
			Kind:     input.Kind,
		})
	}
	return normalized, nil
}

func hasClientParticipant(participants []ParticipantInput, participantID string) bool {
	for _, participant := range participants {
		if participant.ClientID == participantID {
			return true
		}
	}
	return false
}

func scanCard(row rowScanner, userID string) (Card, error) {
	var card Card
	var archivedAt sql.NullInt64
	var partyDate, createdAt, updatedAt int64
	var hostParticipantID sql.NullString
	var hostName sql.NullString
	var coverPhotoID sql.NullString
	var totalAmount sql.NullInt64
	if err := row.Scan(&card.ID, &card.OwnerUserID, &card.Title, &partyDate, &card.VenueName,
		&card.VenueAddress, &card.HostType, &hostParticipantID, &totalAmount,
		&card.ExpenseVisibility, &card.CardStatus, &card.ShareMode, &coverPhotoID,
		&archivedAt, &createdAt, &updatedAt, &card.ParticipantCount, &card.PhotoCount,
		&card.DishCount, &hostName); err != nil {
		return Card{}, err
	}
	card.HostParticipantID = hostParticipantID.String
	card.HostParticipantName = hostName.String
	card.CoverPhotoID = coverPhotoID.String
	if totalAmount.Valid {
		value := totalAmount.Int64
		card.TotalAmountCents = &value
	}
	card.Archived = archivedAt.Valid
	card.PartyDate = time.Unix(partyDate, 0).UTC()
	card.CreatedAt = time.Unix(createdAt, 0).UTC()
	card.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	card.CanEdit = card.OwnerUserID == userID
	card.CanCollaborate = card.CanEdit
	if card.OwnerUserID != userID && card.ExpenseVisibility == "owner" {
		card.TotalAmountCents = nil
	}
	return card, nil
}

func scanParticipant(row rowScanner) (Participant, error) {
	var participant Participant
	var userIDValue sql.NullString
	var canEdit int
	var createdAt, updatedAt int64
	if err := row.Scan(&participant.ID, &participant.CardID, &userIDValue,
		&participant.Name, &participant.Kind, &participant.InviteStatus, &canEdit,
		&participant.SortOrder, &createdAt, &updatedAt); err != nil {
		return Participant{}, err
	}
	if userIDValue.Valid {
		value := userIDValue.String
		participant.UserID = &value
	}
	participant.CanEdit = canEdit == 1
	participant.CreatedAt = time.Unix(createdAt, 0).UTC()
	participant.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return participant, nil
}

func scanPhoto(row rowScanner) (Photo, error) {
	var photo Photo
	var takenAt sql.NullInt64
	var createdAt int64
	if err := row.Scan(&photo.ID, &photo.CardID, &photo.UserID, &photo.FileURL, &photo.Kind,
		&takenAt, &photo.SortOrder, &createdAt); err != nil {
		return Photo{}, err
	}
	if takenAt.Valid {
		value := time.Unix(takenAt.Int64, 0).UTC()
		photo.TakenAt = &value
	}
	photo.CreatedAt = time.Unix(createdAt, 0).UTC()
	return photo, nil
}

func scanDish(row rowScanner) (Dish, error) {
	var dish Dish
	var price sql.NullInt64
	var createdAt, updatedAt int64
	if err := row.Scan(&dish.ID, &dish.CardID, &dish.CreatedByUserID, &dish.Name, &price,
		&dish.SortOrder, &createdAt, &updatedAt, &dish.LikeCount, &dish.OkCount, &dish.NoCount); err != nil {
		return Dish{}, err
	}
	if price.Valid {
		value := price.Int64
		dish.PriceCents = &value
	}
	dish.CreatedAt = time.Unix(createdAt, 0).UTC()
	dish.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return dish, nil
}

func scanAgainVote(row rowScanner) (AgainVote, error) {
	var vote AgainVote
	var createdAt, updatedAt int64
	if err := row.Scan(&vote.ID, &vote.CardID, &vote.ParticipantID, &vote.ParticipantName,
		&vote.Vote, &createdAt, &updatedAt); err != nil {
		return AgainVote{}, err
	}
	vote.CreatedAt = time.Unix(createdAt, 0).UTC()
	vote.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return vote, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func parsePartyDate(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04", "2006-01-02"} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid party date")
}

func nullableUnix(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullableStringID(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
