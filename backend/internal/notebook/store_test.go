package notebook

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"my-first-expo-app/backend/internal/user"
)

func testUser(t *testing.T, databasePath string, suffix string) *user.Store {
	t.Helper()
	users, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open users: %v", err)
	}
	if _, err := users.Create(context.Background(), "notebook-"+suffix+"@example.com", "hash", "笔记本用户", "", ""); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return users
}

func TestNotebookStoreCRUDAndSearch(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	users := testUser(t, databasePath, "one")
	t.Cleanup(func() { _ = users.Close() })
	account, err := users.GetByUsername(ctx, "notebook-one@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open notebook store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	books, err := store.ListBooks(ctx, account.ID)
	if err != nil {
		t.Fatalf("list default books: %v", err)
	}
	if len(books) != 3 || books[0].Name != DefaultBookWork || books[1].Name != DefaultBookLife || books[2].Name != DefaultBookIdeas {
		t.Fatalf("default books = %+v", books)
	}

	note, err := store.CreateNote(ctx, account.ID, NoteInput{
		BookID: books[0].ID,
		Title:  "会议里的三个想法",
		Body:   "先记录，再整理。",
		Checklist: []ChecklistItem{
			{Text: "整理会议结论", Done: true},
			{Text: "补充负责人"},
		},
		Tags:   []string{"工作", "#项目", "项目"},
		Pinned: true,
	})
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	if !note.Pinned || note.BookName != DefaultBookWork || len(note.Checklist) != 2 || len(note.Tags) != 2 {
		t.Fatalf("created note = %+v", note)
	}
	if note.Checklist[0].ID == "" || note.Checklist[1].ID == "" {
		t.Fatal("checklist item IDs were not generated")
	}

	other, err := store.CreateNote(ctx, account.ID, NoteInput{
		BookID: books[1].ID,
		Title:  "杭州两日散步路线",
		Body:   "西湖日落和南山路梧桐。",
		Tags:   []string{"旅行", "周末"},
	})
	if err != nil {
		t.Fatalf("create second note: %v", err)
	}

	result, err := store.ListNotes(ctx, account.ID, NoteFilter{Query: "西湖"})
	if err != nil {
		t.Fatalf("search notes: %v", err)
	}
	if len(result.Notes) != 1 || result.Notes[0].ID != other.ID {
		t.Fatalf("search result = %+v", result.Notes)
	}
	result, err = store.ListNotes(ctx, account.ID, NoteFilter{Tag: "项目"})
	if err != nil {
		t.Fatalf("tag filter: %v", err)
	}
	if len(result.Notes) != 1 || result.Notes[0].ID != note.ID {
		t.Fatalf("tag result = %+v", result.Notes)
	}
	result, err = store.ListNotes(ctx, account.ID, NoteFilter{})
	if err != nil {
		t.Fatalf("list notes: %v", err)
	}
	if len(result.Notes) != 2 || result.Notes[0].ID != note.ID {
		t.Fatalf("pinned note should sort first: %+v", result.Notes)
	}

	title := "会议里的三个想法（已整理）"
	favorite := true
	updated, err := store.UpdateNote(ctx, account.ID, note.ID, NotePatch{Title: &title, Favorite: &favorite})
	if err != nil {
		t.Fatalf("update note: %v", err)
	}
	if updated.Title != title || !updated.Favorite || !updated.Pinned {
		t.Fatalf("updated note = %+v", updated)
	}

	newBook, err := store.CreateBook(ctx, account.ID, BookInput{Name: "项目", Color: "#112233"})
	if err != nil {
		t.Fatalf("create book: %v", err)
	}
	if newBook.Name != "项目" || newBook.Color != "#112233" {
		t.Fatalf("book = %+v", newBook)
	}
	if err := store.DeleteBook(ctx, account.ID, newBook.ID); err != nil {
		t.Fatalf("delete empty book: %v", err)
	}
	if err := store.DeleteBook(ctx, account.ID, notesBookID(t, store, ctx, account.ID, note.ID)); !errors.Is(err, ErrBookNotEmpty) {
		t.Fatalf("delete non-empty book error = %v, want ErrBookNotEmpty", err)
	}

	if err := store.DeleteNote(ctx, account.ID, other.ID); err != nil {
		t.Fatalf("delete note: %v", err)
	}
	if _, err := store.GetNote(ctx, account.ID, other.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("deleted note read error = %v", err)
	}
}

func TestNotebookStoreRejectsInvalidContent(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	users := testUser(t, databasePath, "two")
	t.Cleanup(func() { _ = users.Close() })
	account, err := users.GetByUsername(ctx, "notebook-two@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open notebook store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.ListBooks(ctx, account.ID)
	if err != nil {
		t.Fatalf("list books: %v", err)
	}
	if _, err := store.CreateNote(ctx, account.ID, NoteInput{BookID: books[0].ID}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty note error = %v", err)
	}
	if _, err := store.CreateNote(ctx, account.ID, NoteInput{
		BookID: books[0].ID,
		Title:  "标签过多",
		Tags:   []string{"1", "2", "3", "4", "5", "6", "7", "8", "9"},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("too many tags error = %v", err)
	}
	if _, err := store.CreateNote(ctx, account.ID, NoteInput{BookID: books[0].ID, Title: "   "}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("blank note error = %v", err)
	}
}

func TestNotebookMediaUploadAndDelete(t *testing.T) {
	ctx := context.Background()
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	users := testUser(t, databasePath, "media")
	t.Cleanup(func() { _ = users.Close() })
	account, err := users.GetByUsername(ctx, "notebook-media@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open notebook store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.ListBooks(ctx, account.ID)
	if err != nil {
		t.Fatalf("list books: %v", err)
	}
	note, err := store.CreateNote(ctx, account.ID, NoteInput{BookID: books[0].ID, Title: "带图片的笔记"})
	if err != nil {
		t.Fatalf("create note: %v", err)
	}
	service := NewService(store, filepath.Join(tempDir, "notebook-media"), MaxAudioBytes)
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52}
	media, err := service.UploadMedia(ctx, account.ID, note.ID, MediaKindImage, "photo.png", bytes.NewReader(png), nil)
	if err != nil {
		t.Fatalf("upload media: %v", err)
	}
	if media.Kind != MediaKindImage || media.ContentType != "image/png" || media.ByteSize != int64(len(png)) {
		t.Fatalf("media = %+v", media)
	}
	loaded, path, err := service.GetMedia(ctx, account.ID, media.ID)
	if err != nil {
		t.Fatalf("get media: %v", err)
	}
	if loaded.ID != media.ID || path == "" {
		t.Fatalf("loaded media = %+v path=%q", loaded, path)
	}
	withMedia, err := store.GetNote(ctx, account.ID, note.ID)
	if err != nil {
		t.Fatalf("get note with media: %v", err)
	}
	if len(withMedia.Media) != 1 || withMedia.Media[0].ID != media.ID {
		t.Fatalf("note media = %+v", withMedia.Media)
	}
	if err := service.DeleteMedia(ctx, account.ID, media.ID, nil); err != nil {
		t.Fatalf("delete media: %v", err)
	}
	if _, _, err := service.GetMedia(ctx, account.ID, media.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted media read error = %v", err)
	}

	wav := []byte{'R', 'I', 'F', 'F', 0x24, 0x00, 0x00, 0x00, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' '}
	audio, err := service.UploadMedia(ctx, account.ID, note.ID, MediaKindAudio, "voice.wav", bytes.NewReader(wav), nil)
	if err != nil {
		t.Fatalf("upload wav media: %v", err)
	}
	if audio.Kind != MediaKindAudio || audio.ContentType != "audio/wave" {
		t.Fatalf("audio media = %+v", audio)
	}
}

func notesBookID(t *testing.T, store *Store, ctx context.Context, userID, noteID string) string {
	t.Helper()
	note, err := store.GetNote(ctx, userID, noteID)
	if err != nil {
		t.Fatalf("get note: %v", err)
	}
	return note.BookID
}

func TestEnsureDefaultBooksConcurrentRequestsDoNotDuplicate(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	users := testUser(t, databasePath, "concurrent")
	t.Cleanup(func() { _ = users.Close() })
	account, err := users.GetByUsername(ctx, "notebook-concurrent@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open notebook store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, err := store.ListBooks(ctx, account.ID)
		errs <- err
	}()
	go func() {
		defer wg.Done()
		_, err := store.ListNotes(ctx, account.ID, NoteFilter{})
		errs <- err
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("parallel default init: %v", err)
		}
	}
	books, err := store.ListBooks(ctx, account.ID)
	if err != nil {
		t.Fatalf("list books: %v", err)
	}
	if len(books) != 3 {
		t.Fatalf("books after concurrent init = %+v", books)
	}
}

func TestNotebookEncryptedNoteLifecycle(t *testing.T) {
	ctx := context.Background()
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	users := testUser(t, databasePath, "encrypted")
	t.Cleanup(func() { _ = users.Close() })
	account, err := users.GetByUsername(ctx, "notebook-encrypted@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open notebook store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.ListBooks(ctx, account.ID)
	if err != nil {
		t.Fatalf("list books: %v", err)
	}
	note, err := store.CreateNote(ctx, account.ID, NoteInput{
		BookID: books[0].ID,
		Title:  "写给未来的自己",
		Body:   "这是只应该被自己看到的私密内容。",
		Checklist: []ChecklistItem{
			{Text: "记住这个秘密", Done: true},
		},
		Tags: []string{"私密", "计划"},
	})
	if err != nil {
		t.Fatalf("create plain note: %v", err)
	}
	service := NewService(store, filepath.Join(tempDir, "notebook-media"), MaxAudioBytes)
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52}
	media, err := service.UploadMedia(ctx, account.ID, note.ID, MediaKindImage, "secret.png", bytes.NewReader(png), nil)
	if err != nil {
		t.Fatalf("upload plain media: %v", err)
	}
	_, mediaPath, err := service.GetMedia(ctx, account.ID, media.ID)
	if err != nil {
		t.Fatalf("get plain media path: %v", err)
	}

	status, err := store.SetPassword(ctx, account.ID, PasswordInput{Action: "set", New: "secret-123"})
	if err != nil {
		t.Fatalf("set password: %v", err)
	}
	if !status.HasPassword || status.EncryptedNoteCount != 0 {
		t.Fatalf("security after set = %+v", status)
	}
	if _, _, err := store.Unlock(ctx, account.ID, "wrong-password"); !errors.Is(err, ErrPasswordMismatch) {
		t.Fatalf("wrong unlock error = %v", err)
	}
	token, _, err := store.Unlock(ctx, account.ID, "secret-123")
	if err != nil {
		t.Fatalf("unlock: %v", err)
	}
	dataKey, err := store.GetDataKey(account.ID, token)
	if err != nil {
		t.Fatalf("get data key: %v", err)
	}
	enabled := true
	updated, err := service.UpdateNote(ctx, account.ID, note.ID, NotePatch{Encrypted: &enabled}, dataKey)
	if err != nil {
		t.Fatalf("encrypt note: %v", err)
	}
	if !updated.Encrypted || updated.Locked || updated.Title != note.Title || len(updated.Media) != 1 || !updated.Media[0].Encrypted {
		t.Fatalf("encrypted note = %+v", updated)
	}

	locked, err := store.GetNote(ctx, account.ID, note.ID)
	if err != nil {
		t.Fatalf("get locked note: %v", err)
	}
	if !locked.Encrypted || !locked.Locked || locked.Title != "" || locked.Body != "" || len(locked.Checklist) != 0 || len(locked.Tags) != 0 || len(locked.Media) != 0 {
		t.Fatalf("locked note exposed content: %+v", locked)
	}
	list, err := store.ListNotes(ctx, account.ID, NoteFilter{})
	if err != nil {
		t.Fatalf("list locked notes: %v", err)
	}
	if len(list.Notes) != 1 || !list.Notes[0].Locked || list.Notes[0].Title != "" {
		t.Fatalf("locked list = %+v", list.Notes)
	}
	search, err := store.ListNotes(ctx, account.ID, NoteFilter{Query: "私密"})
	if err != nil {
		t.Fatalf("search encrypted notes: %v", err)
	}
	if len(search.Notes) != 0 {
		t.Fatalf("encrypted note appeared in keyword search: %+v", search.Notes)
	}

	var storedTitle, storedBody, storedChecklist, storedTags, encryptedPayload string
	if err := store.db.QueryRowContext(ctx, `
		SELECT title, body, checklist_json, tags_json, encrypted_payload
		FROM notebook_notes WHERE id = ?
	`, note.ID).Scan(&storedTitle, &storedBody, &storedChecklist, &storedTags, &encryptedPayload); err != nil {
		t.Fatalf("read encrypted row: %v", err)
	}
	if storedTitle != "" || storedBody != "" || storedChecklist != "[]" || storedTags != "[]" || encryptedPayload == "" {
		t.Fatalf("plaintext columns were not cleared: title=%q body=%q checklist=%q tags=%q", storedTitle, storedBody, storedChecklist, storedTags)
	}
	if strings.Contains(encryptedPayload, "私密内容") {
		t.Fatal("encrypted payload contains plaintext")
	}
	storedMedia, err := os.ReadFile(mediaPath)
	if err != nil {
		t.Fatalf("read encrypted media: %v", err)
	}
	if bytes.HasPrefix(storedMedia, png) || bytes.Equal(storedMedia, png) {
		t.Fatal("media file was not encrypted")
	}
	if _, _, err := service.ReadMedia(ctx, account.ID, media.ID, nil); !errors.Is(err, ErrLocked) {
		t.Fatalf("unlocked media read error = %v", err)
	}
	readMedia, contents, err := service.ReadMedia(ctx, account.ID, media.ID, dataKey)
	if err != nil {
		t.Fatalf("decrypt media: %v", err)
	}
	if !readMedia.Encrypted || !bytes.Equal(contents, png) {
		t.Fatalf("decrypted media mismatch: %+v", readMedia)
	}

	newTitle := "写给未来的自己（更新）"
	updated, err = service.UpdateNote(ctx, account.ID, note.ID, NotePatch{Title: &newTitle}, dataKey)
	if err != nil {
		t.Fatalf("update encrypted note: %v", err)
	}
	if updated.Title != newTitle || !updated.Encrypted {
		t.Fatalf("updated encrypted note = %+v", updated)
	}
	unlocked, err := store.GetNoteWithDataKey(ctx, account.ID, note.ID, dataKey)
	if err != nil {
		t.Fatalf("unlock note read: %v", err)
	}
	if unlocked.Title != newTitle || unlocked.Body != note.Body || len(unlocked.Media) != 1 {
		t.Fatalf("unlocked note = %+v", unlocked)
	}

	if _, err := store.SetPassword(ctx, account.ID, PasswordInput{Action: "change", Current: "secret-123", New: "next-secret-456"}); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := store.GetDataKey(account.ID, token); !errors.Is(err, ErrLocked) {
		t.Fatalf("old session still valid: %v", err)
	}
	if _, _, err := store.Unlock(ctx, account.ID, "secret-123"); !errors.Is(err, ErrPasswordMismatch) {
		t.Fatalf("old password still valid: %v", err)
	}
	newToken, _, err := store.Unlock(ctx, account.ID, "next-secret-456")
	if err != nil {
		t.Fatalf("unlock with new password: %v", err)
	}
	newDataKey, err := store.GetDataKey(account.ID, newToken)
	if err != nil {
		t.Fatalf("get new data key: %v", err)
	}

	disabled := false
	plain, err := service.UpdateNote(ctx, account.ID, note.ID, NotePatch{Encrypted: &disabled}, newDataKey)
	if err != nil {
		t.Fatalf("decrypt note: %v", err)
	}
	if plain.Encrypted || plain.Title != newTitle || plain.Body != note.Body || len(plain.Media) != 1 || plain.Media[0].Encrypted {
		t.Fatalf("decrypted note = %+v", plain)
	}
	plainMedia, err := os.ReadFile(mediaPath)
	if err != nil {
		t.Fatalf("read decrypted media: %v", err)
	}
	if !bytes.Equal(plainMedia, png) {
		t.Fatal("media was not decrypted")
	}
	search, err = store.ListNotes(ctx, account.ID, NoteFilter{Query: "未来"})
	if err != nil {
		t.Fatalf("search decrypted note: %v", err)
	}
	if len(search.Notes) != 1 || search.Notes[0].Title != newTitle {
		t.Fatalf("decrypted search = %+v", search.Notes)
	}

	enabled = true
	if _, err := service.UpdateNote(ctx, account.ID, note.ID, NotePatch{Encrypted: &enabled}, newDataKey); err != nil {
		t.Fatalf("re-encrypt note: %v", err)
	}
	if err := service.ResetEncryption(ctx, account.ID, "DELETE"); err != nil {
		t.Fatalf("reset encryption: %v", err)
	}
	if _, err := store.GetNote(ctx, account.ID, note.ID); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("encrypted note survived reset: %v", err)
	}
	if _, err := os.Stat(mediaPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("encrypted media survived reset: %v", err)
	}
}

func TestNotebookMigrationAddsEncryptionColumnsToExistingDatabase(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	users := testUser(t, databasePath, "migration")
	t.Cleanup(func() { _ = users.Close() })
	account, err := users.GetByUsername(ctx, "notebook-migration@example.com")
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	legacyStatements := []string{
		`CREATE TABLE notebook_books (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			color TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE notebook_notes (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			book_id TEXT NOT NULL REFERENCES notebook_books(id) ON DELETE CASCADE,
			title TEXT NOT NULL DEFAULT '',
			body TEXT NOT NULL DEFAULT '',
			checklist_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			pinned INTEGER NOT NULL DEFAULT 0,
			favorite INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE notebook_media (
			id TEXT PRIMARY KEY,
			note_id TEXT NOT NULL REFERENCES notebook_notes(id) ON DELETE CASCADE,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK(kind IN ('image', 'audio')),
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			byte_size INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range legacyStatements {
		if _, err := db.Exec(statement); err != nil {
			_ = db.Close()
			t.Fatalf("create legacy notebook schema: %v", err)
		}
	}
	if _, err := db.Exec(`INSERT INTO notebook_books (id, owner_id, name, color, sort_order, created_at, updated_at) VALUES ('b1', ?, '旧笔记本', '#2d5bff', 10, 1, 1)`, account.ID); err != nil {
		_ = db.Close()
		t.Fatalf("insert legacy book: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO notebook_notes (id, owner_id, book_id, title, body, pinned, favorite, status, created_at, updated_at) VALUES ('n1', ?, 'b1', '旧笔记', '迁移前的正文', 0, 0, 'active', 1, 1)`, account.ID); err != nil {
		_ = db.Close()
		t.Fatalf("insert legacy note: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open migrated notebook store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	note, err := store.GetNote(ctx, account.ID, "n1")
	if err != nil {
		t.Fatalf("get migrated note: %v", err)
	}
	if note.Title != "旧笔记" || note.Body != "迁移前的正文" || note.Encrypted || note.Locked {
		t.Fatalf("migrated note = %+v", note)
	}
	for table, columns := range map[string][]string{
		"notebook_notes": {"encrypted", "encrypted_payload", "note_key_enc", "encryption_version"},
		"notebook_media": {"encrypted"},
	} {
		rows, err := store.db.Query(`PRAGMA table_info(` + table + `)`)
		if err != nil {
			t.Fatalf("inspect migrated %s: %v", table, err)
		}
		found := map[string]bool{}
		for rows.Next() {
			var cid, notNull, pk int
			var name, dataType string
			var defaultValue any
			if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
				rows.Close()
				t.Fatalf("scan migrated %s: %v", table, err)
			}
			found[name] = true
		}
		rows.Close()
		for _, column := range columns {
			if !found[column] {
				t.Fatalf("migration did not add %s.%s", table, column)
			}
		}
	}
}
