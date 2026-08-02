package cookingguide

import "time"

type ImageInfo struct {
	URL       string `json:"url"`
	Source    string `json:"source"`
	Credit    string `json:"credit,omitempty"`
	CheckedAt string `json:"checkedAt,omitempty"`
}

type Ingredient struct {
	Name    string `json:"name"`
	Measure string `json:"measure"`
}

type Area struct {
	Name  string `json:"name"`
	Zh    string `json:"zh"`
	Count int    `json:"count"`
}

type AreasResponse struct {
	Items     []Area `json:"items"`
	FetchedAt string `json:"fetchedAt"`
	Source    string `json:"source"`
}

type DishSummary struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	NameZh          string    `json:"nameZh"`
	Area            string    `json:"area"`
	AreaZh          string    `json:"areaZh"`
	Category        string    `json:"category"`
	Tags            []string  `json:"tags"`
	Image           ImageInfo `json:"image"`
	IngredientCount int       `json:"ingredientCount"`
	StepCount       int       `json:"stepCount"`
}

type DishListResponse struct {
	Items     []DishSummary `json:"items"`
	Total     int           `json:"total"`
	FetchedAt string        `json:"fetchedAt"`
	Source    string        `json:"source"`
}

type DishDetail struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	NameZh       string       `json:"nameZh"`
	Area         string       `json:"area"`
	AreaZh       string       `json:"areaZh"`
	Category     string       `json:"category"`
	Tags         []string     `json:"tags"`
	Image        ImageInfo    `json:"image"`
	Ingredients  []Ingredient `json:"ingredients"`
	Steps        []string     `json:"steps"`
	RecipeSource string       `json:"recipeSource"`
	VideoURL     string       `json:"videoUrl"`
	License      string       `json:"license"`
	FetchedAt    string       `json:"fetchedAt"`
}

type ShoppingListResponse struct {
	DishID string       `json:"dishId"`
	Items  []Ingredient `json:"items"`
}

type SessionInput struct {
	DishID    string `json:"dishId"`
	StepIndex int    `json:"stepIndex"`
	Completed *bool  `json:"completed,omitempty"`
}

type Session struct {
	DishID     string `json:"dishId"`
	Name       string `json:"name"`
	NameZh     string `json:"nameZh"`
	StepIndex  int    `json:"stepIndex"`
	TotalSteps int    `json:"totalSteps"`
	Completed  bool   `json:"completed"`
	UpdatedAt  string `json:"updatedAt"`
}

type HistoryItem struct {
	DishID    string `json:"dishId"`
	Name      string `json:"name"`
	NameZh    string `json:"nameZh"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"createdAt"`
}

type FeedbackInput struct {
	DishID  string `json:"dishId"`
	Helpful bool   `json:"helpful"`
	Note    string `json:"note,omitempty"`
}

type ContributionInput struct {
	Name         string   `json:"name"`
	NameZh       string   `json:"nameZh"`
	Area         string   `json:"area"`
	Category     string   `json:"category"`
	ImageURL     string   `json:"imageUrl"`
	RecipeSource string   `json:"recipeSource"`
	Ingredients  []string `json:"ingredients"`
	Steps        []string `json:"steps"`
}

type Contribution struct {
	ID           string   `json:"id"`
	Status       string   `json:"status"`
	Name         string   `json:"name"`
	NameZh       string   `json:"nameZh"`
	Area         string   `json:"area"`
	Category     string   `json:"category"`
	ImageURL     string   `json:"imageUrl"`
	RecipeSource string   `json:"recipeSource"`
	Ingredients  []string `json:"ingredients"`
	Steps        []string `json:"steps"`
	CreatedAt    string   `json:"createdAt"`
	ReviewedAt   string   `json:"reviewedAt,omitempty"`
	ReviewNote   string   `json:"reviewNote,omitempty"`
}

const (
	ContributionPending  = "pending"
	ContributionApproved = "approved"
	ContributionRejected = "rejected"
)

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
