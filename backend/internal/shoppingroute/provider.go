package shoppingroute

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultOpenFoodFactsBaseURL = "https://world.openfoodfacts.org"

type OpenFoodFactsProvider struct {
	baseURL string
	client  *http.Client
}

func NewOpenFoodFactsProvider(client *http.Client) *OpenFoodFactsProvider {
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	return &OpenFoodFactsProvider{
		baseURL: defaultOpenFoodFactsBaseURL,
		client:  client,
	}
}

func (p *OpenFoodFactsProvider) LookupProduct(ctx context.Context, barcode string) (*ProductMeta, error) {
	barcode = strings.TrimSpace(barcode)
	if !validBarcode(barcode) {
		return nil, nil
	}
	endpoint := fmt.Sprintf("%s/api/v2/product/%s.json?fields=product_name,product_name_zh,brands,categories_tags,image_front_url,code", p.baseURL, url.PathEscape(barcode))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "FunBox/1.0 (shopping route; https://github.com/406970112-sudo/funbox)")
	response, err := p.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Status  int `json:"status"`
		Product struct {
			ProductName    string   `json:"product_name"`
			ProductNameZH  string   `json:"product_name_zh"`
			Brands         string   `json:"brands"`
			CategoriesTags []string `json:"categories_tags"`
			ImageFrontURL  string   `json:"image_front_url"`
			Code           string   `json:"code"`
		} `json:"product"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	if payload.Status != 1 {
		return nil, nil
	}
	name := strings.TrimSpace(payload.Product.ProductNameZH)
	if name == "" {
		name = strings.TrimSpace(payload.Product.ProductName)
	}
	if name == "" {
		return nil, nil
	}
	return &ProductMeta{
		Name:      name,
		Brand:     strings.TrimSpace(payload.Product.Brands),
		Category:  firstOpenFoodCategory(payload.Product.CategoriesTags),
		ImageURL:  strings.TrimSpace(payload.Product.ImageFrontURL),
		Source:    SourceOpenFoodFacts,
		FetchedAt: time.Now().UnixMilli(),
	}, nil
}

func validBarcode(barcode string) bool {
	if len(barcode) < 8 || len(barcode) > 14 {
		return false
	}
	for _, r := range barcode {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func firstOpenFoodCategory(tags []string) string {
	for _, tag := range tags {
		if strings.HasPrefix(tag, "en:") {
			return strings.TrimPrefix(tag, "en:")
		}
	}
	if len(tags) > 0 {
		return tags[0]
	}
	return ""
}
