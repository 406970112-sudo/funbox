package score

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

type Store struct {
	db *sql.DB
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathRequired
	}
	if databasePath != ":memory:" {
		directory := filepath.Dir(databasePath)
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return nil, fmt.Errorf("create score database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open score database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS score_rooms (
			id TEXT PRIMARY KEY,
			code TEXT NOT NULL CHECK(length(code) = 6),
			host_user_id TEXT NOT NULL,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			mode TEXT NOT NULL CHECK(mode IN ('generic')),
			status TEXT NOT NULL CHECK(status IN ('waiting', 'active', 'settled', 'cancelled')),
			max_players INTEGER NOT NULL CHECK(max_players BETWEEN 2 AND 8),
			cents_per_point INTEGER NOT NULL CHECK(cents_per_point BETWEEN 1 AND 1000000),
			version INTEGER NOT NULL CHECK(version >= 1),
			event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(event_sequence >= 0),
			created_at INTEGER NOT NULL,
			started_at INTEGER,
			settled_at INTEGER,
			cancelled_at INTEGER,
			expires_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_score_rooms_active_code
			ON score_rooms(code) WHERE status IN ('waiting', 'active')`,
		`CREATE INDEX IF NOT EXISTS idx_score_rooms_host_created
			ON score_rooms(host_user_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS score_participants (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL REFERENCES score_rooms(id) ON DELETE CASCADE,
			user_id TEXT,
			display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 48),
			normalized_name TEXT NOT NULL,
			role TEXT NOT NULL CHECK(role IN ('host', 'guest')),
			status TEXT NOT NULL CHECK(status IN ('active', 'removed', 'left')),
			token_version INTEGER NOT NULL DEFAULT 1 CHECK(token_version >= 1),
			joined_at INTEGER NOT NULL,
			last_seen_at INTEGER NOT NULL,
			UNIQUE(room_id, normalized_name),
			UNIQUE(room_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_score_participants_room_joined
			ON score_participants(room_id, joined_at, id)`,
		`CREATE TABLE IF NOT EXISTS score_rounds (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL REFERENCES score_rooms(id) ON DELETE CASCADE,
			number INTEGER NOT NULL CHECK(number >= 1),
			kind TEXT NOT NULL CHECK(kind IN ('normal', 'reversal')),
			reverses_round_id TEXT REFERENCES score_rounds(id),
			status TEXT NOT NULL CHECK(status IN ('collecting', 'review', 'confirmed', 'cancelled')),
			roster_json TEXT NOT NULL,
			created_by TEXT NOT NULL REFERENCES score_participants(id),
			created_at INTEGER NOT NULL,
			confirmed_at INTEGER,
			cancelled_at INTEGER,
			UNIQUE(room_id, number),
			CHECK((kind = 'normal' AND reverses_round_id IS NULL) OR (kind = 'reversal' AND reverses_round_id IS NOT NULL))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_score_rounds_room_number
			ON score_rounds(room_id, number DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_score_rounds_one_pending
			ON score_rounds(room_id) WHERE status IN ('collecting', 'review')`,
		`CREATE TABLE IF NOT EXISTS score_entries (
			round_id TEXT NOT NULL REFERENCES score_rounds(id) ON DELETE CASCADE,
			participant_id TEXT NOT NULL REFERENCES score_participants(id),
			delta_points INTEGER NOT NULL CHECK(delta_points BETWEEN -2147483648 AND 2147483647),
			revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
			submitted_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(round_id, participant_id)
		)`,
		`CREATE TABLE IF NOT EXISTS score_confirmations (
			round_id TEXT NOT NULL REFERENCES score_rounds(id) ON DELETE CASCADE,
			participant_id TEXT NOT NULL REFERENCES score_participants(id),
			entry_revision INTEGER NOT NULL CHECK(entry_revision >= 1),
			confirmed_at INTEGER NOT NULL,
			PRIMARY KEY(round_id, participant_id)
		)`,
		`CREATE TABLE IF NOT EXISTS score_gift_batches (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL REFERENCES score_rooms(id) ON DELETE CASCADE,
			number INTEGER NOT NULL CHECK(number >= 1),
			kind TEXT NOT NULL CHECK(kind IN ('normal', 'reversal')),
			reverses_batch_id TEXT REFERENCES score_gift_batches(id),
			created_by TEXT NOT NULL REFERENCES score_participants(id),
			created_at INTEGER NOT NULL,
			UNIQUE(room_id, number),
			CHECK((kind = 'normal' AND reverses_batch_id IS NULL) OR (kind = 'reversal' AND reverses_batch_id IS NOT NULL))
		)`,
		`CREATE INDEX IF NOT EXISTS idx_score_gift_batches_room_number
			ON score_gift_batches(room_id, number DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_score_gift_batches_one_reversal
			ON score_gift_batches(reverses_batch_id) WHERE reverses_batch_id IS NOT NULL`,
		`CREATE TABLE IF NOT EXISTS score_point_gifts (
			batch_id TEXT NOT NULL REFERENCES score_gift_batches(id) ON DELETE CASCADE,
			from_participant_id TEXT NOT NULL REFERENCES score_participants(id),
			to_participant_id TEXT NOT NULL REFERENCES score_participants(id),
			points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 2147483647),
			PRIMARY KEY(batch_id, from_participant_id, to_participant_id),
			CHECK(from_participant_id <> to_participant_id)
		)`,
		`CREATE TABLE IF NOT EXISTS score_room_events (
			room_id TEXT NOT NULL REFERENCES score_rooms(id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL CHECK(sequence >= 1),
			event_type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			actor_participant_id TEXT REFERENCES score_participants(id),
			created_at INTEGER NOT NULL,
			PRIMARY KEY(room_id, sequence)
		)`,
		`CREATE TABLE IF NOT EXISTS score_command_receipts (
			actor_participant_id TEXT NOT NULL,
			client_action_id TEXT NOT NULL,
			command_type TEXT NOT NULL,
			request_hash TEXT NOT NULL,
			result_room_version INTEGER NOT NULL CHECK(result_room_version >= 1),
			result_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(actor_participant_id, client_action_id)
		)`,
		`CREATE TABLE IF NOT EXISTS score_settlements (
			room_id TEXT PRIMARY KEY REFERENCES score_rooms(id) ON DELETE CASCADE,
			room_version INTEGER NOT NULL CHECK(room_version >= 1),
			balances_json TEXT NOT NULL,
			transfers_json TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS score_room_game_configs (
				room_id TEXT PRIMARY KEY REFERENCES score_rooms(id) ON DELETE CASCADE,
				scene TEXT NOT NULL CHECK(scene IN ('generic', 'zhajinhua')),
				force_open_threshold INTEGER NOT NULL DEFAULT 0 CHECK(force_open_threshold BETWEEN 0 AND 8),
				force_open_fee_points INTEGER NOT NULL DEFAULT 0 CHECK(force_open_fee_points BETWEEN 0 AND 2147483647),
				updated_at INTEGER NOT NULL,
				CHECK(
					(scene = 'generic' AND force_open_threshold = 0 AND force_open_fee_points = 0)
					OR
					(scene = 'zhajinhua' AND force_open_threshold >= 2 AND force_open_fee_points >= 1)
				)
			)`,
		`CREATE TABLE IF NOT EXISTS score_zjh_hands (
				id TEXT PRIMARY KEY,
				room_id TEXT NOT NULL REFERENCES score_rooms(id) ON DELETE CASCADE,
				number INTEGER NOT NULL CHECK(number >= 1),
				status TEXT NOT NULL CHECK(status IN ('active', 'finished', 'cancelled')),
				pot_points INTEGER NOT NULL DEFAULT 0 CHECK(pot_points >= 0),
				current_turn_participant_id TEXT REFERENCES score_participants(id),
				force_open_threshold INTEGER NOT NULL CHECK(force_open_threshold BETWEEN 2 AND 8),
				force_open_fee_points INTEGER NOT NULL CHECK(force_open_fee_points BETWEEN 1 AND 2147483647),
				winner_participant_id TEXT REFERENCES score_participants(id),
				created_by TEXT NOT NULL REFERENCES score_participants(id),
				created_at INTEGER NOT NULL,
				finished_at INTEGER,
				cancelled_at INTEGER,
				UNIQUE(room_id, number)
			)`,
		`CREATE INDEX IF NOT EXISTS idx_score_zjh_hands_room_number
				ON score_zjh_hands(room_id, number DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_score_zjh_hands_one_active
				ON score_zjh_hands(room_id) WHERE status = 'active'`,
		`CREATE TABLE IF NOT EXISTS score_zjh_hand_players (
				hand_id TEXT NOT NULL REFERENCES score_zjh_hands(id) ON DELETE CASCADE,
				participant_id TEXT NOT NULL REFERENCES score_participants(id),
				position INTEGER NOT NULL CHECK(position >= 1),
				status TEXT NOT NULL CHECK(status IN ('active', 'folded')),
				contribution_points INTEGER NOT NULL DEFAULT 0 CHECK(contribution_points >= 0),
				is_winner INTEGER NOT NULL DEFAULT 0 CHECK(is_winner IN (0, 1)),
				PRIMARY KEY(hand_id, participant_id),
				UNIQUE(hand_id, position)
			)`,
		`CREATE TABLE IF NOT EXISTS score_zjh_actions (
				hand_id TEXT NOT NULL REFERENCES score_zjh_hands(id) ON DELETE CASCADE,
				sequence INTEGER NOT NULL CHECK(sequence >= 1),
				action_type TEXT NOT NULL CHECK(action_type IN ('raise', 'fold', 'force_open')),
				actor_participant_id TEXT NOT NULL REFERENCES score_participants(id),
				target_participant_id TEXT REFERENCES score_participants(id),
				winner_participant_id TEXT REFERENCES score_participants(id),
				points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
				created_at INTEGER NOT NULL,
				PRIMARY KEY(hand_id, sequence)
			)`,
		`CREATE TABLE IF NOT EXISTS score_zjh_ledger (
				hand_id TEXT NOT NULL REFERENCES score_zjh_hands(id) ON DELETE CASCADE,
				participant_id TEXT NOT NULL REFERENCES score_participants(id),
				delta_points INTEGER NOT NULL,
				PRIMARY KEY(hand_id, participant_id)
			)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			if errors.Is(err, sql.ErrConnDone) {
				return fmt.Errorf("score database connection closed: %w", err)
			}
			return fmt.Errorf("run score database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) loadRoomSnapshot(ctx context.Context, q queryer, roomID string) (RoomSnapshot, error) {
	var snapshot RoomSnapshot
	var status string
	var createdAt, expiresAt int64
	var startedAt, settledAt, cancelledAt sql.NullInt64
	err := q.QueryRowContext(ctx, `
		SELECT id, code, host_user_id, name, mode, status, max_players,
			cents_per_point, version, event_sequence, created_at, started_at,
			settled_at, cancelled_at, expires_at
		FROM score_rooms WHERE id = ?
	`, roomID).Scan(
		&snapshot.ID, &snapshot.Code, &snapshot.HostUserID, &snapshot.Name,
		&snapshot.Mode, &status, &snapshot.MaxPlayers, &snapshot.CentsPerPoint,
		&snapshot.Version, &snapshot.EventSequence, &createdAt, &startedAt,
		&settledAt, &cancelledAt, &expiresAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return RoomSnapshot{}, ErrRoomNotFound
	}
	if err != nil {
		return RoomSnapshot{}, fmt.Errorf("load score room: %w", err)
	}
	snapshot.Status = RoomStatus(status)
	snapshot.CreatedAt = time.Unix(createdAt, 0).UTC()
	snapshot.StartedAt = nullableUnixTime(startedAt)
	snapshot.SettledAt = nullableUnixTime(settledAt)
	snapshot.CancelledAt = nullableUnixTime(cancelledAt)
	snapshot.ExpiresAt = time.Unix(expiresAt, 0).UTC()

	scene, settings, err := loadRoomGameConfig(ctx, q, roomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.Scene = scene
	snapshot.ZhaJinHuaSettings = settings

	participants, err := loadParticipants(ctx, q, roomID, snapshot.CentsPerPoint)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.Participants = participants

	rounds, err := loadRoundList(ctx, q, roomID, `status = 'confirmed'`)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.Rounds = rounds

	currentRounds, err := loadRoundList(ctx, q, roomID, `status IN ('collecting', 'review')`)
	if err != nil {
		return RoomSnapshot{}, err
	}
	if len(currentRounds) > 0 {
		snapshot.CurrentRound = &currentRounds[0]
	}

	settlement, err := loadSettlement(ctx, q, roomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.Settlement = settlement
	giftBatches, err := loadGiftBatches(ctx, q, roomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.GiftBatches = giftBatches
	currentZhaJinHuaHand, err := loadCurrentZhaJinHuaHand(ctx, q, roomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.CurrentZhaJinHuaHand = currentZhaJinHuaHand
	zhaJinHuaHands, err := loadFinishedZhaJinHuaHands(ctx, q, roomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	snapshot.ZhaJinHuaHands = zhaJinHuaHands
	return snapshot, nil
}

func loadRoomGameConfig(ctx context.Context, q queryer, roomID string) (ScoreScene, ZhaJinHuaSettings, error) {
	var scene string
	var settings ZhaJinHuaSettings
	err := q.QueryRowContext(ctx, `
		SELECT scene, force_open_threshold, force_open_fee_points
		FROM score_room_game_configs WHERE room_id = ?
	`, roomID).Scan(&scene, &settings.ForceOpenThreshold, &settings.ForceOpenFeePoints)
	if errors.Is(err, sql.ErrNoRows) {
		return SceneGeneric, ZhaJinHuaSettings{}, nil
	}
	if err != nil {
		return "", ZhaJinHuaSettings{}, fmt.Errorf("load score room game config: %w", err)
	}
	return ScoreScene(scene), settings, nil
}

func loadParticipants(ctx context.Context, q queryer, roomID string, centsPerPoint int64) ([]Participant, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT p.id, p.user_id, p.display_name, p.role, p.status, p.joined_at,
			p.last_seen_at,
			COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN e.delta_points ELSE 0 END), 0) +
			COALESCE((
				SELECT SUM(CASE
					WHEN pg.from_participant_id = p.id THEN -pg.points
					WHEN pg.to_participant_id = p.id THEN pg.points
					ELSE 0
				END)
				FROM score_point_gifts pg
				WHERE pg.from_participant_id = p.id OR pg.to_participant_id = p.id
			), 0) +
			COALESCE((
				SELECT SUM(z.delta_points)
				FROM score_zjh_ledger z
				WHERE z.participant_id = p.id
			), 0)
		FROM score_participants p
		LEFT JOIN score_entries e ON e.participant_id = p.id
		LEFT JOIN score_rounds r ON r.id = e.round_id
		WHERE p.room_id = ?
		GROUP BY p.id, p.user_id, p.display_name, p.role, p.status, p.joined_at, p.last_seen_at
		ORDER BY CASE p.role WHEN 'host' THEN 0 ELSE 1 END, p.joined_at, p.rowid
	`, roomID)
	if err != nil {
		return nil, fmt.Errorf("load score participants: %w", err)
	}
	defer rows.Close()

	participants := make([]Participant, 0)
	for rows.Next() {
		var participant Participant
		var userID sql.NullString
		var role, status string
		var joinedAt, lastSeenAt int64
		if err := rows.Scan(
			&participant.ID, &userID, &participant.DisplayName, &role, &status,
			&joinedAt, &lastSeenAt, &participant.TotalPoints,
		); err != nil {
			return nil, fmt.Errorf("scan score participant: %w", err)
		}
		participant.UserID = userID.String
		participant.Role = ParticipantRole(role)
		participant.Status = ParticipantStatus(status)
		participant.AmountCents = participant.TotalPoints * centsPerPoint
		participant.JoinedAt = time.Unix(joinedAt, 0).UTC()
		participant.LastSeenAt = time.Unix(lastSeenAt, 0).UTC()
		participants = append(participants, participant)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate score participants: %w", err)
	}
	return participants, nil
}

func loadGiftBatches(ctx context.Context, q queryer, roomID string) ([]GiftBatch, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, room_id, number, kind, reverses_batch_id, created_by, created_at
		FROM score_gift_batches
		WHERE room_id = ?
		ORDER BY number DESC
	`, roomID)
	if err != nil {
		return nil, fmt.Errorf("load score gift batches: %w", err)
	}
	batches := make([]GiftBatch, 0)
	for rows.Next() {
		var batch GiftBatch
		var kind string
		var reversesBatchID sql.NullString
		var createdAt int64
		if err := rows.Scan(
			&batch.ID, &batch.RoomID, &batch.Number, &kind, &reversesBatchID,
			&batch.CreatedBy, &createdAt,
		); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan score gift batch: %w", err)
		}
		batch.Kind = RoundKind(kind)
		batch.ReversesBatchID = reversesBatchID.String
		batch.CreatedAt = time.Unix(createdAt, 0).UTC()
		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate score gift batches: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close score gift batches: %w", err)
	}
	for index := range batches {
		giftRows, err := q.QueryContext(ctx, `
			SELECT from_participant_id, to_participant_id, points
			FROM score_point_gifts
			WHERE batch_id = ?
			ORDER BY rowid
		`, batches[index].ID)
		if err != nil {
			return nil, fmt.Errorf("load score gift items: %w", err)
		}
		batches[index].Gifts = make([]GiftItem, 0)
		for giftRows.Next() {
			var gift GiftItem
			if err := giftRows.Scan(&gift.FromParticipantID, &gift.ToParticipantID, &gift.Points); err != nil {
				_ = giftRows.Close()
				return nil, fmt.Errorf("scan score gift item: %w", err)
			}
			batches[index].Gifts = append(batches[index].Gifts, gift)
		}
		if err := giftRows.Err(); err != nil {
			_ = giftRows.Close()
			return nil, fmt.Errorf("iterate score gift items: %w", err)
		}
		if err := giftRows.Close(); err != nil {
			return nil, fmt.Errorf("close score gift items: %w", err)
		}
	}
	return batches, nil
}

func loadRoundList(ctx context.Context, q queryer, roomID, statusPredicate string) ([]Round, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, room_id, number, kind, reverses_round_id, status, roster_json,
			created_by, created_at, confirmed_at, cancelled_at
		FROM score_rounds
		WHERE room_id = ? AND `+statusPredicate+`
		ORDER BY number DESC
	`, roomID)
	if err != nil {
		return nil, fmt.Errorf("load score rounds: %w", err)
	}
	rounds := make([]Round, 0)
	for rows.Next() {
		round, err := scanRound(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		rounds = append(rounds, round)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate score rounds: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close score rounds: %w", err)
	}

	for i := range rounds {
		if err := loadRoundEntries(ctx, q, &rounds[i]); err != nil {
			return nil, err
		}
	}
	return rounds, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanRound(scanner rowScanner) (Round, error) {
	var round Round
	var kind, status, rosterJSON string
	var reversesRoundID sql.NullString
	var createdAt int64
	var confirmedAt, cancelledAt sql.NullInt64
	if err := scanner.Scan(
		&round.ID, &round.RoomID, &round.Number, &kind, &reversesRoundID,
		&status, &rosterJSON, &round.CreatedBy, &createdAt, &confirmedAt, &cancelledAt,
	); err != nil {
		return Round{}, fmt.Errorf("scan score round: %w", err)
	}
	if err := json.Unmarshal([]byte(rosterJSON), &round.Roster); err != nil {
		return Round{}, fmt.Errorf("decode score round roster: %w", err)
	}
	round.Kind = RoundKind(kind)
	round.Status = RoundStatus(status)
	round.ReversesRoundID = reversesRoundID.String
	round.CreatedAt = time.Unix(createdAt, 0).UTC()
	round.ConfirmedAt = nullableUnixTime(confirmedAt)
	round.CancelledAt = nullableUnixTime(cancelledAt)
	return round, nil
}

func loadRoundEntries(ctx context.Context, q queryer, round *Round) error {
	rows, err := q.QueryContext(ctx, `
		SELECT e.participant_id, e.delta_points, e.revision, e.submitted_at,
			e.updated_at,
			CASE WHEN c.entry_revision = e.revision THEN 1 ELSE 0 END
		FROM score_entries e
		LEFT JOIN score_confirmations c
			ON c.round_id = e.round_id AND c.participant_id = e.participant_id
		WHERE e.round_id = ?
	`, round.ID)
	if err != nil {
		return fmt.Errorf("load score entries: %w", err)
	}
	entriesByParticipant := make(map[string]Entry, len(round.Roster))
	for rows.Next() {
		var entry Entry
		var submittedAt, updatedAt int64
		var confirmed int
		if err := rows.Scan(
			&entry.ParticipantID, &entry.DeltaPoints, &entry.Revision,
			&submittedAt, &updatedAt, &confirmed,
		); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan score entry: %w", err)
		}
		entry.Submitted = true
		entry.Confirmed = confirmed == 1
		entry.SubmittedAt = unixTimePointer(submittedAt)
		entry.UpdatedAt = unixTimePointer(updatedAt)
		entriesByParticipant[entry.ParticipantID] = entry
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate score entries: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close score entries: %w", err)
	}

	round.Entries = make([]Entry, 0, len(round.Roster))
	for _, participantID := range round.Roster {
		entry, submitted := entriesByParticipant[participantID]
		if !submitted {
			entry = Entry{ParticipantID: participantID}
		}
		if entry.Submitted {
			round.SubmittedCount++
			round.TotalDelta += entry.DeltaPoints
		}
		if entry.Confirmed {
			round.ConfirmedCount++
		}
		round.Entries = append(round.Entries, entry)
	}
	return nil
}

func loadCurrentZhaJinHuaHand(ctx context.Context, q queryer, roomID string) (*ZhaJinHuaHand, error) {
	hands, err := loadZhaJinHuaHandList(ctx, q, roomID, `status = 'active'`)
	if err != nil {
		return nil, err
	}
	if len(hands) == 0 {
		return nil, nil
	}
	return &hands[0], nil
}

func loadFinishedZhaJinHuaHands(ctx context.Context, q queryer, roomID string) ([]ZhaJinHuaHand, error) {
	return loadZhaJinHuaHandList(ctx, q, roomID, `status = 'finished'`)
}

func loadZhaJinHuaHandList(ctx context.Context, q queryer, roomID, statusPredicate string) ([]ZhaJinHuaHand, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, room_id, number, status, pot_points, current_turn_participant_id,
			force_open_threshold, force_open_fee_points, winner_participant_id,
			created_by, created_at, finished_at, cancelled_at
		FROM score_zjh_hands
		WHERE room_id = ? AND `+statusPredicate+`
		ORDER BY number DESC
	`, roomID)
	if err != nil {
		return nil, fmt.Errorf("load zha jin hua hands: %w", err)
	}
	hands := make([]ZhaJinHuaHand, 0)
	for rows.Next() {
		var hand ZhaJinHuaHand
		var status string
		var currentTurn, winner sql.NullString
		var createdAt int64
		var finishedAt, cancelledAt sql.NullInt64
		if err := rows.Scan(
			&hand.ID, &hand.RoomID, &hand.Number, &status, &hand.PotPoints,
			&currentTurn, &hand.ForceOpenThreshold, &hand.ForceOpenFeePoints,
			&winner, &hand.CreatedBy, &createdAt, &finishedAt, &cancelledAt,
		); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan zha jin hua hand: %w", err)
		}
		hand.Status = ZhaJinHuaHandStatus(status)
		hand.CurrentTurnParticipantID = currentTurn.String
		hand.WinnerParticipantID = winner.String
		hand.CreatedAt = time.Unix(createdAt, 0).UTC()
		hand.FinishedAt = nullableUnixTime(finishedAt)
		hand.CancelledAt = nullableUnixTime(cancelledAt)
		hands = append(hands, hand)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate zha jin hua hands: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close zha jin hua hands: %w", err)
	}
	for index := range hands {
		if err := loadZhaJinHuaPlayers(ctx, q, &hands[index]); err != nil {
			return nil, err
		}
		if err := loadZhaJinHuaActions(ctx, q, &hands[index]); err != nil {
			return nil, err
		}
	}
	return hands, nil
}

func loadZhaJinHuaPlayers(ctx context.Context, q queryer, hand *ZhaJinHuaHand) error {
	rows, err := q.QueryContext(ctx, `
		SELECT participant_id, position, status, contribution_points, is_winner
		FROM score_zjh_hand_players
		WHERE hand_id = ?
		ORDER BY position
	`, hand.ID)
	if err != nil {
		return fmt.Errorf("load zha jin hua players: %w", err)
	}
	defer rows.Close()
	hand.Players = make([]ZhaJinHuaPlayer, 0)
	for rows.Next() {
		var player ZhaJinHuaPlayer
		var status string
		var isWinner int
		if err := rows.Scan(
			&player.ParticipantID, &player.Position, &status,
			&player.ContributionPoints, &isWinner,
		); err != nil {
			return fmt.Errorf("scan zha jin hua player: %w", err)
		}
		player.Status = ZhaJinHuaPlayerStatus(status)
		player.IsWinner = isWinner == 1
		hand.Players = append(hand.Players, player)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate zha jin hua players: %w", err)
	}
	return nil
}

func loadZhaJinHuaActions(ctx context.Context, q queryer, hand *ZhaJinHuaHand) error {
	rows, err := q.QueryContext(ctx, `
		SELECT sequence, action_type, actor_participant_id, target_participant_id,
			winner_participant_id, points, created_at
		FROM score_zjh_actions
		WHERE hand_id = ?
		ORDER BY sequence
	`, hand.ID)
	if err != nil {
		return fmt.Errorf("load zha jin hua actions: %w", err)
	}
	defer rows.Close()
	hand.Actions = make([]ZhaJinHuaAction, 0)
	for rows.Next() {
		var action ZhaJinHuaAction
		var actionType string
		var target, winner sql.NullString
		var createdAt int64
		if err := rows.Scan(
			&action.Sequence, &actionType, &action.ActorParticipantID, &target,
			&winner, &action.Points, &createdAt,
		); err != nil {
			return fmt.Errorf("scan zha jin hua action: %w", err)
		}
		action.ActionType = ZhaJinHuaActionType(actionType)
		action.TargetParticipantID = target.String
		action.WinnerParticipantID = winner.String
		action.CreatedAt = time.Unix(createdAt, 0).UTC()
		hand.Actions = append(hand.Actions, action)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate zha jin hua actions: %w", err)
	}
	return nil
}

func loadSettlement(ctx context.Context, q queryer, roomID string) (*Settlement, error) {
	var balancesJSON, transfersJSON string
	var createdAt int64
	err := q.QueryRowContext(ctx, `
		SELECT balances_json, transfers_json, created_at
		FROM score_settlements WHERE room_id = ?
	`, roomID).Scan(&balancesJSON, &transfersJSON, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load score settlement: %w", err)
	}
	settlement := &Settlement{CreatedAt: time.Unix(createdAt, 0).UTC()}
	if err := json.Unmarshal([]byte(balancesJSON), &settlement.Balances); err != nil {
		return nil, fmt.Errorf("decode score settlement balances: %w", err)
	}
	if err := json.Unmarshal([]byte(transfersJSON), &settlement.Transfers); err != nil {
		return nil, fmt.Errorf("decode score settlement transfers: %w", err)
	}
	return settlement, nil
}

func nullableUnixTime(value sql.NullInt64) *time.Time {
	if !value.Valid {
		return nil
	}
	return unixTimePointer(value.Int64)
}

func unixTimePointer(value int64) *time.Time {
	timestamp := time.Unix(value, 0).UTC()
	return &timestamp
}
