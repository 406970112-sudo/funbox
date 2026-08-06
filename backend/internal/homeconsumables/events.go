package homeconsumables

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Backup struct {
	ExportedAt time.Time `json:"exportedAt"`
	Items      []Item    `json:"items"`
	Events     []Event   `json:"events"`
}

func (s *Store) CreateEvent(ctx context.Context, userID string, itemID string, input EventInput) (Item, error) {
	if !validEventType(input.EventType) {
		return Item{}, ErrInvalidInput
	}
	if input.Quantity < 0 || math.IsNaN(input.Quantity) || math.IsInf(input.Quantity, 0) {
		return Item{}, ErrInvalidInput
	}
	if input.EventType != EventTypeCount && input.Quantity <= 0 {
		return Item{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	occurredAt := now
	if input.OccurredAt != nil {
		occurredAt = input.OccurredAt.UTC()
		if occurredAt.After(now.Add(time.Minute)) {
			return Item{}, ErrInvalidInput
		}
	}
	if input.Source == "" {
		input.Source = SourceUser
	}

	item, err := s.GetItem(ctx, userID, itemID)
	if err != nil {
		return Item{}, err
	}
	stockBefore := item.CurrentStock
	var stockAfter *float64
	switch input.EventType {
	case EventTypePurchase:
		var after float64
		if stockBefore != nil {
			after = *stockBefore + input.Quantity
		} else {
			after = input.Quantity
		}
		stockAfter = &after
	case EventTypeReplace, EventTypeConsume:
		if stockBefore == nil || *stockBefore < input.Quantity {
			return Item{}, ErrInsufficientStock
		}
		after := *stockBefore - input.Quantity
		stockAfter = &after
	case EventTypeCount:
		stockAfter = &input.Quantity
	}

	item.CurrentStock = stockAfter
	confirmedAt := now
	item.StockConfirmedAt = &confirmedAt
	if input.EventType == EventTypeReplace {
		item.CurrentCycleStartedAt = &occurredAt
	}
	item.UpdatedAt = now
	if err := s.updateItemStock(ctx, item); err != nil {
		return Item{}, err
	}

	event := Event{
		ID:          uuid.NewString(),
		ItemID:      itemID,
		UserID:      userID,
		EventType:   input.EventType,
		Quantity:    input.Quantity,
		StockBefore: stockBefore,
		StockAfter:  stockAfter,
		OccurredAt:  occurredAt,
		Source:      input.Source,
		Note:        input.Note,
		EvidenceURL: input.EvidenceURL,
		CreatedAt:   now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO home_consumables_events
			(id, item_id, user_id, event_type, quantity, stock_before, stock_after,
			 occurred_at, source, note, evidence_url, undone_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
	`, event.ID, event.ItemID, event.UserID, event.EventType, event.Quantity,
		event.StockBefore, event.StockAfter, event.OccurredAt.Unix(), event.Source,
		event.Note, event.EvidenceURL, event.CreatedAt.Unix()); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, itemID)
}

func (s *Store) UndoEvent(ctx context.Context, userID string, eventID string) (Item, error) {
	event, err := s.getEvent(ctx, userID, eventID)
	if err != nil {
		return Item{}, err
	}
	if event.UndoneAt != nil {
		return Item{}, ErrInvalidInput
	}
	item, err := s.GetItem(ctx, userID, event.ItemID)
	if err != nil {
		return Item{}, err
	}
	if event.StockBefore != nil {
		item.CurrentStock = event.StockBefore
	} else {
		switch event.EventType {
		case EventTypePurchase:
			if item.CurrentStock != nil {
				after := *item.CurrentStock - event.Quantity
				item.CurrentStock = &after
			}
		case EventTypeReplace, EventTypeConsume:
			if item.CurrentStock != nil {
				after := *item.CurrentStock + event.Quantity
				item.CurrentStock = &after
			}
		case EventTypeCount:
			item.CurrentStock = nil
		}
	}
	now := time.Now().UTC()
	item.StockConfirmedAt = &now
	item.UpdatedAt = now
	if err := s.updateItemStock(ctx, item); err != nil {
		return Item{}, err
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE home_consumables_events SET undone_at = ? WHERE id = ? AND user_id = ?
	`, now.Unix(), eventID, userID); err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, userID, event.ItemID)
}

func (s *Store) ListEvents(ctx context.Context, userID string, itemID string) ([]Event, error) {
	query := `
		SELECT e.id, e.item_id, e.user_id, i.name, e.event_type, e.quantity,
			e.stock_before, e.stock_after, e.occurred_at, e.source, e.note,
			e.evidence_url, e.undone_at, e.created_at
		FROM home_consumables_events e
		JOIN home_consumables_items i ON i.id = e.item_id
		WHERE e.user_id = ?
	`
	args := []any{userID}
	if itemID != "" {
		query += " AND e.item_id = ?"
		args = append(args, itemID)
	}
	query += " ORDER BY e.occurred_at DESC, e.created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEventsWithName(rows)
}

func (s *Store) Summary(ctx context.Context, userID string, date string) (Summary, error) {
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	items, err := s.ListItems(ctx, userID, ItemFilter{})
	if err != nil {
		return Summary{}, err
	}
	summary := Summary{Date: date, Items: items, TotalItems: len(items)}
	for _, item := range items {
		if item.Prediction.RemainingDays != nil && *item.Prediction.RemainingDays <= item.RemindDays {
			summary.NeedRestock++
		}
		if item.Prediction.RemainingDays != nil && *item.Prediction.RemainingDays <= 7 {
			summary.Within7++
		}
		if item.Prediction.RemainingDays != nil && *item.Prediction.RemainingDays <= 30 {
			summary.Within30++
		}
		if item.CurrentStock == nil {
			summary.UnknownStock++
		}
		if item.Prediction.State == StateNoData || item.Prediction.State == StateUnknownStock || item.Prediction.State == StateStale {
			summary.NoData++
		}
	}
	return summary, nil
}

func (s *Store) ShoppingList(ctx context.Context, userID string, date string) (ShoppingList, error) {
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	items, err := s.ListItems(ctx, userID, ItemFilter{})
	if err != nil {
		return ShoppingList{}, err
	}
	filtered := []Item{}
	for _, item := range items {
		if item.CurrentStock != nil &&
			item.Prediction.RemainingDays != nil &&
			*item.Prediction.RemainingDays <= item.RemindDays {
			filtered = append(filtered, item)
		}
	}
	return ShoppingList{Date: date, Items: filtered}, nil
}

func (s *Store) Stats(ctx context.Context, userID string, rangeID string) (StatsSnapshot, error) {
	if rangeID == "" {
		rangeID = "30d"
	}
	items, err := s.ListItems(ctx, userID, ItemFilter{})
	if err != nil {
		return StatsSnapshot{}, err
	}
	snapshot := StatsSnapshot{Range: rangeID, TotalItems: len(items)}
	recent30Consumed, recent30Purchases, err := s.quantitiesSince(ctx, userID, time.Now().UTC().AddDate(0, 0, -30))
	if err != nil {
		return StatsSnapshot{}, err
	}
	snapshot.Recent30Consumed = recent30Consumed
	snapshot.Recent30Purchases = recent30Purchases
	totalAvg := 0.0
	avgCount := 0
	for _, item := range items {
		stat := ItemStat{
			ID:            item.ID,
			Name:          item.Name,
			Unit:          item.Unit,
			CurrentStock:  item.CurrentStock,
			RemainingDays: item.Prediction.RemainingDays,
			AvgCycleDays:  item.Prediction.AvgCycleDays,
			SampleCount:   item.Prediction.SampleCount,
		}
		itemConsumed, itemPurchased, statErr := s.quantitiesForItemSince(ctx, item.ID, time.Now().UTC().AddDate(0, 0, -30))
		if statErr == nil {
			stat.Recent30Consumed = itemConsumed
			stat.Recent30Purchases = itemPurchased
		}
		if item.Prediction.AvgCycleDays != nil {
			totalAvg += *item.Prediction.AvgCycleDays
			avgCount++
		}
		snapshot.Items = append(snapshot.Items, stat)
		if item.Prediction.RemainingDays != nil && *item.Prediction.RemainingDays <= item.RemindDays {
			snapshot.NeedRestock++
		}
	}
	if avgCount > 0 {
		avg := totalAvg / float64(avgCount)
		snapshot.AvgCycleDays = &avg
	}
	accuracy := "暂无"
	snapshot.PredictionAccuracy = &accuracy
	return snapshot, nil
}

func (s *Store) ListReminders(ctx context.Context, userID string, date string) ([]Reminder, error) {
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	items, err := s.ListItems(ctx, userID, ItemFilter{})
	if err != nil {
		return nil, err
	}
	reminders := []Reminder{}
	for _, item := range items {
		if item.CurrentStock == nil || item.Prediction.RemainingDays == nil ||
			*item.Prediction.RemainingDays > item.RemindDays {
			continue
		}
		remindAt := addDays(date, *item.Prediction.RemainingDays)
		dismissed, err := s.isReminderDismissed(ctx, userID, item.ID, remindAt)
		if err != nil {
			return nil, err
		}
		if dismissed {
			continue
		}
		reminders = append(reminders, Reminder{
			ID:            item.ID,
			ItemID:        item.ID,
			ItemName:      item.Name,
			RemainingDays: *item.Prediction.RemainingDays,
			RemindAt:      remindAt,
			Channel:       ChannelApp,
			Status:        "pending",
			CreatedAt:     time.Now().UTC(),
		})
	}
	return reminders, nil
}

func (s *Store) DismissReminder(ctx context.Context, userID string, itemID string, remindAt string) error {
	if strings.TrimSpace(itemID) == "" || strings.TrimSpace(remindAt) == "" {
		return ErrInvalidInput
	}
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT OR IGNORE INTO home_consumables_reminder_dismissals
			(id, item_id, user_id, remind_at, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.NewString(), itemID, userID, remindAt, now.Unix())
	return err
}

func (s *Store) ExportData(ctx context.Context, userID string) (Backup, error) {
	items, err := s.ListItems(ctx, userID, ItemFilter{})
	if err != nil {
		return Backup{}, err
	}
	events, err := s.ListEvents(ctx, userID, "")
	if err != nil {
		return Backup{}, err
	}
	return Backup{ExportedAt: time.Now().UTC(), Items: items, Events: events}, nil
}

func (s *Store) ImportData(ctx context.Context, userID string, payload ImportPayload) (int, error) {
	if len(payload.Items) == 0 || len(payload.Items) > 500 {
		return 0, ErrInvalidInput
	}
	created := 0
	for _, entry := range payload.Items {
		categoryID := entry.Item.CategoryID
		if categoryID == "" && entry.CategoryName != "" {
			categories, err := s.ListCategories(ctx, userID)
			if err != nil {
				return created, err
			}
			for _, category := range categories {
				if category.Name == entry.CategoryName {
					categoryID = category.ID
					break
				}
			}
			if categoryID == "" {
				createdCategory, err := s.CreateCategory(ctx, userID, CategoryInput{
					Name:              entry.CategoryName,
					DefaultUnit:       entry.Item.Unit,
					DefaultRemindDays: entry.Item.RemindDays,
				})
				if err != nil {
					return created, err
				}
				categoryID = createdCategory.ID
			}
		}
		entry.Item.CategoryID = categoryID
		entry.Item.Source = SourceImport
		if entry.Item.CurrentStock != nil {
			stock := *entry.Item.CurrentStock
			entry.Item.CurrentStock = nil
			item, err := s.CreateItem(ctx, userID, entry.Item)
			if err != nil {
				return created, err
			}
			if _, err := s.CreateEvent(ctx, userID, item.ID, EventInput{
				EventType: EventTypeCount,
				Quantity:  stock,
				Source:    SourceImport,
			}); err != nil {
				return created, err
			}
			created++
			continue
		}
		item, err := s.CreateItem(ctx, userID, entry.Item)
		if err != nil {
			return created, err
		}
		sortedEvents := append([]EventInput(nil), entry.Events...)
		sort.SliceStable(sortedEvents, func(i, j int) bool {
			left, right := time.Now(), time.Now()
			if sortedEvents[i].OccurredAt != nil {
				left = *sortedEvents[i].OccurredAt
			}
			if sortedEvents[j].OccurredAt != nil {
				right = *sortedEvents[j].OccurredAt
			}
			return left.Before(right)
		})
		for _, eventInput := range sortedEvents {
			eventInput.Source = SourceImport
			if _, err := s.CreateEvent(ctx, userID, item.ID, eventInput); err != nil {
				return created, err
			}
		}
		created++
	}
	return created, nil
}

func (s *Store) updateItemStock(ctx context.Context, item Item) error {
	var stockConfirmedAt any
	if item.StockConfirmedAt != nil {
		stockConfirmedAt = item.StockConfirmedAt.Unix()
	}
	var cycleStartedAt any
	if item.CurrentCycleStartedAt != nil {
		cycleStartedAt = item.CurrentCycleStartedAt.Unix()
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE home_consumables_items
		SET current_stock = ?, stock_confirmed_at = ?,
			current_cycle_started_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, item.CurrentStock, stockConfirmedAt, cycleStartedAt,
		item.UpdatedAt.Unix(), item.ID, item.UserID)
	return err
}

func (s *Store) getEvent(ctx context.Context, userID string, eventID string) (Event, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, item_id, user_id, event_type, quantity, stock_before,
			stock_after, occurred_at, source, note, evidence_url, undone_at, created_at
		FROM home_consumables_events WHERE id = ? AND user_id = ?
	`, eventID, userID)
	var event Event
	var stockBefore, stockAfter sql.NullFloat64
	var occurredAt, createdAt int64
	var undoneAt sql.NullInt64
	if err := row.Scan(&event.ID, &event.ItemID, &event.UserID, &event.EventType,
		&event.Quantity, &stockBefore, &stockAfter, &occurredAt, &event.Source,
		&event.Note, &event.EvidenceURL, &undoneAt, &createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Event{}, ErrNotFound
		}
		return Event{}, err
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
	return event, nil
}

func (s *Store) quantitiesSince(ctx context.Context, userID string, since time.Time) (float64, float64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_type, quantity FROM home_consumables_events
		WHERE user_id = ? AND occurred_at >= ? AND undone_at IS NULL
	`, userID, since.Unix())
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	consumed := 0.0
	purchased := 0.0
	for rows.Next() {
		var eventType string
		var quantity float64
		if err := rows.Scan(&eventType, &quantity); err != nil {
			return 0, 0, err
		}
		switch eventType {
		case EventTypeReplace, EventTypeConsume:
			consumed += quantity
		case EventTypePurchase:
			purchased += quantity
		}
	}
	return consumed, purchased, rows.Err()
}

func (s *Store) quantitiesForItemSince(ctx context.Context, itemID string, since time.Time) (float64, float64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_type, quantity FROM home_consumables_events
		WHERE item_id = ? AND occurred_at >= ? AND undone_at IS NULL
	`, itemID, since.Unix())
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	consumed := 0.0
	purchased := 0.0
	for rows.Next() {
		var eventType string
		var quantity float64
		if err := rows.Scan(&eventType, &quantity); err != nil {
			return 0, 0, err
		}
		switch eventType {
		case EventTypeReplace, EventTypeConsume:
			consumed += quantity
		case EventTypePurchase:
			purchased += quantity
		}
	}
	return consumed, purchased, rows.Err()
}

func (s *Store) isReminderDismissed(ctx context.Context, userID string, itemID string, remindAt string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM home_consumables_reminder_dismissals
		WHERE user_id = ? AND item_id = ? AND remind_at = ?
	`, userID, itemID, remindAt).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func validEventType(eventType string) bool {
	switch eventType {
	case EventTypePurchase, EventTypeReplace, EventTypeConsume, EventTypeCount:
		return true
	default:
		return false
	}
}

func addDays(date string, days int) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02")
}

func scanEvents(rows *sql.Rows) ([]Event, error) {
	events := []Event{}
	for rows.Next() {
		var event Event
		var stockBefore, stockAfter sql.NullFloat64
		var occurredAt, createdAt int64
		var undoneAt sql.NullInt64
		if err := rows.Scan(&event.ID, &event.ItemID, &event.UserID, &event.EventType,
			&event.Quantity, &stockBefore, &stockAfter, &occurredAt, &event.Source,
			&event.Note, &event.EvidenceURL, &undoneAt, &createdAt); err != nil {
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
		events = append(events, event)
	}
	return events, rows.Err()
}

func scanEventsWithName(rows *sql.Rows) ([]Event, error) {
	events := []Event{}
	for rows.Next() {
		var event Event
		var stockBefore, stockAfter sql.NullFloat64
		var occurredAt, createdAt int64
		var undoneAt sql.NullInt64
		if err := rows.Scan(&event.ID, &event.ItemID, &event.UserID, &event.ItemName,
			&event.EventType, &event.Quantity, &stockBefore, &stockAfter, &occurredAt,
			&event.Source, &event.Note, &event.EvidenceURL, &undoneAt, &createdAt); err != nil {
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
		events = append(events, event)
	}
	return events, rows.Err()
}

func nullableFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
