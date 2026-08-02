package foodrecommendation

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type POIConfig struct {
	AmapKey         string
	AmapBaseURL     string
	OverpassBaseURL string
	Enabled         bool
	Timeout         time.Duration
}

type POIQuery struct {
	Lat          float64
	Lng          float64
	City         string
	District     string
	RadiusMeters int
	Limit        int
}

type POIResult struct {
	Name       string
	Address    string
	OpenHours  string
	DistanceKm float64
	Rating     float64
	Location   string
	Source     string
}

type POIProvider interface {
	NearbyRestaurants(ctx context.Context, query POIQuery) ([]POIResult, error)
}

type OverpassProvider struct {
	BaseURLs []string
	Client   *http.Client
}

type AmapProvider struct {
	Key     string
	BaseURL string
	Client  *http.Client
}

func NewPOIProvider(cfg POIConfig) POIProvider {
	if strings.TrimSpace(cfg.AmapKey) != "" {
		return &AmapProvider{
			Key:     strings.TrimSpace(cfg.AmapKey),
			BaseURL: strings.TrimRight(cfg.AmapBaseURL, "/"),
			Client:  &http.Client{Timeout: cfg.Timeout},
		}
	}
	if cfg.Enabled {
		return &OverpassProvider{
			BaseURLs: []string{
				strings.TrimRight(cfg.OverpassBaseURL, "/"),
				"https://overpass-api.de/api/interpreter",
				"https://overpass.kumi.systems/api/interpreter",
				"https://overpass.osm.ch/api/interpreter",
			},
			Client: &http.Client{Timeout: cfg.Timeout},
		}
	}
	return nil
}

func (p *OverpassProvider) NearbyRestaurants(ctx context.Context, query POIQuery) ([]POIResult, error) {
	radius := query.RadiusMeters
	if radius <= 0 {
		radius = 3000
	}
	data := fmt.Sprintf(
		`[out:json][timeout:25];(node["amenity"="restaurant"](around:%d,%.6f,%.6f);node["amenity"="fast_food"](around:%d,%.6f,%.6f););out 20;`,
		radius,
		query.Lat,
		query.Lng,
		radius,
		query.Lat,
		query.Lng,
	)
	form := url.Values{}
	form.Set("data", data)
	bodyBytes := []byte{}
	var lastErr error
	for _, baseURL := range p.BaseURLs {
		for attempt := 0; attempt < 2; attempt++ {
			httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL, strings.NewReader(form.Encode()))
			if err != nil {
				lastErr = err
				continue
			}
			httpRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			httpRequest.Header.Set("User-Agent", "FunBoxFoodBot/1.0")
			response, err := p.Client.Do(httpRequest)
			if err != nil {
				lastErr = err
				continue
			}
			body, readErr := io.ReadAll(io.LimitReader(response.Body, 4<<20))
			response.Body.Close()
			if readErr != nil {
				lastErr = readErr
				continue
			}
			if response.StatusCode >= 400 || strings.Contains(string(body), "<title>OSM3S Response</title>") {
				lastErr = fmt.Errorf("overpass endpoint %s returned status %d", baseURL, response.StatusCode)
				continue
			}
			bodyBytes = body
			break
		}
		if len(bodyBytes) > 0 {
			break
		}
	}
	if len(bodyBytes) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("overpass returned empty response")
		}
		return nil, lastErr
	}
	var payload struct {
		Elements []struct {
			Lat  float64           `json:"lat"`
			Lon  float64           `json:"lon"`
			Tags map[string]string `json:"tags"`
		} `json:"elements"`
	}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		return nil, fmt.Errorf("decode overpass response: %w", err)
	}
	results := []POIResult{}
	for _, element := range payload.Elements {
		name := strings.TrimSpace(element.Tags["name"])
		if name == "" {
			continue
		}
		address := strings.TrimSpace(
			strings.Join([]string{
				element.Tags["addr:city"],
				element.Tags["addr:district"],
				element.Tags["addr:street"],
				element.Tags["addr:housenumber"],
			}, " "),
		)
		results = append(results, POIResult{
			Name:       name,
			Address:    address,
			OpenHours:  strings.TrimSpace(element.Tags["opening_hours"]),
			DistanceKm: haversineKm(query.Lat, query.Lng, element.Lat, element.Lon),
			Location:   fmt.Sprintf("%.6f,%.6f", element.Lon, element.Lat),
			Source:     "overpass",
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].DistanceKm < results[j].DistanceKm
	})
	return results, nil
}

func (p *AmapProvider) NearbyRestaurants(ctx context.Context, query POIQuery) ([]POIResult, error) {
	if strings.TrimSpace(p.Key) == "" {
		return nil, fmt.Errorf("amap key is empty")
	}
	radius := query.RadiusMeters
	if radius <= 0 {
		radius = 3000
	}
	limit := query.Limit
	if limit <= 0 || limit > 25 {
		limit = 20
	}
	endpoint := fmt.Sprintf(
		"%s/v3/place/around?key=%s&location=%.6f,%.6f&types=050000&radius=%d&offset=%d&extensions=base",
		p.BaseURL,
		url.QueryEscape(p.Key),
		query.Lng,
		query.Lat,
		radius,
		limit,
	)
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build amap request: %w", err)
	}
	response, err := p.Client.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("request amap: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("amap returned status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("read amap response: %w", err)
	}
	var payload struct {
		Status string `json:"status"`
		POIs   []struct {
			Name     string `json:"name"`
			Address  string `json:"address"`
			Distance string `json:"distance"`
			Location string `json:"location"`
		} `json:"pois"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode amap response: %w", err)
	}
	if payload.Status != "1" {
		return nil, fmt.Errorf("amap request failed")
	}
	results := []POIResult{}
	for _, poi := range payload.POIs {
		name := strings.TrimSpace(poi.Name)
		if name == "" {
			continue
		}
		distanceKm := 0.0
		if value, err := strconv.ParseFloat(poi.Distance, 64); err == nil {
			distanceKm = value / 1000
		}
		results = append(results, POIResult{
			Name:       name,
			Address:    strings.TrimSpace(poi.Address),
			DistanceKm: distanceKm,
			Location:   strings.TrimSpace(poi.Location),
			Source:     "amap",
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].DistanceKm < results[j].DistanceKm
	})
	return results, nil
}
