package social

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/user"
)

func TestGameMatchRequiresFriendsAndEnforcesAuthoritativeGomokuTurns(t *testing.T) {
	store, accounts := openGameTestStore(t, "Alice", "Bob")
	alice := accounts[0]
	bob := accounts[1]
	ctx := context.Background()

	if _, err := store.CreateGameMatch(ctx, alice.ID, bob.ID, "gomoku"); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("create match before friendship error = %v, want ErrNotFriends", err)
	}
	makeGameTestFriends(t, store, alice.ID, bob.ID)

	match, err := store.CreateGameMatch(ctx, alice.ID, bob.ID, "gomoku")
	if err != nil {
		t.Fatalf("create match: %v", err)
	}
	if match.Status != GameMatchPending || match.Inviter.ID != alice.ID || match.Opponent.ID != bob.ID {
		t.Fatalf("pending match = %+v", match)
	}

	match, err = store.RespondGameMatch(ctx, match.ID, bob.ID, true)
	if err != nil {
		t.Fatalf("accept match: %v", err)
	}
	if match.Status != GameMatchActive || match.CurrentTurnUserID != alice.ID {
		t.Fatalf("active match = %+v", match)
	}

	if _, err := store.SubmitGameMove(ctx, match.ID, bob.ID, GameMoveInput{
		ClientMoveID: "bob-too-early",
		Col:          0,
		Row:          0,
	}); !errors.Is(err, ErrNotYourTurn) {
		t.Fatalf("out-of-turn move error = %v, want ErrNotYourTurn", err)
	}

	winningMoves := []struct {
		clientMoveID string
		col          int
		row          int
		userID       string
	}{
		{"alice-1", 5, 7, alice.ID},
		{"bob-1", 0, 0, bob.ID},
		{"alice-2", 6, 7, alice.ID},
		{"bob-2", 1, 0, bob.ID},
		{"alice-3", 7, 7, alice.ID},
		{"bob-3", 2, 0, bob.ID},
		{"alice-4", 8, 7, alice.ID},
		{"bob-4", 3, 0, bob.ID},
		{"alice-5", 9, 7, alice.ID},
	}

	for index, move := range winningMoves {
		match, err = store.SubmitGameMove(ctx, match.ID, move.userID, GameMoveInput{
			ClientMoveID: move.clientMoveID,
			Col:          move.col,
			Row:          move.row,
		})
		if err != nil {
			t.Fatalf("submit move %d: %v", index+1, err)
		}
		if index == 0 {
			retried, retryErr := store.SubmitGameMove(ctx, match.ID, move.userID, GameMoveInput{
				ClientMoveID: move.clientMoveID,
				Col:          move.col,
				Row:          move.row,
			})
			if retryErr != nil {
				t.Fatalf("retry first move: %v", retryErr)
			}
			if len(retried.Moves) != 1 {
				t.Fatalf("retried move count = %d, want 1", len(retried.Moves))
			}
		}
	}

	if match.Status != GameMatchFinished || match.WinnerUserID != alice.ID || len(match.Moves) != 9 {
		t.Fatalf("finished match = %+v", match)
	}
}

func TestGameMatchResignationAwardsTheOpponent(t *testing.T) {
	store, accounts := openGameTestStore(t, "Alice", "Bob")
	alice := accounts[0]
	bob := accounts[1]
	makeGameTestFriends(t, store, alice.ID, bob.ID)

	match, err := store.CreateGameMatch(context.Background(), alice.ID, bob.ID, "gomoku")
	if err != nil {
		t.Fatalf("create match: %v", err)
	}
	match, err = store.RespondGameMatch(context.Background(), match.ID, bob.ID, true)
	if err != nil {
		t.Fatalf("accept match: %v", err)
	}
	match, err = store.ResignGameMatch(context.Background(), match.ID, bob.ID)
	if err != nil {
		t.Fatalf("resign match: %v", err)
	}
	if match.Status != GameMatchFinished || match.WinnerUserID != alice.ID {
		t.Fatalf("resigned match = %+v", match)
	}
}

func TestXiangqiFriendMatchValidatesMovesAndDeterminesWinner(t *testing.T) {
	store, accounts := openGameTestStore(t, "Alice", "Bob")
	alice := accounts[0]
	bob := accounts[1]
	makeGameTestFriends(t, store, alice.ID, bob.ID)
	ctx := context.Background()

	match, err := store.CreateGameMatch(ctx, alice.ID, bob.ID, "xiangqi")
	if err != nil {
		t.Fatalf("create xiangqi match: %v", err)
	}
	match, err = store.RespondGameMatch(ctx, match.ID, bob.ID, true)
	if err != nil {
		t.Fatalf("accept xiangqi match: %v", err)
	}
	if match.CurrentTurnUserID != alice.ID {
		t.Fatalf("red should start, current turn = %s", match.CurrentTurnUserID)
	}

	// Red cannon slides from col 1 to col 5 on row 7, then black horse jumps.
	moves := []struct {
		clientMoveID string
		fromCol      int
		fromRow      int
		toCol        int
		toRow        int
		userID       string
	}{
		{"alice-cannon", 1, 7, 5, 7, alice.ID},
		{"bob-horse", 7, 0, 6, 2, bob.ID},
	}
	for _, move := range moves {
		match, err = store.SubmitGameMove(ctx, match.ID, move.userID, GameMoveInput{
			ClientMoveID: move.clientMoveID,
			Col:          move.toCol,
			FromCol:      move.fromCol,
			FromRow:      move.fromRow,
			Row:          move.toRow,
		})
		if err != nil {
			t.Fatalf("submit %s: %v", move.clientMoveID, err)
		}
		t.Logf("after %s currentTurn=%s status=%s moves=%d", move.clientMoveID, match.CurrentTurnUserID, match.Status, len(match.Moves))
	}
	if len(match.Moves) != 2 {
		t.Fatalf("expected 2 moves, got %d", len(match.Moves))
	}
	if match.Moves[0].FromCol != 1 || match.Moves[0].FromRow != 7 ||
		match.Moves[0].Col != 7 || match.Moves[0].Row != 5 {
		t.Fatalf("stored red move = %+v", match.Moves[0])
	}

	if _, err := store.SubmitGameMove(ctx, match.ID, bob.ID, GameMoveInput{
		ClientMoveID: "alice-twice",
		Col:          5,
		FromCol:      7,
		FromRow:      7,
		Row:          7,
	}); !errors.Is(err, ErrNotYourTurn) {
		t.Fatalf("out-of-turn move error = %v, want ErrNotYourTurn", err)
	}
	if _, err := store.SubmitGameMove(ctx, match.ID, alice.ID, GameMoveInput{
		ClientMoveID: "alice-illegal",
		Col:          8,
		FromCol:      0,
		FromRow:      9,
		Row:          6,
	}); !errors.Is(err, ErrGameMove) {
		t.Fatalf("illegal jump error = %v, want ErrGameMove", err)
	}

	match, err = store.ResignGameMatch(ctx, match.ID, bob.ID)
	if err != nil {
		t.Fatalf("resign xiangqi match: %v", err)
	}
	if match.Status != GameMatchFinished || match.WinnerUserID != alice.ID {
		t.Fatalf("expected resignation win, match = %+v", match)
	}
}

func TestGameGomokuWinDetectionCoversEveryDirection(t *testing.T) {
	directions := []struct {
		colDelta int
		name     string
		rowDelta int
	}{
		{name: "horizontal", rowDelta: 0, colDelta: 1},
		{name: "vertical", rowDelta: 1, colDelta: 0},
		{name: "down diagonal", rowDelta: 1, colDelta: 1},
		{name: "up diagonal", rowDelta: 1, colDelta: -1},
	}

	for _, direction := range directions {
		t.Run(direction.name, func(t *testing.T) {
			moves := make([]GameMove, 0, 5)
			for offset := -2; offset <= 2; offset++ {
				moves = append(moves, GameMove{
					Col:    7 + direction.colDelta*offset,
					Row:    7 + direction.rowDelta*offset,
					UserID: "alice",
				})
			}
			if !hasGomokuWin(moves, "alice", 7, 7) {
				t.Fatal("five connected stones were not detected")
			}
		})
	}
}

func TestGameLeaderboardUsesBestScoreCurrentWeekAndFriendsOnly(t *testing.T) {
	store, accounts := openGameTestStore(t, "Alice", "Bob", "Carol")
	alice := accounts[0]
	bob := accounts[1]
	carol := accounts[2]
	makeGameTestFriends(t, store, alice.ID, bob.ID)
	ctx := context.Background()
	now := time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC)
	previousWeek := time.Date(2026, time.July, 24, 12, 0, 0, 0, time.UTC)

	submissions := []struct {
		at     time.Time
		score  int
		userID string
	}{
		{previousWeek, 1200, alice.ID},
		{now.Add(-3 * time.Hour), 1000, alice.ID},
		{now.Add(-2 * time.Hour), 1100, alice.ID},
		{now.Add(-time.Hour), 900, alice.ID},
		{now.Add(-4 * time.Hour), 1500, bob.ID},
		{now.Add(-time.Hour), 9999, carol.ID},
	}
	for _, submission := range submissions {
		if _, err := store.SubmitGameScore(ctx, submission.userID, "tetris", submission.score, submission.at); err != nil {
			t.Fatalf("submit score for %s: %v", submission.userID, err)
		}
	}

	weekly, err := store.ListFriendLeaderboard(ctx, alice.ID, "tetris", LeaderboardWeekly, now)
	if err != nil {
		t.Fatalf("list weekly leaderboard: %v", err)
	}
	if len(weekly) != 2 || weekly[0].User.ID != bob.ID || weekly[0].Score != 1500 || weekly[0].Rank != 1 {
		t.Fatalf("weekly leaderboard = %+v", weekly)
	}
	if weekly[1].User.ID != alice.ID || weekly[1].Score != 1100 || weekly[1].Rank != 2 {
		t.Fatalf("weekly current user entry = %+v", weekly[1])
	}

	allTime, err := store.ListFriendLeaderboard(ctx, alice.ID, "tetris", LeaderboardAllTime, now)
	if err != nil {
		t.Fatalf("list all-time leaderboard: %v", err)
	}
	if len(allTime) != 2 || allTime[1].User.ID != alice.ID || allTime[1].Score != 1200 {
		t.Fatalf("all-time leaderboard = %+v", allTime)
	}

	if _, err := store.SubmitGameScore(ctx, alice.ID, "gomoku", 10, now); !errors.Is(err, ErrGameCapability) {
		t.Fatalf("unsupported score error = %v, want ErrGameCapability", err)
	}
}

func openGameTestStore(t *testing.T, names ...string) (*Store, []user.User) {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "game-social.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })

	accounts := make([]user.User, 0, len(names))
	for index, name := range names {
		account, createErr := userStore.Create(
			context.Background(),
			"1380013800"+string(rune('0'+index)),
			"hash",
			name,
			"question",
			"answer-hash",
		)
		if createErr != nil {
			t.Fatalf("create user %s: %v", name, createErr)
		}
		accounts = append(accounts, account)
	}

	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, accounts
}

func makeGameTestFriends(t *testing.T, store *Store, senderID string, recipientID string) {
	t.Helper()
	request, err := store.CreateFriendRequest(context.Background(), senderID, recipientID)
	if err != nil {
		t.Fatalf("create friend request: %v", err)
	}
	if _, _, err := store.RespondToFriendRequest(context.Background(), request.ID, recipientID, true); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}
}
