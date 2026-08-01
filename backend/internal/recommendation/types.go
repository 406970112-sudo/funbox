package recommendation

import "time"

type Request struct {
	Query         string   `json:"query"`
	Category      string   `json:"category"`
	BudgetMin     *int     `json:"budgetMin,omitempty"`
	BudgetMax     *int     `json:"budgetMax,omitempty"`
	Brands        []string `json:"brands,omitempty"`
	Scenarios     []string `json:"scenarios,omitempty"`
	Platforms     []string `json:"platforms,omitempty"`
	PreviousQuery string   `json:"previousQueryId,omitempty"`
}

type Link struct {
	Platform string `json:"platform"`
	Label    string `json:"label"`
	URL      string `json:"url"`
}

type Product struct {
	ID             string            `json:"id"`
	Category       string            `json:"category"`
	Name           string            `json:"name"`
	Brand          string            `json:"brand"`
	Tagline        string            `json:"tagline"`
	ReferencePrice int               `json:"referencePrice"`
	PriceSource    string            `json:"priceSource"`
	Specs          map[string]string `json:"specs"`
	Links          []Link            `json:"links"`
	FitTags        []string          `json:"fitTags"`
	Note           string            `json:"note,omitempty"`
}

type Reason struct {
	Label string `json:"label"`
	Text  string `json:"text"`
}

type Item struct {
	ProductID      string            `json:"productId"`
	Name           string            `json:"name"`
	Brand          string            `json:"brand"`
	FitScore       int               `json:"fitScore"`
	ReferencePrice int               `json:"referencePrice"`
	PriceSource    string            `json:"priceSource"`
	Reasons        []Reason          `json:"reasons"`
	SuitableFor    string            `json:"suitableFor"`
	Specs          map[string]string `json:"specs"`
	Links          []Link            `json:"links"`
}

type Budget struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

type FilterOption struct {
	Min   *int   `json:"min,omitempty"`
	Max   *int   `json:"max,omitempty"`
	Label string `json:"label"`
}

type AvailableFilters struct {
	BudgetRanges []FilterOption `json:"budgetRanges"`
	Brands       []string       `json:"brands"`
	Scenarios    []string       `json:"scenarios"`
	Platforms    []string       `json:"platforms"`
}

type Response struct {
	QueryID          string           `json:"queryId"`
	Category         string           `json:"category"`
	Budget           *Budget          `json:"budget,omitempty"`
	Preferences      []string         `json:"preferences,omitempty"`
	Summary          string           `json:"summary"`
	Items            []Item           `json:"items"`
	AvailableFilters AvailableFilters `json:"availableFilters"`
	AI               string           `json:"ai"`
	Disclaimer       string           `json:"disclaimer"`
	GeneratedAt      string           `json:"generatedAt"`
}

type CatalogResponse struct {
	Products  []Product `json:"products"`
	UpdatedAt string    `json:"updatedAt"`
}

type FeedbackInput struct {
	QueryID   string `json:"queryId"`
	ProductID string `json:"productId"`
	Helpful   bool   `json:"helpful"`
	Note      string `json:"note,omitempty"`
}

type HistoryItem struct {
	QueryID      string `json:"queryId"`
	Query        string `json:"query"`
	Category     string `json:"category"`
	Summary      string `json:"summary"`
	ProductCount int    `json:"productCount"`
	CreatedAt    string `json:"createdAt"`
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
