package plantid

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"unicode"
)

const defaultPlantNetBaseURL = "https://my-api.plantnet.org"

type plantNetResponse struct {
	Results []struct {
		Score   float64 `json:"score"`
		Species struct {
			ScientificNameWithoutAuthor string `json:"scientificNameWithoutAuthor"`
			ScientificNameAuthorship    string `json:"scientificNameAuthorship"`
			Genus                       struct {
				ScientificNameWithoutAuthor string `json:"scientificNameWithoutAuthor"`
			} `json:"genus"`
			Family struct {
				ScientificNameWithoutAuthor string `json:"scientificNameWithoutAuthor"`
			} `json:"family"`
			CommonNames []string `json:"commonNames"`
			GBIF        struct {
				ID json.Number `json:"id"`
			} `json:"gbif"`
		} `json:"species"`
	} `json:"results"`
}

func callPlantNet(ctx context.Context, cfg Config, imageData []byte, organ string) ([]PlantNetSpeciesWithScore, error) {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = defaultPlantNetBaseURL
	}
	project := strings.TrimSpace(cfg.Project)
	if project == "" {
		project = "all"
	}
	maxMatches := cfg.MaxMatches
	if maxMatches <= 0 {
		maxMatches = 5
	}

	query := url.Values{}
	query.Set("api-key", cfg.APIKey)
	query.Set("nb-results", fmt.Sprintf("%d", maxMatches))
	query.Set("lang", "zh")
	endpoint := fmt.Sprintf("%s/v2/identify/%s?%s", baseURL, url.PathEscape(project), query.Encode())

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("images", "plant.jpg")
	if err != nil {
		return nil, fmt.Errorf("create plant net image part: %w", err)
	}
	if _, err := part.Write(imageData); err != nil {
		return nil, fmt.Errorf("write plant net image part: %w", err)
	}
	if organ != "" {
		if err := writer.WriteField("organs", organ); err != nil {
			return nil, fmt.Errorf("write plant net organ field: %w", err)
		}
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close plant net form: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, fmt.Errorf("create plant net request: %w", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: cfg.RequestTimeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("call plant net: %w", err)
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("read plant net response: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("plant net responded %d: %s", response.StatusCode, strings.TrimSpace(string(payload)))
	}

	var parsed plantNetResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, fmt.Errorf("decode plant net response: %w", err)
	}

	results := make([]PlantNetSpeciesWithScore, 0, len(parsed.Results))
	for _, item := range parsed.Results {
		species := PlantNetSpecies{
			ScientificName:              strings.TrimSpace(item.Species.ScientificNameWithoutAuthor),
			ScientificNameWithoutAuthor: strings.TrimSpace(item.Species.ScientificNameWithoutAuthor),
			Genus:                       strings.TrimSpace(item.Species.Genus.ScientificNameWithoutAuthor),
			Family:                      strings.TrimSpace(item.Species.Family.ScientificNameWithoutAuthor),
			CommonNames:                 item.Species.CommonNames,
		}
		if id, err := item.Species.GBIF.ID.Int64(); err == nil {
			species.GBIFKey = id
		}
		results = append(results, PlantNetSpeciesWithScore{Species: species, Score: item.Score})
	}
	return results, nil
}

type PlantNetSpeciesWithScore struct {
	Species PlantNetSpecies
	Score   float64
}

type gbifSpeciesResponse struct {
	Key            int64  `json:"key"`
	ScientificName string `json:"scientificName"`
	VernacularName string `json:"vernacularName"`
	Kingdom        string `json:"kingdom"`
	Phylum         string `json:"phylum"`
	Class          string `json:"class"`
	Order          string `json:"order"`
	Family         string `json:"family"`
	Genus          string `json:"genus"`
}

func fetchGBIFSpecies(ctx context.Context, client *http.Client, gbifKey int64) (gbifSpeciesResponse, error) {
	endpoint := fmt.Sprintf("https://api.gbif.org/v1/species/%d", gbifKey)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return gbifSpeciesResponse{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return gbifSpeciesResponse{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return gbifSpeciesResponse{}, fmt.Errorf("gbif responded %d", response.StatusCode)
	}
	var parsed gbifSpeciesResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&parsed); err != nil {
		return gbifSpeciesResponse{}, err
	}
	if parsed.Key == 0 {
		parsed.Key = gbifKey
	}
	return parsed, nil
}

type wikipediaResponse struct {
	Query struct {
		Pages map[string]struct {
			Title     string `json:"title"`
			Extract   string `json:"extract"`
			PageImage string `json:"pageimage"`
			Thumbnail struct {
				Source string `json:"source"`
			} `json:"thumbnail"`
			FullURL string `json:"fullurl"`
		} `json:"pages"`
	} `json:"query"`
}

func fetchWikipediaSummary(ctx context.Context, client *http.Client, query string) (SummaryInfo, string, error) {
	params := url.Values{}
	params.Set("action", "query")
	params.Set("prop", "extracts|pageimages|info")
	params.Set("exintro", "1")
	params.Set("explaintext", "1")
	params.Set("format", "json")
	params.Set("redirects", "1")
	params.Set("inprop", "url")
	params.Set("pithumbsize", "960")
	params.Set("titles", query)
	endpoint := "https://zh.wikipedia.org/w/api.php?" + params.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return SummaryInfo{}, "", err
	}
	request.Header.Set("User-Agent", "FunBoxPlantIdentifier/1.0 (https://funbox.local)")
	response, err := client.Do(request)
	if err != nil {
		return SummaryInfo{}, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return SummaryInfo{}, "", fmt.Errorf("wikipedia responded %d", response.StatusCode)
	}
	var parsed wikipediaResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&parsed); err != nil {
		return SummaryInfo{}, "", err
	}
	for _, page := range parsed.Query.Pages {
		if page.Extract == "" {
			continue
		}
		summary := SummaryInfo{
			Text:      strings.TrimSpace(page.Extract),
			URL:       page.FullURL,
			Source:    "wikipedia",
			FetchedAt: nowISO(),
		}
		imageURL := ""
		if page.Thumbnail.Source != "" {
			imageURL = page.Thumbnail.Source
		}
		return summary, imageURL, nil
	}
	return SummaryInfo{}, "", nil
}

type inaturalistResponse struct {
	Results []struct {
		ID                  int64  `json:"id"`
		ObservationsCount   int64  `json:"observations_count"`
		PreferredCommonName string `json:"preferred_common_name"`
		DefaultPhoto        struct {
			URL         string `json:"url"`
			MediumURL   string `json:"medium_url"`
			Attribution string `json:"attribution"`
			LicenseCode string `json:"license_code"`
		} `json:"default_photo"`
	} `json:"results"`
}

func fetchINaturalist(ctx context.Context, client *http.Client, scientificName string) (ImageInfo, ObservationsInfo, string, error) {
	params := url.Values{}
	params.Set("q", scientificName)
	params.Set("rank", "species")
	params.Set("per_page", "3")
	endpoint := "https://api.inaturalist.org/v1/taxa?" + params.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ImageInfo{}, ObservationsInfo{}, "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return ImageInfo{}, ObservationsInfo{}, "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ImageInfo{}, ObservationsInfo{}, "", fmt.Errorf("inaturalist responded %d", response.StatusCode)
	}
	var parsed inaturalistResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&parsed); err != nil {
		return ImageInfo{}, ObservationsInfo{}, "", err
	}
	if len(parsed.Results) == 0 {
		return ImageInfo{}, ObservationsInfo{}, "", nil
	}
	first := parsed.Results[0]
	observations := ObservationsInfo{
		Count:     first.ObservationsCount,
		Source:    "inaturalist",
		FetchedAt: nowISO(),
	}
	image := ImageInfo{}
	if first.DefaultPhoto.MediumURL != "" || first.DefaultPhoto.URL != "" {
		image.URL = first.DefaultPhoto.MediumURL
		if image.URL == "" {
			image.URL = first.DefaultPhoto.URL
		}
		image.Source = "inaturalist"
		image.Credit = first.DefaultPhoto.Attribution
		image.License = first.DefaultPhoto.LicenseCode
		image.CheckedAt = nowISO()
	}
	return image, observations, first.PreferredCommonName, nil
}

var familyZhMap = map[string]string{
	"Asteraceae":    "菊科",
	"Rosaceae":      "蔷薇科",
	"Ginkgoaceae":   "银杏科",
	"Poaceae":       "禾本科",
	"Liliaceae":     "百合科",
	"Solanaceae":    "茄科",
	"Ranunculaceae": "毛茛科",
	"Apiaceae":      "伞形科",
	"Fabaceae":      "豆科",
	"Brassicaceae":  "十字花科",
	"Lamiaceae":     "唇形科",
	"Pinaceae":      "松科",
	"Salicaceae":    "杨柳科",
	"Moraceae":      "桑科",
	"Theaceae":      "山茶科",
	"Malvaceae":     "锦葵科",
	"Orchidaceae":   "兰科",
	"Araceae":       "天南星科",
	"Euphorbiaceae": "大戟科",
	"Apocynaceae":   "夹竹桃科",
}

func familyZh(family string) string {
	if value := familyZhMap[strings.TrimSpace(family)]; value != "" {
		return value
	}
	return ""
}

func firstChineseName(names []string) string {
	for _, name := range names {
		trimmed := strings.TrimSpace(name)
		if trimmed == "" {
			continue
		}
		hasCJK := false
		for _, r := range trimmed {
			if unicode.Is(unicode.Han, r) {
				hasCJK = true
				break
			}
		}
		if hasCJK {
			return trimmed
		}
	}
	return ""
}
