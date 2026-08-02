package homerecommendation

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"my-first-expo-app/backend/internal/access"
)

const (
	maxTitleOverrideRunes       = 24
	maxDescriptionOverrideRunes = 60
	maxCTALabelOverrideRunes    = 12
)

type Service struct {
	store      *Store
	features   map[string]FeatureDefinition
	nowFunc    func() time.Time
}

func NewService(store *Store) (*Service, error) {
	var definitions []FeatureDefinition
	if err := json.Unmarshal(access.RegistryJSON(), &definitions); err != nil {
		return nil, fmt.Errorf("decode home recommendation registry: %w", err)
	}
	features := make(map[string]FeatureDefinition, len(definitions))
	for _, definition := range definitions {
		features[definition.ID] = definition
	}
	return &Service{
		store:    store,
		features: features,
		nowFunc:  time.Now,
	}, nil
}

func (s *Service) Registry() []FeatureDefinition {
	items := make([]FeatureDefinition, 0, len(s.features))
	for _, feature := range s.features {
		items = append(items, feature)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].ID < items[j].ID
	})
	return items
}

func (s *Service) FeatureByID(featureID string) (FeatureDefinition, bool) {
	feature, ok := s.features[featureID]
	return feature, ok
}

type PublicItem struct {
	SlotID       string `json:"slotId"`
	Kind         string `json:"kind"`
	FeatureID    string `json:"featureId"`
	Name         string `json:"name"`
	Tagline      string `json:"tagline"`
	Icon         string `json:"icon"`
	AccentColor  string `json:"accentColor"`
	Route        string `json:"route"`
	CTALabel     string `json:"ctaLabel"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	SortOrder    int    `json:"sortOrder"`
}

type PublicResponse struct {
	Date   string       `json:"date"`
	Source string       `json:"source"`
	Items  []PublicItem `json:"items"`
}

type AdminSlot struct {
	Slot        Slot              `json:"slot"`
	Feature     FeatureDefinition `json:"feature"`
	Valid       bool              `json:"valid"`
	InvalidNote string            `json:"invalidNote"`
}

type AdminListResponse struct {
	Slots    []AdminSlot `json:"slots"`
	Registry []FeatureDefinition `json:"registry"`
	Summary  Summary     `json:"summary"`
}

type StatsResponse struct {
	SinceDate string      `json:"sinceDate"`
	Items     []SlotStats `json:"items"`
}

func (s *Service) HomeRecommendations(
	ctx context.Context,
	visibleFeatureIDs []string,
	date string,
) (PublicResponse, error) {
	date = normalizeDate(date)
	if date == "" {
		date = s.nowFunc().Format("2006-01-02")
	}
	visible := make(map[string]struct{}, len(visibleFeatureIDs))
	for _, id := range visibleFeatureIDs {
		visible[id] = struct{}{}
	}

	slots, err := s.store.ListSlots(ctx)
	if err != nil {
		return PublicResponse{}, err
	}
	items := make([]PublicItem, 0, 3)
	for _, slot := range slots {
		if !slot.Enabled || !s.slotActiveOn(slot, date) {
			continue
		}
		if _, ok := visible[slot.FeatureID]; !ok {
			continue
		}
		item, ok := s.publicItem(slot)
		if !ok {
			continue
		}
		items = append(items, item)
		if len(items) >= 3 {
			break
		}
	}

	if len(items) > 0 {
		return PublicResponse{Date: date, Source: SourceConfigured, Items: items}, nil
	}

	fallback, ok := s.fallbackItem(visible)
	if !ok {
		return PublicResponse{Date: date, Source: SourceFallback, Items: []PublicItem{}}, nil
	}
	return PublicResponse{Date: date, Source: SourceFallback, Items: []PublicItem{fallback}}, nil
}

func (s *Service) AdminList(ctx context.Context) (AdminListResponse, error) {
	slots, err := s.store.ListSlots(ctx)
	if err != nil {
		return AdminListResponse{}, err
	}
	adminSlots := make([]AdminSlot, 0, len(slots))
	enabledToday := 0
	disabled := 0
	today := s.nowFunc().Format("2006-01-02")
	for _, slot := range slots {
		feature, exists := s.features[slot.FeatureID]
		valid := true
		note := ""
		if !exists {
			valid = false
			note = "功能已失效"
		} else if !s.featureSelectable(feature) {
			valid = false
			note = "功能状态不可推荐"
		}
		if slot.Enabled {
			if s.slotActiveOn(slot, today) {
				enabledToday++
			}
		} else {
			disabled++
		}
		adminSlots = append(adminSlots, AdminSlot{
			Slot:        slot,
			Feature:     feature,
			Valid:       valid,
			InvalidNote: note,
		})
	}
	defaultFeature := s.defaultFeatureLabel()
	return AdminListResponse{
		Slots:    adminSlots,
		Registry: s.Registry(),
		Summary: Summary{
			EnabledToday:   enabledToday,
			Disabled:       disabled,
			DefaultFeature: defaultFeature,
		},
	}, nil
}

func (s *Service) CreateSlot(ctx context.Context, adminID string, input SlotInput) (Slot, error) {
	feature, err := s.validateSlotInput(input)
	if err != nil {
		return Slot{}, err
	}
	slot := slotFromInput(input)
	slot.FeatureID = feature.ID
	slot.FeatureKind = kindForRoute(feature.Route)
	slot.CreatedBy = adminID
	slot.UpdatedBy = adminID
	return s.store.CreateSlot(ctx, slot)
}

func (s *Service) UpdateSlot(ctx context.Context, adminID, slotID string, input SlotInput) (Slot, error) {
	feature, err := s.validateSlotInput(input)
	if err != nil {
		return Slot{}, err
	}
	existing, err := s.store.GetSlot(ctx, slotID)
	if err != nil {
		return Slot{}, err
	}
	slot := slotFromInput(input)
	slot.ID = existing.ID
	slot.FeatureID = feature.ID
	slot.FeatureKind = kindForRoute(feature.Route)
	slot.CreatedBy = existing.CreatedBy
	slot.CreatedAt = existing.CreatedAt
	slot.UpdatedBy = adminID
	if slot.Enabled {
		return s.store.UpdateSlot(ctx, slot)
	}

	enabledCount, err := s.store.EnabledSlotCount(ctx)
	if err != nil {
		return Slot{}, err
	}
	if existing.Enabled && enabledCount <= 1 {
		return Slot{}, ErrLastEnabledSlot
	}
	return s.store.UpdateSlot(ctx, slot)
}

func (s *Service) DeleteSlot(ctx context.Context, adminID, slotID string) error {
	existing, err := s.store.GetSlot(ctx, slotID)
	if err != nil {
		return err
	}
	if existing.Enabled {
		enabledCount, err := s.store.EnabledSlotCount(ctx)
		if err != nil {
			return err
		}
		if enabledCount <= 1 {
			return ErrLastEnabledSlot
		}
	}
	if err := s.store.DeleteSlot(ctx, slotID); err != nil {
		return err
	}
	return s.store.AppendAudit(ctx, adminID, "delete", slotID, existing.FeatureID)
}

func (s *Service) Reorder(ctx context.Context, adminID string, slotIDs []string) error {
	if len(slotIDs) == 0 {
		return nil
	}
	orders := make(map[string]int, len(slotIDs))
	for index, slotID := range slotIDs {
		orders[slotID] = index
	}
	if err := s.store.ReorderSlots(ctx, orders, adminID); err != nil {
		return err
	}
	return s.store.AppendAudit(ctx, adminID, "reorder", strings.Join(slotIDs, ","), fmt.Sprintf("count=%d", len(slotIDs)))
}

func (s *Service) AuditLog(ctx context.Context, limit int) ([]AuditEntry, error) {
	return s.store.AuditLog(ctx, limit)
}

func (s *Service) AuditLogAppend(
	ctx context.Context,
	adminID string,
	action string,
	slotID string,
	detail string,
) error {
	return s.store.AppendAudit(ctx, adminID, action, slotID, detail)
}

func (s *Service) Stats(ctx context.Context, days int) (StatsResponse, error) {
	if days <= 0 || days > 90 {
		days = 30
	}
	since := s.nowFunc().AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	items, err := s.store.Stats(ctx, since)
	if err != nil {
		return StatsResponse{}, err
	}
	return StatsResponse{SinceDate: since, Items: items}, nil
}

func (s *Service) RecordEvent(
	ctx context.Context,
	userID string,
	slotID string,
	eventType string,
	date string,
) error {
	if eventType != "view" && eventType != "click" {
		return ErrEventInvalid
	}
	if strings.TrimSpace(slotID) == "" || strings.TrimSpace(userID) == "" {
		return ErrEventInvalid
	}
	date = normalizeDate(date)
	if date == "" {
		date = s.nowFunc().Format("2006-01-02")
	}
	featureID := ""
	if slot, err := s.store.GetSlot(ctx, slotID); err == nil {
		featureID = slot.FeatureID
	}
	return s.store.RecordEvent(ctx, slotID, featureID, userID, date, eventType)
}

func (s *Service) validateSlotInput(input SlotInput) (FeatureDefinition, error) {
	featureID := strings.TrimSpace(input.FeatureID)
	feature, ok := s.features[featureID]
	if !ok {
		return FeatureDefinition{}, ErrFeatureInvalid
	}
	if !s.featureSelectable(feature) {
		return FeatureDefinition{}, ErrFeatureInvalid
	}
	if s.store == nil {
		return FeatureDefinition{}, fmt.Errorf("home recommendation store is required")
	}

	if err := validateDateRange(input.StartsOn, input.EndsOn); err != nil {
		return FeatureDefinition{}, err
	}
	if err := validateWeekdays(input.Weekdays); err != nil {
		return FeatureDefinition{}, err
	}
	if err := validateOverrideLength("title", input.TitleOverride, maxTitleOverrideRunes); err != nil {
		return FeatureDefinition{}, err
	}
	if err := validateOverrideLength("description", input.DescriptionOverride, maxDescriptionOverrideRunes); err != nil {
		return FeatureDefinition{}, err
	}
	if err := validateOverrideLength("ctaLabel", input.CTALabelOverride, maxCTALabelOverrideRunes); err != nil {
		return FeatureDefinition{}, err
	}
	return feature, nil
}

func (s *Service) featureSelectable(feature FeatureDefinition) bool {
	if feature.HiddenFromList {
		return false
	}
	switch kindForRoute(feature.Route) {
	case KindTool:
		return feature.Status == "available"
	case KindGame:
		return feature.Status == "playable"
	default:
		return false
	}
}

func (s *Service) publicItem(slot Slot) (PublicItem, bool) {
	feature, ok := s.features[slot.FeatureID]
	if !ok || !s.featureSelectable(feature) {
		return PublicItem{}, false
	}
	kind := kindForRoute(feature.Route)
	name := feature.Name
	if strings.TrimSpace(slot.TitleOverride) != "" {
		name = strings.TrimSpace(slot.TitleOverride)
	}
	tagline := feature.Tagline
	if strings.TrimSpace(slot.DescriptionOverride) != "" {
		tagline = strings.TrimSpace(slot.DescriptionOverride)
	}
	ctaLabel := feature.UsageLabel
	if kind == KindGame {
		ctaLabel = "开始游戏"
	}
	if strings.TrimSpace(slot.CTALabelOverride) != "" {
		ctaLabel = strings.TrimSpace(slot.CTALabelOverride)
	}
	return PublicItem{
		SlotID:      slot.ID,
		Kind:        kind,
		FeatureID:   feature.ID,
		Name:        feature.Name,
		Tagline:     feature.Tagline,
		Icon:        feature.Icon,
		AccentColor: feature.AccentColor,
		Route:       feature.Route,
		CTALabel:    ctaLabel,
		Title:       name,
		Description: tagline,
		SortOrder:   slot.SortOrder,
	}, true
}

func (s *Service) fallbackItem(visible map[string]struct{}) (PublicItem, bool) {
	if slot, ok := s.fallbackSlot(DefaultFallbackFeatureID, visible); ok {
		return slot, true
	}
	ids := make([]string, 0, len(s.features))
	for id := range s.features {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if _, ok := visible[id]; !ok {
			continue
		}
		feature := s.features[id]
		if kindForRoute(feature.Route) == KindTool && s.featureSelectable(feature) {
			slot := Slot{
				ID:          "",
				FeatureID:   feature.ID,
				FeatureKind: KindTool,
				Enabled:     true,
				SortOrder:   0,
			}
			if item, ok := s.publicItem(slot); ok {
				return item, true
			}
		}
	}
	return PublicItem{}, false
}

func (s *Service) fallbackSlot(featureID string, visible map[string]struct{}) (PublicItem, bool) {
	if _, ok := visible[featureID]; !ok {
		return PublicItem{}, false
	}
	feature, ok := s.features[featureID]
	if !ok || !s.featureSelectable(feature) {
		return PublicItem{}, false
	}
	slot := Slot{
		ID:          "",
		FeatureID:   featureID,
		FeatureKind: kindForRoute(feature.Route),
		Enabled:     true,
		SortOrder:   0,
	}
	return s.publicItem(slot)
}

func (s *Service) slotActiveOn(slot Slot, date string) bool {
	if !slot.Enabled {
		return false
	}
	if slot.StartsOn != nil && strings.TrimSpace(*slot.StartsOn) != "" && date < strings.TrimSpace(*slot.StartsOn) {
		return false
	}
	if slot.EndsOn != nil && strings.TrimSpace(*slot.EndsOn) != "" && date > strings.TrimSpace(*slot.EndsOn) {
		return false
	}
	if len(slot.Weekdays) > 0 {
		parsed, err := time.Parse("2006-01-02", date)
		if err != nil {
			return false
		}
		weekday := int(parsed.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		for _, day := range slot.Weekdays {
			if day == weekday {
				return true
			}
		}
		return false
	}
	return true
}

func (s *Service) defaultFeatureLabel() string {
	if feature, ok := s.features[DefaultFallbackFeatureID]; ok {
		return feature.Name
	}
	return DefaultFallbackFeatureID
}

func slotFromInput(input SlotInput) Slot {
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	sortOrder := 0
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	}
	weekdays := make([]int, 0, len(input.Weekdays))
	for _, day := range input.Weekdays {
		weekdays = append(weekdays, day)
	}
	return Slot{
		FeatureID:           strings.TrimSpace(input.FeatureID),
		Enabled:             enabled,
		SortOrder:           sortOrder,
		StartsOn:            input.StartsOn,
		EndsOn:              input.EndsOn,
		Weekdays:            weekdays,
		TitleOverride:       strings.TrimSpace(input.TitleOverride),
		DescriptionOverride: strings.TrimSpace(input.DescriptionOverride),
		CTALabelOverride:    strings.TrimSpace(input.CTALabelOverride),
	}
}

func kindForRoute(route string) string {
	if strings.HasPrefix(route, "/games/") {
		return KindGame
	}
	return KindTool
}

func normalizeDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return ""
	}
	return parsed.Format("2006-01-02")
}

func validateDateRange(startsOn, endsOn *string) error {
	start := ""
	if startsOn != nil {
		start = normalizeDate(*startsOn)
		if start == "" && strings.TrimSpace(*startsOn) != "" {
			return ErrInvalidDateRange
		}
	}
	end := ""
	if endsOn != nil {
		end = normalizeDate(*endsOn)
		if end == "" && strings.TrimSpace(*endsOn) != "" {
			return ErrInvalidDateRange
		}
	}
	if start != "" && end != "" && start > end {
		return ErrInvalidDateRange
	}
	return nil
}

func validateWeekdays(weekdays []int) error {
	seen := make(map[int]struct{}, len(weekdays))
	for _, day := range weekdays {
		if day < 1 || day > 7 {
			return ErrInvalidWeekday
		}
		if _, exists := seen[day]; exists {
			return ErrInvalidWeekday
		}
		seen[day] = struct{}{}
	}
	return nil
}

func validateOverrideLength(field, value string, max int) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	length := utf8.RuneCountInString(value)
	if length < 2 || length > max {
		return fmt.Errorf("%w: %s length %d out of range", ErrInvalidOverride, field, length)
	}
	return nil
}
