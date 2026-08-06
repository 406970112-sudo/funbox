package gooutchecklist

type ItemType string

const (
	ItemTypeItem   ItemType = "item"
	ItemTypeSafety ItemType = "safety"
)

type Item struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Icon           string   `json:"icon"`
	ItemType       ItemType `json:"itemType"`
	WeatherRuleIDs []string `json:"weatherRuleIds,omitempty"`
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`
}

type Scene struct {
	ID        string `json:"id"`
	UserID    string `json:"userId"`
	Name      string `json:"name"`
	Icon      string `json:"icon"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
}

type SceneItem struct {
	SceneID  string `json:"sceneId"`
	ItemID   string `json:"itemId"`
	Position int    `json:"position"`
}

type Schedule struct {
	ID         string `json:"id"`
	SceneID    string `json:"sceneId"`
	DaysOfWeek []int  `json:"daysOfWeek"`
	Time       string `json:"time"`
	Enabled    bool   `json:"enabled"`
}

type Settings struct {
	City                string  `json:"city"`
	Lat                 float64 `json:"lat"`
	Lon                 float64 `json:"lon"`
	Timezone            string  `json:"timezone"`
	WeatherEnabled      bool    `json:"weatherEnabled"`
	ActiveSceneID       string  `json:"activeSceneId"`
	NotificationEnabled bool    `json:"notificationEnabled"`
	UpdatedAt           int64   `json:"updatedAt"`
}

type SettingsPayload struct {
	Settings  Settings   `json:"settings"`
	Schedules []Schedule `json:"schedules"`
}

type ConfirmedItem struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Weather bool   `json:"weather"`
	Reason  string `json:"reason,omitempty"`
}

type WeatherSnapshot struct {
	Available      bool     `json:"available"`
	Status         string   `json:"status"`
	City           string   `json:"city,omitempty"`
	Temperature    *float64 `json:"temperature,omitempty"`
	FeelsLike      *float64 `json:"feelsLike,omitempty"`
	PrecipProb     *float64 `json:"precipProb,omitempty"`
	UVIndex        *float64 `json:"uvIndex,omitempty"`
	AQI            *float64 `json:"aqi,omitempty"`
	WeatherCode    *int     `json:"weatherCode,omitempty"`
	Source         string   `json:"source,omitempty"`
	FetchedAt      string   `json:"fetchedAt,omitempty"`
	License        string   `json:"license,omitempty"`
	RuleHits       []string `json:"ruleHits,omitempty"`
	UnavailableMsg string   `json:"unavailableMsg,omitempty"`
}

type Completion struct {
	ID             string          `json:"id"`
	SceneID        string          `json:"sceneId"`
	SceneName      string          `json:"sceneName"`
	CheckedAt      string          `json:"checkedAt"`
	ConfirmedItems []ConfirmedItem `json:"confirmedItems"`
	Weather        WeatherSnapshot `json:"weather"`
	ResultText     string          `json:"resultText"`
}

type State struct {
	SchemaVersion int          `json:"schemaVersion"`
	Items         []Item       `json:"items"`
	Scenes        []Scene      `json:"scenes"`
	SceneItems    []SceneItem  `json:"sceneItems"`
	Schedules     []Schedule   `json:"schedules"`
	Settings      Settings     `json:"settings"`
	Completions   []Completion `json:"completions"`
	UpdatedAt     int64        `json:"updatedAt"`
}

type HomeItem struct {
	Item
	Group         string `json:"group"`
	SceneID       string `json:"sceneId,omitempty"`
	WeatherRuleID string `json:"weatherRuleId,omitempty"`
	WeatherReason string `json:"weatherReason,omitempty"`
}

type HomeResponse struct {
	Items              []HomeItem          `json:"items"`
	Scenes             []Scene             `json:"scenes"`
	SceneItems         []SceneItem         `json:"sceneItems"`
	Schedules          []Schedule          `json:"schedules"`
	ActiveSceneID      string              `json:"activeSceneId"`
	ActiveScene        *Scene              `json:"activeScene,omitempty"`
	Weather            WeatherSnapshot     `json:"weather"`
	WeatherSuggestions []WeatherSuggestion `json:"weatherSuggestions"`
	Settings           Settings            `json:"settings"`
	ServerNow          string              `json:"serverNow"`
	UpdatedAt          int64               `json:"updatedAt"`
}

type WeatherSuggestion struct {
	RuleID string `json:"ruleId"`
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

type TemplateItem struct {
	Name           string   `json:"name"`
	Icon           string   `json:"icon"`
	WeatherRuleIDs []string `json:"weatherRuleIds,omitempty"`
}

type Template struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Icon  string         `json:"icon"`
	Items []TemplateItem `json:"items"`
}

type CompletionInput struct {
	SceneID       string          `json:"sceneId"`
	ConfirmedItem []ConfirmedItem `json:"confirmedItems"`
}

type ItemInput struct {
	Name           string   `json:"name"`
	Icon           string   `json:"icon"`
	ItemType       ItemType `json:"itemType"`
	WeatherRuleIDs []string `json:"weatherRuleIds,omitempty"`
}

type SceneInput struct {
	Name      string   `json:"name"`
	Icon      string   `json:"icon"`
	SortOrder int      `json:"sortOrder"`
	ItemIDs   []string `json:"itemIds,omitempty"`
}

type HistoryResponse struct {
	Records []Completion `json:"records"`
	Stats   HistoryStats `json:"stats"`
}

type HistoryStats struct {
	Today  int `json:"today"`
	Week   int `json:"week"`
	Streak int `json:"streak"`
	Total  int `json:"total"`
}

type HealthSource struct {
	Source        string `json:"source"`
	Status        string `json:"status"`
	LastFetchedAt string `json:"lastFetchedAt,omitempty"`
	Message       string `json:"message,omitempty"`
}

type HealthResponse struct {
	Status    string         `json:"status"`
	Sources   []HealthSource `json:"sources"`
	UpdatedAt string         `json:"updatedAt"`
}
