package homerecommendation

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func newTestService(t *testing.T) (*Service, *Store) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service, err := NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	return service, store
}

func boolPtr(value bool) *bool {
	return &value
}

func intPtr(value int) *int {
	return &value
}

func strPtr(value string) *string {
	return &value
}

func TestCreateAndListSlots(t *testing.T) {
	service, _ := newTestService(t)
	created, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "card-score",
		Enabled:   boolPtr(true),
	})
	if err != nil {
		t.Fatalf("create slot: %v", err)
	}
	if created.FeatureKind != KindTool {
		t.Fatalf("kind = %q, want tool", created.FeatureKind)
	}
	if created.ID == "" {
		t.Fatal("slot id is empty")
	}
	response, err := service.AdminList(context.Background())
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if len(response.Slots) != 1 || !response.Slots[0].Valid {
		t.Fatalf("slots = %+v", response.Slots)
	}
	if response.Summary.EnabledToday != 1 {
		t.Fatalf("enabled today = %d", response.Summary.EnabledToday)
	}
}

func TestCreateSlotRejectsInvalidFeature(t *testing.T) {
	service, _ := newTestService(t)
	for _, featureID := range []string{"not-exists", "image-cleanup", "double-color-ball-history"} {
		_, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
			FeatureID: featureID,
			Enabled:   boolPtr(true),
		})
		if err == nil {
			t.Fatalf("expected error for feature %q", featureID)
		}
	}
}

func TestDeleteLastEnabledSlotIsRejected(t *testing.T) {
	service, _ := newTestService(t)
	created, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "card-score",
		Enabled:   boolPtr(true),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteSlot(context.Background(), "admin-1", created.ID); err != ErrLastEnabledSlot {
		t.Fatalf("delete last slot err = %v", err)
	}
}

func TestDisableLastEnabledSlotIsRejected(t *testing.T) {
	service, _ := newTestService(t)
	created, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "card-score",
		Enabled:   boolPtr(true),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.UpdateSlot(context.Background(), "admin-1", created.ID, SlotInput{
		FeatureID: "card-score",
		Enabled:   boolPtr(false),
	})
	if err != ErrLastEnabledSlot {
		t.Fatalf("disable last slot err = %v", err)
	}
}

func TestHomeRecommendationsFallback(t *testing.T) {
	service, _ := newTestService(t)
	visible := make([]string, 0, len(service.features))
	for id := range service.features {
		visible = append(visible, id)
	}
	response, err := service.HomeRecommendations(context.Background(), visible, "")
	if err != nil {
		t.Fatal(err)
	}
	if response.Source != SourceFallback {
		t.Fatalf("source = %q", response.Source)
	}
	if len(response.Items) != 1 || response.Items[0].FeatureID != DefaultFallbackFeatureID {
		t.Fatalf("fallback items = %+v", response.Items)
	}
	if response.Items[0].CTALabel == "" || response.Items[0].Route == "" {
		t.Fatalf("fallback item missing fields: %+v", response.Items[0])
	}
}

func TestHomeRecommendationsConfiguredOrderAndDate(t *testing.T) {
	service, _ := newTestService(t)
	fixedDate := "2026-08-02"
	service.nowFunc = func() time.Time {
		parsed, _ := time.Parse("2006-01-02", fixedDate)
		return parsed
	}
	_, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "smart-translation",
		Enabled:   boolPtr(true),
		SortOrder: intPtr(0),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "snake-brawl",
		Enabled:   boolPtr(true),
		SortOrder: intPtr(1),
		Weekdays:  []int{int(fixedDateWeekday(fixedDate))},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "qr-code",
		Enabled:   boolPtr(true),
		SortOrder: intPtr(2),
		StartsOn:  strPtr("2026-08-10"),
	})
	if err != nil {
		t.Fatal(err)
	}

	visible := []string{"smart-translation", "snake-brawl", "qr-code"}
	response, err := service.HomeRecommendations(context.Background(), visible, fixedDate)
	if err != nil {
		t.Fatal(err)
	}
	if response.Source != SourceConfigured || len(response.Items) != 2 {
		t.Fatalf("response = %+v", response)
	}
	if response.Items[0].FeatureID != "smart-translation" || response.Items[1].FeatureID != "snake-brawl" {
		t.Fatalf("order = %s, %s", response.Items[0].FeatureID, response.Items[1].FeatureID)
	}
	if response.Items[0].Kind != KindTool || response.Items[1].Kind != KindGame {
		t.Fatalf("kinds = %s, %s", response.Items[0].Kind, response.Items[1].Kind)
	}
}

func TestHomeRecommendationsRespectsVisibility(t *testing.T) {
	service, _ := newTestService(t)
	_, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "smart-translation",
		Enabled:   boolPtr(true),
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := service.HomeRecommendations(context.Background(), []string{"qr-code"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if response.Source != SourceFallback || len(response.Items) != 1 {
		t.Fatalf("response = %+v", response)
	}
}

func TestOverridesAndValidation(t *testing.T) {
	service, _ := newTestService(t)
	created, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID:           "card-score",
		Enabled:             boolPtr(true),
		TitleOverride:       "今日牌局",
		DescriptionOverride: "多人实时记分",
		CTALabelOverride:    "立即开始",
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := service.HomeRecommendations(context.Background(), []string{"card-score"}, "")
	if err != nil {
		t.Fatal(err)
	}
	item := response.Items[0]
	if item.Title != "今日牌局" || item.Description != "多人实时记分" || item.CTALabel != "立即开始" {
		t.Fatalf("override item = %+v", item)
	}
	if item.SlotID != created.ID {
		t.Fatalf("slot id = %q", item.SlotID)
	}

	_, err = service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "qr-code",
		Enabled:   boolPtr(true),
		StartsOn:  strPtr("2026-08-10"),
		EndsOn:    strPtr("2026-08-01"),
	})
	if err != ErrInvalidDateRange {
		t.Fatalf("date range err = %v", err)
	}
	_, err = service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "qr-code",
		Enabled:   boolPtr(true),
		Weekdays:  []int{1, 1},
	})
	if err != ErrInvalidWeekday {
		t.Fatalf("weekday err = %v", err)
	}
	_, err = service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID:     "qr-code",
		Enabled:       boolPtr(true),
		TitleOverride: "x",
	})
	if err == nil || !errors.Is(err, ErrInvalidOverride) {
		t.Fatalf("override err = %v", err)
	}
}

func TestEventsDeduplicateAndAudit(t *testing.T) {
	service, _ := newTestService(t)
	created, err := service.CreateSlot(context.Background(), "admin-1", SlotInput{
		FeatureID: "card-score",
		Enabled:   boolPtr(true),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RecordEvent(context.Background(), "user-1", created.ID, "view", "2026-08-02"); err != nil {
		t.Fatal(err)
	}
	if err := service.RecordEvent(context.Background(), "user-1", created.ID, "view", "2026-08-02"); err != nil {
		t.Fatal(err)
	}
	if err := service.RecordEvent(context.Background(), "user-1", created.ID, "click", "2026-08-02"); err != nil {
		t.Fatal(err)
	}
	stats, err := service.Stats(context.Background(), 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(stats.Items) != 1 || stats.Items[0].Views != 1 || stats.Items[0].Clicks != 1 {
		t.Fatalf("stats = %+v", stats.Items)
	}

	_ = service.AuditLogAppend(context.Background(), "admin-1", "create", created.ID, created.FeatureID)
	entries, err := service.AuditLog(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Action != "create" {
		t.Fatalf("audit = %+v", entries)
	}
}

func fixedDateWeekday(date string) int {
	parsed, _ := time.Parse("2006-01-02", date)
	weekday := int(parsed.Weekday())
	if weekday == 0 {
		return 7
	}
	return weekday
}
