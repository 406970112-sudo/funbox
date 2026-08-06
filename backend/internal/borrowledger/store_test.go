package borrowledger

import (
	"context"
	"database/sql"
	"testing"
)

func amount(value float64) *float64 {
	return &value
}

func TestStoreRoundTrip(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	createBorrowLedgerUsersTable(t, store.db)

	initial, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("get initial state: %v", err)
	}
	if initial.SchemaVersion != 1 || len(initial.Records) != 0 {
		t.Fatalf("expected empty initial state, got %+v", initial)
	}

	state := State{
		SchemaVersion: 1,
		Records: []Record{
			{
				ID:          "r1",
				Kind:        KindLendOut,
				SubjectType: SubjectItem,
				Title:       "充电器",
				Counterparty: Counterparty{
					Name: "阿哲",
				},
				LentAt:     "2026-08-01",
				DueAt:      "2026-08-10",
				RemindRule: RemindBefore3Days,
				CreatedAt:  100,
				UpdatedAt:  100,
			},
			{
				ID:          "r2",
				Kind:        KindPaidFor,
				SubjectType: SubjectMoney,
				Title:       "垫付费用",
				Amount:      amount(120),
				Currency:    "CNY",
				Counterparty: Counterparty{
					Name: "小王",
				},
				LentAt:     "2026-08-02",
				RemindRule: RemindNone,
				CreatedAt:  200,
				UpdatedAt:  200,
			},
		},
	}
	saved, err := store.SaveState(context.Background(), "user-1", state)
	if err != nil {
		t.Fatalf("save state: %v", err)
	}
	if saved.UpdatedAt <= 0 || len(saved.Records) != 2 {
		t.Fatalf("unexpected saved state: %+v", saved)
	}

	loaded, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("get saved state: %v", err)
	}
	if loaded.Records[0].Title != "充电器" || loaded.Records[1].Currency != "CNY" {
		t.Fatalf("unexpected loaded records: %+v", loaded.Records)
	}

	cleared, err := store.ClearState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("clear state: %v", err)
	}
	if len(cleared.Records) != 0 {
		t.Fatalf("expected cleared state, got %+v", cleared)
	}
}

func createBorrowLedgerUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'borrow-ledger-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}

func TestValidateStateRejectsInvalidRecords(t *testing.T) {
	state := State{
		SchemaVersion: 1,
		Records: []Record{
			{
				ID:          "r1",
				Kind:        KindLendOut,
				SubjectType: SubjectMoney,
				Title:       "借款",
				Counterparty: Counterparty{
					Name: "阿哲",
				},
				LentAt: "2026-08-01",
			},
		},
	}
	if err := ValidateState(state); err == nil {
		t.Fatal("expected invalid amount error")
	}

	state.Records[0].Amount = amount(0)
	if err := ValidateState(state); err == nil {
		t.Fatal("expected zero amount error")
	}
}
