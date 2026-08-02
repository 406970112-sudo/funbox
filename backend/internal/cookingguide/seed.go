package cookingguide

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed seed.json
var seedJSON []byte

type SeedDish struct {
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

type Seed struct {
	Source    string     `json:"source"`
	FetchedAt string     `json:"fetchedAt"`
	Areas     []Area     `json:"areas"`
	Dishes    []SeedDish `json:"dishes"`
}

func LoadSeed() (Seed, error) {
	var seed Seed
	if err := json.Unmarshal(seedJSON, &seed); err != nil {
		return Seed{}, fmt.Errorf("decode cooking guide seed: %w", err)
	}
	if seed.Source == "" || seed.FetchedAt == "" {
		return Seed{}, fmt.Errorf("cooking guide seed is missing source metadata")
	}
	if len(seed.Areas) == 0 || len(seed.Dishes) == 0 {
		return Seed{}, fmt.Errorf("cooking guide seed is empty")
	}
	for _, dish := range seed.Dishes {
		if dish.ID == "" || dish.Name == "" || dish.Area == "" {
			return Seed{}, fmt.Errorf("cooking guide seed contains an invalid dish")
		}
		if dish.Image.URL == "" || dish.Image.Source == "" {
			return Seed{}, fmt.Errorf("dish %q has no valid image", dish.ID)
		}
		if len(dish.Ingredients) == 0 || len(dish.Steps) == 0 {
			return Seed{}, fmt.Errorf("dish %q is missing ingredients or steps", dish.ID)
		}
	}
	return seed, nil
}
