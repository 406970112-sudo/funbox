package homemanual

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestStoreEncryptsSecretsAfterPasswordSet(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createHomeManualUsersTable(t, store.db)

	state := State{
		SchemaVersion: 1,
		Devices: []Device{
			{ID: "d1", Category: "water-purifier", Name: "厨房净水器", Model: "真实型号", UpdatedAt: 1},
		},
		Networks: []Network{
			{ID: "n1", Name: "家庭网络", SSID: "HomeWiFi", SecurityType: "WPA2", WiFiPassword: "real-password", RouterURL: "192.168.1.1", UpdatedAt: 2},
		},
		Contacts: []Contact{
			{ID: "c1", Kind: "property", Name: "物业", Phone: "13800000000", UpdatedAt: 3},
		},
		Reminders: []Reminder{},
	}
	if err := store.SetPassword(context.Background(), "user-1", "set", "", "home1234"); err != nil {
		t.Fatalf("set password: %v", err)
	}
	saved, err := store.SaveState(context.Background(), "user-1", state, makeDataKeyForTest(t, store, "user-1", "home1234"))
	if err != nil {
		t.Fatalf("save encrypted state: %v", err)
	}
	if !saved.Security.Enabled {
		t.Fatalf("expected security enabled")
	}

	metadata, err := store.GetState(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("get metadata: %v", err)
	}
	if metadata.Networks[0].WiFiPassword != "" || metadata.Contacts[0].Phone != "" {
		t.Fatalf("metadata leaked secrets: %+v", metadata)
	}
	if _, err := store.GetFullState(context.Background(), "user-1", nil); err != ErrLocked {
		t.Fatalf("expected locked without data key, got %v", err)
	}

	token, expiresIn, err := store.Unlock(context.Background(), "user-1", "home1234")
	if err != nil {
		t.Fatalf("unlock: %v", err)
	}
	if expiresIn <= 0 {
		t.Fatalf("expected positive expiry")
	}
	dataKey, err := store.GetDataKey(context.Background(), "user-1", token)
	if err != nil {
		t.Fatalf("get data key: %v", err)
	}
	full, err := store.GetFullState(context.Background(), "user-1", dataKey)
	if err != nil {
		t.Fatalf("get full state: %v", err)
	}
	if full.Networks[0].WiFiPassword != "real-password" || full.Contacts[0].Phone != "13800000000" {
		t.Fatalf("unexpected full state: %+v", full)
	}
	if err := store.Lock(context.Background(), "user-1", token); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if _, err := store.GetDataKey(context.Background(), "user-1", token); err != ErrLocked {
		t.Fatalf("expected locked after manual lock")
	}
}

func TestStoreRejectsSecretsWithoutPassword(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createHomeManualUsersTable(t, store.db)

	state := State{
		SchemaVersion: 1,
		Networks: []Network{
			{ID: "n1", Name: "家庭网络", WiFiPassword: "secret", UpdatedAt: 1},
		},
	}
	if _, err := store.SaveState(context.Background(), "user-1", state, nil); err != ErrPasswordRequired {
		t.Fatalf("expected password required, got %v", err)
	}
}

func TestStoreRejectsWrongPasswordAndLocksOut(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createHomeManualUsersTable(t, store.db)

	if err := store.SetPassword(context.Background(), "user-1", "set", "", "home1234"); err != nil {
		t.Fatalf("set password: %v", err)
	}
	for i := 0; i < 4; i++ {
		if _, _, err := store.Unlock(context.Background(), "user-1", "wrong"); err != ErrPasswordMismatch {
			t.Fatalf("expected mismatch at %d, got %v", i, err)
		}
	}
	if _, _, err := store.Unlock(context.Background(), "user-1", "wrong"); err != ErrPasswordMismatch {
		t.Fatalf("expected mismatch before lockout")
	}
	if _, _, err := store.Unlock(context.Background(), "user-1", "home1234"); err != ErrLockedOut {
		t.Fatalf("expected locked out, got %v", err)
	}
}

func createHomeManualUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'home-manual-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}

func makeDataKeyForTest(t *testing.T, store *Store, userID string, password string) []byte {
	t.Helper()
	token, _, err := store.Unlock(context.Background(), userID, password)
	if err != nil {
		t.Fatalf("unlock for test: %v", err)
	}
	dataKey, err := store.GetDataKey(context.Background(), userID, token)
	if err != nil {
		t.Fatalf("get data key for test: %v", err)
	}
	return dataKey
}
