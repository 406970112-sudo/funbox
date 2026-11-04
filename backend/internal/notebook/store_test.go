package notebook

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
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
	media, err := service.UploadMedia(ctx, account.ID, note.ID, MediaKindImage, "photo.png", bytes.NewReader(png))
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
	if err := service.DeleteMedia(ctx, account.ID, media.ID); err != nil {
		t.Fatalf("delete media: %v", err)
	}
	if _, _, err := service.GetMedia(ctx, account.ID, media.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted media read error = %v", err)
	}

	wav := []byte{'R', 'I', 'F', 'F', 0x24, 0x00, 0x00, 0x00, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' '}
	audio, err := service.UploadMedia(ctx, account.ID, note.ID, MediaKindAudio, "voice.wav", bytes.NewReader(wav))
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
