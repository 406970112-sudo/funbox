package plantid

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotConfigured   = errors.New("plant net api key is not configured")
	ErrProviderFailed  = errors.New("plant id provider failed")
	ErrSpeciesNotFound = errors.New("plant species not found")
)

const (
	disclaimerText    = "识别结果仅供参考，请勿据此采食或药用。食用/毒性信息请以权威来源为准。"
	safetyUnknownNote = "暂无可信食用资料，请勿采食。"
)

type Service struct {
	cfg      Config
	store    *Store
	client   *http.Client
	commonMu sync.Mutex
}

func NewService(cfg Config, store *Store) *Service {
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 45 * time.Second
	}
	return &Service{
		cfg:    cfg,
		store:  store,
		client: &http.Client{Timeout: timeout},
	}
}

func (s *Service) Identify(ctx context.Context, imageData []byte, organ string) (*IdentificationResult, error) {
	if strings.TrimSpace(s.cfg.APIKey) == "" {
		return nil, ErrNotConfigured
	}
	plantNetResults, err := callPlantNet(ctx, s.cfg, imageData, organ)
	if err != nil {
		return nil, err
	}
	if len(plantNetResults) == 0 {
		return nil, fmt.Errorf("%w: no matches", ErrProviderFailed)
	}

	matches := make([]Match, 0, len(plantNetResults))
	for index, item := range plantNetResults {
		match := Match{
			Rank:           index + 1,
			Score:          item.Score,
			GBIFKey:        item.Species.GBIFKey,
			ScientificName: item.Species.ScientificName,
			CommonNameZh:   firstChineseName(item.Species.CommonNames),
			Family:         item.Species.Family,
			FamilyZh:       familyZh(item.Species.Family),
			Genus:          item.Species.Genus,
			Source:         "plantnet",
			FetchedAt:      nowISO(),
		}
		matches = append(matches, match)
	}

	return &IdentificationResult{
		IdentificationID: uuid.NewString(),
		Photo:            PhotoInfo{UploadedAt: nowISO()},
		Matches:          matches,
		Disclaimer:       disclaimerText,
	}, nil
}

func (s *Service) Species(ctx context.Context, gbifKey int64, hint *PlantNetSpecies) (*SpeciesDetail, error) {
	cacheTTL := s.cfg.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 24 * time.Hour
	}
	if cached, ok, err := s.store.GetSpeciesCache(ctx, gbifKey, cacheTTL); err == nil && ok {
		return &cached, nil
	}

	gbif, gbifErr := fetchGBIFSpecies(ctx, s.client, gbifKey)
	if gbifErr != nil && gbifKey <= 0 {
		return nil, ErrSpeciesNotFound
	}

	searchNames := []string{}
	if hint != nil {
		if chinese := firstChineseName(hint.CommonNames); chinese != "" {
			searchNames = append(searchNames, chinese)
		}
		searchNames = append(searchNames, hint.ScientificName)
	}
	if gbifErr == nil {
		if gbif.VernacularName != "" {
			searchNames = append(searchNames, gbif.VernacularName)
		}
		if gbif.ScientificName != "" {
			searchNames = append(searchNames, gbif.ScientificName)
		}
	}
	if len(searchNames) == 0 {
		searchNames = append(searchNames, fmt.Sprintf("taxon %d", gbifKey))
	}

	scientificName := ""
	if gbifErr == nil {
		scientificName = gbif.ScientificName
	}
	if scientificName == "" && hint != nil {
		scientificName = hint.ScientificName
	}

	type wikiResult struct {
		summary  SummaryInfo
		imageURL string
	}
	type inatResult struct {
		image        ImageInfo
		observations ObservationsInfo
		commonName   string
	}

	wikiCh := make(chan wikiResult, 1)
	inatCh := make(chan inatResult, 1)
	go func() {
		summary, imageURL, _ := fetchWikipediaSummary(ctx, s.client, searchNames[0])
		wikiCh <- wikiResult{summary: summary, imageURL: imageURL}
	}()
	go func() {
		if scientificName == "" {
			inatCh <- inatResult{}
			return
		}
		image, observations, commonName, _ := fetchINaturalist(ctx, s.client, scientificName)
		inatCh <- inatResult{image: image, observations: observations, commonName: commonName}
	}()

	wiki := <-wikiCh
	inat := <-inatCh

	commonNames := []string{}
	seen := map[string]bool{}
	if hint != nil {
		for _, name := range hint.CommonNames {
			name = strings.TrimSpace(name)
			if name != "" && !seen[name] {
				seen[name] = true
				commonNames = append(commonNames, name)
			}
		}
	}
	if inat.commonName != "" && !seen[inat.commonName] {
		seen[inat.commonName] = true
		commonNames = append(commonNames, inat.commonName)
	}
	if gbifErr == nil && gbif.VernacularName != "" && !seen[gbif.VernacularName] {
		seen[gbif.VernacularName] = true
		commonNames = append(commonNames, gbif.VernacularName)
	}

	classification := SpeciesClassification{}
	if gbifErr == nil {
		classification.Family = gbif.Family
		classification.FamilyZh = familyZh(gbif.Family)
		classification.Genus = gbif.Genus
		classification.Order = gbif.Order
		classification.Class = gbif.Class
	}
	if classification.Family == "" && hint != nil {
		classification.Family = hint.Family
		classification.FamilyZh = familyZh(hint.Family)
		classification.Genus = hint.Genus
	}

	images := []ImageInfo{}
	if inat.image.URL != "" {
		images = append(images, inat.image)
	}
	if wiki.imageURL != "" {
		images = append(images, ImageInfo{
			URL:       wiki.imageURL,
			Source:    "wikimedia",
			CheckedAt: nowISO(),
		})
	}

	safety := analyzeSafety(scientificName, commonNames, wiki.summary.Text)
	detail := &SpeciesDetail{
		GBIFKey:        gbifKey,
		ScientificName: scientificName,
		CommonNames:    commonNames,
		Classification: classification,
		Summary:        wiki.summary,
		Images:         images,
		Observations:   inat.observations,
		Safety:         safety,
		Disclaimer:     disclaimerText,
		FetchedAt:      nowISO(),
	}
	if err := s.store.PutSpeciesCache(ctx, *detail); err != nil {
		return nil, err
	}
	return detail, nil
}

func (s *Service) CommonPlants() ([]CommonPlant, string) {
	s.commonMu.Lock()
	defer s.commonMu.Unlock()
	return commonPlantsSnapshot(), commonPlantsFetchedAt
}

func (s *Service) Sources() SourcesResponse {
	return SourcesResponse{
		Items: []SourceEntry{
			{
				ID:          "plantnet",
				Name:        "PlantNet",
				Purpose:     "植物图像识别，返回候选物种、置信度与 GBIF key",
				NeedsKey:    true,
				UpdatedAt:   nowISO(),
				DocumentURL: "https://my.plantnet.org/",
			},
			{
				ID:          "gbif",
				Name:        "GBIF",
				Purpose:     "物种分类学：科/属/目/纲与学名",
				NeedsKey:    false,
				UpdatedAt:   nowISO(),
				DocumentURL: "https://www.gbif.org/developer/species",
			},
			{
				ID:          "inaturalist",
				Name:        "iNaturalist",
				Purpose:     "真实植物照片、作者署名与全球观察统计",
				NeedsKey:    false,
				UpdatedAt:   nowISO(),
				DocumentURL: "https://api.inaturalist.org/v1/docs/",
			},
			{
				ID:          "wikipedia",
				Name:        "Wikipedia / Wikimedia",
				Purpose:     "中文词条摘要、别名、食用/毒性相关原文与图片",
				NeedsKey:    false,
				UpdatedAt:   nowISO(),
				DocumentURL: "https://zh.wikipedia.org/",
			},
		},
		FetchedAt: nowISO(),
	}
}

func (s *Service) Feedback(ctx context.Context, userID string, input FeedbackInput) error {
	if strings.TrimSpace(input.IdentificationID) == "" || strings.TrimSpace(input.Kind) == "" {
		return fmt.Errorf("identification_id and kind are required")
	}
	if input.Kind != "wrong_match" && input.Kind != "wrong_info" && input.Kind != "image_issue" {
		return fmt.Errorf("unsupported feedback kind")
	}
	return s.store.SaveFeedback(ctx, userID, input)
}

func (s *Service) History(ctx context.Context, userID string, limit int) ([]HistoryItem, error) {
	return s.store.ListHistory(ctx, userID, limit)
}

func (s *Service) SaveHistory(ctx context.Context, userID string, item HistoryItem) error {
	return s.store.SaveHistory(ctx, userID, item)
}

func (s *Service) DeleteHistory(ctx context.Context, userID, id string) error {
	return s.store.DeleteHistory(ctx, userID, id)
}

func (s *Service) ClearHistory(ctx context.Context, userID string) error {
	return s.store.ClearHistory(ctx, userID)
}
