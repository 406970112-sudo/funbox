package shoppingroute

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
	ErrInvalidInput      = errors.New("shopping route invalid input")
	ErrNotFound          = errors.New("shopping route not found")
	ErrDatabasePathEmpty = errors.New("shopping route database path is empty")
)

type DB struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*DB, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create shopping route database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open shopping route database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &DB{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *DB) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *DB) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS shopping_lists (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_shopping_lists_user
			ON shopping_lists(user_id, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS shopping_items (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			quantity TEXT NOT NULL DEFAULT '',
			unit TEXT NOT NULL DEFAULT '',
			barcode TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT 'user',
			product_meta_json TEXT NOT NULL DEFAULT '{}',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_shopping_items_list
			ON shopping_items(list_id, created_at ASC)`,
		`CREATE TABLE IF NOT EXISTS shopping_stores (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			address TEXT NOT NULL DEFAULT '',
			lat TEXT NOT NULL DEFAULT '',
			lon TEXT NOT NULL DEFAULT '',
			note TEXT NOT NULL DEFAULT '',
			entry_zone_id TEXT NOT NULL DEFAULT '',
			checkout_zone_id TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_shopping_stores_user
			ON shopping_stores(user_id, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS shopping_zones (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			store_id TEXT NOT NULL REFERENCES shopping_stores(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			zone_type TEXT NOT NULL DEFAULT '',
			position INTEGER NOT NULL,
			source TEXT NOT NULL DEFAULT 'user',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_shopping_zones_store
			ON shopping_zones(store_id, position ASC)`,
		`CREATE TABLE IF NOT EXISTS shopping_mappings (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			item_key TEXT NOT NULL,
			zone_type TEXT NOT NULL DEFAULT '',
			store_id TEXT NOT NULL DEFAULT '',
			zone_id TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT 'user',
			source_ref TEXT NOT NULL DEFAULT '',
			confirmed_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(user_id, item_key, store_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_shopping_mappings_user_item
			ON shopping_mappings(user_id, item_key, store_id)`,
		`CREATE TABLE IF NOT EXISTS shopping_routes (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
			store_id TEXT NOT NULL REFERENCES shopping_stores(id) ON DELETE CASCADE,
			zone_order_json TEXT NOT NULL,
			item_snapshot_json TEXT NOT NULL,
			completeness REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active',
			created_at INTEGER NOT NULL,
			completed_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_shopping_routes_user
			ON shopping_routes(user_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate shopping route: %w", err)
		}
	}
	return nil
}

func (s *DB) CreateList(ctx context.Context, userID, name string) (List, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > MaxListNameLength {
		return List{}, fmt.Errorf("%w: invalid list name", ErrInvalidInput)
	}
	list := List{
		ID:        uuid.NewString(),
		UserID:    userID,
		Name:      name,
		Items:     []Item{},
		CreatedAt: nowMillis(),
		UpdatedAt: nowMillis(),
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shopping_lists (id, user_id, name, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`, list.ID, list.UserID, list.Name, list.CreatedAt, list.UpdatedAt)
	if err != nil {
		return List{}, fmt.Errorf("create shopping list: %w", err)
	}
	return list, nil
}

func (s *DB) ListLists(ctx context.Context, userID string) ([]List, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, name, created_at, updated_at
		FROM shopping_lists
		WHERE user_id = ?
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list shopping lists: %w", err)
	}
	defer rows.Close()
	lists := []List{}
	for rows.Next() {
		list, err := scanList(rows)
		if err != nil {
			return nil, err
		}
		lists = append(lists, list)
	}
	return lists, rows.Err()
}

func (s *DB) GetList(ctx context.Context, userID, listID string) (List, error) {
	list, err := s.getListRow(ctx, userID, listID)
	if err != nil {
		return List{}, err
	}
	items, err := s.ListItems(ctx, userID, listID)
	if err != nil {
		return List{}, err
	}
	list.Items = items
	return list, nil
}

func (s *DB) getListRow(ctx context.Context, userID, listID string) (List, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, created_at, updated_at
		FROM shopping_lists WHERE id = ? AND user_id = ?
	`, listID, userID)
	list, err := scanList(row)
	if errors.Is(err, sql.ErrNoRows) {
		return List{}, fmt.Errorf("%w: list", ErrNotFound)
	}
	if err != nil {
		return List{}, err
	}
	return list, nil
}

func (s *DB) DeleteList(ctx context.Context, userID, listID string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM shopping_lists WHERE id = ? AND user_id = ?
	`, listID, userID)
	if err != nil {
		return fmt.Errorf("delete shopping list: %w", err)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return fmt.Errorf("%w: list", ErrNotFound)
	}
	return nil
}

func (s *DB) AddItem(ctx context.Context, userID string, item Item) (Item, error) {
	item.ID = uuid.NewString()
	item.UserID = userID
	item.NormalizedName = normalizeName(item.Name)
	if err := validateItem(item); err != nil {
		return Item{}, err
	}
	if _, err := s.getListRow(ctx, userID, item.ListID); err != nil {
		return Item{}, err
	}
	count := 0
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM shopping_items WHERE list_id = ? AND user_id = ?
	`, item.ListID, userID).Scan(&count); err != nil {
		return Item{}, fmt.Errorf("count shopping items: %w", err)
	}
	if count >= MaxItemsPerList {
		return Item{}, fmt.Errorf("%w: too many items", ErrInvalidInput)
	}
	item.CreatedAt = nowMillis()
	item.UpdatedAt = item.CreatedAt
	metaJSON := "{}"
	if item.ProductMeta != nil {
		encoded, err := json.Marshal(item.ProductMeta)
		if err != nil {
			return Item{}, fmt.Errorf("encode product meta: %w", err)
		}
		metaJSON = string(encoded)
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shopping_items (
			id, user_id, list_id, name, normalized_name, quantity, unit, barcode,
			note, source, product_meta_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.UserID, item.ListID, item.Name, item.NormalizedName, item.Quantity,
		item.Unit, item.Barcode, item.Note, item.Source, metaJSON, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return Item{}, fmt.Errorf("add shopping item: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE shopping_lists SET updated_at = ? WHERE id = ? AND user_id = ?
	`, item.CreatedAt, item.ListID, userID); err != nil {
		return Item{}, fmt.Errorf("touch shopping list: %w", err)
	}
	return item, nil
}

func (s *DB) ListItems(ctx context.Context, userID, listID string) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, list_id, name, normalized_name, quantity, unit, barcode,
			note, source, product_meta_json, created_at, updated_at
		FROM shopping_items
		WHERE user_id = ? AND list_id = ?
		ORDER BY created_at ASC, id ASC
	`, userID, listID)
	if err != nil {
		return nil, fmt.Errorf("list shopping items: %w", err)
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

func (s *DB) GetItem(ctx context.Context, userID, itemID string) (Item, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, list_id, name, normalized_name, quantity, unit, barcode,
			note, source, product_meta_json, created_at, updated_at
		FROM shopping_items
		WHERE user_id = ? AND id = ?
	`, userID, itemID)
	item, err := scanItem(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, fmt.Errorf("%w: item", ErrNotFound)
	}
	if err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *DB) UpdateItem(ctx context.Context, userID string, item Item) (Item, error) {
	item.UserID = userID
	item.NormalizedName = normalizeName(item.Name)
	if item.ID == "" {
		return Item{}, fmt.Errorf("%w: item id required", ErrInvalidInput)
	}
	if err := validateItem(item); err != nil {
		return Item{}, err
	}
	metaJSON := "{}"
	if item.ProductMeta != nil {
		encoded, err := json.Marshal(item.ProductMeta)
		if err != nil {
			return Item{}, fmt.Errorf("encode product meta: %w", err)
		}
		metaJSON = string(encoded)
	}
	item.UpdatedAt = nowMillis()
	result, err := s.db.ExecContext(ctx, `
		UPDATE shopping_items SET
			name = ?, normalized_name = ?, quantity = ?, unit = ?, barcode = ?,
			note = ?, source = ?, product_meta_json = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, item.Name, item.NormalizedName, item.Quantity, item.Unit, item.Barcode,
		item.Note, item.Source, metaJSON, item.UpdatedAt, item.ID, userID)
	if err != nil {
		return Item{}, fmt.Errorf("update shopping item: %w", err)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return Item{}, fmt.Errorf("%w: item", ErrNotFound)
	}
	_ = s.touchList(ctx, userID, item.ListID, item.UpdatedAt)
	return item, nil
}

func (s *DB) DeleteItem(ctx context.Context, userID, itemID string) error {
	var listID string
	err := s.db.QueryRowContext(ctx, `
		SELECT list_id FROM shopping_items WHERE id = ? AND user_id = ?
	`, itemID, userID).Scan(&listID)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: item", ErrNotFound)
	}
	if err != nil {
		return fmt.Errorf("find shopping item: %w", err)
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM shopping_items WHERE id = ? AND user_id = ?
	`, itemID, userID)
	if err != nil {
		return fmt.Errorf("delete shopping item: %w", err)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return fmt.Errorf("%w: item", ErrNotFound)
	}
	_ = s.touchList(ctx, userID, listID, nowMillis())
	return nil
}

func (s *DB) CreateStore(ctx context.Context, userID string, store StoreProfile) (StoreProfile, error) {
	store.ID = uuid.NewString()
	store.UserID = userID
	if err := validateStore(store); err != nil {
		return StoreProfile{}, err
	}
	store.CreatedAt = nowMillis()
	store.UpdatedAt = store.CreatedAt
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shopping_stores (
			id, user_id, name, address, lat, lon, note,
			entry_zone_id, checkout_zone_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, store.ID, store.UserID, store.Name, store.Address, store.Lat, store.Lon,
		store.Note, store.EntryZoneID, store.CheckoutZoneID, store.CreatedAt, store.UpdatedAt)
	if err != nil {
		return StoreProfile{}, fmt.Errorf("create shopping store: %w", err)
	}
	return store, nil
}

func (s *DB) ListStores(ctx context.Context, userID string) ([]StoreProfile, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, name, address, lat, lon, note,
			entry_zone_id, checkout_zone_id, created_at, updated_at
		FROM shopping_stores
		WHERE user_id = ?
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list shopping stores: %w", err)
	}
	defer rows.Close()
	stores := []StoreProfile{}
	for rows.Next() {
		store, err := scanStore(rows)
		if err != nil {
			return nil, err
		}
		stores = append(stores, store)
	}
	for index := range stores {
		zones, err := s.ListZones(ctx, userID, stores[index].ID)
		if err != nil {
			return nil, err
		}
		stores[index].Zones = zones
	}
	return stores, rows.Err()
}

func (s *DB) GetStore(ctx context.Context, userID, storeID string) (StoreProfile, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, address, lat, lon, note,
			entry_zone_id, checkout_zone_id, created_at, updated_at
		FROM shopping_stores WHERE id = ? AND user_id = ?
	`, storeID, userID)
	store, err := scanStore(row)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreProfile{}, fmt.Errorf("%w: store", ErrNotFound)
	}
	if err != nil {
		return StoreProfile{}, err
	}
	zones, err := s.ListZones(ctx, userID, storeID)
	if err != nil {
		return StoreProfile{}, err
	}
	store.Zones = zones
	return store, nil
}

func (s *DB) UpdateStore(ctx context.Context, userID string, store StoreProfile) (StoreProfile, error) {
	store.UserID = userID
	if store.ID == "" {
		return StoreProfile{}, fmt.Errorf("%w: store id required", ErrInvalidInput)
	}
	if err := validateStore(store); err != nil {
		return StoreProfile{}, err
	}
	store.UpdatedAt = nowMillis()
	result, err := s.db.ExecContext(ctx, `
		UPDATE shopping_stores SET
			name = ?, address = ?, lat = ?, lon = ?, note = ?,
			entry_zone_id = ?, checkout_zone_id = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, store.Name, store.Address, store.Lat, store.Lon, store.Note,
		store.EntryZoneID, store.CheckoutZoneID, store.UpdatedAt, store.ID, userID)
	if err != nil {
		return StoreProfile{}, fmt.Errorf("update shopping store: %w", err)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return StoreProfile{}, fmt.Errorf("%w: store", ErrNotFound)
	}
	return store, nil
}

func (s *DB) DeleteStore(ctx context.Context, userID, storeID string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM shopping_stores WHERE id = ? AND user_id = ?
	`, storeID, userID)
	if err != nil {
		return fmt.Errorf("delete shopping store: %w", err)
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return fmt.Errorf("%w: store", ErrNotFound)
	}
	return nil
}

func (s *DB) SetZones(ctx context.Context, userID, storeID string, zones []ZoneInput) ([]Zone, error) {
	if _, err := s.GetStore(ctx, userID, storeID); err != nil {
		return nil, err
	}
	if len(zones) == 0 || len(zones) > MaxZonesPerStore {
		return nil, fmt.Errorf("%w: invalid zone count", ErrInvalidInput)
	}
	seen := map[string]bool{}
	saved := make([]Zone, 0, len(zones))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin zones transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM shopping_zones WHERE store_id = ? AND user_id = ?
	`, storeID, userID); err != nil {
		return nil, fmt.Errorf("clear shopping zones: %w", err)
	}
	now := nowMillis()
	for index, input := range zones {
		name := strings.TrimSpace(input.Name)
		zoneType := strings.TrimSpace(input.ZoneType)
		if name == "" || len([]rune(name)) > MaxZoneNameLength {
			return nil, fmt.Errorf("%w: invalid zone name", ErrInvalidInput)
		}
		if !validZoneType(zoneType) {
			return nil, fmt.Errorf("%w: invalid zone type", ErrInvalidInput)
		}
		if seen[name] {
			return nil, fmt.Errorf("%w: duplicate zone name", ErrInvalidInput)
		}
		seen[name] = true
		zone := Zone{
			ID:        uuid.NewString(),
			StoreID:   storeID,
			Name:      name,
			ZoneType:  zoneType,
			Position:  index + 1,
			Source:    SourceUser,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO shopping_zones (id, user_id, store_id, name, zone_type, position, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, zone.ID, userID, storeID, zone.Name, zone.ZoneType, zone.Position, zone.Source, zone.CreatedAt, zone.UpdatedAt); err != nil {
			return nil, fmt.Errorf("insert shopping zone: %w", err)
		}
		saved = append(saved, zone)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE shopping_stores SET updated_at = ? WHERE id = ? AND user_id = ?
	`, now, storeID, userID); err != nil {
		return nil, fmt.Errorf("touch shopping store: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit shopping zones: %w", err)
	}
	return saved, nil
}

func (s *DB) ListZones(ctx context.Context, userID, storeID string) ([]Zone, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, store_id, name, zone_type, position, source, created_at, updated_at
		FROM shopping_zones
		WHERE user_id = ? AND store_id = ?
		ORDER BY position ASC, id ASC
	`, userID, storeID)
	if err != nil {
		return nil, fmt.Errorf("list shopping zones: %w", err)
	}
	defer rows.Close()
	zones := []Zone{}
	for rows.Next() {
		zone, err := scanZone(rows)
		if err != nil {
			return nil, err
		}
		zones = append(zones, zone)
	}
	return zones, rows.Err()
}

func (s *DB) SaveMapping(ctx context.Context, userID string, mapping Mapping) (Mapping, error) {
	mapping.ItemKey = normalizeName(mapping.ItemKey)
	if mapping.ItemKey == "" || mapping.ZoneType == "" {
		return Mapping{}, fmt.Errorf("%w: mapping requires item and zone type", ErrInvalidInput)
	}
	if !validZoneType(mapping.ZoneType) {
		return Mapping{}, fmt.Errorf("%w: invalid zone type", ErrInvalidInput)
	}
	if mapping.Source == "" {
		mapping.Source = SourceUser
	}
	now := nowMillis()
	mapping.ID = uuid.NewString()
	mapping.UserID = userID
	mapping.ConfirmedAt = now
	mapping.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shopping_mappings (
			id, user_id, item_key, zone_type, store_id, zone_id,
			source, source_ref, confirmed_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, item_key, store_id) DO UPDATE SET
			zone_type = excluded.zone_type,
			zone_id = excluded.zone_id,
			source = excluded.source,
			source_ref = excluded.source_ref,
			confirmed_at = excluded.confirmed_at,
			updated_at = excluded.updated_at
	`, mapping.ID, mapping.UserID, mapping.ItemKey, mapping.ZoneType, mapping.StoreID,
		mapping.ZoneID, mapping.Source, mapping.SourceRef, mapping.ConfirmedAt, mapping.UpdatedAt)
	if err != nil {
		return Mapping{}, fmt.Errorf("save shopping mapping: %w", err)
	}
	return mapping, nil
}

func (s *DB) ListMappings(ctx context.Context, userID string) ([]Mapping, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, item_key, zone_type, store_id, zone_id,
			source, source_ref, confirmed_at, updated_at
		FROM shopping_mappings
		WHERE user_id = ?
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list shopping mappings: %w", err)
	}
	defer rows.Close()
	mappings := []Mapping{}
	for rows.Next() {
		mapping, err := scanMapping(rows)
		if err != nil {
			return nil, err
		}
		mappings = append(mappings, mapping)
	}
	return mappings, rows.Err()
}

func (s *DB) CreateRoute(ctx context.Context, userID, listID, storeID string) (Route, error) {
	list, err := s.GetList(ctx, userID, listID)
	if err != nil {
		return Route{}, err
	}
	if len(list.Items) == 0 {
		return Route{}, fmt.Errorf("%w: list is empty", ErrInvalidInput)
	}
	store, err := s.GetStore(ctx, userID, storeID)
	if err != nil {
		return Route{}, err
	}
	mappings, err := s.ListMappings(ctx, userID)
	if err != nil {
		return Route{}, err
	}
	route := BuildRoute(list, store, store.Zones, mappings)
	route.ID = uuid.NewString()
	route.UserID = userID
	route.CreatedAt = nowMillis()
	if err := s.saveRoute(ctx, route); err != nil {
		return Route{}, err
	}
	return route, nil
}

func (s *DB) GetRoute(ctx context.Context, userID, routeID string) (Route, error) {
	var snapshotJSON string
	var completeness float64
	var status string
	var completedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT item_snapshot_json, completeness, status, completed_at
		FROM shopping_routes WHERE id = ? AND user_id = ?
	`, routeID, userID).Scan(&snapshotJSON, &completeness, &status, &completedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Route{}, fmt.Errorf("%w: route", ErrNotFound)
	}
	if err != nil {
		return Route{}, fmt.Errorf("get shopping route: %w", err)
	}
	var route Route
	if err := json.Unmarshal([]byte(snapshotJSON), &route); err != nil {
		return Route{}, fmt.Errorf("decode shopping route: %w", err)
	}
	route.ID = routeID
	route.UserID = userID
	route.Status = status
	route.Completeness = completeness
	route.CompletedAt = completedAt
	return route, nil
}

func (s *DB) UpdateRouteItem(ctx context.Context, userID, routeID, itemID string, completed bool) (Route, error) {
	route, err := s.GetRoute(ctx, userID, routeID)
	if err != nil {
		return Route{}, err
	}
	updateRouteItem(&route, itemID, completed)
	if routeCompleted(route) {
		route.Status = RouteStatusComplete
		route.CompletedAt = nowMillis()
	}
	if err := s.saveRoute(ctx, route); err != nil {
		return Route{}, err
	}
	return route, nil
}

func (s *DB) CompleteRoute(ctx context.Context, userID, routeID string) (Route, error) {
	route, err := s.GetRoute(ctx, userID, routeID)
	if err != nil {
		return Route{}, err
	}
	for zoneIndex := range route.Zones {
		for itemIndex := range route.Zones[zoneIndex].Items {
			route.Zones[zoneIndex].Items[itemIndex].Completed = true
		}
		route.Zones[zoneIndex].Completed = route.Zones[zoneIndex].Total
	}
	for itemIndex := range route.Unmapped {
		route.Unmapped[itemIndex].Completed = true
	}
	route.Status = RouteStatusComplete
	route.CompletedAt = nowMillis()
	if err := s.saveRoute(ctx, route); err != nil {
		return Route{}, err
	}
	return route, nil
}

func (s *DB) ListHistory(ctx context.Context, userID string) ([]Route, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_snapshot_json, completeness, status, completed_at
		FROM shopping_routes
		WHERE user_id = ? AND completed_at > 0
		ORDER BY completed_at DESC
		LIMIT 100
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list shopping route history: %w", err)
	}
	defer rows.Close()
	routes := []Route{}
	for rows.Next() {
		var id, snapshotJSON, status string
		var completeness float64
		var completedAt int64
		if err := rows.Scan(&id, &snapshotJSON, &completeness, &status, &completedAt); err != nil {
			return nil, fmt.Errorf("scan shopping route history: %w", err)
		}
		var route Route
		if err := json.Unmarshal([]byte(snapshotJSON), &route); err != nil {
			return nil, fmt.Errorf("decode shopping route history: %w", err)
		}
		route.ID = id
		route.UserID = userID
		route.Status = status
		route.Completeness = completeness
		route.CompletedAt = completedAt
		routes = append(routes, route)
	}
	return routes, rows.Err()
}

func (s *DB) LatestActiveRoute(ctx context.Context, userID string) (Route, error) {
	var id string
	err := s.db.QueryRowContext(ctx, `
		SELECT id FROM shopping_routes
		WHERE user_id = ? AND status = 'active'
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return Route{}, fmt.Errorf("%w: route", ErrNotFound)
	}
	if err != nil {
		return Route{}, fmt.Errorf("latest active route: %w", err)
	}
	return s.GetRoute(ctx, userID, id)
}

func (s *DB) saveRoute(ctx context.Context, route Route) error {
	zoneOrderJSON, err := json.Marshal(route.Zones)
	if err != nil {
		return fmt.Errorf("encode route zones: %w", err)
	}
	snapshotJSON, err := json.Marshal(route)
	if err != nil {
		return fmt.Errorf("encode route snapshot: %w", err)
	}
	completedAt := route.CompletedAt
	status := route.Status
	if status == "" {
		status = RouteStatusActive
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO shopping_routes (
			id, user_id, list_id, store_id, zone_order_json, item_snapshot_json,
			completeness, status, created_at, completed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			zone_order_json = excluded.zone_order_json,
			item_snapshot_json = excluded.item_snapshot_json,
			completeness = excluded.completeness,
			status = excluded.status,
			completed_at = excluded.completed_at
	`, route.ID, route.UserID, route.ListID, route.StoreID, string(zoneOrderJSON),
		string(snapshotJSON), route.Completeness, status, route.CreatedAt, completedAt)
	if err != nil {
		return fmt.Errorf("save shopping route: %w", err)
	}
	return nil
}

func (s *DB) touchList(ctx context.Context, userID, listID string, updatedAt int64) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE shopping_lists SET updated_at = ? WHERE id = ? AND user_id = ?
	`, updatedAt, listID, userID)
	if err != nil {
		return fmt.Errorf("touch shopping list: %w", err)
	}
	return nil
}

func validateItem(item Item) error {
	if item.Name == "" || len([]rune(item.Name)) > MaxItemNameLength {
		return fmt.Errorf("%w: invalid item name", ErrInvalidInput)
	}
	if item.Quantity == "" || len([]rune(item.Quantity)) > MaxQuantityLength {
		return fmt.Errorf("%w: invalid item quantity", ErrInvalidInput)
	}
	if len([]rune(item.Unit)) > MaxUnitLength {
		return fmt.Errorf("%w: invalid item unit", ErrInvalidInput)
	}
	if len([]rune(item.Barcode)) > MaxBarcodeLength {
		return fmt.Errorf("%w: invalid item barcode", ErrInvalidInput)
	}
	if len([]rune(item.Note)) > MaxNoteLength {
		return fmt.Errorf("%w: invalid item note", ErrInvalidInput)
	}
	if item.Source == "" {
		item.Source = SourceUser
	}
	return nil
}

func validateStore(store StoreProfile) error {
	if store.Name == "" || len([]rune(store.Name)) > MaxStoreNameLength {
		return fmt.Errorf("%w: invalid store name", ErrInvalidInput)
	}
	if len([]rune(store.Address)) > MaxAddressLength {
		return fmt.Errorf("%w: invalid store address", ErrInvalidInput)
	}
	if len([]rune(store.Note)) > MaxNoteLength {
		return fmt.Errorf("%w: invalid store note", ErrInvalidInput)
	}
	return nil
}

func validZoneType(zoneType string) bool {
	switch zoneType {
	case ZoneTypeProduce, ZoneTypeDairy, ZoneTypeFrozen, ZoneTypeMeat, ZoneTypeGrain,
		ZoneTypeHousehold, ZoneTypePersonal, ZoneTypeSnacks, ZoneTypeBakery, ZoneTypeOther:
		return true
	default:
		return false
	}
}

type scanner interface {
	Scan(dest ...any) error
}

func scanList(row scanner) (List, error) {
	var list List
	if err := row.Scan(&list.ID, &list.UserID, &list.Name, &list.CreatedAt, &list.UpdatedAt); err != nil {
		return List{}, err
	}
	list.Items = []Item{}
	return list, nil
}

func scanItem(row scanner) (Item, error) {
	var item Item
	var metaJSON string
	if err := row.Scan(&item.ID, &item.UserID, &item.ListID, &item.Name, &item.NormalizedName,
		&item.Quantity, &item.Unit, &item.Barcode, &item.Note, &item.Source, &metaJSON,
		&item.CreatedAt, &item.UpdatedAt); err != nil {
		return Item{}, err
	}
	if metaJSON != "" && metaJSON != "{}" {
		var meta ProductMeta
		if err := json.Unmarshal([]byte(metaJSON), &meta); err == nil {
			item.ProductMeta = &meta
		}
	}
	return item, nil
}

func scanStore(row scanner) (StoreProfile, error) {
	var store StoreProfile
	if err := row.Scan(&store.ID, &store.UserID, &store.Name, &store.Address, &store.Lat,
		&store.Lon, &store.Note, &store.EntryZoneID, &store.CheckoutZoneID,
		&store.CreatedAt, &store.UpdatedAt); err != nil {
		return StoreProfile{}, err
	}
	return store, nil
}

func scanZone(row scanner) (Zone, error) {
	var zone Zone
	if err := row.Scan(&zone.ID, &zone.UserID, &zone.StoreID, &zone.Name, &zone.ZoneType,
		&zone.Position, &zone.Source, &zone.CreatedAt, &zone.UpdatedAt); err != nil {
		return Zone{}, err
	}
	return zone, nil
}

func scanMapping(row scanner) (Mapping, error) {
	var mapping Mapping
	if err := row.Scan(&mapping.ID, &mapping.UserID, &mapping.ItemKey, &mapping.ZoneType,
		&mapping.StoreID, &mapping.ZoneID, &mapping.Source, &mapping.SourceRef,
		&mapping.ConfirmedAt, &mapping.UpdatedAt); err != nil {
		return Mapping{}, err
	}
	return mapping, nil
}

var _ = time.Now
