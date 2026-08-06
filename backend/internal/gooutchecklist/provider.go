package gooutchecklist

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	weatherBaseURL = "https://api.open-meteo.com/v1/forecast"
	airBaseURL     = "https://air-quality-api.open-meteo.com/v1/air-quality"
	geoBaseURL     = "https://geocoding-api.open-meteo.com/v1/search"
)

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

type CityResult struct {
	Name    string  `json:"name"`
	Country string  `json:"country"`
	Admin1  string  `json:"admin1,omitempty"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
}

type Provider interface {
	FetchWeather(ctx context.Context, lat, lon float64, date string) (WeatherData, error)
	FetchAirQuality(ctx context.Context, lat, lon float64) (AirQualityData, error)
	SearchCities(ctx context.Context, query string) ([]CityResult, error)
}

type OpenMeteoProvider struct {
	client *http.Client
}

func NewOpenMeteoProvider(timeout time.Duration) *OpenMeteoProvider {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &OpenMeteoProvider{client: &http.Client{Timeout: timeout}}
}

type forecastResponse struct {
	Timezone string `json:"timezone"`
	Current  struct {
		Time                string   `json:"time"`
		Temperature2M       *float64 `json:"temperature_2m"`
		RelativeHumidity2M  *float64 `json:"relative_humidity_2m"`
		ApparentTemperature *float64 `json:"apparent_temperature"`
		WeatherCode         *int     `json:"weather_code"`
		WindSpeed10M        *float64 `json:"wind_speed_10m"`
	} `json:"current"`
	Daily struct {
		Time                 []string  `json:"time"`
		WeatherCode          []int     `json:"weather_code"`
		Temperature2MMax     []float64 `json:"temperature_2m_max"`
		Temperature2MMin     []float64 `json:"temperature_2m_min"`
		PrecipitationProbMax []float64 `json:"precipitation_probability_max"`
		UVIndexMax           []float64 `json:"uv_index_max"`
		Sunrise              []string  `json:"sunrise"`
		Sunset               []string  `json:"sunset"`
		DaylightDuration     []float64 `json:"daylight_duration"`
		WindSpeed10MMax      []float64 `json:"wind_speed_10m_max"`
	} `json:"daily"`
}

type airQualityResponse struct {
	Current struct {
		Time        string   `json:"time"`
		EuropeanAQI *float64 `json:"european_aqi"`
		PM25        *float64 `json:"pm2_5"`
		PM10        *float64 `json:"pm10"`
		Ozone       *float64 `json:"ozone"`
	} `json:"current"`
}

type geocodingResponse struct {
	Results []struct {
		Name      string  `json:"name"`
		Country   string  `json:"country"`
		Admin1    string  `json:"admin1"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"results"`
}

func (p *OpenMeteoProvider) FetchWeather(ctx context.Context, lat, lon float64, date string) (WeatherData, error) {
	params := url.Values{}
	params.Set("latitude", strconv.FormatFloat(lat, 'f', 4, 64))
	params.Set("longitude", strconv.FormatFloat(lon, 'f', 4, 64))
	params.Set("timezone", "auto")
	if date != "" {
		params.Set("start_date", date)
		params.Set("end_date", date)
	} else {
		params.Set("forecast_days", "1")
	}
	params.Set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m")
	params.Set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset,daylight_duration,wind_speed_10m_max")
	var raw forecastResponse
	if err := p.getJSON(ctx, weatherBaseURL+"?"+params.Encode(), &raw); err != nil {
		return WeatherData{}, err
	}
	data := WeatherData{Date: date, Timezone: raw.Timezone, FetchedAt: time.Now().UTC()}
	if raw.Current.Time != "" {
		data.Current = &CurrentWeather{
			Time:                raw.Current.Time,
			Temperature:         raw.Current.Temperature2M,
			Humidity:            raw.Current.RelativeHumidity2M,
			ApparentTemperature: raw.Current.ApparentTemperature,
			WeatherCode:         raw.Current.WeatherCode,
			WindSpeed:           raw.Current.WindSpeed10M,
		}
	}
	if len(raw.Daily.Time) > 0 {
		data.Daily = &DailyWeather{}
		if data.Date == "" {
			data.Date = raw.Daily.Time[0]
		}
		if len(raw.Daily.WeatherCode) > 0 {
			data.Daily.WeatherCode = &raw.Daily.WeatherCode[0]
		}
		if len(raw.Daily.Temperature2MMax) > 0 {
			data.Daily.TemperatureMax = &raw.Daily.Temperature2MMax[0]
		}
		if len(raw.Daily.Temperature2MMin) > 0 {
			data.Daily.TemperatureMin = &raw.Daily.Temperature2MMin[0]
		}
		if len(raw.Daily.PrecipitationProbMax) > 0 {
			data.Daily.PrecipitationProb = &raw.Daily.PrecipitationProbMax[0]
		}
		if len(raw.Daily.UVIndexMax) > 0 {
			data.Daily.UVIndex = &raw.Daily.UVIndexMax[0]
		}
		if len(raw.Daily.Sunrise) > 0 {
			data.Daily.Sunrise = &raw.Daily.Sunrise[0]
		}
		if len(raw.Daily.Sunset) > 0 {
			data.Daily.Sunset = &raw.Daily.Sunset[0]
		}
		if len(raw.Daily.DaylightDuration) > 0 {
			data.Daily.DaylightSeconds = &raw.Daily.DaylightDuration[0]
		}
		if len(raw.Daily.WindSpeed10MMax) > 0 {
			data.Daily.WindSpeedMax = &raw.Daily.WindSpeed10MMax[0]
		}
	}
	if data.Date == "" {
		return WeatherData{}, fmt.Errorf("weather source returned no date")
	}
	return data, nil
}

func (p *OpenMeteoProvider) FetchAirQuality(ctx context.Context, lat, lon float64) (AirQualityData, error) {
	params := url.Values{}
	params.Set("latitude", strconv.FormatFloat(lat, 'f', 4, 64))
	params.Set("longitude", strconv.FormatFloat(lon, 'f', 4, 64))
	params.Set("timezone", "auto")
	params.Set("current", "european_aqi,pm2_5,pm10,ozone")
	var raw airQualityResponse
	if err := p.getJSON(ctx, airBaseURL+"?"+params.Encode(), &raw); err != nil {
		return AirQualityData{}, err
	}
	if raw.Current.Time == "" {
		return AirQualityData{}, fmt.Errorf("air quality source returned no current time")
	}
	return AirQualityData{
		Time:      raw.Current.Time,
		EAQI:      raw.Current.EuropeanAQI,
		PM25:      raw.Current.PM25,
		PM10:      raw.Current.PM10,
		Ozone:     raw.Current.Ozone,
		FetchedAt: time.Now().UTC(),
	}, nil
}

func (p *OpenMeteoProvider) SearchCities(ctx context.Context, query string) ([]CityResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: empty city query", ErrInvalidInput)
	}
	params := url.Values{}
	params.Set("name", query)
	params.Set("count", "10")
	params.Set("language", "zh")
	params.Set("format", "json")
	var raw geocodingResponse
	if err := p.getJSON(ctx, geoBaseURL+"?"+params.Encode(), &raw); err != nil {
		return nil, err
	}
	results := make([]CityResult, 0, len(raw.Results))
	for _, item := range raw.Results {
		results = append(results, CityResult{
			Name:    item.Name,
			Country: item.Country,
			Admin1:  item.Admin1,
			Lat:     item.Latitude,
			Lon:     item.Longitude,
		})
	}
	return results, nil
}

func (p *OpenMeteoProvider) getJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch %s: %w", strings.SplitN(endpoint, "?", 2)[0], err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return fmt.Errorf("fetch %s: status %d", strings.SplitN(endpoint, "?", 2)[0], resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}
