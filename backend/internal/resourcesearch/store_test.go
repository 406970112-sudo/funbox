package resourcesearch

import (
	"context"
	"testing"
	"time"
)

func TestStoreSeedsRealSourcesAndSupportsCRUD(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	sources, err := store.ListSources(ctx, SourceFilter{})
	if err != nil {
		t.Fatalf("list sources: %v", err)
	}
	if len(sources) != 6 {
		t.Fatalf("expected 6 seeded sources, got %d", len(sources))
	}

	created, err := store.CreateSource(ctx, "admin-1", SourceInput{
		Name:              "测试站",
		Description:       "真实测试",
		Category:          "综合",
		HomepageURL:       "https://example.com/",
		SearchURLTemplate: "https://example.com/s/{keyword}.html",
		Mode:              SourceModeDirect,
		AdapterKey:        adapterDirectLink,
		LogoType:          "text",
		LogoText:          "TS",
		LogoBackground:    "#e7ecff",
		LogoColor:         "#4b6bff",
		DefaultSelected:   false,
		Enabled:           true,
		SortOrder:         99,
		MaxResults:        20,
		TimeoutMS:         12000,
		CacheTTLMS:        120000,
	})
	if err != nil {
		t.Fatalf("create source: %v", err)
	}

	created.DefaultSelected = true
	updated, err := store.UpdateSource(ctx, "admin-1", created.ID, SourceInput{
		Name:              "测试站改",
		Description:       "真实测试",
		Category:          "影视",
		HomepageURL:       "https://example.com/",
		SearchURLTemplate: "https://example.com/s/{keyword}.html",
		Mode:              SourceModeDirect,
		AdapterKey:        adapterDirectLink,
		LogoType:          "text",
		LogoText:          "TS",
		LogoBackground:    "#e7ecff",
		LogoColor:         "#4b6bff",
		DefaultSelected:   true,
		Enabled:           false,
		SortOrder:         98,
		MaxResults:        10,
		TimeoutMS:         8000,
		CacheTTLMS:        60000,
	})
	if err != nil {
		t.Fatalf("update source: %v", err)
	}
	if updated.Name != "测试站改" || updated.Enabled || !updated.DefaultSelected {
		t.Fatalf("unexpected updated source: %#v", updated)
	}

	filtered, err := store.ListSources(ctx, SourceFilter{Status: "disabled", Category: "影视"})
	if err != nil {
		t.Fatalf("filter sources: %v", err)
	}
	if len(filtered) != 1 || filtered[0].ID != created.ID {
		t.Fatalf("unexpected filtered sources: %#v", filtered)
	}

	if _, err := store.DeleteSource(ctx, "admin-1", created.ID); err != nil {
		t.Fatalf("delete source: %v", err)
	}
	if _, err := store.GetSource(ctx, created.ID); err != ErrSourceNotFound {
		t.Fatalf("expected deleted source to be missing, got %v", err)
	}
}

func TestStoreTracksHealthTestAuditAndUsage(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	now := time.Now().UTC()
	if err := store.SaveHealthCheck(ctx, HealthCheck{
		SourceID:   "laoer-motewan",
		CheckedAt:  now,
		Status:     StatusSuccess,
		HTTPStatus: 200,
		LatencyMS:  570,
		FinalURL:   "https://laoer.motewan.com/",
		Message:    "ok",
		Trigger:    "manual",
	}); err != nil {
		t.Fatalf("save health check: %v", err)
	}
	health, ok, err := store.LatestHealth(ctx, "laoer-motewan")
	if err != nil || !ok {
		t.Fatalf("latest health: ok=%v err=%v", ok, err)
	}
	if health.Status != StatusSuccess || health.LatencyMS != 570 {
		t.Fatalf("unexpected health: %#v", health)
	}

	if err := store.SaveTestRun(ctx, TestRun{
		SourceID:   "laoer-motewan",
		OperatorID: "admin-1",
		Query:      "流浪地球2",
		Status:     StatusSuccess,
		Count:      5,
		DurationMS: 3382,
		CreatedAt:  now,
	}); err != nil {
		t.Fatalf("save test run: %v", err)
	}
	runs, err := store.ListTestRuns(ctx, "laoer-motewan", 5)
	if err != nil || len(runs) != 1 || runs[0].Count != 5 {
		t.Fatalf("unexpected test runs: %#v err=%v", runs, err)
	}

	if err := store.AddAudit(ctx, AuditLog{
		OperatorID:   "admin-1",
		OperatorName: "管理员",
		Action:       "source_update",
		SourceID:     "laoer-motewan",
		Result:       "success",
		CreatedAt:    now,
	}); err != nil {
		t.Fatalf("add audit: %v", err)
	}
	page, err := store.ListAuditLogs(ctx, 20, 0, "", "")
	if err != nil || page.Total != 1 || len(page.Logs) != 1 {
		t.Fatalf("unexpected audit page: %#v err=%v", page, err)
	}

	for index := 0; index < 3; index++ {
		if err := store.LogUsage(ctx, "laoer-motewan", "流浪地球2", string(StatusSuccess), 5, 100, "user-1"); err != nil {
			t.Fatalf("log usage: %v", err)
		}
	}
	stats, err := store.Stats(ctx, 7)
	if err != nil || len(stats) != 1 || stats[0].SearchCount != 3 || stats[0].ResultCount != 15 {
		t.Fatalf("unexpected stats: %#v err=%v", stats, err)
	}
	keywords, err := store.TopKeywords(ctx, 7, 5)
	if err != nil || len(keywords) != 1 || keywords[0].Keyword != "流浪地球2" || keywords[0].Count != 3 {
		t.Fatalf("unexpected keywords: %#v err=%v", keywords, err)
	}
}
