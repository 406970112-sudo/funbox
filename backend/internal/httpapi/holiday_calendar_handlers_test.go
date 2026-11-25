package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"testing"

	"my-first-expo-app/backend/internal/config"
)

func TestHolidayCalendarIsPublicAndShowsOfficialMakeupDays(t *testing.T) {
	cfg := config.Config{Database: config.DatabaseConfig{Path: filepath.Join(t.TempDir(), "calendar.db")}}
	server := NewServer(cfg, nil, nil, nil, nil, nil)
	t.Cleanup(func() { _ = server.Shutdown(context.Background()) })
	recorder := httptest.NewRecorder()
	server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/holiday-calendar", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("public calendar returned %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Version string
		Years   []struct {
			Year     int
			Source   struct{ URL, PublishedAt string }
			Holidays []struct {
				Name, StartDate, EndDate string
				MakeupDates              []string
			}
		}
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Version == "" || len(payload.Years) < 2 || payload.Years[0].Year != 2026 || payload.Years[1].Year != 2027 {
		t.Fatalf("expected versioned 2026 and 2027 data, got %+v", payload)
	}
	calendar := payload.Years[1]
	if calendar.Source.URL == "" || calendar.Source.PublishedAt != "2026-11-05" || len(calendar.Holidays) != 7 {
		t.Fatalf("missing official notice or holidays: %+v", calendar)
	}
	spring := calendar.Holidays[1]
	if spring.Name != "春节" || spring.StartDate != "2027-02-05" || spring.EndDate != "2027-02-13" ||
		!slices.Equal(spring.MakeupDates, []string{"2027-01-31", "2027-02-14"}) {
		t.Fatalf("incorrect Spring Festival schedule: %+v", spring)
	}
}
