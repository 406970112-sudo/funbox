package homeconsumables

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
)

func (s *Store) ListItems(ctx context.Context, userID string, filter ItemFilter) ([]Item, error) {
	query := `
		SELECT i.id, i.user_id, i.category_id, c.name, c.icon, c.color,
			i.name, i.unit, i.current_stock, i.stock_confirmed_at,
			i.current_cycle_started_at, i.remind_days, i.note, i.status,
			i.source, i.archived_at, i.created_at, i.updated_at,
			(SELECT COUNT(*) FROM home_consumables_events e
				WHERE e.item_id = i.id AND e.undone_at IS NULL) AS event_count
		FROM home_consumables_items i
		JOIN home_consumables_categories c ON c.id = i.category_id
		WHERE i.user_id = ? AND i.archived_at IS NULL
	`
	args := []any{userID}
	if filter.CategoryID != "" {
		query += " AND i.category_id = ?"
		args = append(args, filter.CategoryID)
	}
	if filter.Query != "" {
		query += " AND (i.name LIKE ? OR i.note LIKE ? OR c.name LIKE ?)"
		keyword := "%" + filter.Query + "%"
		args = append(args, keyword, keyword, keyword)
	}
	query += " ORDER BY i.created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list home consumables items: %w", err)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for index := range items {
		if err := s.attachPrediction(ctx, &items[index]); err != nil {
			return nil, err
		}
	}
	items = filterItems(items, filter.State)
	switch filter.Sort {
	case "name":
		sortItemsByName(items)
	case "recent-purchase":
		sortItemsByRecentEvent(ctx, s, items, EventTypePurchase)
	case "recent-replace":
		sortItemsByRecentEvent(ctx, s, items, EventTypeReplace)
	default:
		sortItemsByRemaining(items)
	}
	return items, nil
}

func (s *Store) GetItem(ctx context.Context, userID string, itemID string) (Item, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT i.id, i.user_id, i.category_id, c.name, c.icon, c.color,
			i.name, i.unit, i.current_stock, i.stock_confirmed_at,
			i.current_cycle_started_at, i.remind_days, i.note, i.status,
			i.source, i.archived_at, i.created_at, i.updated_at,
			(SELECT COUNT(*) FROM home_consumables_events e
				WHERE e.item_id = i.id AND e.undone_at IS NULL) AS event_count
		FROM home_consumables_items i
		JOIN home_consumables_categories c ON c.id = i.category_id
		WHERE i.id = ? AND i.user_id = ? AND i.archived_at IS NULL
	`, itemID, userID)
	item, err := scanItem(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Item{}, ErrNotFound
		}
		return Item{}, err
	}
	if err := s.attachPrediction(ctx, &item); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *Store) CreateItem(ctx context.Context, userID string, input ItemInput) (Item, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Unit = strings.TrimSpace(input.Unit)
	if input.Name == "" || len([]rune(input.Name)) > 60 {
		return Item{}, ErrInvalidInput
	}
	if input.Unit == "" || len([]rune(input.Unit)) > 20 {
		return Item{}, ErrInvalidInput
	}
	if input.CategoryID == "" {
		return Item{}, ErrInvalidInput
	}
	if _, err := s.getCategory(ctx, userID, input.CategoryID); err != nil {
		return Item{}, err
	}
	if input.CurrentStock != nil && (*input.CurrentStock < 0 || math.IsNaN(*input.CurrentStock) || math.IsInf(*input.CurrentStock, 0)) {
		return Item{}, ErrInvalidInput
	}
	if input.RemindDays <= 0 {
		input.RemindDays = 7
	}
	if input.Source == "" {
		input.Source = SourceUser
	}
	now := time.Now().UTC()
	item := Item{
		ID:           uuid.NewString(),
		UserID:       userID,
		CategoryID:   input.CategoryID,
		Name:         input.Name,
		Unit:         input.Unit,
		CurrentStock: input.CurrentStock,
		RemindDays:   input.RemindDays,
		Note:         input.Note,
		Status:       StatusActive,
		Source:       input.Source,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if item.CurrentStock != nil {
		item.StockConfirmedAt = &now
	}
	if input.CurrentCycleStartedAt != nil {
		startedAt, err := parseDate(*input.CurrentCycleStartedAt)
		if err != nil {
			return Item{}, ErrInvalidInput
		}
		item.CurrentCycleStartedAt = &startedAt
	}
	var stockConfirmedAt any
	if item.StockConfirmedAt != nil {
		stockConfirmedAt = item.StockConfirmedAt.Unix()
	}
	var cycleStartedAt any
	if item.CurrentCycleStartedAt != nil {
		cycleStartedAt = item.CurrentCycleStartedAt.Unix()
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO home_consumables_items
			(id, user_id, category_id, name, unit, current_stock, stock_confirmed_at,
			 current_cycle_started_at, remind_days, note, status, source, archived_at,
			 created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
	`, item.ID, item.UserID, item.CategoryID, item.Name, item.Unit,
		item.CurrentStock, stockConfirmedAt, cycleStartedAt, item.RemindDays,
		item.Note, item.Status, item.Source, item.CreatedAt.Unix(), item.UpdatedAt.Unix()); err != nil {
		return Item{}, err
	}
	if item.CurrentStock != nil {
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO home_consumables_events
				(id, item_id, user_id, event_type, quantity, stock_before, stock_after,
				 occurred_at, source, note, evidence_url, undone_at, created_at)
			VALUES (?, ?, ?, 'count', ?, NULL, ?, ?, ?, '', '', NULL, ?)
		`, uuid.NewString(), item.ID, item.UserID, *item.CurrentStock,
			*item.CurrentStock, now.Unix(), item.Source, now.Unix()); err != nil {
			return Item{}, err
		}
	}
	return s.GetItem(ctx, userID, item.ID)
}

func (s *Store) UpdateItem(ctx context.Context, userID string, itemID string, input ItemInput) (Item, error) {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	if input.Name != "" {
		input.Name = strings.TrimSpace(input.Name)
		if input.Name == "" || len([]rune(input.Name)) > 60 {
			return Item{}, ErrInvalidInput
		}
		item.Name = input.Name
	}
	if input.Unit != "" {
		input.Unit = strings.TrimSpace(input.Unit)
		if input.Unit == "" || len([]rune(input.Unit)) > 20 {
			return Item{}, ErrInvalidInput
		}
		item.Unit = input.Unit
	}
	if input.CategoryID != "" {
		if _, err := s.getCategory(ctx, userID, input.CategoryID); err != nil {
			return Item{}, err
		}
		item.CategoryID = input.CategoryID
	}
	if input.CurrentCycleStartedAt != nil {
		startedAt, err := parseDate(*input.CurrentCycleStartedAt)
		if err != nil {
			return Item{}, ErrInvalidInput
		}
		item.CurrentCycleStartedAt = &startedAt
	}
	if input.RemindDays > 0 {
		item.RemindDays = input.RemindDays
	}
	if input.Note != "" {
		item.Note = input.Note
	}
	if input.Source != "" {
		item.Source = input.Source
	}
	if input.Status != "" {
		if input.Status != StatusActive && input.Status != StatusArchived {
			return Item{}, ErrInvalidInput
		}
		item.Status = input.Status
	}

	changedStock := input.CurrentStock != nil &&
		(item.CurrentStock == nil || math.Abs(*item.CurrentStock-*input.CurrentStock) > 0.000001)
	if changedStock {
		if *input.CurrentStock < 0 || math.IsNaN(*input.CurrentStock) || math.IsInf(*input.CurrentStock, 0) {
			return Item{}, ErrInvalidInput
		}
		item.CurrentStock = input.CurrentStock
		now := time.Now().UTC()
		item.StockConfirmedAt = &now
	}
	item.UpdatedAt = time.Now().UTC()
	var stockConfirmedAt any
	if item.StockConfirmedAt != nil {
		stockConfirmedAt = item.StockConfirmedAt.Unix()
	}
	var cycleStartedAt any
	if item.CurrentCycleStartedAt != nil {
		cycleStartedAt = item.CurrentCycleStartedAt.Unix()
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE home_consumables_items
		SET category_id = ?, name = ?, unit = ?, current_stock = ?,
			stock_confirmed_at = ?, current_cycle_started_at = ?, remind_days = ?,
			note = ?, status = ?, source = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, item.CategoryID, item.Name, item.Unit, item.CurrentStock,
		stockConfirmedAt, cycleStartedAt, item.RemindDays, item.Note,
		item.Status, item.Source, item.UpdatedAt.Unix(), itemID, userID); err != nil {
		return Item{}, err
	}
	if changedStock {
		now := time.Now().UTC()
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO home_consumables_events
				(id, item_id, user_id, event_type, quantity, stock_before, stock_after,
				 occurred_at, source, note, evidence_url, undone_at, created_at)
			VALUES (?, ?, ?, 'count', ?, NULL, ?, ?, ?, '', '', NULL, ?)
		`, uuid.NewString(), item.ID, item.UserID, *item.CurrentStock,
			nil, *item.CurrentStock, now.Unix(), SourceUser, now.Unix()); err != nil {
			return Item{}, err
		}
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) DeleteItem(ctx context.Context, userID string, itemID string) error {
	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		UPDATE home_consumables_items
		SET status = 'archived', archived_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, now.Unix(), now.Unix(), item.ID, userID)
	return err
}

func (s *Store) attachPrediction(ctx context.Context, item *Item) error {
	events, err := s.eventsForItem(ctx, item.ID)
	if err != nil {
		return err
	}
	item.Prediction = computePrediction(item.CurrentStock, events, item.CurrentCycleStartedAt, time.Now().UTC())
	return nil
}

func (s *Store) eventsForItem(ctx context.Context, itemID string) ([]Event, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, item_id, user_id, event_type, quantity, stock_before,
			stock_after, occurred_at, source, note, evidence_url, undone_at, created_at
		FROM home_consumables_events
		WHERE item_id = ? AND undone_at IS NULL
		ORDER BY occurred_at ASC
	`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEvents(rows)
}

func scanItem(row interface{ Scan(...any) error }) (Item, error) {
	var item Item
	var currentStock sql.NullFloat64
	var stockConfirmedAt sql.NullInt64
	var cycleStartedAt sql.NullInt64
	var archivedAt sql.NullInt64
	var createdAt, updatedAt int64
	if err := row.Scan(&item.ID, &item.UserID, &item.CategoryID, &item.CategoryName,
		&item.CategoryIcon, &item.CategoryColor, &item.Name, &item.Unit,
		&currentStock, &stockConfirmedAt, &cycleStartedAt, &item.RemindDays,
		&item.Note, &item.Status, &item.Source, &archivedAt, &createdAt, &updatedAt,
		&item.EventCount); err != nil {
		return Item{}, err
	}
	if currentStock.Valid {
		item.CurrentStock = &currentStock.Float64
	}
	item.StockConfirmedAt = scanTime(stockConfirmedAt)
	item.CurrentCycleStartedAt = scanTime(cycleStartedAt)
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func filterItems(items []Item, state string) []Item {
	if state == "" || state == "all" {
		return items
	}
	filtered := []Item{}
	for _, item := range items {
		switch state {
		case "restock":
			if item.Prediction.RemainingDays != nil && *item.Prediction.RemainingDays <= item.RemindDays {
				filtered = append(filtered, item)
			}
		case "normal":
			if item.Prediction.RemainingDays != nil && *item.Prediction.RemainingDays > item.RemindDays {
				filtered = append(filtered, item)
			}
		case "no-data":
			if item.Prediction.State == StateNoData || item.Prediction.State == StateUnknownStock || item.Prediction.State == StateStale {
				filtered = append(filtered, item)
			}
		case "unknown":
			if item.CurrentStock == nil {
				filtered = append(filtered, item)
			}
		}
	}
	return filtered
}

func sortItemsByRemaining(items []Item) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			left := items[j-1]
			right := items[j]
			leftDays := remainingDaysOrMax(left)
			rightDays := remainingDaysOrMax(right)
			if leftDays <= rightDays {
				break
			}
			items[j-1], items[j] = right, left
		}
	}
}

func remainingDaysOrMax(item Item) int {
	if item.Prediction.RemainingDays == nil {
		return int(^uint(0) >> 1)
	}
	return *item.Prediction.RemainingDays
}

func sortItemsByName(items []Item) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			if items[j-1].Name <= items[j].Name {
				break
			}
			items[j-1], items[j] = items[j], items[j-1]
		}
	}
}

func sortItemsByRecentEvent(ctx context.Context, s *Store, items []Item, eventType string) {
	latest := map[string]time.Time{}
	for _, item := range items {
		event, err := s.latestEvent(ctx, item.ID, eventType)
		if err == nil && event != nil {
			latest[item.ID] = event.OccurredAt
		}
	}
	for i := 1; i < len(items); i++ {
		for j := i; j > 0; j-- {
			left := latest[items[j-1].ID]
			right := latest[items[j].ID]
			if left.After(right) {
				items[j-1], items[j] = items[j], items[j-1]
			} else {
				break
			}
		}
	}
}

func (s *Store) latestEvent(ctx context.Context, itemID string, eventType string) (*Event, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, item_id, user_id, event_type, quantity, stock_before,
			stock_after, occurred_at, source, note, evidence_url, undone_at, created_at
		FROM home_consumables_events
		WHERE item_id = ? AND event_type = ? AND undone_at IS NULL
		ORDER BY occurred_at DESC LIMIT 1
	`, itemID, eventType)
	var event Event
	var stockBefore, stockAfter sql.NullFloat64
	var occurredAt, createdAt int64
	var undoneAt sql.NullInt64
	if err := row.Scan(&event.ID, &event.ItemID, &event.UserID, &event.EventType,
		&event.Quantity, &stockBefore, &stockAfter, &occurredAt, &event.Source,
		&event.Note, &event.EvidenceURL, &undoneAt, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if stockBefore.Valid {
		event.StockBefore = &stockBefore.Float64
	}
	if stockAfter.Valid {
		event.StockAfter = &stockAfter.Float64
	}
	event.OccurredAt = time.Unix(occurredAt, 0).UTC()
	event.CreatedAt = time.Unix(createdAt, 0).UTC()
	event.UndoneAt = scanTime(undoneAt)
	return &event, nil
}

func parseDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", strings.TrimSpace(value))
}
