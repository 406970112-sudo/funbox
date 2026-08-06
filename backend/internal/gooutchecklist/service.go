package gooutchecklist

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	MaxItems        = 80
	MaxScenes       = 20
	MaxCompletions  = 200
	MaxItemNameLen  = 20
	MaxSceneNameLen = 20
	MaxIconLen      = 40
)

var (
	GroupEssential = "essential"
	GroupScene     = "scene"
	GroupWeather   = "weather"
	GroupSafety    = "safety"
)

var validWeatherRules = map[string]bool{
	"rain-umbrella": true,
	"uv-protect":    true,
	"heat-water":    true,
	"air-mask":      true,
}

var weatherRuleItemNames = map[string]string{
	"rain-umbrella": "雨伞",
	"uv-protect":    "防晒霜",
	"heat-water":    "水杯",
	"air-mask":      "口罩",
}

var weatherRuleLabels = map[string]string{
	"rain-umbrella": "降雨概率 >= 40% 或当前有雨",
	"uv-protect":    "当日最大 UV >= 6",
	"heat-water":    "当日最高温 >= 32°C",
	"air-mask":      "当前 EAQI > 100",
}

type Service struct {
	store    *Store
	provider Provider

	healthMu sync.Mutex
	health   map[string]HealthSource
}

func NewService(store *Store, provider Provider) *Service {
	return &Service{
		store:    store,
		provider: provider,
		health:   map[string]HealthSource{},
	}
}

func (s *Service) GetState(ctx context.Context, userID string) (State, error) {
	return s.store.GetState(ctx, userID)
}

func (s *Service) ClearData(ctx context.Context, userID string) error {
	return s.store.ClearState(ctx, userID)
}

func (s *Service) ListItems(ctx context.Context, userID string) ([]Item, error) {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return nil, err
	}
	return state.Items, nil
}

func (s *Service) CreateItem(ctx context.Context, userID string, input ItemInput) (Item, error) {
	item, err := normalizeItemInput(input)
	if err != nil {
		return Item{}, err
	}
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return Item{}, err
	}
	if len(state.Items) >= MaxItems {
		return Item{}, fmt.Errorf("%w: too many items", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	item.ID = uuid.NewString()
	item.CreatedAt = now
	item.UpdatedAt = now
	state.Items = append(state.Items, item)
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *Service) UpdateItem(ctx context.Context, userID, itemID string, input ItemInput) (Item, error) {
	item, err := normalizeItemInput(input)
	if err != nil {
		return Item{}, err
	}
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return Item{}, err
	}
	index := indexOfItem(state.Items, itemID)
	if index < 0 {
		return Item{}, fmt.Errorf("%w: item %s", ErrNotFound, itemID)
	}
	item.ID = state.Items[index].ID
	item.CreatedAt = state.Items[index].CreatedAt
	item.UpdatedAt = time.Now().UnixMilli()
	state.Items[index] = item
	// Keep scene links and schedule links valid after type changes.
	if item.ItemType != ItemTypeSafety {
		state.SceneItems = removeSceneItemsByItem(state.SceneItems, item.ID)
	}
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return Item{}, err
	}
	return item, nil
}

func (s *Service) DeleteItem(ctx context.Context, userID, itemID string) error {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return err
	}
	if indexOfItem(state.Items, itemID) < 0 {
		return fmt.Errorf("%w: item %s", ErrNotFound, itemID)
	}
	state.Items = removeItem(state.Items, itemID)
	state.SceneItems = removeSceneItemsByItem(state.SceneItems, itemID)
	_, err = s.store.SaveState(ctx, userID, state)
	return err
}

func (s *Service) ListScenes(ctx context.Context, userID string) ([]Scene, []SceneItem, error) {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	return state.Scenes, state.SceneItems, nil
}

func (s *Service) CreateScene(ctx context.Context, userID string, input SceneInput) (Scene, error) {
	scene, err := normalizeSceneInput(input)
	if err != nil {
		return Scene{}, err
	}
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return Scene{}, err
	}
	if len(state.Scenes) >= MaxScenes {
		return Scene{}, fmt.Errorf("%w: too many scenes", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	scene.ID = uuid.NewString()
	scene.UserID = userID
	scene.CreatedAt = now
	scene.UpdatedAt = now
	state.Scenes = append(state.Scenes, scene)
	state.SceneItems = appendSceneItems(state.SceneItems, scene.ID, input.ItemIDs)
	if state.Settings.ActiveSceneID == "" {
		state.Settings.ActiveSceneID = scene.ID
	}
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return Scene{}, err
	}
	return scene, nil
}

func (s *Service) UpdateScene(ctx context.Context, userID, sceneID string, input SceneInput) (Scene, error) {
	scene, err := normalizeSceneInput(input)
	if err != nil {
		return Scene{}, err
	}
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return Scene{}, err
	}
	index := indexOfScene(state.Scenes, sceneID)
	if index < 0 {
		return Scene{}, fmt.Errorf("%w: scene %s", ErrNotFound, sceneID)
	}
	scene.ID = sceneID
	scene.UserID = userID
	scene.CreatedAt = state.Scenes[index].CreatedAt
	scene.UpdatedAt = time.Now().UnixMilli()
	state.Scenes[index] = scene
	state.SceneItems = removeSceneItemsByScene(state.SceneItems, sceneID)
	state.SceneItems = appendSceneItems(state.SceneItems, sceneID, input.ItemIDs)
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return Scene{}, err
	}
	return scene, nil
}

func (s *Service) DeleteScene(ctx context.Context, userID, sceneID string) error {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return err
	}
	if indexOfScene(state.Scenes, sceneID) < 0 {
		return fmt.Errorf("%w: scene %s", ErrNotFound, sceneID)
	}
	state.Scenes = removeScene(state.Scenes, sceneID)
	state.SceneItems = removeSceneItemsByScene(state.SceneItems, sceneID)
	state.Schedules = removeSchedulesByScene(state.Schedules, sceneID)
	if state.Settings.ActiveSceneID == sceneID {
		state.Settings.ActiveSceneID = ""
	}
	_, err = s.store.SaveState(ctx, userID, state)
	return err
}

func (s *Service) Templates() []Template {
	return TemplateLibrary
}

func (s *Service) ApplyTemplate(ctx context.Context, userID, templateID string) (Scene, error) {
	template := findTemplate(templateID)
	if template == nil {
		return Scene{}, fmt.Errorf("%w: template not found", ErrNotFound)
	}
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return Scene{}, err
	}
	if len(state.Scenes) >= MaxScenes {
		return Scene{}, fmt.Errorf("%w: too many scenes", ErrInvalidInput)
	}
	now := time.Now().UnixMilli()
	scene := Scene{
		ID:        uuid.NewString(),
		UserID:    userID,
		Name:      template.Name,
		Icon:      template.Icon,
		SortOrder: len(state.Scenes),
		CreatedAt: now,
		UpdatedAt: now,
	}
	state.Scenes = append(state.Scenes, scene)
	for position, templateItem := range template.Items {
		item := findItemByName(state.Items, templateItem.Name)
		if item == nil {
			item = &Item{
				ID:             uuid.NewString(),
				Name:           templateItem.Name,
				Icon:           templateItem.Icon,
				ItemType:       ItemTypeItem,
				WeatherRuleIDs: normalizeRuleIDs(templateItem.WeatherRuleIDs),
				CreatedAt:      now,
				UpdatedAt:      now,
			}
			state.Items = append(state.Items, *item)
		}
		state.SceneItems = append(state.SceneItems, SceneItem{
			SceneID:  scene.ID,
			ItemID:   item.ID,
			Position: position,
		})
	}
	if state.Settings.ActiveSceneID == "" {
		state.Settings.ActiveSceneID = scene.ID
	}
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return Scene{}, err
	}
	return scene, nil
}

func (s *Service) GetSettings(ctx context.Context, userID string) (SettingsPayload, error) {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return SettingsPayload{}, err
	}
	return SettingsPayload{Settings: state.Settings, Schedules: state.Schedules}, nil
}

func (s *Service) SaveSettings(ctx context.Context, userID string, payload SettingsPayload) (SettingsPayload, error) {
	if err := validateSettings(payload.Settings); err != nil {
		return SettingsPayload{}, err
	}
	for _, schedule := range payload.Schedules {
		if err := validateSchedule(schedule); err != nil {
			return SettingsPayload{}, err
		}
	}
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return SettingsPayload{}, err
	}
	payload.Settings.UpdatedAt = time.Now().UnixMilli()
	state.Settings = payload.Settings
	state.Schedules = normalizeSchedules(payload.Schedules, state.Scenes)
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return SettingsPayload{}, err
	}
	return SettingsPayload{Settings: state.Settings, Schedules: state.Schedules}, nil
}

func (s *Service) Home(ctx context.Context, userID, sceneID string) (HomeResponse, error) {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return HomeResponse{}, err
	}
	activeID := resolveActiveScene(state, time.Now())
	if sceneID != "" {
		if indexOfScene(state.Scenes, sceneID) < 0 {
			return HomeResponse{}, fmt.Errorf("%w: scene %s", ErrNotFound, sceneID)
		}
		activeID = sceneID
	}
	if activeID == "" && len(state.Scenes) > 0 {
		activeID = state.Scenes[0].ID
	}
	if activeID != "" && state.Settings.ActiveSceneID != activeID {
		state.Settings.ActiveSceneID = activeID
		if _, err := s.store.SaveState(ctx, userID, state); err != nil {
			log.Printf("save go out checklist active scene failed: %v", err)
		}
	}
	weather := s.fetchWeather(ctx, state.Settings)
	items := buildHomeItems(state, activeID, weather)
	suggestions := buildWeatherSuggestions(state.Items, weather)
	var activeScene *Scene
	if activeID != "" {
		if scene := findScene(state.Scenes, activeID); scene != nil {
			copyScene := *scene
			activeScene = &copyScene
		}
	}
	return HomeResponse{
		Items:              items,
		Scenes:             state.Scenes,
		SceneItems:         state.SceneItems,
		Schedules:          state.Schedules,
		ActiveSceneID:      activeID,
		ActiveScene:        activeScene,
		Weather:            weather,
		WeatherSuggestions: suggestions,
		Settings:           state.Settings,
		ServerNow:          time.Now().UTC().Format(time.RFC3339),
		UpdatedAt:          state.UpdatedAt,
	}, nil
}

func (s *Service) AddCompletion(ctx context.Context, userID string, input CompletionInput) (Completion, error) {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return Completion{}, err
	}
	if len(input.ConfirmedItem) == 0 {
		return Completion{}, fmt.Errorf("%w: confirmed items required", ErrInvalidInput)
	}
	confirmed := make([]ConfirmedItem, 0, len(input.ConfirmedItem))
	seen := map[string]bool{}
	for _, item := range input.ConfirmedItem {
		id := strings.TrimSpace(item.ID)
		name := strings.TrimSpace(item.Name)
		if id == "" || name == "" || seen[id] {
			return Completion{}, fmt.Errorf("%w: invalid confirmed item", ErrInvalidInput)
		}
		if findItem(state.Items, id) == nil {
			return Completion{}, fmt.Errorf("%w: item does not exist", ErrInvalidInput)
		}
		seen[id] = true
		confirmed = append(confirmed, ConfirmedItem{
			ID:      id,
			Name:    name,
			Weather: item.Weather,
			Reason:  strings.TrimSpace(item.Reason),
		})
	}
	sceneName := "未设置场景"
	if scene := findScene(state.Scenes, input.SceneID); scene != nil {
		sceneName = scene.Name
	}
	completion := Completion{
		ID:             uuid.NewString(),
		SceneID:        strings.TrimSpace(input.SceneID),
		SceneName:      sceneName,
		CheckedAt:      time.Now().UTC().Format(time.RFC3339),
		ConfirmedItems: confirmed,
		Weather:        s.fetchWeather(ctx, state.Settings),
		ResultText:     "今日出门检查完成，没有遗漏。",
	}
	state.Completions = append([]Completion{completion}, state.Completions...)
	if len(state.Completions) > MaxCompletions {
		state.Completions = state.Completions[:MaxCompletions]
	}
	if _, err := s.store.SaveState(ctx, userID, state); err != nil {
		return Completion{}, err
	}
	return completion, nil
}

func (s *Service) DeleteCompletion(ctx context.Context, userID, id string) error {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return err
	}
	for index, item := range state.Completions {
		if item.ID == id {
			state.Completions = append(state.Completions[:index], state.Completions[index+1:]...)
			_, err := s.store.SaveState(ctx, userID, state)
			return err
		}
	}
	return fmt.Errorf("%w: completion %s", ErrNotFound, id)
}

func (s *Service) History(ctx context.Context, userID string) (HistoryResponse, error) {
	state, err := s.store.GetState(ctx, userID)
	if err != nil {
		return HistoryResponse{}, err
	}
	records := append([]Completion(nil), state.Completions...)
	sort.Slice(records, func(i, j int) bool {
		return records[i].CheckedAt > records[j].CheckedAt
	})
	stats := buildHistoryStats(records, state.Settings)
	return HistoryResponse{Records: records, Stats: stats}, nil
}

func (s *Service) WeatherHealth(ctx context.Context) HealthResponse {
	s.healthMu.Lock()
	sources := make([]HealthSource, 0, len(s.health))
	for _, item := range s.health {
		sources = append(sources, item)
	}
	s.healthMu.Unlock()
	sort.Slice(sources, func(i, j int) bool {
		return sources[i].Source < sources[j].Source
	})
	status := "ok"
	for _, item := range sources {
		if item.Status != "ok" {
			status = "partial"
			break
		}
	}
	if len(sources) == 0 {
		status = "unavailable"
		sources = []HealthSource{
			{Source: "Open-Meteo Forecast", Status: "unknown"},
			{Source: "Open-Meteo Air Quality", Status: "unknown"},
		}
	}
	return HealthResponse{
		Status:    status,
		Sources:   sources,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func (s *Service) SearchCities(ctx context.Context, query string) ([]CityResult, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("%w: weather provider unavailable", ErrInvalidInput)
	}
	return s.provider.SearchCities(ctx, query)
}

func (s *Service) fetchWeather(ctx context.Context, settings Settings) WeatherSnapshot {
	if !settings.WeatherEnabled {
		return WeatherSnapshot{Available: false, Status: "unavailable", UnavailableMsg: "天气联动未开启"}
	}
	if strings.TrimSpace(settings.City) == "" || settings.Lat == 0 || settings.Lon == 0 {
		return WeatherSnapshot{Available: false, Status: "unavailable", UnavailableMsg: "请先选择城市"}
	}
	date := localDateString(settings.Timezone, time.Now())
	key := weatherCacheKey(date, settings.Lat, settings.Lon)
	if cached, at, err := s.store.GetWeatherCache(ctx, key); err == nil && cached.Available {
		cached.FetchedAt = at.UTC().Format(time.RFC3339)
		return cached
	}
	if s.provider == nil {
		return WeatherSnapshot{Available: false, Status: "unavailable", UnavailableMsg: "天气服务暂不可用"}
	}
	weather, weatherErr := s.provider.FetchWeather(ctx, settings.Lat, settings.Lon, date)
	air, airErr := s.provider.FetchAirQuality(ctx, settings.Lat, settings.Lon)
	s.setHealth("Open-Meteo Forecast", weatherErr == nil && weather.Daily != nil, weatherErr)
	s.setHealth("Open-Meteo Air Quality", airErr == nil && air.EAQI != nil, airErr)
	snapshot := buildWeatherSnapshot(settings.City, weather, air, weatherErr, airErr)
	if snapshot.Available {
		if err := s.store.SaveWeatherCache(ctx, key, snapshot); err != nil {
			log.Printf("save go out checklist weather cache failed: %v", err)
		}
	}
	return snapshot
}

func (s *Service) setHealth(source string, ok bool, err error) {
	item := HealthSource{Source: source, Status: "ok", LastFetchedAt: time.Now().UTC().Format(time.RFC3339)}
	if !ok {
		item.Status = "error"
		if err != nil {
			item.Message = err.Error()
		}
	}
	s.healthMu.Lock()
	s.health[source] = item
	s.healthMu.Unlock()
}

func normalizeItemInput(input ItemInput) (Item, error) {
	item := Item{
		Name:           strings.TrimSpace(input.Name),
		Icon:           strings.TrimSpace(input.Icon),
		ItemType:       input.ItemType,
		WeatherRuleIDs: normalizeRuleIDs(input.WeatherRuleIDs),
	}
	if item.Name == "" || len([]rune(item.Name)) > MaxItemNameLen {
		return Item{}, fmt.Errorf("%w: invalid item name", ErrInvalidInput)
	}
	if item.Icon == "" || len(item.Icon) > MaxIconLen {
		item.Icon = "package-variant"
	}
	if item.ItemType != ItemTypeItem && item.ItemType != ItemTypeSafety {
		return Item{}, fmt.Errorf("%w: invalid item type", ErrInvalidInput)
	}
	return item, nil
}

func normalizeSceneInput(input SceneInput) (Scene, error) {
	scene := Scene{
		Name:      strings.TrimSpace(input.Name),
		Icon:      strings.TrimSpace(input.Icon),
		SortOrder: input.SortOrder,
	}
	if scene.Name == "" || len([]rune(scene.Name)) > MaxSceneNameLen {
		return Scene{}, fmt.Errorf("%w: invalid scene name", ErrInvalidInput)
	}
	if scene.Icon == "" || len(scene.Icon) > MaxIconLen {
		scene.Icon = "briefcase"
	}
	if scene.SortOrder < 0 {
		return Scene{}, fmt.Errorf("%w: invalid sort order", ErrInvalidInput)
	}
	return scene, nil
}

func validateSettings(settings Settings) error {
	if settings.City != "" {
		if settings.Lat < -90 || settings.Lat > 90 || settings.Lon < -180 || settings.Lon > 180 {
			return fmt.Errorf("%w: invalid coordinates", ErrInvalidInput)
		}
	}
	if settings.Timezone == "" {
		settings.Timezone = "Asia/Shanghai"
	}
	return nil
}

func validateSchedule(schedule Schedule) error {
	if strings.TrimSpace(schedule.SceneID) == "" || strings.TrimSpace(schedule.Time) == "" {
		return fmt.Errorf("%w: schedule requires scene and time", ErrInvalidInput)
	}
	parts := strings.Split(schedule.Time, ":")
	if len(parts) != 2 {
		return fmt.Errorf("%w: schedule time must be HH:MM", ErrInvalidInput)
	}
	hour, hourErr := strconv.Atoi(parts[0])
	minute, minuteErr := strconv.Atoi(parts[1])
	if hourErr != nil || minuteErr != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return fmt.Errorf("%w: schedule time must be HH:MM", ErrInvalidInput)
	}
	seen := map[int]bool{}
	for _, day := range schedule.DaysOfWeek {
		if day < 0 || day > 6 || seen[day] {
			return fmt.Errorf("%w: invalid schedule days", ErrInvalidInput)
		}
		seen[day] = true
	}
	return nil
}

func normalizeRuleIDs(ids []string) []string {
	result := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if !validWeatherRules[id] || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func normalizeSchedules(schedules []Schedule, scenes []Scene) []Schedule {
	sceneIDs := map[string]bool{}
	for _, scene := range scenes {
		sceneIDs[scene.ID] = true
	}
	result := make([]Schedule, 0, len(schedules))
	seen := map[string]bool{}
	for _, schedule := range schedules {
		if !sceneIDs[schedule.SceneID] || seen[schedule.SceneID] {
			continue
		}
		if validateSchedule(schedule) != nil {
			continue
		}
		if schedule.ID == "" {
			schedule.ID = uuid.NewString()
		}
		seen[schedule.SceneID] = true
		result = append(result, schedule)
	}
	return result
}

func resolveActiveScene(state State, now time.Time) string {
	location, err := time.LoadLocation(state.Settings.Timezone)
	if err != nil || state.Settings.Timezone == "" {
		location = time.FixedZone("CST", 8*3600)
	}
	local := now.In(location)
	currentMinutes := local.Hour()*60 + local.Minute()
	weekday := int(local.Weekday())
	var bestScene string
	bestMinutes := -1
	for _, schedule := range state.Schedules {
		if !schedule.Enabled {
			continue
		}
		contains := false
		for _, day := range schedule.DaysOfWeek {
			if day == weekday {
				contains = true
				break
			}
		}
		if !contains {
			continue
		}
		minutes := scheduleMinutes(schedule.Time)
		if minutes >= 0 && minutes <= currentMinutes && minutes > bestMinutes {
			bestScene = schedule.SceneID
			bestMinutes = minutes
		}
	}
	if bestScene != "" && findScene(state.Scenes, bestScene) != nil {
		return bestScene
	}
	if findScene(state.Scenes, state.Settings.ActiveSceneID) != nil {
		return state.Settings.ActiveSceneID
	}
	return ""
}

func scheduleMinutes(value string) int {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return -1
	}
	hour, hourErr := strconv.Atoi(parts[0])
	minute, minuteErr := strconv.Atoi(parts[1])
	if hourErr != nil || minuteErr != nil {
		return -1
	}
	return hour*60 + minute
}

func buildHomeItems(state State, activeSceneID string, weather WeatherSnapshot) []HomeItem {
	sceneItems := map[string]bool{}
	for _, link := range state.SceneItems {
		if link.SceneID == activeSceneID {
			sceneItems[link.ItemID] = true
		}
	}
	items := make([]HomeItem, 0, len(state.Items))
	for _, item := range state.Items {
		homeItem := HomeItem{Item: item}
		ruleHit := matchingWeatherRule(item, weather)
		if item.ItemType == ItemTypeSafety {
			homeItem.Group = GroupSafety
		} else if ruleHit != "" {
			homeItem.Group = GroupWeather
			homeItem.WeatherRuleID = ruleHit
			homeItem.WeatherReason = weatherRuleReason(ruleHit, weather)
		} else if sceneItems[item.ID] {
			homeItem.Group = GroupScene
			homeItem.SceneID = activeSceneID
		} else {
			homeItem.Group = GroupEssential
		}
		items = append(items, homeItem)
	}
	groupOrder := map[string]int{
		GroupEssential: 0,
		GroupScene:     1,
		GroupWeather:   2,
		GroupSafety:    3,
	}
	sort.SliceStable(items, func(i, j int) bool {
		gi := groupOrder[items[i].Group]
		gj := groupOrder[items[j].Group]
		if gi != gj {
			return gi < gj
		}
		return items[i].CreatedAt < items[j].CreatedAt
	})
	return items
}

func matchingWeatherRule(item Item, weather WeatherSnapshot) string {
	if !weather.Available {
		return ""
	}
	for _, rule := range item.WeatherRuleIDs {
		if weatherRuleHits(rule, weather) {
			return rule
		}
	}
	return ""
}

func weatherRuleHits(rule string, weather WeatherSnapshot) bool {
	switch rule {
	case "rain-umbrella":
		return weather.PrecipProb != nil && *weather.PrecipProb >= 40
	case "uv-protect":
		return weather.UVIndex != nil && *weather.UVIndex >= 6
	case "heat-water":
		return weather.Temperature != nil && *weather.Temperature >= 32
	case "air-mask":
		return weather.AQI != nil && *weather.AQI > 100
	default:
		return false
	}
}

func weatherRuleReason(rule string, weather WeatherSnapshot) string {
	label := weatherRuleLabels[rule]
	if weather.Available {
		switch rule {
		case "rain-umbrella":
			if weather.PrecipProb != nil {
				return fmt.Sprintf("%s · 当前 %.0f%%", label, *weather.PrecipProb)
			}
		case "uv-protect":
			if weather.UVIndex != nil {
				return fmt.Sprintf("%s · 当前 %.1f", label, *weather.UVIndex)
			}
		case "heat-water":
			if weather.Temperature != nil {
				return fmt.Sprintf("%s · 当前 %.1f°C", label, *weather.Temperature)
			}
		case "air-mask":
			if weather.AQI != nil {
				return fmt.Sprintf("%s · 当前 %.0f", label, *weather.AQI)
			}
		}
	}
	return label
}

func buildWeatherSuggestions(items []Item, weather WeatherSnapshot) []WeatherSuggestion {
	if !weather.Available {
		return []WeatherSuggestion{}
	}
	existing := map[string]bool{}
	for _, item := range items {
		for _, rule := range item.WeatherRuleIDs {
			existing[rule] = true
		}
	}
	suggestions := []WeatherSuggestion{}
	for rule, name := range weatherRuleItemNames {
		if !weatherRuleHits(rule, weather) || existing[rule] {
			continue
		}
		suggestions = append(suggestions, WeatherSuggestion{
			RuleID: rule,
			Name:   name,
			Reason: weatherRuleReason(rule, weather),
		})
	}
	sort.Slice(suggestions, func(i, j int) bool {
		return suggestions[i].RuleID < suggestions[j].RuleID
	})
	return suggestions
}

func buildWeatherSnapshot(city string, weather WeatherData, air AirQualityData, weatherErr, airErr error) WeatherSnapshot {
	snapshot := WeatherSnapshot{
		Available: weather.Daily != nil || air.EAQI != nil,
		Status:    "complete",
		City:      city,
		Source:    "Open-Meteo",
		License:   "cc-by-4.0",
	}
	if weather.Daily != nil {
		snapshot.Temperature = weather.Daily.TemperatureMax
		snapshot.PrecipProb = weather.Daily.PrecipitationProb
		snapshot.UVIndex = weather.Daily.UVIndex
		snapshot.WeatherCode = weather.Daily.WeatherCode
	}
	if weather.Current != nil {
		snapshot.FeelsLike = weather.Current.ApparentTemperature
	}
	if air.EAQI != nil {
		snapshot.AQI = air.EAQI
	}
	if weatherErr != nil || airErr != nil {
		snapshot.Status = "partial"
		snapshot.UnavailableMsg = "天气数据部分不可用"
	}
	if snapshot.Available {
		if weather.Daily != nil {
			snapshot.FetchedAt = weather.FetchedAt.UTC().Format(time.RFC3339)
		} else {
			snapshot.FetchedAt = air.FetchedAt.UTC().Format(time.RFC3339)
		}
	}
	if !snapshot.Available {
		snapshot.Status = "unavailable"
		snapshot.UnavailableMsg = "天气暂未获取"
	}
	return snapshot
}

func buildHistoryStats(records []Completion, settings Settings) HistoryStats {
	location, err := time.LoadLocation(settings.Timezone)
	if err != nil || settings.Timezone == "" {
		location = time.FixedZone("CST", 8*3600)
	}
	now := time.Now().In(location)
	todayKey := now.Format("2006-01-02")
	weekStart := now
	for weekStart.Weekday() != time.Monday {
		weekStart = weekStart.AddDate(0, 0, -1)
	}
	weekKey := weekStart.Format("2006-01-02")
	seenDays := map[string]bool{}
	today := 0
	week := 0
	for _, record := range records {
		parsed, parseErr := time.Parse(time.RFC3339, record.CheckedAt)
		if parseErr != nil {
			continue
		}
		local := parsed.In(location)
		key := local.Format("2006-01-02")
		seenDays[key] = true
		if key == todayKey {
			today++
		}
		if key >= weekKey && local.After(weekStart.Add(-time.Second)) {
			week++
		}
	}
	streak := 0
	day := now
	if !seenDays[day.Format("2006-01-02")] {
		day = day.AddDate(0, 0, -1)
	}
	for seenDays[day.Format("2006-01-02")] {
		streak++
		day = day.AddDate(0, 0, -1)
	}
	return HistoryStats{
		Today:  today,
		Week:   week,
		Streak: streak,
		Total:  len(records),
	}
}

func localDateString(timezone string, now time.Time) string {
	location, err := time.LoadLocation(timezone)
	if err != nil || timezone == "" {
		location = time.FixedZone("CST", 8*3600)
	}
	return now.In(location).Format("2006-01-02")
}

func weatherCacheKey(date string, lat, lon float64) string {
	latKey := strconv.FormatFloat(math.Round(lat*100)/100, 'f', -1, 64)
	lonKey := strconv.FormatFloat(math.Round(lon*100)/100, 'f', -1, 64)
	return date + "|" + latKey + "|" + lonKey
}

func indexOfItem(items []Item, id string) int {
	for index, item := range items {
		if item.ID == id {
			return index
		}
	}
	return -1
}

func indexOfScene(scenes []Scene, id string) int {
	for index, scene := range scenes {
		if scene.ID == id {
			return index
		}
	}
	return -1
}

func findItem(items []Item, id string) *Item {
	if index := indexOfItem(items, id); index >= 0 {
		return &items[index]
	}
	return nil
}

func findScene(scenes []Scene, id string) *Scene {
	if index := indexOfScene(scenes, id); index >= 0 {
		return &scenes[index]
	}
	return nil
}

func findItemByName(items []Item, name string) *Item {
	for index := range items {
		if items[index].Name == name {
			return &items[index]
		}
	}
	return nil
}

func removeItem(items []Item, id string) []Item {
	result := make([]Item, 0, len(items))
	for _, item := range items {
		if item.ID != id {
			result = append(result, item)
		}
	}
	return result
}

func removeScene(scenes []Scene, id string) []Scene {
	result := make([]Scene, 0, len(scenes))
	for _, scene := range scenes {
		if scene.ID != id {
			result = append(result, scene)
		}
	}
	return result
}

func appendSceneItems(sceneItems []SceneItem, sceneID string, itemIDs []string) []SceneItem {
	for position, itemID := range itemIDs {
		itemID = strings.TrimSpace(itemID)
		if itemID == "" {
			continue
		}
		sceneItems = append(sceneItems, SceneItem{
			SceneID:  sceneID,
			ItemID:   itemID,
			Position: position,
		})
	}
	return sceneItems
}

func removeSceneItemsByItem(sceneItems []SceneItem, itemID string) []SceneItem {
	result := make([]SceneItem, 0, len(sceneItems))
	for _, link := range sceneItems {
		if link.ItemID != itemID {
			result = append(result, link)
		}
	}
	return result
}

func removeSceneItemsByScene(sceneItems []SceneItem, sceneID string) []SceneItem {
	result := make([]SceneItem, 0, len(sceneItems))
	for _, link := range sceneItems {
		if link.SceneID != sceneID {
			result = append(result, link)
		}
	}
	return result
}

func removeSchedulesByScene(schedules []Schedule, sceneID string) []Schedule {
	result := make([]Schedule, 0, len(schedules))
	for _, schedule := range schedules {
		if schedule.SceneID != sceneID {
			result = append(result, schedule)
		}
	}
	return result
}
