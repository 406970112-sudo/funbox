package dailylucksign

import (
	"context"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/6tail/lunar-go/HolidayUtil"
	"github.com/6tail/lunar-go/calendar"
)

const (
	StatusComplete    = "complete"
	StatusPartial     = "partial"
	StatusUnavailable = "unavailable"

	CategorySmallThing    = "small-thing"
	CategoryChallenge     = "challenge"
	CategoryEncouragement = "encouragement"

	sourceWeather  = "Open-Meteo Forecast"
	sourceAir      = "Open-Meteo Air Quality"
	sourceCalendar = "lunar-go 农历节气"
	sourceHoliday  = "lunar-go 节假日表"
	sourceLocation = "FunBox 位置设置"
)

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

func (s *Service) GetSign(ctx context.Context, date string, loc Location) (Response, error) {
	loc.Name = strings.TrimSpace(loc.Name)
	if loc.Name == "" {
		loc.Name = "当前位置"
	}
	if loc.Lat < -90 || loc.Lat > 90 || loc.Lon < -180 || loc.Lon > 180 {
		return Response{}, fmt.Errorf("%w: invalid coordinates", ErrInvalidInput)
	}
	if loc.Source != "manual" && loc.Source != "system-location" {
		loc.Source = "manual"
	}
	parsed, err := parseDate(date)
	if err != nil {
		return Response{}, err
	}
	date = parsed.Format("2006-01-02")
	key := cacheKey(date, loc.Lat, loc.Lon)
	if cached, at, err := s.store.GetCache(ctx, key); err == nil && cached.Date == date {
		cached.CachedAt = at.Format(time.RFC3339)
		return cached, nil
	}

	weather, weatherErr := s.provider.FetchWeather(ctx, loc.Lat, loc.Lon, date)
	air, airErr := s.provider.FetchAirQuality(ctx, loc.Lat, loc.Lon)
	cal := buildCalendarData(date)
	weatherOK := weatherErr == nil && weather.Daily != nil
	airOK := airErr == nil && air.EAQI != nil

	s.setHealth(sourceWeather, weatherOK, weatherErr)
	s.setHealth(sourceAir, airOK, airErr)
	s.setHealth(sourceCalendar, true, nil)
	s.setHealth(sourceHoliday, true, nil)

	response := Response{
		Date:        date,
		Timezone:    weather.Timezone,
		Status:      StatusUnavailable,
		Location:    loc,
		Facts:       buildFacts(weather, air, cal, loc),
		Suggestions: buildSuggestions(weather, air, cal),
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if response.Timezone == "" {
		response.Timezone = "Asia/Shanghai"
	}
	if weatherOK || airOK {
		response.Status = StatusComplete
	}
	if weatherErr != nil || airErr != nil {
		response.Status = StatusPartial
	}
	response.Color = buildColor(weather, air, cal)
	if !weatherOK && !airOK {
		response.Status = StatusUnavailable
		response.Color = Color{}
		response.Suggestions = []Suggestion{}
	}
	if response.Facts == nil {
		response.Facts = []Fact{}
	}
	if response.Suggestions == nil {
		response.Suggestions = []Suggestion{}
	}
	if weatherOK || airOK {
		if err := s.store.SaveCache(ctx, key, response); err != nil {
			log.Printf("save daily luck sign cache failed: %v", err)
		}
	}
	return response, nil
}

func (s *Service) SearchCities(ctx context.Context, query string) ([]CityResult, error) {
	return s.provider.SearchCities(ctx, query)
}

func (s *Service) Health(ctx context.Context) HealthResponse {
	s.healthMu.Lock()
	sources := make([]HealthSource, 0, len(s.health))
	for _, item := range s.health {
		sources = append(sources, item)
	}
	s.healthMu.Unlock()
	status := StatusComplete
	for _, item := range sources {
		if item.Status != "ok" {
			status = StatusPartial
			break
		}
	}
	if len(sources) == 0 {
		status = StatusUnavailable
		sources = []HealthSource{
			{Source: sourceWeather, Status: "unknown"},
			{Source: sourceAir, Status: "unknown"},
			{Source: sourceCalendar, Status: "ok"},
			{Source: sourceHoliday, Status: "ok"},
		}
	}
	return HealthResponse{
		Status:    status,
		Sources:   sources,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

func (s *Service) ListCompletions(ctx context.Context, userID string) ([]Completion, error) {
	return s.store.ListCompletions(ctx, userID)
}

func (s *Service) AddCompletion(ctx context.Context, userID string, item Completion) (Completion, error) {
	return s.store.AddCompletion(ctx, userID, item)
}

func (s *Service) DeleteCompletion(ctx context.Context, userID, id string) error {
	return s.store.DeleteCompletion(ctx, userID, id)
}

func (s *Service) GetSettings(ctx context.Context, userID string) (Settings, error) {
	return s.store.GetSettings(ctx, userID)
}

func (s *Service) SaveSettings(ctx context.Context, userID string, settings Settings) (Settings, error) {
	return s.store.SaveSettings(ctx, userID, settings)
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

func parseDate(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		loc, err := time.LoadLocation("Asia/Shanghai")
		if err != nil {
			loc = time.FixedZone("CST", 8*3600)
		}
		return time.Now().In(loc), nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: date must be YYYY-MM-DD", ErrInvalidInput)
	}
	return parsed, nil
}

func cacheKey(date string, lat, lon float64) string {
	latKey := strconv.FormatFloat(math.Round(lat*100)/100, 'f', -1, 64)
	lonKey := strconv.FormatFloat(math.Round(lon*100)/100, 'f', -1, 64)
	return date + "|" + latKey + "|" + lonKey
}

func buildCalendarData(date string) CalendarData {
	parsed, _ := time.Parse("2006-01-02", date)
	solar := calendar.NewSolarFromYmd(parsed.Year(), int(parsed.Month()), parsed.Day())
	lunar := solar.GetLunar()
	data := CalendarData{
		LunarDate: strings.TrimSpace(lunar.GetMonthInChinese()) + "月" + strings.TrimSpace(lunar.GetDayInChinese()),
		SolarTerm: strings.TrimSpace(lunar.GetJieQi()),
		Weekday:   int(parsed.Weekday()),
		FetchedAt: time.Now().UTC(),
	}
	if next := lunar.GetNextJieQi(); next != nil {
		data.NextSolarTerm = next.GetName()
		data.NextSolarTermDate = next.GetSolar().ToYmd()
	}
	if data.SolarTerm == "" && data.NextSolarTermDate == date {
		data.SolarTerm = data.NextSolarTerm
	}
	if holiday := HolidayUtil.GetHoliday(date); holiday != nil {
		if holiday.IsWork() {
			data.HolidayName = "调休工作日"
			data.IsWorkday = true
		} else {
			data.HolidayName = holiday.GetName()
		}
	}
	return data
}

func buildFacts(weather WeatherData, air AirQualityData, cal CalendarData, loc Location) []Fact {
	facts := make([]Fact, 0, 16)
	weatherAt := weather.FetchedAt.UTC().Format(time.RFC3339)
	airAt := air.FetchedAt.UTC().Format(time.RFC3339)
	calAt := cal.FetchedAt.UTC().Format(time.RFC3339)
	facts = append(facts,
		Fact{Key: "city", Label: "城市", Value: loc.Name, Source: sourceLocation, FetchedAt: calAt, License: "user-data"},
		Fact{Key: "lunar", Label: "农历", Value: cal.LunarDate, Source: sourceCalendar, FetchedAt: calAt, License: "mit"},
	)
	if cal.SolarTerm != "" {
		facts = append(facts, Fact{Key: "solar-term", Label: "今日节气", Value: cal.SolarTerm, Source: sourceCalendar, FetchedAt: calAt, License: "mit"})
	}
	if cal.NextSolarTerm != "" && cal.NextSolarTermDate != "" {
		facts = append(facts, Fact{Key: "next-solar-term", Label: "下一个节气", Value: cal.NextSolarTerm, Unit: cal.NextSolarTermDate, Source: sourceCalendar, FetchedAt: calAt, License: "mit"})
	}
	if cal.HolidayName != "" {
		facts = append(facts, Fact{Key: "holiday", Label: "节假日", Value: cal.HolidayName, Source: sourceHoliday, FetchedAt: calAt, License: "mit"})
	}
	if weather.Daily != nil {
		if weather.Daily.TemperatureMax != nil {
			facts = append(facts, Fact{Key: "temp-max", Label: "最高气温", Value: round1(*weather.Daily.TemperatureMax), Unit: "°C", Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Daily.TemperatureMin != nil {
			facts = append(facts, Fact{Key: "temp-min", Label: "最低气温", Value: round1(*weather.Daily.TemperatureMin), Unit: "°C", Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Daily.PrecipitationProb != nil {
			facts = append(facts, Fact{Key: "precip-prob", Label: "降雨概率", Value: round0(*weather.Daily.PrecipitationProb), Unit: "%", Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Daily.UVIndex != nil {
			facts = append(facts, Fact{Key: "uv-index", Label: "最大 UV", Value: round1(*weather.Daily.UVIndex), Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Daily.Sunrise != nil {
			facts = append(facts, Fact{Key: "sunrise", Label: "日出", Value: shortTime(*weather.Daily.Sunrise), Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Daily.Sunset != nil {
			facts = append(facts, Fact{Key: "sunset", Label: "日落", Value: shortTime(*weather.Daily.Sunset), Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Daily.DaylightSeconds != nil {
			facts = append(facts, Fact{Key: "daylight", Label: "白天时长", Value: formatDuration(*weather.Daily.DaylightSeconds), Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
	}
	if weather.Current != nil {
		if weather.Current.Temperature != nil {
			facts = append(facts, Fact{Key: "temp-now", Label: "当前气温", Value: round1(*weather.Current.Temperature), Unit: "°C", Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
		if weather.Current.Humidity != nil {
			facts = append(facts, Fact{Key: "humidity", Label: "相对湿度", Value: round0(*weather.Current.Humidity), Unit: "%", Source: sourceWeather, FetchedAt: weatherAt, License: "cc-by-4.0"})
		}
	}
	if air.EAQI != nil {
		facts = append(facts, Fact{Key: "aqi", Label: "EAQI", Value: round0(*air.EAQI), Unit: "EAQI", Source: sourceAir, FetchedAt: airAt, License: "cc-by-4.0"})
	}
	if air.PM25 != nil {
		facts = append(facts, Fact{Key: "pm25", Label: "PM2.5", Value: round1(*air.PM25), Unit: "μg/m³", Source: sourceAir, FetchedAt: airAt, License: "cc-by-4.0"})
	}
	if air.PM10 != nil {
		facts = append(facts, Fact{Key: "pm10", Label: "PM10", Value: round1(*air.PM10), Unit: "μg/m³", Source: sourceAir, FetchedAt: airAt, License: "cc-by-4.0"})
	}
	if air.Ozone != nil {
		facts = append(facts, Fact{Key: "ozone", Label: "臭氧", Value: round1(*air.Ozone), Unit: "μg/m³", Source: sourceAir, FetchedAt: airAt, License: "cc-by-4.0"})
	}
	return facts
}

func buildColor(weather WeatherData, air AirQualityData, cal CalendarData) Color {
	aqiOK := air.EAQI != nil
	aqi := 0.0
	if aqiOK {
		aqi = *air.EAQI
	}
	if aqiOK && aqi > 100 {
		return Color{Hex: "#e59a3a", Name: "透氧橙", RuleID: "color-aqi-high", Rationale: fmt.Sprintf("AQI %s，空气偏重，使用透氧橙提醒防护", round0(aqi))}
	}
	if weather.Daily != nil {
		code := 0
		if weather.Daily.WeatherCode != nil {
			code = *weather.Daily.WeatherCode
		}
		precip := 0.0
		if weather.Daily.PrecipitationProb != nil {
			precip = *weather.Daily.PrecipitationProb
		}
		if code >= 71 && code <= 77 {
			return Color{Hex: "#e6f1ff", Name: "初雪白", RuleID: "color-snow", Rationale: "今日有降雪，使用初雪白作为视觉灵感"}
		}
		if precip >= 40 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) {
			extra := ""
			if aqiOK {
				extra = fmt.Sprintf("，AQI %s 优", round0(aqi))
			}
			return Color{Hex: "#2f9b8f", Name: "雨雾青", RuleID: "color-rain", Rationale: fmt.Sprintf("今日降雨概率 %s%%%s", round0(precip), extra)}
		}
		uv := 0.0
		if weather.Daily.UVIndex != nil {
			uv = *weather.Daily.UVIndex
		}
		if (code == 0 || code == 1) && uv >= 6 {
			return Color{Hex: "#4b8bff", Name: "晴空蓝", RuleID: "color-clear-uv", Rationale: fmt.Sprintf("晴天且 UV %s，使用晴空蓝", round1(uv))}
		}
		return Color{Hex: "#7c93b5", Name: "云灰蓝", RuleID: "color-cloud", Rationale: "今日云量偏多，使用云灰蓝"}
	}
	if aqiOK {
		return Color{Hex: "#3f8f7d", Name: "透氧青", RuleID: "color-air", Rationale: fmt.Sprintf("空气质量 AQI %s，使用透氧青", round0(aqi))}
	}
	if cal.NextSolarTerm != "" {
		return Color{Hex: "#5f7f6a", Name: "节气青", RuleID: "color-calendar", Rationale: fmt.Sprintf("下一个节气 %s，使用节气青", cal.NextSolarTerm)}
	}
	return Color{}
}

func buildSuggestions(weather WeatherData, air AirQualityData, cal CalendarData) []Suggestion {
	suggestions := make([]Suggestion, 0, 8)
	aqiOK := air.EAQI != nil
	if aqiOK {
		aqi := *air.EAQI
		if aqi <= 50 {
			suggestions = append(suggestions, Suggestion{
				ID: "ventilate", Category: CategorySmallThing, Title: "开窗透气 15 分钟",
				Reason: fmt.Sprintf("AQI %s，空气质量为优", round0(aqi)), RuleID: "ventilate",
				Sources: []string{sourceAir},
			})
		}
		suggestions = append(suggestions, Suggestion{
			ID: "air-encourage", Category: CategoryEncouragement, Title: "今天空气很好",
			Reason: fmt.Sprintf("AQI %s，适合开窗换气，给身体一点真实的小礼物", round0(aqi)),
			RuleID: "air-encourage", Sources: []string{sourceAir},
		})
	}
	if weather.Daily != nil {
		if weather.Daily.PrecipitationProb != nil {
			precip := *weather.Daily.PrecipitationProb
			tempMax := 99.0
			if weather.Daily.TemperatureMax != nil {
				tempMax = *weather.Daily.TemperatureMax
			}
			if precip >= 40 && precip <= 70 && tempMax <= 35 {
				suggestions = append(suggestions, Suggestion{
					ID: "walk-umbrella", Category: CategorySmallThing, Title: "带伞散步 20 分钟",
					Reason: fmt.Sprintf("降雨概率 %s%%，气温最高 %s°C", round0(precip), round1(tempMax)),
					RuleID: "walk-umbrella", Sources: []string{sourceWeather},
				})
			}
			if precip >= 40 {
				suggestions = append(suggestions, Suggestion{
					ID: "sky-photo", Category: CategoryChallenge, Title: "拍一张今天的天空",
					Reason: fmt.Sprintf("降雨概率 %s%%，云层和光线会一直变化", round0(precip)),
					RuleID: "sky-photo", Sources: []string{sourceWeather},
				})
			}
		}
		hot := false
		reasons := make([]string, 0, 2)
		if weather.Daily.TemperatureMax != nil && *weather.Daily.TemperatureMax >= 30 {
			hot = true
			reasons = append(reasons, "最高"+round1(*weather.Daily.TemperatureMax)+"°C")
		}
		if weather.Current != nil && weather.Current.Humidity != nil && *weather.Current.Humidity >= 70 {
			hot = true
			reasons = append(reasons, "湿度"+round0(*weather.Current.Humidity)+"%")
		}
		if hot {
			reason := strings.Join(reasons, "，")
			suggestions = append(suggestions,
				Suggestion{ID: "hydrate", Category: CategorySmallThing, Title: "今天记得补水", Reason: reason, RuleID: "hydrate", Sources: []string{sourceWeather}},
				Suggestion{ID: "water-count", Category: CategoryChallenge, Title: "今天喝够 6 杯水", Reason: reason, RuleID: "water-count", Sources: []string{sourceWeather}},
			)
		}
		if weather.Daily.UVIndex != nil && *weather.Daily.UVIndex >= 6 {
			suggestions = append(suggestions, Suggestion{
				ID: "uv-protect", Category: CategorySmallThing, Title: "10 点后外出记得防晒",
				Reason: "今日最大 UV " + round1(*weather.Daily.UVIndex) + "，属于高强度紫外线",
				RuleID: "uv-protect", Sources: []string{sourceWeather},
			})
		}
		if weather.Daily.DaylightSeconds != nil {
			suggestions = append(suggestions, Suggestion{
				ID: "daylight-encourage", Category: CategoryEncouragement, Title: "今天白天足够长",
				Reason: "白天时长 " + formatDuration(*weather.Daily.DaylightSeconds) + "，足够完成一件最重要的小事",
				RuleID: "daylight-encourage", Sources: []string{sourceWeather},
			})
		}
	}
	if cal.NextSolarTerm != "" && cal.NextSolarTermDate != "" {
		suggestions = append(suggestions,
			Suggestion{
				ID: "solar-term-eve", Category: CategorySmallThing, Title: "给下一个节气做个温柔收尾",
				Reason: "下一个节气是 " + cal.NextSolarTerm + "（" + cal.NextSolarTermDate + "）",
				RuleID: "solar-term-eve", Sources: []string{sourceCalendar},
			},
			Suggestion{
				ID: "sleep-early", Category: CategoryChallenge, Title: "今晚早点休息",
				Reason: "明天进入 " + cal.NextSolarTerm + "，适合用早睡给今天收尾",
				RuleID: "sleep-early", Sources: []string{sourceCalendar},
			},
		)
	}
	if cal.HolidayName != "" && !cal.IsWorkday {
		suggestions = append(suggestions, Suggestion{
			ID: "holiday-greet", Category: CategorySmallThing, Title: "给重要的人发一句问候",
			Reason: "今天是" + cal.HolidayName, RuleID: "holiday-greet", Sources: []string{sourceHoliday},
		})
	}
	if cal.Weekday >= 1 && cal.Weekday <= 5 && cal.HolidayName == "" {
		suggestions = append(suggestions, Suggestion{
			ID: "workday-write", Category: CategoryChallenge, Title: "写下今天最重要的一件小事",
			Reason: "今天是工作日，把最重要的一件小事写下来更容易完成",
			RuleID: "workday-write", Sources: []string{sourceCalendar},
		})
	}
	return suggestions
}

func round1(value float64) string {
	return strconv.FormatFloat(value, 'f', 1, 64)
}

func round0(value float64) string {
	return strconv.FormatFloat(value, 'f', 0, 64)
}

func shortTime(value string) string {
	value = strings.TrimSpace(value)
	if len(value) < 16 {
		return value
	}
	return value[11:16]
}

func formatDuration(seconds float64) string {
	total := int(math.Round(seconds))
	hours := total / 3600
	minutes := (total % 3600) / 60
	return fmt.Sprintf("%d 小时 %d 分", hours, minutes)
}
