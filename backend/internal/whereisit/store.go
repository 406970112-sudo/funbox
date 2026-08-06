package whereisit

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

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound          = errors.New("where is it not found")
	ErrInvalidInput      = errors.New("where is it invalid input")
	ErrDatabasePathEmpty = errors.New("where is it database path is empty")
	ErrRoomNotEmpty      = errors.New("where is it room not empty")
)

const (
	MaxNameLength       = 60
	MaxLocationLength   = 80
	MaxNearbyLength     = 40
	MaxNoteLength       = 500
	MaxTagLength        = 12
	MaxTags             = 8
	MaxRooms            = 20
	MaxPhotos           = 6
	MaxSearchHistory    = 10
	MaxListItems        = 200
	UnconfirmedDaysMark = 180
)

var supportedCategories = map[string]bool{
	"":     true,
	"钥匙":   true,
	"证件票据": true,
	"工具":   true,
	"数码":   true,
	"药品":   true,
	"衣物":   true,
	"其他":   true,
}

type Room struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	Name      string    `json:"name"`
	Icon      string    `json:"icon"`
	Color     string    `json:"color"`
	SortOrder int       `json:"sortOrder"`
	IsSystem  bool      `json:"isSystem"`
	ItemCount int       `json:"itemCount"`
	Archived  bool      `json:"archived"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Item struct {
	ID              string     `json:"id"`
	UserID          string     `json:"userId"`
	RoomID          string     `json:"roomId"`
	RoomName        string     `json:"roomName"`
	RoomIcon        string     `json:"roomIcon"`
	RoomColor       string     `json:"roomColor"`
	Name            string     `json:"name"`
	Category        string     `json:"category"`
	LocationDetail  string     `json:"locationDetail"`
	NearbyHint      string     `json:"nearbyHint"`
	Note            string     `json:"note"`
	Tags            []string   `json:"tags"`
	CoverPhotoID    string     `json:"coverPhotoId,omitempty"`
	CoverPhotoURL   string     `json:"coverPhotoUrl,omitempty"`
	PhotoCount      int        `json:"photoCount"`
	LastSeenAt      *time.Time `json:"lastSeenAt,omitempty"`
	UnconfirmedDays int        `json:"unconfirmedDays"`
	Archived        bool       `json:"archived"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type ItemDetail struct {
	Item
	Photos []Photo `json:"photos"`
}

type Photo struct {
	ID        string     `json:"id"`
	ItemID    string     `json:"itemId"`
	UserID    string     `json:"userId"`
	FileURL   string     `json:"fileUrl"`
	Kind      string     `json:"kind"`
	TakenAt   *time.Time `json:"takenAt,omitempty"`
	SortOrder int        `json:"sortOrder"`
	CreatedAt time.Time  `json:"createdAt"`
}

type MoveEvent struct {
	ID                 string    `json:"id"`
	ItemID             string    `json:"itemId"`
	UserID             string    `json:"userId"`
	Action             string    `json:"action"`
	FromRoomID         string    `json:"fromRoomId"`
	FromRoomName       string    `json:"fromRoomName"`
	FromLocationDetail string    `json:"fromLocationDetail"`
	ToRoomID           string    `json:"toRoomId"`
	ToRoomName         string    `json:"toRoomName"`
	ToLocationDetail   string    `json:"toLocationDetail"`
	Note               string    `json:"note"`
	PhotoID            string    `json:"photoId,omitempty"`
	MovedAt            time.Time `json:"movedAt"`
	CreatedAt          time.Time `json:"createdAt"`
}

type Summary struct {
	TotalItems       int    `json:"totalItems"`
	RoomCount        int    `json:"roomCount"`
	UnconfirmedCount int    `json:"unconfirmedCount"`
	RecentAdded      []Item `json:"recentAdded"`
	RecentMoved      []Item `json:"recentMoved"`
	Rooms            []Room `json:"rooms"`
}

type ItemFilter struct {
	RoomID   string
	Category string
	Query    string
	Status   string
	Sort     string
	Limit    int
}

type ItemInput struct {
	RoomID         string   `json:"roomId"`
	Name           string   `json:"name"`
	Category       string   `json:"category"`
	LocationDetail string   `json:"locationDetail"`
	NearbyHint     string   `json:"nearbyHint"`
	Note           string   `json:"note"`
	Tags           []string `json:"tags"`
	CoverPhotoID   *string  `json:"coverPhotoId,omitempty"`
}

type RoomInput struct {
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
}

type MoveInput struct {
	RoomID         string `json:"roomId"`
	LocationDetail string `json:"locationDetail"`
	Note           string `json:"note"`
	PhotoID        string `json:"photoId,omitempty"`
}

type ExportSnapshot struct {
	ExportedAt time.Time   `json:"exportedAt"`
	Rooms      []Room      `json:"rooms"`
	Items      []Item      `json:"items"`
	Photos     []Photo     `json:"photos"`
	Events     []MoveEvent `json:"events"`
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create where is it database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open where is it database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS where_rooms (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			icon TEXT NOT NULL DEFAULT 'home',
			color TEXT NOT NULL DEFAULT '#4b6bff',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_system INTEGER NOT NULL DEFAULT 0,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_where_rooms_user ON where_rooms(user_id, sort_order, id)`,
		`CREATE TABLE IF NOT EXISTS where_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			room_id TEXT NOT NULL REFERENCES where_rooms(id),
			name TEXT NOT NULL,
			category TEXT NOT NULL DEFAULT '',
			location_detail TEXT NOT NULL,
			nearby_hint TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			tags_json TEXT NOT NULL DEFAULT '[]',
			cover_photo_id TEXT,
			last_seen_at INTEGER,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_where_items_user_updated ON where_items(user_id, archived_at, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_where_items_room ON where_items(room_id, archived_at)`,
		`CREATE TABLE IF NOT EXISTS where_item_photos (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES where_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			file_url TEXT NOT NULL,
			kind TEXT NOT NULL DEFAULT 'photo',
			taken_at INTEGER,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_where_photos_item ON where_item_photos(item_id, sort_order, created_at)`,
		`CREATE TABLE IF NOT EXISTS where_move_events (
			id TEXT PRIMARY KEY,
			item_id TEXT NOT NULL REFERENCES where_items(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL DEFAULT 'move',
			from_room_id TEXT,
			from_room_name TEXT NOT NULL DEFAULT '',
			from_location_detail TEXT NOT NULL DEFAULT '',
			to_room_id TEXT,
			to_room_name TEXT NOT NULL DEFAULT '',
			to_location_detail TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			photo_id TEXT,
			moved_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_where_events_item ON where_move_events(item_id, moved_at DESC)`,
		`CREATE TABLE IF NOT EXISTS where_search_history (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			query TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_where_search_history_user ON where_search_history(user_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate where is it: %w", err)
		}
	}
	return nil
}

func (s *Store) EnsureDefaultRooms(ctx context.Context, userID string) ([]Room, error) {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM where_rooms
		WHERE user_id = ? AND is_system = 1 AND id NOT IN (
			SELECT MIN(id) FROM where_rooms WHERE user_id = ? AND is_system = 1 GROUP BY name
		)
	`, userID, userID); err != nil {
		return nil, fmt.Errorf("dedupe where is it rooms: %w", err)
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM where_rooms WHERE user_id = ? AND is_system = 1`, userID).Scan(&count); err != nil {
		return nil, fmt.Errorf("count where is it rooms: %w", err)
	}
	if count == 0 {
		now := time.Now().UTC()
		templates := []Room{
			{Name: "玄关", Icon: "door-open", Color: "#4b6bff"},
			{Name: "客厅", Icon: "sofa", Color: "#ff6b8f"},
			{Name: "餐厅", Icon: "utensils", Color: "#f1a33b"},
			{Name: "厨房", Icon: "chef-hat", Color: "#20ad78"},
			{Name: "卧室", Icon: "bed", Color: "#8b5cf6"},
			{Name: "书房", Icon: "notebook-pen", Color: "#18a78f"},
			{Name: "卫生间", Icon: "bath", Color: "#38bdf8"},
			{Name: "阳台", Icon: "flower-2", Color: "#7cc48a"},
			{Name: "储物间/车库", Icon: "warehouse", Color: "#94a3b8"},
		}
		for i, room := range templates {
			room.ID = uuid.NewString()
			room.UserID = userID
			room.IsSystem = true
			room.SortOrder = i
			room.CreatedAt = now
			room.UpdatedAt = now
			if _, err := s.db.ExecContext(ctx, `
				INSERT OR IGNORE INTO where_rooms
					(id, user_id, name, icon, color, sort_order, is_system, archived_at, created_at, updated_at)
				SELECT ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?
				WHERE NOT EXISTS (SELECT 1 FROM where_rooms WHERE user_id = ? AND is_system = 1 AND name = ?)
			`, room.ID, room.UserID, room.Name, room.Icon, room.Color, room.SortOrder,
				room.CreatedAt.Unix(), room.UpdatedAt.Unix(), userID, room.Name); err != nil {
				return nil, err
			}
		}
	}
	return s.ListRooms(ctx, userID)
}

func (s *Store) ListRooms(ctx context.Context, userID string) ([]Room, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.user_id, r.name, r.icon, r.color, r.sort_order, r.is_system,
			r.archived_at, r.created_at, r.updated_at,
			(SELECT COUNT(*) FROM where_items i WHERE i.room_id = r.id AND i.archived_at IS NULL) AS item_count
		FROM where_rooms r
		WHERE r.user_id = ? AND r.archived_at IS NULL
		ORDER BY r.sort_order ASC, r.created_at ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list where is it rooms: %w", err)
	}
	defer rows.Close()
	rooms := []Room{}
	for rows.Next() {
		var room Room
		var archivedAt sql.NullInt64
		var isSystem int
		var createdAt, updatedAt int64
		if err := rows.Scan(&room.ID, &room.UserID, &room.Name, &room.Icon, &room.Color,
			&room.SortOrder, &isSystem, &archivedAt, &createdAt, &updatedAt, &room.ItemCount); err != nil {
			return nil, err
		}
		room.Archived = archivedAt.Valid
		room.IsSystem = isSystem == 1
		room.CreatedAt = time.Unix(createdAt, 0).UTC()
		room.UpdatedAt = time.Unix(updatedAt, 0).UTC()
		rooms = append(rooms, room)
	}
	return rooms, rows.Err()
}

func (s *Store) getRoom(ctx context.Context, userID, roomID string) (Room, error) {
	var room Room
	var archivedAt sql.NullInt64
	var isSystem int
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT r.id, r.user_id, r.name, r.icon, r.color, r.sort_order, r.is_system,
			r.archived_at, r.created_at, r.updated_at,
			(SELECT COUNT(*) FROM where_items i WHERE i.room_id = r.id AND i.archived_at IS NULL) AS item_count
		FROM where_rooms r
		WHERE r.id = ? AND r.user_id = ? AND r.archived_at IS NULL
	`, roomID, userID).Scan(&room.ID, &room.UserID, &room.Name, &room.Icon, &room.Color,
		&room.SortOrder, &isSystem, &archivedAt, &createdAt, &updatedAt, &room.ItemCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Room{}, ErrNotFound
	}
	if err != nil {
		return Room{}, err
	}
	room.Archived = archivedAt.Valid
	room.IsSystem = isSystem == 1
	room.CreatedAt = time.Unix(createdAt, 0).UTC()
	room.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return room, nil
}

func (s *Store) CreateRoom(ctx context.Context, userID string, input RoomInput) (Room, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 40 {
		return Room{}, ErrInvalidInput
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM where_rooms WHERE user_id = ? AND archived_at IS NULL`, userID).Scan(&count); err != nil {
		return Room{}, err
	}
	if count >= MaxRooms {
		return Room{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	room := Room{
		ID: uuid.NewString(), UserID: userID, Name: name,
		Icon: strings.TrimSpace(input.Icon), Color: strings.TrimSpace(input.Color),
		SortOrder: input.SortOrder, CreatedAt: now, UpdatedAt: now,
	}
	if room.Icon == "" {
		room.Icon = "home"
	}
	if room.Color == "" {
		room.Color = "#4b6bff"
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO where_rooms (id, user_id, name, icon, color, sort_order, is_system, archived_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
	`, room.ID, room.UserID, room.Name, room.Icon, room.Color, room.SortOrder,
		room.CreatedAt.Unix(), room.UpdatedAt.Unix()); err != nil {
		return Room{}, err
	}
	return s.getRoom(ctx, userID, room.ID)
}

func (s *Store) UpdateRoom(ctx context.Context, userID, roomID string, input RoomInput) (Room, error) {
	if _, err := s.getRoom(ctx, userID, roomID); err != nil {
		return Room{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 40 {
		return Room{}, ErrInvalidInput
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE where_rooms SET name = ?, icon = ?, color = ?, sort_order = ?, updated_at = ?
		WHERE id = ? AND user_id = ? AND archived_at IS NULL
	`, name, strings.TrimSpace(input.Icon), strings.TrimSpace(input.Color), input.SortOrder,
		time.Now().UTC().Unix(), roomID, userID); err != nil {
		return Room{}, err
	}
	return s.getRoom(ctx, userID, roomID)
}

func (s *Store) DeleteRoom(ctx context.Context, userID, roomID string) error {
	room, err := s.getRoom(ctx, userID, roomID)
	if err != nil {
		return err
	}
	if room.IsSystem {
		return ErrInvalidInput
	}
	if room.ItemCount > 0 {
		return ErrRoomNotEmpty
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE where_rooms SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?
	`, time.Now().UTC().Unix(), time.Now().UTC().Unix(), roomID, userID)
	return err
}

func (s *Store) Summary(ctx context.Context, userID string) (Summary, error) {
	rooms, err := s.EnsureDefaultRooms(ctx, userID)
	if err != nil {
		return Summary{}, err
	}
	items, err := s.ListItems(ctx, userID, ItemFilter{Sort: "updated", Limit: MaxListItems})
	if err != nil {
		return Summary{}, err
	}
	unconfirmed := 0
	for _, item := range items {
		if item.UnconfirmedDays >= UnconfirmedDaysMark {
			unconfirmed++
		}
	}
	recentAdded, err := s.ListItems(ctx, userID, ItemFilter{Sort: "created", Limit: 5})
	if err != nil {
		return Summary{}, err
	}
	recentMoved, err := s.ListItems(ctx, userID, ItemFilter{Sort: "updated", Limit: 5})
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		TotalItems: len(items), RoomCount: len(rooms), UnconfirmedCount: unconfirmed,
		RecentAdded: recentAdded, RecentMoved: recentMoved, Rooms: rooms,
	}, nil
}

func (s *Store) ListItems(ctx context.Context, userID string, filter ItemFilter) ([]Item, error) {
	limit := filter.Limit
	if limit <= 0 || limit > MaxListItems {
		limit = MaxListItems
	}
	where := []string{"i.user_id = ?", "i.archived_at IS NULL"}
	args := []any{userID}
	if filter.RoomID != "" {
		where = append(where, "i.room_id = ?")
		args = append(args, filter.RoomID)
	}
	if filter.Category != "" {
		where = append(where, "i.category = ?")
		args = append(args, filter.Category)
	}
	if filter.Status == "confirmed" {
		where = append(where, "i.last_seen_at IS NOT NULL")
	}
	if filter.Status == "unconfirmed" {
		where = append(where, "i.last_seen_at IS NULL")
	}
	if q := strings.TrimSpace(filter.Query); q != "" {
		pattern := "%" + q + "%"
		where = append(where, `(i.name LIKE ? OR i.location_detail LIKE ? OR i.nearby_hint LIKE ?
			OR i.note LIKE ? OR i.tags_json LIKE ? OR i.category LIKE ? OR r.name LIKE ?)`)
		args = append(args, pattern, pattern, pattern, pattern, pattern, pattern, pattern)
	}
	order := "i.updated_at DESC"
	switch filter.Sort {
	case "created":
		order = "i.created_at DESC"
	case "confirmed":
		order = "CASE WHEN i.last_seen_at IS NULL THEN 1 ELSE 0 END, i.last_seen_at DESC"
	case "name":
		order = "i.name ASC"
	}
	query := `
		SELECT i.id, i.user_id, i.room_id, r.name, r.icon, r.color, i.name, i.category,
			i.location_detail, i.nearby_hint, i.note, i.tags_json, i.cover_photo_id,
			i.last_seen_at, i.created_at, i.updated_at,
			(SELECT COUNT(*) FROM where_item_photos p WHERE p.item_id = i.id) AS photo_count
		FROM where_items i
		JOIN where_rooms r ON r.id = i.room_id
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY ` + order + `
		LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetItem(ctx context.Context, userID, itemID string) (Item, error) {
	item, err := s.getItemRow(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	photos, err := s.ListPhotos(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if item.CoverPhotoID != "" {
		for _, photo := range photos {
			if photo.ID == item.CoverPhotoID {
				item.CoverPhotoURL = photo.FileURL
				break
			}
		}
	} else if len(photos) > 0 {
		item.CoverPhotoURL = photos[0].FileURL
	}
	return item, nil
}

func (s *Store) GetItemDetail(ctx context.Context, userID, itemID string) (ItemDetail, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return ItemDetail{}, err
	}
	photos, err := s.ListPhotos(ctx, userID, itemID)
	if err != nil {
		return ItemDetail{}, err
	}
	return ItemDetail{Item: item, Photos: photos}, nil
}

func (s *Store) CreateItem(ctx context.Context, userID string, input ItemInput) (Item, error) {
	if _, err := s.validateItemInput(ctx, userID, input); err != nil {
		return Item{}, err
	}
	now := time.Now().UTC()
	item := Item{
		ID: uuid.NewString(), UserID: userID, RoomID: input.RoomID,
		Name: strings.TrimSpace(input.Name), Category: strings.TrimSpace(input.Category),
		LocationDetail: strings.TrimSpace(input.LocationDetail),
		NearbyHint:     strings.TrimSpace(input.NearbyHint), Note: strings.TrimSpace(input.Note),
		Tags: normalizeTags(input.Tags), CreatedAt: now, UpdatedAt: now,
	}
	if item.Category == "" {
		item.Category = "其他"
	}
	tagsJSON, _ := json.Marshal(item.Tags)
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO where_items (id, user_id, room_id, name, category, location_detail, nearby_hint,
			note, tags_json, cover_photo_id, last_seen_at, archived_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
	`, item.ID, item.UserID, item.RoomID, item.Name, item.Category, item.LocationDetail,
		item.NearbyHint, item.Note, string(tagsJSON), item.CreatedAt.Unix(), item.UpdatedAt.Unix()); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, item.ID)
}

func (s *Store) UpdateItem(ctx context.Context, userID, itemID string, input ItemInput) (Item, error) {
	current, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if input.RoomID == "" {
		input.RoomID = current.RoomID
	}
	if strings.TrimSpace(input.Name) == "" {
		input.Name = current.Name
	}
	if strings.TrimSpace(input.LocationDetail) == "" {
		input.LocationDetail = current.LocationDetail
	}
	if _, err := s.validateItemInput(ctx, userID, input); err != nil {
		return Item{}, err
	}
	category := strings.TrimSpace(input.Category)
	if category == "" {
		category = current.Category
	}
	tagsJSON, _ := json.Marshal(normalizeTags(input.Tags))
	coverID := sql.NullString{}
	if input.CoverPhotoID != nil {
		coverID = sql.NullString{String: *input.CoverPhotoID, Valid: *input.CoverPhotoID != ""}
	} else if current.CoverPhotoID != "" {
		coverID = sql.NullString{String: current.CoverPhotoID, Valid: true}
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE where_items SET room_id = ?, name = ?, category = ?, location_detail = ?,
			nearby_hint = ?, note = ?, tags_json = ?, cover_photo_id = ?, updated_at = ?
		WHERE id = ? AND user_id = ? AND archived_at IS NULL
	`, input.RoomID, strings.TrimSpace(input.Name), category, strings.TrimSpace(input.LocationDetail),
		strings.TrimSpace(input.NearbyHint), strings.TrimSpace(input.Note), string(tagsJSON),
		coverID, time.Now().UTC().Unix(), itemID, userID)
	if err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) DeleteItem(ctx context.Context, userID, itemID string) error {
	if _, err := s.GetItem(ctx, userID, itemID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE where_items SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL
	`, time.Now().UTC().Unix(), time.Now().UTC().Unix(), itemID, userID)
	return err
}

func (s *Store) ListPhotos(ctx context.Context, userID, itemID string) ([]Photo, error) {
	if _, err := s.getItemRow(ctx, userID, itemID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, file_url, kind, taken_at, sort_order, created_at
		FROM where_item_photos WHERE item_id = ? AND user_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, itemID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	photos := []Photo{}
	for rows.Next() {
		var photo Photo
		var takenAt sql.NullInt64
		var createdAt int64
		if err := rows.Scan(&photo.ID, &photo.ItemID, &photo.UserID, &photo.FileURL,
			&photo.Kind, &takenAt, &photo.SortOrder, &createdAt); err != nil {
			return nil, err
		}
		if takenAt.Valid {
			value := time.Unix(takenAt.Int64, 0).UTC()
			photo.TakenAt = &value
		}
		photo.CreatedAt = time.Unix(createdAt, 0).UTC()
		photos = append(photos, photo)
	}
	return photos, rows.Err()
}

func (s *Store) AddPhoto(ctx context.Context, userID, itemID, fileURL, kind string, takenAt int64, cover bool) (Photo, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Photo{}, err
	}
	if item.PhotoCount >= MaxPhotos {
		return Photo{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	photo := Photo{ID: uuid.NewString(), ItemID: itemID, UserID: userID, FileURL: fileURL,
		Kind: kind, SortOrder: item.PhotoCount, CreatedAt: now}
	if takenAt > 0 {
		value := time.Unix(takenAt, 0).UTC()
		photo.TakenAt = &value
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Photo{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO where_item_photos (id, item_id, user_id, file_url, kind, taken_at, sort_order, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, photo.ID, photo.ItemID, photo.UserID, photo.FileURL, photo.Kind,
		nullableUnix(takenAt), photo.SortOrder, photo.CreatedAt.Unix()); err != nil {
		return Photo{}, err
	}
	if cover || item.CoverPhotoID == "" {
		if _, err := tx.ExecContext(ctx, `UPDATE where_items SET cover_photo_id = ? WHERE id = ? AND user_id = ?`,
			photo.ID, itemID, userID); err != nil {
			return Photo{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Photo{}, err
	}
	return photo, nil
}

func (s *Store) DeletePhoto(ctx context.Context, userID, itemID, photoID string) error {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return err
	}
	var existing Photo
	err = s.db.QueryRowContext(ctx, `SELECT id, item_id, user_id FROM where_item_photos WHERE id = ? AND user_id = ?`,
		photoID, userID).Scan(&existing.ID, &existing.ItemID, &existing.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if existing.ItemID != itemID {
		return ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM where_item_photos WHERE id = ? AND item_id = ? AND user_id = ?`,
		photoID, itemID, userID); err != nil {
		return err
	}
	if item.CoverPhotoID == photoID {
		var nextID string
		err = tx.QueryRowContext(ctx, `SELECT id FROM where_item_photos WHERE item_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1`, itemID).Scan(&nextID)
		cover := sql.NullString{}
		if err == nil {
			cover = sql.NullString{String: nextID, Valid: true}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE where_items SET cover_photo_id = ? WHERE id = ?`, cover, itemID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GetPhoto(ctx context.Context, userID, photoID string) (Photo, error) {
	var photo Photo
	var takenAt sql.NullInt64
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, item_id, user_id, file_url, kind, taken_at, sort_order, created_at
		FROM where_item_photos WHERE id = ? AND user_id = ?
	`, photoID, userID).Scan(&photo.ID, &photo.ItemID, &photo.UserID, &photo.FileURL,
		&photo.Kind, &takenAt, &photo.SortOrder, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, err
	}
	if takenAt.Valid {
		value := time.Unix(takenAt.Int64, 0).UTC()
		photo.TakenAt = &value
	}
	photo.CreatedAt = time.Unix(createdAt, 0).UTC()
	return photo, nil
}

func (s *Store) MoveItem(ctx context.Context, userID, itemID string, input MoveInput) (Item, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	roomID := strings.TrimSpace(input.RoomID)
	location := strings.TrimSpace(input.LocationDetail)
	if roomID == "" || location == "" || len([]rune(location)) > MaxLocationLength {
		return Item{}, ErrInvalidInput
	}
	toRoom, err := s.getRoom(ctx, userID, roomID)
	if err != nil {
		return Item{}, err
	}
	now := time.Now().UTC()
	photoID := strings.TrimSpace(input.PhotoID)
	if photoID != "" {
		photo, err := s.GetPhoto(ctx, userID, photoID)
		if err != nil {
			return Item{}, err
		}
		if photo.ItemID != itemID {
			return Item{}, ErrInvalidInput
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE where_items SET room_id = ?, location_detail = ?, updated_at = ? WHERE id = ? AND user_id = ? AND archived_at IS NULL
	`, roomID, location, now.Unix(), itemID, userID); err != nil {
		return Item{}, err
	}
	event := MoveEvent{
		ID: uuid.NewString(), ItemID: itemID, UserID: userID, Action: "move",
		FromRoomID: item.RoomID, FromRoomName: item.RoomName, FromLocationDetail: item.LocationDetail,
		ToRoomID: roomID, ToRoomName: toRoom.Name, ToLocationDetail: location,
		Note: strings.TrimSpace(input.Note), PhotoID: photoID, MovedAt: now, CreatedAt: now,
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO where_move_events (id, item_id, user_id, action, from_room_id, from_room_name,
			from_location_detail, to_room_id, to_room_name, to_location_detail, note, photo_id, moved_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.ItemID, event.UserID, event.Action, event.FromRoomID, event.FromRoomName,
		event.FromLocationDetail, event.ToRoomID, event.ToRoomName, event.ToLocationDetail,
		event.Note, nullableString(photoID), event.MovedAt.Unix(), event.CreatedAt.Unix()); err != nil {
		return Item{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) ConfirmItem(ctx context.Context, userID, itemID string) (Item, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE where_items SET last_seen_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		now.Unix(), now.Unix(), itemID, userID); err != nil {
		return Item{}, err
	}
	event := MoveEvent{
		ID: uuid.NewString(), ItemID: itemID, UserID: userID, Action: "confirm",
		FromRoomID: item.RoomID, FromRoomName: item.RoomName, FromLocationDetail: item.LocationDetail,
		ToRoomID: item.RoomID, ToRoomName: item.RoomName, ToLocationDetail: item.LocationDetail,
		MovedAt: now, CreatedAt: now,
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO where_move_events (id, item_id, user_id, action, from_room_id, from_room_name,
			from_location_detail, to_room_id, to_room_name, to_location_detail, note, photo_id, moved_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?)
	`, event.ID, event.ItemID, event.UserID, event.Action, event.FromRoomID, event.FromRoomName,
		event.FromLocationDetail, event.ToRoomID, event.ToRoomName, event.ToLocationDetail,
		event.MovedAt.Unix(), event.CreatedAt.Unix()); err != nil {
		return Item{}, err
	}
	if err := tx.Commit(); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) ListHistory(ctx context.Context, userID, itemID string) ([]MoveEvent, error) {
	if _, err := s.getItemRow(ctx, userID, itemID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, action, from_room_id, from_room_name, from_location_detail,
			to_room_id, to_room_name, to_location_detail, note, photo_id, moved_at, created_at
		FROM where_move_events WHERE item_id = ? AND user_id = ?
		ORDER BY moved_at DESC, rowid DESC
	`, itemID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []MoveEvent{}
	for rows.Next() {
		var event MoveEvent
		var photoID sql.NullString
		var movedAt, createdAt int64
		if err := rows.Scan(&event.ID, &event.ItemID, &event.UserID, &event.Action,
			&event.FromRoomID, &event.FromRoomName, &event.FromLocationDetail,
			&event.ToRoomID, &event.ToRoomName, &event.ToLocationDetail,
			&event.Note, &photoID, &movedAt, &createdAt); err != nil {
			return nil, err
		}
		event.PhotoID = photoID.String
		event.MovedAt = time.Unix(movedAt, 0).UTC()
		event.CreatedAt = time.Unix(createdAt, 0).UTC()
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) RecordSearch(ctx context.Context, userID, query string) error {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	now := time.Now().UTC().Unix()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO where_search_history (id, user_id, query, created_at) VALUES (?, ?, ?, ?)
	`, uuid.NewString(), userID, query, now); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM where_search_history WHERE user_id = ? AND id NOT IN (
			SELECT id FROM where_search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
		)
	`, userID, userID, MaxSearchHistory)
	return err
}

func (s *Store) ListSearchHistory(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT query FROM where_search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, userID, MaxSearchHistory)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	queries := []string{}
	for rows.Next() {
		var query string
		if err := rows.Scan(&query); err != nil {
			return nil, err
		}
		queries = append(queries, query)
	}
	return queries, rows.Err()
}

func (s *Store) ClearSearchHistory(ctx context.Context, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM where_search_history WHERE user_id = ?`, userID)
	return err
}

func (s *Store) Export(ctx context.Context, userID string) (ExportSnapshot, error) {
	rooms, err := s.ListRooms(ctx, userID)
	if err != nil {
		return ExportSnapshot{}, err
	}
	items, err := s.ListItems(ctx, userID, ItemFilter{Sort: "updated", Limit: MaxListItems})
	if err != nil {
		return ExportSnapshot{}, err
	}
	photos := []Photo{}
	events := []MoveEvent{}
	for _, item := range items {
		itemPhotos, err := s.ListPhotos(ctx, userID, item.ID)
		if err != nil {
			return ExportSnapshot{}, err
		}
		photos = append(photos, itemPhotos...)
		itemEvents, err := s.ListHistory(ctx, userID, item.ID)
		if err != nil {
			return ExportSnapshot{}, err
		}
		events = append(events, itemEvents...)
	}
	return ExportSnapshot{ExportedAt: time.Now().UTC(), Rooms: rooms, Items: items, Photos: photos, Events: events}, nil
}

func (s *Store) validateItemInput(ctx context.Context, userID string, input ItemInput) (Room, error) {
	name := strings.TrimSpace(input.Name)
	location := strings.TrimSpace(input.LocationDetail)
	category := strings.TrimSpace(input.Category)
	if name == "" || len([]rune(name)) > MaxNameLength {
		return Room{}, ErrInvalidInput
	}
	if location == "" || len([]rune(location)) > MaxLocationLength {
		return Room{}, ErrInvalidInput
	}
	if len([]rune(strings.TrimSpace(input.NearbyHint))) > MaxNearbyLength ||
		len([]rune(strings.TrimSpace(input.Note))) > MaxNoteLength ||
		len(normalizeTags(input.Tags)) > MaxTags {
		return Room{}, ErrInvalidInput
	}
	if !supportedCategories[category] {
		return Room{}, ErrInvalidInput
	}
	if input.RoomID == "" {
		return Room{}, ErrInvalidInput
	}
	return s.getRoom(ctx, userID, input.RoomID)
}

func (s *Store) getItemRow(ctx context.Context, userID, itemID string) (Item, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.id, i.user_id, i.room_id, r.name, r.icon, r.color, i.name, i.category,
			i.location_detail, i.nearby_hint, i.note, i.tags_json, i.cover_photo_id,
			i.last_seen_at, i.created_at, i.updated_at,
			(SELECT COUNT(*) FROM where_item_photos p WHERE p.item_id = i.id) AS photo_count
		FROM where_items i
		JOIN where_rooms r ON r.id = i.room_id
		WHERE i.id = ? AND i.user_id = ? AND i.archived_at IS NULL
		LIMIT 1
	`, itemID, userID)
	if err != nil {
		return Item{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Item{}, ErrNotFound
	}
	return scanItem(rows)
}

func scanItem(row interface{ Scan(dest ...any) error }) (Item, error) {
	var item Item
	var tagsJSON string
	var lastSeenAt sql.NullInt64
	var coverPhotoID sql.NullString
	var createdAt, updatedAt int64
	if err := row.Scan(&item.ID, &item.UserID, &item.RoomID, &item.RoomName,
		&item.RoomIcon, &item.RoomColor, &item.Name, &item.Category, &item.LocationDetail,
		&item.NearbyHint, &item.Note, &tagsJSON, &coverPhotoID,
		&lastSeenAt, &createdAt, &updatedAt, &item.PhotoCount); err != nil {
		return Item{}, err
	}
	item.CoverPhotoID = coverPhotoID.String
	if lastSeenAt.Valid {
		value := time.Unix(lastSeenAt.Int64, 0).UTC()
		item.LastSeenAt = &value
	}
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	item.UnconfirmedDays = unconfirmedDays(item.LastSeenAt)
	_ = json.Unmarshal([]byte(tagsJSON), &item.Tags)
	return item, nil
}

func normalizeTags(tags []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, raw := range tags {
		tag := strings.TrimSpace(raw)
		if tag == "" || len([]rune(tag)) > MaxTagLength || seen[tag] {
			continue
		}
		seen[tag] = true
		result = append(result, tag)
	}
	return result
}

func unconfirmedDays(lastSeenAt *time.Time) int {
	if lastSeenAt == nil {
		return 0
	}
	days := int(time.Since(*lastSeenAt).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}

func nullableUnix(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
