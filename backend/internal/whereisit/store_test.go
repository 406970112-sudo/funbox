package whereisit

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestStoreCreatesRealRoomsAndItems(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	ctx := context.Background()
	rooms, err := store.EnsureDefaultRooms(ctx, "user-1")
	if err != nil {
		t.Fatalf("ensure rooms: %v", err)
	}
	if len(rooms) != 9 {
		t.Fatalf("expected 9 rooms, got %d", len(rooms))
	}
	item, err := store.CreateItem(ctx, "user-1", ItemInput{
		RoomID: rooms[1].ID, Name: "备用钥匙", Category: "钥匙",
		LocationDetail: "电视柜第二层", NearbyHint: "中间门左侧",
		Note: "仅紧急时使用", Tags: []string{"备用", "钥匙", "备用"},
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	if len(item.Tags) != 2 || item.RoomName != "客厅" {
		t.Fatalf("unexpected item: %#v", item)
	}
	items, err := store.ListItems(ctx, "user-1", ItemFilter{Query: "电视柜"})
	if err != nil || len(items) != 1 {
		t.Fatalf("search failed: items=%#v err=%v", items, err)
	}
}

func TestStoreMoveConfirmPhotosAndHistory(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	ctx := context.Background()
	rooms, _ := store.EnsureDefaultRooms(ctx, "user-1")
	item, _ := store.CreateItem(ctx, "user-1", ItemInput{
		RoomID: rooms[1].ID, Name: "螺丝刀", Category: "工具", LocationDetail: "工具箱",
	})
	photo, err := store.AddPhoto(ctx, "user-1", item.ID, "/where-is-it-media/user-1/photos/1.jpg", "photo", time.Now().Unix(), true)
	if err != nil {
		t.Fatalf("add photo: %v", err)
	}
	detail, err := store.GetItemDetail(ctx, "user-1", item.ID)
	if err != nil || len(detail.Photos) != 1 || detail.CoverPhotoID != photo.ID {
		t.Fatalf("unexpected detail: %#v err=%v", detail, err)
	}
	if _, err := store.MoveItem(ctx, "user-1", item.ID, MoveInput{
		RoomID: rooms[7].ID, LocationDetail: "工具箱第二层", Note: "搬家后更新", PhotoID: photo.ID,
	}); err != nil {
		t.Fatalf("move: %v", err)
	}
	history, _ := store.ListHistory(ctx, "user-1", item.ID)
	if len(history) != 1 || history[0].Action != "move" || history[0].FromRoomName != "客厅" {
		t.Fatalf("unexpected history: %#v", history)
	}
	if _, err := store.ConfirmItem(ctx, "user-1", item.ID); err != nil {
		t.Fatalf("confirm: %v", err)
	}
	history, _ = store.ListHistory(ctx, "user-1", item.ID)
	if len(history) != 2 || history[0].Action != "confirm" {
		t.Fatalf("unexpected confirm history: %#v", history)
	}
}

func TestStoreDeleteAndRoomGuard(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	ctx := context.Background()
	if _, err := store.EnsureDefaultRooms(ctx, "user-1"); err != nil {
		t.Fatalf("ensure rooms: %v", err)
	}
	custom, _ := store.CreateRoom(ctx, "user-1", RoomInput{Name: "储物间", Icon: "warehouse", Color: "#94a3b8"})
	item, _ := store.CreateItem(ctx, "user-1", ItemInput{
		RoomID: custom.ID, Name: "旧手机", Category: "数码", LocationDetail: "衣柜顶部",
	})
	if err := store.DeleteRoom(ctx, "user-1", custom.ID); !errors.Is(err, ErrRoomNotEmpty) {
		t.Fatalf("expected room not empty, got %v", err)
	}
	if err := store.DeleteItem(ctx, "user-1", item.ID); err != nil {
		t.Fatalf("delete item: %v", err)
	}
	if err := store.DeleteRoom(ctx, "user-1", custom.ID); err != nil {
		t.Fatalf("delete room: %v", err)
	}
}

func TestSearchHistoryKeepsRealQueries(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()
	ctx := context.Background()
	for i := 0; i < MaxSearchHistory+2; i++ {
		if err := store.RecordSearch(ctx, "user-1", "查询-"+string(rune('A'+i))); err != nil {
			t.Fatalf("record search: %v", err)
		}
	}
	queries, err := store.ListSearchHistory(ctx, "user-1")
	if err != nil || len(queries) != MaxSearchHistory {
		t.Fatalf("unexpected history: %#v err=%v", queries, err)
	}
	if err := store.ClearSearchHistory(ctx, "user-1"); err != nil {
		t.Fatalf("clear: %v", err)
	}
}

func createUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE)`); err != nil {
		t.Fatalf("create users: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'where-user')`); err != nil {
		t.Fatalf("insert users: %v", err)
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "app.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open raw db: %v", err)
	}
	createUsersTable(t, db)
	_ = db.Close()
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return store
}
