package leftovermanager

import (
	"sort"
	"strings"
)

var RecipeLibrary = []Recipe{
	{
		ID:   "tomato-scrambled-eggs",
		Name: "西红柿炒鸡蛋",
		MainIngredients: []RecipeIngredient{
			{Keyword: "西红柿", Label: "西红柿", Quantity: "2 个"},
			{Keyword: "鸡蛋", Label: "鸡蛋", Quantity: "3 个"},
		},
		Seasonings:       []string{"食用油", "盐", "糖"},
		EstimatedMinutes: 15,
		Steps: []string{
			"西红柿切块，鸡蛋打散。",
			"热锅倒油，先炒鸡蛋后盛出。",
			"下西红柿炒出汁，加盐和糖调味。",
			"倒回鸡蛋翻匀即可。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "potato-luncheon-meat",
		Name: "土豆午餐肉",
		MainIngredients: []RecipeIngredient{
			{Keyword: "土豆", Label: "土豆", Quantity: "2 个"},
			{Keyword: "午餐肉", Label: "午餐肉", Quantity: "半盒"},
		},
		Seasonings:       []string{"食用油", "盐", "生抽"},
		EstimatedMinutes: 20,
		Steps: []string{
			"土豆切小块，午餐肉切丁。",
			"锅中倒油，先煎土豆至边缘微黄。",
			"加入午餐肉炒香。",
			"加少量水焖熟，用盐和生抽调味。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "tomato-egg-fried-rice",
		Name: "西红柿鸡蛋炒饭",
		MainIngredients: []RecipeIngredient{
			{Keyword: "米饭", Label: "米饭", Quantity: "1 碗"},
			{Keyword: "西红柿", Label: "西红柿", Quantity: "1 个"},
			{Keyword: "鸡蛋", Label: "鸡蛋", Quantity: "2 个"},
		},
		Seasonings:       []string{"食用油", "盐"},
		EstimatedMinutes: 18,
		Steps: []string{
			"西红柿切丁，鸡蛋打散。",
			"炒熟鸡蛋后加入西红柿丁。",
			"倒入米饭炒散，加盐调味。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "luncheon-meat-fried-rice",
		Name: "午餐肉炒饭",
		MainIngredients: []RecipeIngredient{
			{Keyword: "米饭", Label: "米饭", Quantity: "1 碗"},
			{Keyword: "午餐肉", Label: "午餐肉", Quantity: "半盒"},
			{Keyword: "鸡蛋", Label: "鸡蛋", Quantity: "1 个"},
		},
		Seasonings:       []string{"食用油", "盐", "葱花"},
		EstimatedMinutes: 15,
		Steps: []string{
			"午餐肉切丁，鸡蛋打散。",
			"炒熟鸡蛋后加入午餐肉。",
			"倒入米饭炒散，加盐调味。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "garlic-broccoli",
		Name: "蒜蓉西兰花",
		MainIngredients: []RecipeIngredient{
			{Keyword: "西兰花", Label: "西兰花", Quantity: "1 颗"},
			{Keyword: "大蒜", Label: "大蒜", Quantity: "3 瓣"},
		},
		Seasonings:       []string{"食用油", "盐"},
		EstimatedMinutes: 12,
		Steps: []string{
			"西兰花掰小朵，焯水后捞出。",
			"热锅倒油，下蒜末炒香。",
			"倒入西兰花翻炒，加盐出锅。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "cucumber-garlic-salad",
		Name: "凉拌黄瓜",
		MainIngredients: []RecipeIngredient{
			{Keyword: "黄瓜", Label: "黄瓜", Quantity: "1 根"},
			{Keyword: "大蒜", Label: "大蒜", Quantity: "2 瓣"},
		},
		Seasonings:       []string{"醋", "生抽", "香油", "盐"},
		EstimatedMinutes: 10,
		Steps: []string{
			"黄瓜拍碎切段。",
			"加蒜末、醋、生抽、香油和盐拌匀。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "braised-pork-fried-rice",
		Name: "红烧肉炒饭",
		MainIngredients: []RecipeIngredient{
			{Keyword: "米饭", Label: "米饭", Quantity: "1 碗"},
			{Keyword: "红烧肉", Label: "红烧肉", Quantity: "半碗"},
		},
		Seasonings:       []string{"食用油", "盐"},
		EstimatedMinutes: 12,
		Steps: []string{
			"红烧肉切小块。",
			"热锅后放入红烧肉炒热。",
			"倒入米饭炒散，按口味加盐。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
	{
		ID:   "strawberry-yogurt-bowl",
		Name: "草莓酸奶碗",
		MainIngredients: []RecipeIngredient{
			{Keyword: "草莓", Label: "草莓", Quantity: "半盒"},
			{Keyword: "酸奶", Label: "酸奶", Quantity: "1 杯"},
		},
		Seasonings:       []string{},
		EstimatedMinutes: 5,
		Steps: []string{
			"草莓洗净切块。",
			"倒入酸奶，撒上草莓即可。",
		},
		Source: "FunBox 家常菜谱库 V1",
	},
}

func FindRecipe(recipeID string) *Recipe {
	for i := range RecipeLibrary {
		if RecipeLibrary[i].ID == recipeID {
			return &RecipeLibrary[i]
		}
	}
	return nil
}

func BuildSuggestions(recipes []Recipe, items []Item, now int64) []RecipeMatch {
	matches := []RecipeMatch{}
	for _, recipe := range recipes {
		match := matchRecipe(recipe, items, now)
		if match != nil {
			matches = append(matches, *match)
		}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		left := matches[i].MatchPercent + matches[i].ExpiringCount*10
		right := matches[j].MatchPercent + matches[j].ExpiringCount*10
		if left != right {
			return left > right
		}
		return matches[i].EstimatedMinutes < matches[j].EstimatedMinutes
	})
	if len(matches) > 3 {
		matches = matches[:3]
	}
	return matches
}

func matchRecipe(recipe Recipe, items []Item, now int64) *RecipeMatch {
	if len(recipe.MainIngredients) == 0 {
		return nil
	}
	matched := make([]RecipeMatchedItem, 0, len(recipe.MainIngredients))
	missing := []string{}
	matchedItemIDs := map[string]bool{}
	expiringCount := 0
	for _, ingredient := range recipe.MainIngredients {
		found := false
		for _, item := range items {
			if item.Status != StatusActive || item.RemainingPercent <= 0 {
				continue
			}
			if !matchesIngredient(item, ingredient.Keyword) {
				continue
			}
			found = true
			if !matchedItemIDs[item.ID] {
				expiring := item.ExpectedConsumeAt > 0 && item.ExpectedConsumeAt <= now+24*60*60*1000
				matched = append(matched, RecipeMatchedItem{
					ItemID:         item.ID,
					Name:           item.Name,
					RemainingText:  item.RemainingText,
					ExpiringWithin: expiring,
				})
				matchedItemIDs[item.ID] = true
				if expiring {
					expiringCount++
				}
			}
			break
		}
		if !found {
			missing = append(missing, ingredient.Label+" "+ingredient.Quantity)
		}
	}
	if len(matched) == 0 {
		return nil
	}
	total := len(recipe.MainIngredients)
	percent := matchedCount(recipe.MainIngredients, items) * 100 / total
	return &RecipeMatch{
		RecipeID:         recipe.ID,
		Name:             recipe.Name,
		MatchPercent:     percent,
		MatchedCount:     len(matched),
		TotalCount:       total,
		EstimatedMinutes: recipe.EstimatedMinutes,
		Source:           recipe.Source,
		MatchedItems:     matched,
		Missing:          missing,
		ExpiringCount:    expiringCount,
	}
}

func matchedCount(ingredients []RecipeIngredient, items []Item) int {
	count := 0
	for _, ingredient := range ingredients {
		for _, item := range items {
			if item.Status == StatusActive && item.RemainingPercent > 0 && matchesIngredient(item, ingredient.Keyword) {
				count++
				break
			}
		}
	}
	return count
}

func matchesIngredient(item Item, keyword string) bool {
	if strings.Contains(item.Name, keyword) {
		return true
	}
	for _, tag := range item.Tags {
		if tag == keyword || strings.Contains(tag, keyword) {
			return true
		}
	}
	return false
}
