package dailylucksign

import "time"

type Location struct {
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	Source string  `json:"source"`
}

type Color struct {
	Hex       string `json:"hex"`
	Name      string `json:"name"`
	RuleID    string `json:"ruleId"`
	Rationale string `json:"rationale"`
}

type Fact struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Value     any    `json:"value"`
	Unit      string `json:"unit,omitempty"`
	Source    string `json:"source"`
	FetchedAt string `json:"fetchedAt"`
	License   string `json:"license"`
}

type Suggestion struct {
	ID       string   `json:"id"`
	Category string   `json:"category"`
	Title    string   `json:"title"`
	Reason   string   `json:"reason"`
	RuleID   string   `json:"ruleId"`
	Sources  []string `json:"sources"`
}

type Response struct {
	Date        string       `json:"date"`
	Timezone    string       `json:"timezone"`
	Status      string       `json:"status"`
	Location    Location     `json:"location"`
	Color       Color        `json:"color"`
	Facts       []Fact       `json:"facts"`
	Suggestions []Suggestion `json:"suggestions"`
	GeneratedAt string       `json:"generatedAt"`
	CachedAt    string       `json:"cachedAt,omitempty"`
}

type Completion struct {
	ID          string `json:"id"`
	Date        string `json:"date"`
	RuleID      string `json:"ruleId"`
	Title       string `json:"title"`
	CompletedAt string `json:"completedAt"`
}

type Settings struct {
	City      string  `json:"city"`
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Source    string  `json:"source"`
	UpdatedAt int64   `json:"updatedAt"`
}

type CityResult struct {
	Name    string  `json:"name"`
	Country string  `json:"country"`
	Admin1  string  `json:"admin1,omitempty"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
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

type WeatherData struct {
	Date      string
	Timezone  string
	Current   *CurrentWeather
	Daily     *DailyWeather
	FetchedAt time.Time
}

type CurrentWeather struct {
	Time                string
	Temperature         *float64
	Humidity            *float64
	ApparentTemperature *float64
	WeatherCode         *int
	WindSpeed           *float64
}

type DailyWeather struct {
	WeatherCode       *int
	TemperatureMax    *float64
	TemperatureMin    *float64
	PrecipitationProb *float64
	UVIndex           *float64
	Sunrise           *string
	Sunset            *string
	DaylightSeconds   *float64
	WindSpeedMax      *float64
}

type AirQualityData struct {
	Time      string
	EAQI      *float64
	PM25      *float64
	PM10      *float64
	Ozone     *float64
	FetchedAt time.Time
}

type CalendarData struct {
	LunarDate         string
	SolarTerm         string
	NextSolarTerm     string
	NextSolarTermDate string
	HolidayName       string
	IsWorkday         bool
	Weekday           int
	FetchedAt         time.Time
}
