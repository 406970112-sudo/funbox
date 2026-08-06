package partymemorycard

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestStoreRealPartyFlow(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsers(t, store.db)
	ctx := context.Background()

	summary, err := store.Summary(ctx, "user-1")
	if err != nil || summary.TotalCards != 0 {
		t.Fatalf("expected empty summary: %#v %v", summary, err)
	}

	amount := int64(48600)
	card, err := store.CreateCard(ctx, "user-1", CardInput{
		Title:             "8月老友聚餐",
		PartyDate:         "2026-08-06 20:30",
		VenueName:         "川香居",
		VenueAddress:      "滨江路 18 号",
		HostType:          "member",
		HostParticipantID: "client-a",
		TotalAmountCents:  &amount,
		ExpenseVisibility: "participants",
		ShareMode:         "shared",
		Participants: []ParticipantInput{
			{ClientID: "client-a", UserID: strPtr("user-1"), Name: "我"},
			{ClientID: "client-b", Name: "李雷"},
			{ClientID: "client-c", Name: "韩梅梅"},
		},
	})
	if err != nil {
		t.Fatalf("create card: %v", err)
	}
	if card.ParticipantCount != 3 || card.HostParticipantName != "我" {
		t.Fatalf("unexpected card: %#v", card)
	}

	detail, err := store.GetCardDetail(ctx, "user-1", card.ID)
	if err != nil {
		t.Fatalf("get detail: %v", err)
	}
	if len(detail.Participants) != 3 {
		t.Fatalf("unexpected participants: %#v", detail.Participants)
	}

	dish, err := store.CreateDish(ctx, "user-1", card.ID, DishInput{Name: "烤鱼", PriceCents: &amount})
	if err != nil {
		t.Fatalf("create dish: %v", err)
	}
	if _, err := store.VoteDish(ctx, "user-1", card.ID, dish.ID, DishVoteInput{Rating: "like"}); err != nil {
		t.Fatalf("vote dish: %v", err)
	}
	if _, err := store.AddVenueNote(ctx, "user-1", card.ID, VenueNoteInput{Dimension: "parking", Content: "停车不方便"}); err != nil {
		t.Fatalf("add venue note: %v", err)
	}
	if _, err := store.AddAgainVote(ctx, "user-1", card.ID, AgainVoteInput{Vote: "want"}); err != nil {
		t.Fatalf("add again vote: %v", err)
	}

	prep, err := store.GetNextPrep(ctx, "user-1")
	if err != nil || !prep.HasPrevious {
		t.Fatalf("expected next prep: %#v %v", prep, err)
	}
	if prep.Card == nil || prep.Card.VenueName != "川香居" || len(prep.Dishes) != 1 {
		t.Fatalf("unexpected prep: %#v", prep)
	}
}

func TestStoreExpensePrivacy(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsers(t, store.db)
	ctx := context.Background()
	amount := int64(39200)
	card, err := store.CreateCard(ctx, "user-1", CardInput{
		PartyDate:         "2026-08-06 20:30",
		VenueName:         "老码头火锅",
		HostType:          "aa",
		TotalAmountCents:  &amount,
		ExpenseVisibility: "owner",
		ShareMode:         "shared",
		Participants: []ParticipantInput{
			{UserID: strPtr("user-2"), Name: "王明"},
			{Name: "李雷"},
		},
	})
	if err != nil {
		t.Fatalf("create card: %v", err)
	}
	hidden, err := store.GetCard(ctx, "user-2", card.ID)
	if err != nil {
		t.Fatalf("get hidden: %v", err)
	}
	if hidden.TotalAmountCents != nil {
		t.Fatalf("expected hidden amount: %#v", hidden.TotalAmountCents)
	}
}

func createUsers(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users: %v", err)
	}
	for _, u := range []struct{ id, name string }{
		{"user-1", "party-owner"},
		{"user-2", "party-friend"},
	} {
		if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)`, u.id, u.name); err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
}

func strPtr(value string) *string {
	return &value
}
