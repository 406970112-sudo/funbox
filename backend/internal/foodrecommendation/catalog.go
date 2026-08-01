package foodrecommendation

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed catalog.json
var catalogJSON []byte

type Catalog []Dish

func LoadCatalog() (Catalog, error) {
	var catalog Catalog
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		return nil, fmt.Errorf("decode food catalog: %w", err)
	}
	if len(catalog) == 0 {
		return nil, fmt.Errorf("food catalog is empty")
	}
	for _, dish := range catalog {
		if dish.ID == "" || dish.Name == "" || dish.City == "" || dish.District == "" || dish.Cuisine == "" {
			return nil, fmt.Errorf("food catalog contains an invalid entry")
		}
		if dish.Image.URL == "" || dish.Image.Source == "" {
			return nil, fmt.Errorf("dish %q has no valid image", dish.ID)
		}
		if len(dish.Ingredients) == 0 || len(dish.FlavorProfile) == 0 || len(dish.SuitableFor) == 0 || len(dish.Reasons) == 0 {
			return nil, fmt.Errorf("dish %q is missing structured food fields", dish.ID)
		}
		if dish.AvgPrice <= 0 || dish.Rating <= 0 {
			return nil, fmt.Errorf("dish %q has invalid price or rating", dish.ID)
		}
		if dish.Restaurant.Name == "" || dish.Restaurant.Address == "" || dish.Restaurant.OpenHours == "" {
			return nil, fmt.Errorf("dish %q has no complete restaurant info", dish.ID)
		}
	}
	return catalog, nil
}
