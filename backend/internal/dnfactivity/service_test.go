package dnfactivity

import (
	"context"
	"testing"
	"time"
)

func TestActivityStatus(t *testing.T) {
	tests := []struct {
		name      string
		start     string
		end       string
		today     string
		wantState ActivityStatus
		wantDays  int
	}{
		{name: "ongoing", start: "2026-07-15", end: "2026-08-11", today: "2026-08-04", wantState: StatusOngoing, wantDays: 7},
		{name: "upcoming", start: "2026-09-01", end: "2026-09-10", today: "2026-08-04", wantState: StatusUpcoming},
		{name: "ended", start: "2026-07-01", end: "2026-07-22", today: "2026-08-04", wantState: StatusEnded},
		{name: "unknown missing start", start: "", end: "2026-08-11", today: "2026-08-04", wantState: StatusUnknown},
		{name: "unknown missing end", start: "2026-07-15", end: "", today: "2026-08-04", wantState: StatusUnknown},
		{name: "unknown invalid range", start: "2026-08-20", end: "2026-08-01", today: "2026-08-04", wantState: StatusUnknown},
		{name: "same day ongoing", start: "2026-08-04", end: "2026-08-04", today: "2026-08-04", wantState: StatusOngoing, wantDays: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotState, gotDays := activityStatus(tt.start, tt.end, tt.today)
			if gotState != tt.wantState {
				t.Fatalf("state = %q, want %q", gotState, tt.wantState)
			}
			if gotDays != tt.wantDays {
				t.Fatalf("days = %d, want %d", gotDays, tt.wantDays)
			}
		})
	}
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	service := NewService(ServiceConfig{
		SourceURL:    sourceURL,
		SyncInterval: time.Hour,
		CacheTTL:     time.Hour,
		PageSize:     20,
		MaxFavorites: 30,
	}, store)
	service.mu.Lock()
	service.lastSync = time.Now()
	service.mu.Unlock()
	return service
}

func seedRows(t *testing.T, service *Service) {
	t.Helper()
	now := time.Now()
	rows := []activityRow{
		{ID: "a", SourceID: "a", Title: "摸金秘境 星赠好礼", StartDate: "2026-07-15", EndDate: "2026-08-11", FetchedAt: now},
		{ID: "b", SourceID: "b", Title: "公会召集令", StartDate: "2026-07-15", EndDate: "2026-08-09", FetchedAt: now},
		{ID: "c", SourceID: "c", Title: "开石鉴宝 点石成金", StartDate: "2026-07-08", EndDate: "2026-07-22", FetchedAt: now},
		{ID: "d", SourceID: "d", Title: "大唐新春 策马开年", StartDate: "", EndDate: "", FetchedAt: now},
	}
	if err := service.store.ReplaceActivities(context.Background(), rows); err != nil {
		t.Fatalf("seed rows: %v", err)
	}
}

func TestOverview(t *testing.T) {
	service := newTestService(t)
	seedRows(t, service)
	overview, err := service.Overview(context.Background())
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if overview.Total != 4 {
		t.Fatalf("total = %d, want 4", overview.Total)
	}
	if overview.Ongoing != 2 || overview.Ended != 1 || overview.Unknown != 1 || overview.Upcoming != 0 {
		t.Fatalf("counts = ongoing %d ended %d unknown %d upcoming %d", overview.Ongoing, overview.Ended, overview.Unknown, overview.Upcoming)
	}
	if len(overview.OngoingActivities) != 2 {
		t.Fatalf("ongoing activities = %d, want 2", len(overview.OngoingActivities))
	}
	if overview.OngoingActivities[0].ID != "b" {
		t.Fatalf("first ending soon = %s, want b", overview.OngoingActivities[0].ID)
	}
}

func TestListFiltersAndSort(t *testing.T) {
	service := newTestService(t)
	seedRows(t, service)
	list, err := service.List(context.Background(), ListQuery{Status: string(StatusOngoing), Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if list.Total != 2 || len(list.Items) != 2 {
		t.Fatalf("ongoing total = %d items %d, want 2/2", list.Total, len(list.Items))
	}
	if list.Items[0].ID != "b" || list.Items[1].ID != "a" {
		t.Fatalf("ongoing order = %s,%s, want b,a", list.Items[0].ID, list.Items[1].ID)
	}
	searched, err := service.List(context.Background(), ListQuery{Query: "鉴宝", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if searched.Total != 1 || searched.Items[0].ID != "c" {
		t.Fatalf("search total = %d, want 1 with id c", searched.Total)
	}
}

func TestCalendar(t *testing.T) {
	service := newTestService(t)
	seedRows(t, service)
	calendar, err := service.Calendar(context.Background(), 2026, 8)
	if err != nil {
		t.Fatalf("calendar: %v", err)
	}
	if len(calendar.Days) != 31 {
		t.Fatalf("days = %d, want 31", len(calendar.Days))
	}
	day5 := calendar.Days[4]
	if len(day5.ActivityIDs) != 2 {
		t.Fatalf("2026-08-05 activities = %d, want 2", len(day5.ActivityIDs))
	}
	day20 := calendar.Days[19]
	if len(day20.ActivityIDs) != 0 {
		t.Fatalf("2026-08-20 activities = %v, want none", day20.ActivityIDs)
	}
}

func TestShareText(t *testing.T) {
	text := buildShareText("摸金秘境 星赠好礼", "2026-07-15", "2026-08-11")
	if text != "摸金秘境 星赠好礼 · 2026-07-15 ~ 2026-08-11 · 地下城与勇士：起源 官方活动" {
		t.Fatalf("share text = %q", text)
	}
}
