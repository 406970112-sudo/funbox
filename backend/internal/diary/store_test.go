package diary

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/user"
)

type diaryTestFixture struct {
	account user.User
	store   *Store
}

func openDiaryTestStore(t *testing.T, name string) diaryTestFixture {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "diary.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	account, err := userStore.Create(
		context.Background(),
		"139"+name,
		"hash",
		name,
		"question",
		"answer-hash",
	)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open diary store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return diaryTestFixture{account: account, store: store}
}

func TestDiaryOpenNotebookStoresRealEntries(t *testing.T) {
	fixture := openDiaryTestStore(t, "Alice")
	store := fixture.store
	ctx := context.Background()

	notebook, err := store.CreateNotebook(ctx, fixture.account.ID, NotebookInput{
		Name:       "旅行手记",
		CoverColor: "#18a78f",
	})
	if err != nil {
		t.Fatalf("create notebook: %v", err)
	}
	date := time.Now().UTC().Format("2006-01-02")
	entry, err := store.UpsertEntry(ctx, fixture.account.ID, notebook.ID, date, EntryInput{
		Title:   "西湖傍晚",
		Content: "云被风吹成很薄的一层。",
		Mood:    "happy",
		Weather: "sunny",
	}, nil)
	if err != nil {
		t.Fatalf("upsert entry: %v", err)
	}
	if entry.Content != "云被风吹成很薄的一层。" || entry.Mood != "happy" {
		t.Fatalf("entry = %+v", entry)
	}

	notebook, err = store.GetNotebook(ctx, fixture.account.ID, notebook.ID)
	if err != nil {
		t.Fatalf("get notebook: %v", err)
	}
	if notebook.EntryCount != 1 || notebook.LastEntryDate != date {
		t.Fatalf("notebook stats = %+v", notebook)
	}
	month := time.Now().UTC().Format("2006-01")
	calendar, err := store.Calendar(ctx, fixture.account.ID, notebook.ID, month)
	if err != nil {
		t.Fatalf("calendar: %v", err)
	}
	if len(calendar.Days) != 1 || calendar.Days[0].Date != date {
		t.Fatalf("calendar = %+v", calendar.Days)
	}
	stats, err := store.Stats(ctx, fixture.account.ID, notebook.ID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.EntryCount != 1 || stats.MonthCount != 1 {
		t.Fatalf("stats = %+v", stats)
	}

	if err := store.DeleteEntry(ctx, fixture.account.ID, notebook.ID, date); err != nil {
		t.Fatalf("delete entry: %v", err)
	}
	if _, err := store.GetEntry(ctx, fixture.account.ID, notebook.ID, date, nil); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get deleted entry error = %v, want ErrNotFound", err)
	}
}

func TestDiaryPasswordEncryptionUnlockChangeAndRemove(t *testing.T) {
	fixture := openDiaryTestStore(t, "Bob")
	store := fixture.store
	ctx := context.Background()
	password := "secret123"
	notebook, err := store.CreateNotebook(ctx, fixture.account.ID, NotebookInput{
		Name:     "秘密花园",
		Password: &password,
	})
	if err != nil {
		t.Fatalf("create protected notebook: %v", err)
	}
	if !notebook.HasPassword {
		t.Fatal("notebook should have password")
	}
	date := time.Now().UTC().Format("2006-01-02")
	if _, err := store.GetEntry(ctx, fixture.account.ID, notebook.ID, date, nil); !errors.Is(err, ErrLocked) {
		t.Fatalf("get entry before unlock error = %v, want ErrLocked", err)
	}
	if _, err := store.Unlock(ctx, fixture.account.ID, notebook.ID, "wrong-password"); !errors.Is(err, ErrPasswordMismatch) {
		t.Fatalf("wrong password error = %v, want ErrPasswordMismatch", err)
	}
	token, err := store.Unlock(ctx, fixture.account.ID, notebook.ID, password)
	if err != nil {
		t.Fatalf("unlock: %v", err)
	}
	dataKey, err := store.GetDataKey(ctx, fixture.account.ID, notebook.ID, token)
	if err != nil {
		t.Fatalf("get data key: %v", err)
	}
	if len(dataKey) != argonKeyLength {
		t.Fatalf("data key length = %d", len(dataKey))
	}
	entry, err := store.UpsertEntry(ctx, fixture.account.ID, notebook.ID, date, EntryInput{
		Title:   "只给自己看",
		Content: "今天没有告诉任何人。",
		Mood:    "calm",
	}, dataKey)
	if err != nil {
		t.Fatalf("upsert encrypted entry: %v", err)
	}
	if entry.Content != "今天没有告诉任何人。" {
		t.Fatalf("decrypted content = %q", entry.Content)
	}
	results, err := store.Search(ctx, fixture.account.ID, notebook.ID, "任何人", dataKey, 10)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("search results = %d", len(results))
	}
	exported, err := store.ExportEntries(ctx, fixture.account.ID, notebook.ID, dataKey)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if len(exported) != 1 || exported[0].Content != "今天没有告诉任何人。" {
		t.Fatalf("export = %+v", exported)
	}

	newPassword := "new-secret-123"
	notebook, err = store.SetPassword(ctx, fixture.account.ID, notebook.ID, PasswordInput{
		Action:  "change",
		Current: password,
		New:     newPassword,
	})
	if err != nil {
		t.Fatalf("change password: %v", err)
	}
	if !notebook.HasPassword {
		t.Fatal("notebook should still have password")
	}
	if _, err := store.GetDataKey(ctx, fixture.account.ID, notebook.ID, token); !errors.Is(err, ErrLocked) {
		t.Fatalf("old token error = %v, want ErrLocked", err)
	}
	token, err = store.Unlock(ctx, fixture.account.ID, notebook.ID, newPassword)
	if err != nil {
		t.Fatalf("unlock after change: %v", err)
	}
	dataKey, err = store.GetDataKey(ctx, fixture.account.ID, notebook.ID, token)
	if err != nil {
		t.Fatalf("get data key after change: %v", err)
	}
	entry, err = store.GetEntry(ctx, fixture.account.ID, notebook.ID, date, dataKey)
	if err != nil {
		t.Fatalf("get entry after change: %v", err)
	}
	if entry.Content != "今天没有告诉任何人。" {
		t.Fatalf("content after change = %q", entry.Content)
	}

	notebook, err = store.SetPassword(ctx, fixture.account.ID, notebook.ID, PasswordInput{
		Action:  "remove",
		Current: newPassword,
	})
	if err != nil {
		t.Fatalf("remove password: %v", err)
	}
	if notebook.HasPassword {
		t.Fatal("notebook should not have password")
	}
	entry, err = store.GetEntry(ctx, fixture.account.ID, notebook.ID, date, nil)
	if err != nil {
		t.Fatalf("get entry after remove: %v", err)
	}
	if entry.Content != "今天没有告诉任何人。" {
		t.Fatalf("content after remove = %q", entry.Content)
	}
	if err := store.DeleteNotebook(ctx, fixture.account.ID, notebook.ID); err != nil {
		t.Fatalf("delete notebook: %v", err)
	}
}
