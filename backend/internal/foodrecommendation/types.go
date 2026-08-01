package foodrecommendation

import "time"

type Request struct {
	Query           string   `json:"query"`
	City            string   `json:"city,omitempty"`
	District        string   `json:"district,omitempty"`
	Cuisines        []string `json:"cuisines,omitempty"`
	Spiciness       []string `json:"spiciness,omitempty"`
	PriceMin        *int     `json:"priceMin,omitempty"`
	PriceMax        *int     `json:"priceMax,omitempty"`
	DistanceMaxKm   *float64 `json:"distanceMaxKm,omitempty"`
	Dietary         []string `json:"dietary,omitempty"`
	Scenarios       []string `json:"scenarios,omitempty"`
	PreviousQueryID string   `json:"previousQueryId,omitempty"`
}

type ImageInfo struct {
	URL    string `json:"url"`
	Source string `json:"source"`
	Credit string `json:"credit,omitempty"`
}

type RestaurantInfo struct {
	Name       string  `json:"name"`
	Address    string  `json:"address"`
	OpenHours  string  `json:"openHours"`
	DistanceKm float64 `json:"distanceKm"`
	Rating     float64 `json:"rating"`
}

type Reason struct {
	Label string `json:"label"`
	Text  string `json:"text"`
}

type Dish struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	City          string         `json:"city"`
	District      string         `json:"district"`
	Cuisine       string         `json:"cuisine"`
	Image         ImageInfo      `json:"image"`
	Ingredients   []string       `json:"ingredients"`
	FlavorProfile []string       `json:"flavorProfile"`
	Spiciness     string         `json:"spiciness"`
	AvgPrice      int            `json:"avgPrice"`
	Rating        float64        `json:"rating"`
	Restaurant    RestaurantInfo `json:"restaurant"`
	BestTime      string         `json:"bestTime"`
	SuitableFor   []string       `json:"suitableFor"`
	Reasons       []Reason       `json:"reasons"`
	FitTags       []string       `json:"fitTags"`
	Source        string         `json:"source"`
	UpdatedAt     string         `json:"updatedAt"`
}

type Item struct {
	DishID        string         `json:"dishId"`
	Name          string         `json:"name"`
	Cuisine       string         `json:"cuisine"`
	City          string         `json:"city"`
	District      string         `json:"district"`
	Image         ImageInfo      `json:"image"`
	Ingredients   []string       `json:"ingredients"`
	FlavorProfile []string       `json:"flavorProfile"`
	Spiciness     string         `json:"spiciness"`
	AvgPrice      int            `json:"avgPrice"`
	Rating        float64        `json:"rating"`
	DistanceKm    float64        `json:"distanceKm"`
	Restaurant    RestaurantInfo `json:"restaurant"`
	BestTime      string         `json:"bestTime"`
	SuitableFor   []string       `json:"suitableFor"`
	Reasons       []Reason       `json:"reasons"`
	FitScore      int            `json:"fitScore"`
	Source        string         `json:"source"`
	UpdatedAt     string         `json:"updatedAt"`
}

type FilterOption struct {
	Min   *float64 `json:"min,omitempty"`
	Max   *float64 `json:"max,omitempty"`
	Label string   `json:"label"`
}

type AvailableFilters struct {
	Cuisines       []string       `json:"cuisines"`
	Spiciness      []string       `json:"spiciness"`
	PriceRanges    []FilterOption `json:"priceRanges"`
	DistanceRanges []FilterOption `json:"distanceRanges"`
	Dietary        []string       `json:"dietary"`
	Scenarios      []string       `json:"scenarios"`
}

type Response struct {
	QueryID          string           `json:"queryId"`
	City             string           `json:"city"`
	District         string           `json:"district"`
	Summary          string           `json:"summary"`
	Items            []Item           `json:"items"`
	AvailableFilters AvailableFilters `json:"availableFilters"`
	AI               string           `json:"ai"`
	Disclaimer       string           `json:"disclaimer"`
	GeneratedAt      string           `json:"generatedAt"`
}

type CatalogResponse struct {
	Dishes    []Dish `json:"dishes"`
	UpdatedAt string `json:"updatedAt"`
}

type FeedbackInput struct {
	QueryID string `json:"queryId"`
	DishID  string `json:"dishId"`
	Helpful bool   `json:"helpful"`
	Note    string `json:"note,omitempty"`
}

type HistoryItem struct {
	QueryID   string `json:"queryId"`
	Query     string `json:"query"`
	City      string `json:"city"`
	District  string `json:"district"`
	Summary   string `json:"summary"`
	DishCount int    `json:"dishCount"`
	CreatedAt string `json:"createdAt"`
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
