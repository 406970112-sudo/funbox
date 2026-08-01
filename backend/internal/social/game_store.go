package social

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrCellOccupied   = errors.New("game board cell is occupied")
	ErrGameCapability = errors.New("game capability is not supported")
	ErrGameMove       = errors.New("game move is invalid")
	ErrMatchExists    = errors.New("active game match already exists")
	ErrMatchNotActive = errors.New("game match is not active")
	ErrNotFriends     = errors.New("users are not friends")
	ErrNotYourTurn    = errors.New("game match is not on this user's turn")
)

const (
	GameMatchPending  = "pending"
	GameMatchActive   = "active"
	GameMatchFinished = "finished"
	GameMatchDeclined = "declined"

	LeaderboardWeekly  = "weekly"
	LeaderboardAllTime = "all-time"
)

type GameCapability struct {
	FriendMatch bool
	ScoreRule   string
}

type GameMove struct {
	ClientMoveID string
	Col          int
	CreatedAt    time.Time
	FromCol      int
	FromRow      int
	Row          int
	Sequence     int
	UserID       string
}

type GameMoveInput struct {
	ClientMoveID string
	Col          int
	FromCol      int
	FromRow      int
	Row          int
}

type GameMatch struct {
	CreatedAt         time.Time
	CurrentTurnUserID string
	GameID            string
	ID                string
	Inviter           UserSummary
	Moves             []GameMove
	Opponent          UserSummary
	Status            string
	UpdatedAt         time.Time
	WinnerUserID      string
}

type GameScore struct {
	CreatedAt time.Time
	GameID    string
	ID        string
	Score     int
	UserID    string
}

type LeaderboardEntry struct {
	IsCurrentUser bool
	Rank          int
	Score         int
	UpdatedAt     time.Time
	User          UserSummary
}

var gameCapabilities = map[string]GameCapability{
	"brick-breaker": {ScoreRule: "higher"},
	"gomoku":        {FriendMatch: true},
	"snake-brawl":   {ScoreRule: "higher"},
	"tetris":        {ScoreRule: "higher"},
	"xiangqi":       {FriendMatch: true},
}

func GameCapabilityFor(gameID string) (GameCapability, bool) {
	capability, ok := gameCapabilities[strings.TrimSpace(gameID)]
	return capability, ok
}

func gameSocialMigrationStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS game_matches (
			id TEXT PRIMARY KEY,
			game_id TEXT NOT NULL,
			inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			opponent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'finished', 'declined')),
			current_turn_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			winner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			CHECK(inviter_id <> opponent_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_game_matches_users_updated
			ON game_matches(inviter_id, opponent_id, updated_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_game_matches_one_open
			ON game_matches(game_id,
				CASE WHEN inviter_id < opponent_id THEN inviter_id ELSE opponent_id END,
				CASE WHEN inviter_id < opponent_id THEN opponent_id ELSE inviter_id END)
			WHERE status IN ('pending', 'active')`,
		`CREATE TABLE IF NOT EXISTS game_match_moves (
			match_id TEXT NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			client_move_id TEXT NOT NULL,
			row_index INTEGER NOT NULL,
			col_index INTEGER NOT NULL,
			from_row_index INTEGER NOT NULL DEFAULT -1,
			from_col_index INTEGER NOT NULL DEFAULT -1,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(match_id, sequence),
			UNIQUE(match_id, user_id, client_move_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_game_match_moves_match
			ON game_match_moves(match_id, sequence)`,
		`CREATE TABLE IF NOT EXISTS game_score_submissions (
			id TEXT PRIMARY KEY,
			game_id TEXT NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			score INTEGER NOT NULL CHECK(score >= 0),
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_game_scores_game_time
			ON game_score_submissions(game_id, created_at DESC, user_id, score DESC)`,
	}
}

func (s *Store) ensureGameMoveColumns() error {
	rows, err := s.db.Query(`PRAGMA table_info(game_match_moves)`)
	if err != nil {
		return fmt.Errorf("inspect game move columns: %w", err)
	}
	columns := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			rows.Close()
			return fmt.Errorf("scan game move column: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close game move columns: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate game move columns: %w", err)
	}
	if !columns["from_row_index"] {
		if _, err := s.db.Exec(`ALTER TABLE game_match_moves ADD COLUMN from_row_index INTEGER NOT NULL DEFAULT -1`); err != nil {
			return fmt.Errorf("add from_row_index column: %w", err)
		}
	}
	if !columns["from_col_index"] {
		if _, err := s.db.Exec(`ALTER TABLE game_match_moves ADD COLUMN from_col_index INTEGER NOT NULL DEFAULT -1`); err != nil {
			return fmt.Errorf("add from_col_index column: %w", err)
		}
	}

	var legacyIndex int
	if err := s.db.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master
		 WHERE type = 'index' AND tbl_name = 'game_match_moves' AND name = 'sqlite_autoindex_game_match_moves_2'`,
	).Scan(&legacyIndex); err != nil {
		return fmt.Errorf("inspect legacy game move index: %w", err)
	}
	if legacyIndex > 0 {
		if err := s.rebuildGameMatchMoves(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) rebuildGameMatchMoves() error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin game move table rebuild: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	statements := []string{
		`CREATE TABLE game_match_moves_new (
			match_id TEXT NOT NULL REFERENCES game_matches(id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			client_move_id TEXT NOT NULL,
			row_index INTEGER NOT NULL,
			col_index INTEGER NOT NULL,
			from_row_index INTEGER NOT NULL DEFAULT -1,
			from_col_index INTEGER NOT NULL DEFAULT -1,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(match_id, sequence),
			UNIQUE(match_id, user_id, client_move_id)
		)`,
		`INSERT INTO game_match_moves_new
		 (match_id, sequence, user_id, client_move_id, row_index, col_index,
		  from_row_index, from_col_index, created_at)
		 SELECT match_id, sequence, user_id, client_move_id, row_index, col_index,
		        from_row_index, from_col_index, created_at
		 FROM game_match_moves`,
		`DROP TABLE game_match_moves`,
		`ALTER TABLE game_match_moves_new RENAME TO game_match_moves`,
		`CREATE INDEX IF NOT EXISTS idx_game_match_moves_match
			ON game_match_moves(match_id, sequence)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("rebuild game move table: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit game move table rebuild: %w", err)
	}
	return nil
}

func (s *Store) CreateGameMatch(
	ctx context.Context,
	inviterID string,
	opponentID string,
	gameID string,
) (GameMatch, error) {
	capability, ok := GameCapabilityFor(gameID)
	if !ok || !capability.FriendMatch {
		return GameMatch{}, ErrGameCapability
	}
	if inviterID == opponentID {
		return GameMatch{}, ErrForbidden
	}
	if friends, err := s.areFriends(ctx, inviterID, opponentID); err != nil {
		return GameMatch{}, err
	} else if !friends {
		return GameMatch{}, ErrNotFriends
	}

	now := time.Now().UTC()
	created := GameMatch{
		CreatedAt: now,
		GameID:    gameID,
		ID:        uuid.NewString(),
		Status:    GameMatchPending,
		UpdatedAt: now,
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO game_matches
		 (id, game_id, inviter_id, opponent_id, status, current_turn_user_id,
		  winner_user_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
		created.ID,
		created.GameID,
		inviterID,
		opponentID,
		created.Status,
		created.CreatedAt.UnixMilli(),
		created.UpdatedAt.UnixMilli(),
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint") {
			return GameMatch{}, ErrMatchExists
		}
		return GameMatch{}, fmt.Errorf("create game match: %w", err)
	}
	return s.GetGameMatch(ctx, created.ID, inviterID)
}

func (s *Store) RespondGameMatch(
	ctx context.Context,
	matchID string,
	userID string,
	accept bool,
) (GameMatch, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return GameMatch{}, fmt.Errorf("begin game match response: %w", err)
	}
	defer tx.Rollback()

	var inviterID string
	var opponentID string
	var status string
	if err := tx.QueryRowContext(
		ctx,
		`SELECT inviter_id, opponent_id, status FROM game_matches WHERE id = ?`,
		matchID,
	).Scan(&inviterID, &opponentID, &status); errors.Is(err, sql.ErrNoRows) {
		return GameMatch{}, ErrNotFound
	} else if err != nil {
		return GameMatch{}, fmt.Errorf("read game match response target: %w", err)
	}
	if opponentID != userID {
		return GameMatch{}, ErrForbidden
	}
	if status != GameMatchPending {
		return GameMatch{}, ErrMatchNotActive
	}

	nextStatus := GameMatchDeclined
	var currentTurn any
	if accept {
		nextStatus = GameMatchActive
		currentTurn = inviterID
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE game_matches
		 SET status = ?, current_turn_user_id = ?, updated_at = ? WHERE id = ?`,
		nextStatus,
		currentTurn,
		now.UnixMilli(),
		matchID,
	); err != nil {
		return GameMatch{}, fmt.Errorf("respond game match: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return GameMatch{}, fmt.Errorf("commit game match response: %w", err)
	}
	return s.GetGameMatch(ctx, matchID, userID)
}

func (s *Store) SubmitGameMove(
	ctx context.Context,
	matchID string,
	userID string,
	input GameMoveInput,
) (GameMatch, error) {
	if strings.TrimSpace(input.ClientMoveID) == "" || input.Row < 0 || input.Row >= 15 || input.Col < 0 || input.Col >= 15 {
		return GameMatch{}, ErrGameMove
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return GameMatch{}, fmt.Errorf("begin game move: %w", err)
	}
	defer tx.Rollback()

	var existingSequence int
	err = tx.QueryRowContext(
		ctx,
		`SELECT sequence FROM game_match_moves
		 WHERE match_id = ? AND user_id = ? AND client_move_id = ?`,
		matchID,
		userID,
		input.ClientMoveID,
	).Scan(&existingSequence)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return GameMatch{}, fmt.Errorf("commit idempotent game move: %w", err)
		}
		return s.GetGameMatch(ctx, matchID, userID)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return GameMatch{}, fmt.Errorf("read idempotent game move: %w", err)
	}

	var gameID string
	var inviterID string
	var opponentID string
	var status string
	var currentTurn sql.NullString
	if err := tx.QueryRowContext(
		ctx,
		`SELECT game_id, inviter_id, opponent_id, status, current_turn_user_id
		 FROM game_matches WHERE id = ?`,
		matchID,
	).Scan(&gameID, &inviterID, &opponentID, &status, &currentTurn); errors.Is(err, sql.ErrNoRows) {
		return GameMatch{}, ErrNotFound
	} else if err != nil {
		return GameMatch{}, fmt.Errorf("read game match for move: %w", err)
	}
	if userID != inviterID && userID != opponentID {
		return GameMatch{}, ErrForbidden
	}
	if status != GameMatchActive {
		return GameMatch{}, ErrMatchNotActive
	}
	if !currentTurn.Valid || currentTurn.String != userID {
		return GameMatch{}, ErrNotYourTurn
	}
	if gameID == "xiangqi" {
		if err := tx.Commit(); err != nil {
			return GameMatch{}, fmt.Errorf("release xiangqi move transaction: %w", err)
		}
		return s.submitXiangqiMove(ctx, matchID, userID, input)
	}
	if gameID != "gomoku" {
		return GameMatch{}, ErrGameCapability
	}

	var occupied int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM game_match_moves
		 WHERE match_id = ? AND row_index = ? AND col_index = ?`,
		matchID,
		input.Row,
		input.Col,
	).Scan(&occupied); err != nil {
		return GameMatch{}, fmt.Errorf("check game board cell: %w", err)
	}
	if occupied > 0 {
		return GameMatch{}, ErrCellOccupied
	}

	var sequence int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*) + 1 FROM game_match_moves WHERE match_id = ?`,
		matchID,
	).Scan(&sequence); err != nil {
		return GameMatch{}, fmt.Errorf("read next game move sequence: %w", err)
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO game_match_moves
		 (match_id, sequence, user_id, client_move_id, row_index, col_index,
		  from_row_index, from_col_index, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		matchID,
		sequence,
		userID,
		input.ClientMoveID,
		input.Row,
		input.Col,
		input.FromRow,
		input.FromCol,
		now.UnixMilli(),
	); err != nil {
		return GameMatch{}, fmt.Errorf("insert game move: %w", err)
	}

	moves, err := listGameMoves(ctx, tx, matchID)
	if err != nil {
		return GameMatch{}, err
	}
	winnerID := ""
	nextStatus := GameMatchActive
	nextTurn := opponentID
	if userID == opponentID {
		nextTurn = inviterID
	}
	if hasGomokuWin(moves, userID, input.Row, input.Col) {
		nextStatus = GameMatchFinished
		nextTurn = ""
		winnerID = userID
	} else if len(moves) == 15*15 {
		nextStatus = GameMatchFinished
		nextTurn = ""
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE game_matches
		 SET status = ?, current_turn_user_id = NULLIF(?, ''),
		     winner_user_id = NULLIF(?, ''), updated_at = ? WHERE id = ?`,
		nextStatus,
		nextTurn,
		winnerID,
		now.UnixMilli(),
		matchID,
	); err != nil {
		return GameMatch{}, fmt.Errorf("update game match after move: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return GameMatch{}, fmt.Errorf("commit game move: %w", err)
	}
	return s.GetGameMatch(ctx, matchID, userID)
}

func (s *Store) submitXiangqiMove(
	ctx context.Context,
	matchID string,
	userID string,
	input GameMoveInput,
) (GameMatch, error) {
	if strings.TrimSpace(input.ClientMoveID) == "" ||
		!xiangqiInside(input.FromCol, input.FromRow) ||
		!xiangqiInside(input.Col, input.Row) {
		return GameMatch{}, ErrGameMove
	}

	var gameID string
	var inviterID string
	var opponentID string
	var status string
	var currentTurn sql.NullString
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT game_id, inviter_id, opponent_id, status, current_turn_user_id
		 FROM game_matches WHERE id = ?`,
		matchID,
	).Scan(&gameID, &inviterID, &opponentID, &status, &currentTurn); errors.Is(err, sql.ErrNoRows) {
		return GameMatch{}, ErrNotFound
	} else if err != nil {
		return GameMatch{}, fmt.Errorf("read xiangqi match: %w", err)
	}
	if gameID != "xiangqi" {
		return GameMatch{}, ErrGameCapability
	}
	if userID != inviterID && userID != opponentID {
		return GameMatch{}, ErrForbidden
	}
	if status != GameMatchActive {
		return GameMatch{}, ErrMatchNotActive
	}
	if !currentTurn.Valid || currentTurn.String != userID {
		return GameMatch{}, ErrNotYourTurn
	}

	board := xiangqiInitialBoard()
	moves, err := listGameMoves(ctx, s.db, matchID)
	if err != nil {
		return GameMatch{}, err
	}
	for _, stored := range moves {
		if stored.FromRow < 0 || stored.FromCol < 0 {
			return GameMatch{}, ErrGameMove
		}
		board = xiangqiApply(board, xiangqiMove{
			From: xiangqiPosition{Col: stored.FromCol, Row: stored.FromRow},
			To:   xiangqiPosition{Col: stored.Col, Row: stored.Row},
		})
	}

	move := xiangqiMove{
		From: xiangqiPosition{Col: input.FromCol, Row: input.FromRow},
		To:   xiangqiPosition{Col: input.Col, Row: input.Row},
	}
	piece := xiangqiPieceAt(board, input.FromCol, input.FromRow)
	if piece == nil || piece.Color == "" {
		return GameMatch{}, ErrGameMove
	}
	expectedColor := "red"
	if len(moves)%2 == 1 {
		expectedColor = "black"
	}
	if expectedColor != piece.Color {
		return GameMatch{}, ErrGameMove
	}
	legal := false
	for _, candidate := range xiangqiPseudoMoves(board, move.From) {
		if candidate.To == move.To && !xiangqiInCheck(xiangqiApply(board, candidate), piece.Color) {
			legal = true
			break
		}
	}
	if !legal {
		return GameMatch{}, ErrGameMove
	}

	board = xiangqiApply(board, move)
	winner, draw := xiangqiGameResult(board, xiangqiOpponent(piece.Color))
	now := time.Now().UTC()
	nextSequence := len(moves) + 1
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO game_match_moves
		 (match_id, sequence, user_id, client_move_id, row_index, col_index,
		  from_row_index, from_col_index, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		matchID,
		nextSequence,
		userID,
		input.ClientMoveID,
		input.Col,
		input.Row,
		input.FromRow,
		input.FromCol,
		now.UnixMilli(),
	); err != nil {
		return GameMatch{}, fmt.Errorf("insert xiangqi move: %w", err)
	}

	nextStatus := GameMatchActive
	nextTurn := opponentID
	if userID == opponentID {
		nextTurn = inviterID
	}
	if winner != "" || draw {
		nextStatus = GameMatchFinished
		nextTurn = ""
	}
	winnerUserID := ""
	if winner != "" && winner != piece.Color {
		winnerUserID = userID
	}
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE game_matches
		 SET status = ?, current_turn_user_id = NULLIF(?, ''), winner_user_id = NULLIF(?, ''),
		     updated_at = ? WHERE id = ?`,
		nextStatus,
		nextTurn,
		winnerUserID,
		now.UnixMilli(),
		matchID,
	); err != nil {
		return GameMatch{}, fmt.Errorf("update xiangqi match: %w", err)
	}
	return s.GetGameMatch(ctx, matchID, userID)
}

func (s *Store) ResignGameMatch(ctx context.Context, matchID string, userID string) (GameMatch, error) {
	match, err := s.GetGameMatch(ctx, matchID, userID)
	if err != nil {
		return GameMatch{}, err
	}
	if match.Status != GameMatchActive {
		return GameMatch{}, ErrMatchNotActive
	}
	winnerID := match.Inviter.ID
	if userID == match.Inviter.ID {
		winnerID = match.Opponent.ID
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE game_matches
		 SET status = ?, current_turn_user_id = NULL, winner_user_id = ?, updated_at = ?
		 WHERE id = ? AND status = ?`,
		GameMatchFinished,
		winnerID,
		now.UnixMilli(),
		matchID,
		GameMatchActive,
	); err != nil {
		return GameMatch{}, fmt.Errorf("resign game match: %w", err)
	}
	return s.GetGameMatch(ctx, matchID, userID)
}

func (s *Store) GetGameMatch(ctx context.Context, matchID string, userID string) (GameMatch, error) {
	return getGameMatchFrom(ctx, s.db, matchID, userID)
}

func (s *Store) ListGameMatches(ctx context.Context, userID string) ([]GameMatch, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id FROM game_matches
		 WHERE inviter_id = ? OR opponent_id = ?
		 ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
		          updated_at DESC
		 LIMIT 50`,
		userID,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list game match ids: %w", err)
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("scan game match id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	matches := make([]GameMatch, 0, len(ids))
	for _, id := range ids {
		match, err := s.GetGameMatch(ctx, id, userID)
		if err != nil {
			return nil, err
		}
		matches = append(matches, match)
	}
	return matches, nil
}

func (s *Store) SubmitGameScore(
	ctx context.Context,
	userID string,
	gameID string,
	score int,
	createdAt time.Time,
) (GameScore, error) {
	capability, ok := GameCapabilityFor(gameID)
	if !ok || capability.ScoreRule != "higher" {
		return GameScore{}, ErrGameCapability
	}
	if score < 0 || score > 1_000_000_000 {
		return GameScore{}, ErrGameMove
	}
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	created := GameScore{
		CreatedAt: createdAt.UTC(),
		GameID:    gameID,
		ID:        uuid.NewString(),
		Score:     score,
		UserID:    userID,
	}
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO game_score_submissions (id, game_id, user_id, score, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		created.ID,
		created.GameID,
		created.UserID,
		created.Score,
		created.CreatedAt.UnixMilli(),
	); err != nil {
		return GameScore{}, fmt.Errorf("submit game score: %w", err)
	}
	return created, nil
}

func (s *Store) ListFriendLeaderboard(
	ctx context.Context,
	userID string,
	gameID string,
	period string,
	now time.Time,
) ([]LeaderboardEntry, error) {
	capability, ok := GameCapabilityFor(gameID)
	if !ok || capability.ScoreRule != "higher" {
		return nil, ErrGameCapability
	}
	if period != LeaderboardWeekly && period != LeaderboardAllTime {
		return nil, ErrGameMove
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	cutoff := int64(0)
	if period == LeaderboardWeekly {
		cutoff = startOfUTCWeek(now).UnixMilli()
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT u.id, u.username, u.display_name, u.avatar_file, s.score, s.created_at
		 FROM game_score_submissions s
		 JOIN users u ON u.id = s.user_id
		 WHERE s.game_id = ? AND s.created_at >= ?
		   AND (s.user_id = ? OR EXISTS (
		     SELECT 1 FROM friendships f
		     WHERE (f.user_one_id = ? AND f.user_two_id = s.user_id)
		        OR (f.user_two_id = ? AND f.user_one_id = s.user_id)
		   ))`,
		gameID,
		cutoff,
		userID,
		userID,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query friend leaderboard: %w", err)
	}
	defer rows.Close()

	best := make(map[string]LeaderboardEntry)
	for rows.Next() {
		var entry LeaderboardEntry
		var updatedAt int64
		if err := rows.Scan(
			&entry.User.ID,
			&entry.User.Username,
			&entry.User.DisplayName,
			&entry.User.AvatarFile,
			&entry.Score,
			&updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan friend leaderboard score: %w", err)
		}
		entry.IsCurrentUser = entry.User.ID == userID
		entry.UpdatedAt = time.UnixMilli(updatedAt).UTC()
		previous, exists := best[entry.User.ID]
		if !exists || entry.Score > previous.Score || (entry.Score == previous.Score && entry.UpdatedAt.Before(previous.UpdatedAt)) {
			best[entry.User.ID] = entry
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	entries := make([]LeaderboardEntry, 0, len(best))
	for _, entry := range best {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(left int, right int) bool {
		if entries[left].Score != entries[right].Score {
			return entries[left].Score > entries[right].Score
		}
		if !entries[left].UpdatedAt.Equal(entries[right].UpdatedAt) {
			return entries[left].UpdatedAt.Before(entries[right].UpdatedAt)
		}
		return entries[left].User.ID < entries[right].User.ID
	})
	for index := range entries {
		entries[index].Rank = index + 1
	}
	return entries, nil
}

type gameMatchQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func getGameMatchFrom(
	ctx context.Context,
	queryer gameMatchQueryer,
	matchID string,
	userID string,
) (GameMatch, error) {
	var match GameMatch
	var createdAt int64
	var updatedAt int64
	var currentTurn sql.NullString
	var winner sql.NullString
	err := queryer.QueryRowContext(
		ctx,
		`SELECT
		   gm.id, gm.game_id, gm.status, gm.created_at, gm.updated_at,
		   gm.current_turn_user_id, gm.winner_user_id,
		   inviter.id, inviter.username, inviter.display_name, inviter.avatar_file,
		   opponent.id, opponent.username, opponent.display_name, opponent.avatar_file
		 FROM game_matches gm
		 JOIN users inviter ON inviter.id = gm.inviter_id
		 JOIN users opponent ON opponent.id = gm.opponent_id
		 WHERE gm.id = ?`,
		matchID,
	).Scan(
		&match.ID,
		&match.GameID,
		&match.Status,
		&createdAt,
		&updatedAt,
		&currentTurn,
		&winner,
		&match.Inviter.ID,
		&match.Inviter.Username,
		&match.Inviter.DisplayName,
		&match.Inviter.AvatarFile,
		&match.Opponent.ID,
		&match.Opponent.Username,
		&match.Opponent.DisplayName,
		&match.Opponent.AvatarFile,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return GameMatch{}, ErrNotFound
	}
	if err != nil {
		return GameMatch{}, fmt.Errorf("get game match: %w", err)
	}
	if match.Inviter.ID != userID && match.Opponent.ID != userID {
		return GameMatch{}, ErrForbidden
	}
	match.CreatedAt = time.UnixMilli(createdAt).UTC()
	match.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	match.CurrentTurnUserID = currentTurn.String
	match.WinnerUserID = winner.String
	moves, err := listGameMoves(ctx, queryer, matchID)
	if err != nil {
		return GameMatch{}, err
	}
	match.Moves = moves
	return match, nil
}

func listGameMoves(ctx context.Context, queryer gameMatchQueryer, matchID string) ([]GameMove, error) {
	rows, err := queryer.QueryContext(
		ctx,
		`SELECT sequence, user_id, client_move_id, row_index, col_index,
		        created_at, from_row_index, from_col_index
		 FROM game_match_moves WHERE match_id = ? ORDER BY sequence`,
		matchID,
	)
	if err != nil {
		return nil, fmt.Errorf("list game moves: %w", err)
	}
	defer rows.Close()
	moves := make([]GameMove, 0)
	for rows.Next() {
		var move GameMove
		var createdAt int64
		if err := rows.Scan(
			&move.Sequence,
			&move.UserID,
			&move.ClientMoveID,
			&move.Row,
			&move.Col,
			&createdAt,
			&move.FromRow,
			&move.FromCol,
		); err != nil {
			return nil, fmt.Errorf("scan game move: %w", err)
		}
		move.CreatedAt = time.UnixMilli(createdAt).UTC()
		moves = append(moves, move)
	}
	return moves, rows.Err()
}

func (s *Store) areFriends(ctx context.Context, firstUserID string, secondUserID string) (bool, error) {
	one, two := orderedUsers(firstUserID, secondUserID)
	var count int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM friendships WHERE user_one_id = ? AND user_two_id = ?`,
		one,
		two,
	).Scan(&count); err != nil {
		return false, fmt.Errorf("check game friendship: %w", err)
	}
	return count > 0, nil
}

func hasGomokuWin(moves []GameMove, userID string, row int, col int) bool {
	occupied := make(map[[2]int]bool)
	for _, move := range moves {
		if move.UserID == userID {
			occupied[[2]int{move.Row, move.Col}] = true
		}
	}
	for _, direction := range [][2]int{{0, 1}, {1, 0}, {1, 1}, {1, -1}} {
		count := 1
		for sign := -1; sign <= 1; sign += 2 {
			for offset := 1; ; offset++ {
				position := [2]int{
					row + direction[0]*offset*sign,
					col + direction[1]*offset*sign,
				}
				if !occupied[position] {
					break
				}
				count++
			}
		}
		if count >= 5 {
			return true
		}
	}
	return false
}

func startOfUTCWeek(value time.Time) time.Time {
	date := value.UTC()
	daysSinceMonday := (int(date.Weekday()) + 6) % 7
	return time.Date(date.Year(), date.Month(), date.Day()-daysSinceMonday, 0, 0, 0, 0, time.UTC)
}
