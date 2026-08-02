package cookingguide

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

var ErrDishNotFound = errors.New("cooking guide dish not found")

type Service struct {
	seed  Seed
	store *Store
}

func NewService(store *Store) *Service {
	seed, err := LoadSeed()
	if err != nil {
		panic(err)
	}
	return &Service{seed: seed, store: store}
}

func (s *Service) Areas() AreasResponse {
	return AreasResponse{
		Items:     append([]Area(nil), s.seed.Areas...),
		FetchedAt: s.seed.FetchedAt,
		Source:    s.seed.Source,
	}
}

func (s *Service) Search(_ context.Context, query, area, category, tag string, limit int) DishListResponse {
	query = strings.ToLower(strings.TrimSpace(query))
	area = strings.TrimSpace(area)
	category = strings.TrimSpace(category)
	tag = strings.TrimSpace(tag)
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	items := []DishSummary{}
	for _, dish := range s.seed.Dishes {
		if area != "" && !matchesArea(dish, area) {
			continue
		}
		if category != "" && !strings.EqualFold(dish.Category, category) {
			continue
		}
		if tag != "" && !containsFold(dish.Tags, tag) {
			continue
		}
		if query != "" && !matchesQuery(dish, query) {
			continue
		}
		items = append(items, summarizeDish(dish))
		if len(items) >= limit {
			break
		}
	}
	return DishListResponse{
		Items:     items,
		Total:     len(items),
		FetchedAt: s.seed.FetchedAt,
		Source:    s.seed.Source,
	}
}

func (s *Service) Detail(_ context.Context, id string) (DishDetail, error) {
	dish, ok := s.findDish(strings.TrimSpace(id))
	if !ok {
		return DishDetail{}, ErrDishNotFound
	}
	return DishDetail{
		ID:           dish.ID,
		Name:         dish.Name,
		NameZh:       dish.NameZh,
		Area:         dish.Area,
		AreaZh:       dish.AreaZh,
		Category:     dish.Category,
		Tags:         append([]string(nil), dish.Tags...),
		Image:        dish.Image,
		Ingredients:  append([]Ingredient(nil), dish.Ingredients...),
		Steps:        append([]string(nil), dish.Steps...),
		RecipeSource: dish.RecipeSource,
		VideoURL:     dish.VideoURL,
		License:      dish.License,
		FetchedAt:    dish.FetchedAt,
	}, nil
}

func (s *Service) ShoppingList(_ context.Context, id string) (ShoppingListResponse, error) {
	dish, ok := s.findDish(strings.TrimSpace(id))
	if !ok {
		return ShoppingListResponse{}, ErrDishNotFound
	}
	return ShoppingListResponse{
		DishID: dish.ID,
		Items:  append([]Ingredient(nil), dish.Ingredients...),
	}, nil
}

func (s *Service) SaveSession(ctx context.Context, userID string, input SessionInput) (Session, error) {
	dish, ok := s.findDish(strings.TrimSpace(input.DishID))
	if !ok {
		return Session{}, ErrDishNotFound
	}
	total := len(dish.Steps)
	completed := input.Completed != nil && *input.Completed
	stepIndex := input.StepIndex
	if stepIndex < 0 {
		stepIndex = 0
	}
	if stepIndex >= total {
		stepIndex = total - 1
	}
	if completed {
		stepIndex = total - 1
	}
	if s.store == nil {
		return Session{
			DishID:     dish.ID,
			Name:       dish.Name,
			NameZh:     dish.NameZh,
			StepIndex:  stepIndex,
			TotalSteps: total,
			Completed:  completed,
			UpdatedAt:  nowISO(),
		}, nil
	}
	return s.store.UpsertSession(ctx, userID, Session{
		DishID:     dish.ID,
		Name:       dish.Name,
		NameZh:     dish.NameZh,
		StepIndex:  stepIndex,
		TotalSteps: total,
		Completed:  completed,
		UpdatedAt:  nowISO(),
	})
}

func (s *Service) RecordView(ctx context.Context, userID, dishID string) error {
	if _, ok := s.findDish(strings.TrimSpace(dishID)); !ok {
		return ErrDishNotFound
	}
	if s.store == nil {
		return nil
	}
	return s.store.RecordView(ctx, userID, strings.TrimSpace(dishID))
}

func (s *Service) History(ctx context.Context, userID string, limit int) ([]HistoryItem, error) {
	if s.store == nil {
		return []HistoryItem{}, nil
	}
	items, err := s.store.ListHistory(ctx, userID, limit)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if dish, ok := s.findDish(items[i].DishID); ok {
			items[i].Name = dish.Name
			items[i].NameZh = dish.NameZh
		}
	}
	return items, nil
}

func (s *Service) Feedback(ctx context.Context, userID string, input FeedbackInput) error {
	input.DishID = strings.TrimSpace(input.DishID)
	input.Note = strings.TrimSpace(input.Note)
	if _, ok := s.findDish(input.DishID); !ok {
		return ErrDishNotFound
	}
	if len([]rune(input.Note)) > 200 {
		return fmt.Errorf("note exceeds 200 characters")
	}
	if s.store == nil {
		return nil
	}
	return s.store.SaveFeedback(ctx, userID, input)
}

func (s *Service) ListFavorites(ctx context.Context, userID string) ([]DishSummary, error) {
	if s.store == nil {
		return []DishSummary{}, nil
	}
	ids, err := s.store.ListFavorites(ctx, userID)
	if err != nil {
		return nil, err
	}
	items := []DishSummary{}
	for _, id := range ids {
		if dish, ok := s.findDish(id); ok {
			items = append(items, summarizeDish(dish))
		}
	}
	return items, nil
}

func (s *Service) AddFavorite(ctx context.Context, userID, dishID string) error {
	dishID = strings.TrimSpace(dishID)
	if _, ok := s.findDish(dishID); !ok {
		return ErrDishNotFound
	}
	if s.store == nil {
		return nil
	}
	return s.store.AddFavorite(ctx, userID, dishID)
}

func (s *Service) RemoveFavorite(ctx context.Context, userID, dishID string) error {
	dishID = strings.TrimSpace(dishID)
	if s.store == nil {
		return nil
	}
	return s.store.RemoveFavorite(ctx, userID, dishID)
}

func (s *Service) CreateContribution(ctx context.Context, userID string, input ContributionInput) (Contribution, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Area = strings.TrimSpace(input.Area)
	input.NameZh = strings.TrimSpace(input.NameZh)
	input.Category = strings.TrimSpace(input.Category)
	input.ImageURL = strings.TrimSpace(input.ImageURL)
	input.RecipeSource = strings.TrimSpace(input.RecipeSource)
	input.Ingredients = normalizeNonEmpty(input.Ingredients)
	input.Steps = normalizeNonEmpty(input.Steps)
	if input.Name == "" || input.Area == "" {
		return Contribution{}, fmt.Errorf("name and area are required")
	}
	if len(input.Ingredients) == 0 || len(input.Steps) == 0 {
		return Contribution{}, fmt.Errorf("ingredients and steps are required")
	}
	if s.store == nil {
		return Contribution{}, fmt.Errorf("contribution storage is unavailable")
	}
	return s.store.CreateContribution(ctx, userID, input)
}

func (s *Service) ListContributions(ctx context.Context, status string) ([]Contribution, error) {
	if s.store == nil {
		return []Contribution{}, nil
	}
	return s.store.ListContributions(ctx, strings.TrimSpace(status))
}

func (s *Service) ReviewContribution(ctx context.Context, contributionID, status, reviewerID, note string) (Contribution, error) {
	status = strings.TrimSpace(status)
	switch status {
	case ContributionPending, ContributionApproved, ContributionRejected:
	default:
		return Contribution{}, fmt.Errorf("invalid review status")
	}
	if s.store == nil {
		return Contribution{}, fmt.Errorf("contribution storage is unavailable")
	}
	return s.store.UpdateContributionStatus(ctx, contributionID, status, reviewerID, strings.TrimSpace(note))
}

func (s *Service) findDish(id string) (SeedDish, bool) {
	for _, dish := range s.seed.Dishes {
		if dish.ID == id {
			return dish, true
		}
	}
	return SeedDish{}, false
}

func summarizeDish(dish SeedDish) DishSummary {
	return DishSummary{
		ID:              dish.ID,
		Name:            dish.Name,
		NameZh:          dish.NameZh,
		Area:            dish.Area,
		AreaZh:          dish.AreaZh,
		Category:        dish.Category,
		Tags:            append([]string(nil), dish.Tags...),
		Image:           dish.Image,
		IngredientCount: len(dish.Ingredients),
		StepCount:       len(dish.Steps),
	}
}

func matchesArea(dish SeedDish, area string) bool {
	return strings.EqualFold(dish.Area, area) || strings.EqualFold(dish.AreaZh, area)
}

func matchesQuery(dish SeedDish, query string) bool {
	haystack := strings.ToLower(strings.Join([]string{
		dish.Name,
		dish.NameZh,
		dish.Area,
		dish.AreaZh,
		dish.Category,
		strings.Join(dish.Tags, " "),
	}, " "))
	for _, ingredient := range dish.Ingredients {
		haystack += " " + strings.ToLower(ingredient.Name)
	}
	return strings.Contains(haystack, query)
}

func containsFold(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}

func normalizeNonEmpty(values []string) []string {
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}
