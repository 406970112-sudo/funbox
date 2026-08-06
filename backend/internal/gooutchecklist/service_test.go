package gooutchecklist

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/user"
)

type fakeProvider struct{}

func (fakeProvider) FetchWeather(ctx context.Context, lat, lon float64, date string) (WeatherData, error) {
	max := 34.3
	precip := 52.0
	uv := 8.3
	return WeatherData{
		Date:      date,
		Timezone:  "Asia/Shanghai",
		FetchedAt: time.Now().UTC(),
		Daily: &DailyWeather{
			TemperatureMax:    &max,
			PrecipitationProb: &precip,
			UVIndex:           &uv,
		},
	}, nil
}

func (fakeProvider) FetchAirQuality(ctx context.Context, lat, lon float64) (AirQualityData, error) {
	aqi := 37.0
	return AirQualityData{
		Time:      "2026-08-06T09:00",
		EAQI:      &aqi,
		FetchedAt: time.Now().UTC(),
	}, nil
}

func (fakeProvider) SearchCities(ctx context.Context, query string) ([]CityResult, error) {
	return []CityResult{{Name: "上海市", Admin1: "上海", Country: "中国", Lat: 31.23, Lon: 121.47}}, nil
}

func TestServiceEmptyAndTemplateFlow(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	defer userStore.Close()
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	service := NewService(store, fakeProvider{})

	state, err := service.GetState(ctx, "u1")
	if err != nil {
		t.Fatalf("get state: %v", err)
	}
	if len(state.Items) != 0 || len(state.Scenes) != 0 || len(state.Completions) != 0 {
		t.Fatalf("expected empty state, got %+v", state)
	}

	scene, err := service.ApplyTemplate(ctx, "u1", "work")
	if err != nil {
		t.Fatalf("apply template: %v", err)
	}
	state, _ = service.GetState(ctx, "u1")
	if len(state.Items) != 4 || len(state.Scenes) != 1 || len(state.SceneItems) != 4 {
		t.Fatalf("template did not create real user data: %+v", state)
	}

	settings, err := service.GetSettings(ctx, "u1")
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	settings.Settings.City = "上海市"
	settings.Settings.Lat = 31.23
	settings.Settings.Lon = 121.47
	settings.Settings.Timezone = "Asia/Shanghai"
	settings.Settings.WeatherEnabled = true
	settings.Settings.ActiveSceneID = scene.ID
	if _, err := service.SaveSettings(ctx, "u1", settings); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	home, err := service.Home(ctx, "u1", scene.ID)
	if err != nil {
		t.Fatalf("home: %v", err)
	}
	if !home.Weather.Available || home.Weather.PrecipProb == nil || *home.Weather.PrecipProb != 52 {
		t.Fatalf("expected real weather snapshot, got %+v", home.Weather)
	}
	if home.ActiveSceneID != scene.ID {
		t.Fatalf("expected active scene, got %q", home.ActiveSceneID)
	}
}

func TestServiceCompletionAndHistory(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	defer userStore.Close()
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	service := NewService(store, fakeProvider{})

	scene, err := service.ApplyTemplate(ctx, "u2", "work")
	if err != nil {
		t.Fatalf("apply template: %v", err)
	}
	state, _ := service.GetState(ctx, "u2")
	confirmed := make([]ConfirmedItem, 0, len(state.Items))
	for _, item := range state.Items {
		confirmed = append(confirmed, ConfirmedItem{ID: item.ID, Name: item.Name})
	}
	completion, err := service.AddCompletion(ctx, "u2", CompletionInput{
		SceneID:       scene.ID,
		ConfirmedItem: confirmed,
	})
	if err != nil {
		t.Fatalf("add completion: %v", err)
	}
	if completion.ResultText != "今日出门检查完成，没有遗漏。" {
		t.Fatalf("unexpected result text: %s", completion.ResultText)
	}
	history, err := service.History(ctx, "u2")
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if history.Stats.Total != 1 || len(history.Records) != 1 {
		t.Fatalf("unexpected history: %+v", history)
	}
	if err := service.DeleteCompletion(ctx, "u2", completion.ID); err != nil {
		t.Fatalf("delete completion: %v", err)
	}
	history, _ = service.History(ctx, "u2")
	if history.Stats.Total != 0 {
		t.Fatalf("expected empty history, got %+v", history)
	}
}
