package priceradar

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBaseURL = "https://pfsc.agri.cn"
	pfscAESKey     = "7s9K$pG2xQ8zR5mB7vA3sD9fH2jW40cV"
)

type Config struct {
	BaseURL        string
	CacheTTL       time.Duration
	RequestTimeout time.Duration
}

type Provider struct {
	cfg    Config
	client *http.Client

	mu        sync.Mutex
	catalog   []Product
	catalogAt time.Time
	markets   map[string][]Market
	marketsAt map[string]time.Time
	prices    map[string][]OfficialPrice
	pricesAt  map[string]time.Time
}

type categoryItem struct {
	ID              string `json:"id"`
	VarietyTypeName string `json:"varietyTypeName"`
	VarietyTypeCode string `json:"varietyTypeCode"`
}

type varietyItem struct {
	ID              string `json:"id"`
	VarietyTypeName string `json:"varietyTypeName"`
	VarietyTypeCode string `json:"varietyTypeCode"`
	VarietyCode     string `json:"varietyCode"`
	VarietyName     string `json:"varietyName"`
	MeteringUnit    string `json:"meteringUnit"`
}

type marketItem struct {
	ID             string `json:"id"`
	MarketName     string `json:"marketName"`
	EnterpriseName string `json:"enterpriseName"`
	Province       string `json:"province"`
	ProvinceName   string `json:"provinceName"`
	Address        string `json:"address"`
	Longitude      string `json:"longitude"`
	Latitude       string `json:"latitude"`
}

type chartPayload struct {
	Date string    `json:"date"`
	X    []string  `json:"x"`
	Y    []float64 `json:"y"`
}

type rawResponse struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Content json.RawMessage `json:"content"`
	Data    string          `json:"data"`
}

func NewProvider(cfg Config) *Provider {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		cfg.BaseURL = defaultBaseURL
	}
	cfg.BaseURL = strings.TrimRight(cfg.BaseURL, "/")
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 15 * time.Second
	}
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 15 * time.Minute
	}
	return &Provider{
		cfg:       cfg,
		client:    &http.Client{Timeout: cfg.RequestTimeout},
		markets:   map[string][]Market{},
		marketsAt: map[string]time.Time{},
		prices:    map[string][]OfficialPrice{},
		pricesAt:  map[string]time.Time{},
	}
}

func (p *Provider) SearchProduct(ctx context.Context, query string) (Product, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return Product{}, fmt.Errorf("%w: empty query", ErrInvalidInput)
	}
	catalog, err := p.productCatalog(ctx)
	if err != nil {
		return Product{}, err
	}
	lower := strings.ToLower(query)
	for _, product := range catalog {
		if strings.Contains(strings.ToLower(product.Name), lower) {
			return product, nil
		}
	}
	return Product{}, fmt.Errorf("%w: %s", ErrProductNotFound, query)
}

func (p *Provider) ProductByID(ctx context.Context, productID string) (Product, error) {
	productID = strings.TrimSpace(productID)
	if productID == "" {
		return Product{}, fmt.Errorf("%w: empty product id", ErrInvalidInput)
	}
	catalog, err := p.productCatalog(ctx)
	if err != nil {
		return Product{}, err
	}
	for _, product := range catalog {
		if product.ID == productID {
			return product, nil
		}
	}
	return Product{}, fmt.Errorf("%w: %s", ErrProductNotFound, productID)
}

func (p *Provider) MarketsByProvince(ctx context.Context, provinceCode string) ([]Market, error) {
	provinceCode = strings.TrimSpace(provinceCode)
	if provinceCode == "" {
		provinceCode = "310000"
	}
	p.mu.Lock()
	if items, ok := p.markets[provinceCode]; ok && time.Since(p.marketsAt[provinceCode]) < p.cfg.CacheTTL {
		p.mu.Unlock()
		return items, nil
	}
	p.mu.Unlock()

	params := url.Values{}
	params.Set("code", provinceCode)
	raw, err := p.postJSON(ctx, "/api/priceQuotationController/getMarketByProvinceCode", params, nil)
	if err != nil {
		return nil, err
	}
	var response rawResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, fmt.Errorf("%w: decode market response: %v", ErrSourceInvalid, err)
	}
	if response.Code != 200 {
		return nil, fmt.Errorf("%w: market response code %d", ErrSourceUnavailable, response.Code)
	}
	var items []marketItem
	if err := json.Unmarshal(response.Content, &items); err != nil {
		return nil, fmt.Errorf("%w: decode markets: %v", ErrSourceInvalid, err)
	}
	markets := make([]Market, 0, len(items))
	for _, item := range items {
		market := Market{
			ID:             item.ID,
			Name:           item.MarketName,
			EnterpriseName: item.EnterpriseName,
			ProvinceCode:   provinceCode,
			ProvinceName:   item.ProvinceName,
			Address:        item.Address,
		}
		market.Latitude, _ = strconv.ParseFloat(item.Latitude, 64)
		market.Longitude, _ = strconv.ParseFloat(item.Longitude, 64)
		markets = append(markets, market)
	}
	p.mu.Lock()
	p.markets[provinceCode] = markets
	p.marketsAt[provinceCode] = time.Now()
	p.mu.Unlock()
	return markets, nil
}

func (p *Provider) OfficialPrices(
	ctx context.Context,
	productID string,
	marketIDs []string,
	provinceCode string,
) ([]OfficialPrice, error) {
	provinceCode = strings.TrimSpace(provinceCode)
	if provinceCode == "" {
		provinceCode = "310000"
	}
	key := provinceCode + "|" + strings.Join(marketIDs, ",") + "|" + productID
	p.mu.Lock()
	if items, ok := p.prices[key]; ok && time.Since(p.pricesAt[key]) < p.cfg.CacheTTL {
		p.mu.Unlock()
		return items, nil
	}
	p.mu.Unlock()

	params := url.Values{}
	params.Set("marketIDs", strings.Join(marketIDs, ","))
	params.Set("provinceCodes", provinceCode)
	params.Set("varietyID", productID)
	raw, err := p.postJSON(ctx, "/price_portal/index/getMarketReportPriceChart", params, nil)
	if err != nil {
		return nil, err
	}
	var response rawResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, fmt.Errorf("%w: decode chart response: %v", ErrSourceInvalid, err)
	}
	if response.Code != 0 && response.Code != 200 {
		return nil, fmt.Errorf("%w: chart response code %d", ErrSourceUnavailable, response.Code)
	}
	if strings.TrimSpace(response.Data) == "" {
		return nil, fmt.Errorf("%w: empty chart data", ErrSourceInvalid)
	}
	decrypted, err := decryptPfsc(response.Data)
	if err != nil {
		return nil, fmt.Errorf("%w: decrypt chart data: %v", ErrSourceInvalid, err)
	}
	var chart chartPayload
	if err := json.Unmarshal(decrypted, &chart); err != nil {
		return nil, fmt.Errorf("%w: decode chart payload: %v", ErrSourceInvalid, err)
	}

	markets, _ := p.MarketsByProvince(ctx, provinceCode)
	marketByEnterprise := map[string]Market{}
	for _, market := range markets {
		marketByEnterprise[market.EnterpriseName] = market
	}
	result := make([]OfficialPrice, 0, len(chart.X))
	for index := range chart.X {
		name := chart.X[index]
		marketID := ""
		shortName := name
		if market, ok := marketByEnterprise[name]; ok {
			marketID = market.ID
			shortName = market.Name
		}
		price := 0.0
		if index < len(chart.Y) {
			price = chart.Y[index]
		}
		result = append(result, OfficialPrice{
			MarketID:       marketID,
			MarketName:     shortName,
			EnterpriseName: name,
			Price:          price,
			Unit:           UnitPerKg,
			CapturedAt:     chart.Date,
			Source:         "农业农村部信息中心",
			SourceURL:      p.cfg.BaseURL + "/#/priceMarket",
		})
	}
	p.mu.Lock()
	p.prices[key] = result
	p.pricesAt[key] = time.Now()
	p.mu.Unlock()
	return result, nil
}

func (p *Provider) productCatalog(ctx context.Context) ([]Product, error) {
	p.mu.Lock()
	if p.catalog != nil && time.Since(p.catalogAt) < p.cfg.CacheTTL {
		catalog := p.catalog
		p.mu.Unlock()
		return catalog, nil
	}
	p.mu.Unlock()

	categories, err := p.categories(ctx)
	if err != nil {
		return nil, err
	}
	catalog := make([]Product, 0, 500)
	for _, category := range categories {
		params := url.Values{}
		params.Set("pid", category.VarietyTypeCode)
		raw, requestErr := p.postJSON(ctx, "/api/priceQuotationController/getVarietyNameByPid", params, nil)
		if requestErr != nil {
			continue
		}
		var response rawResponse
		if jsonErr := json.Unmarshal(raw, &response); jsonErr != nil || response.Code != 200 {
			continue
		}
		var groups [][]varietyItem
		if jsonErr := json.Unmarshal(response.Content, &groups); jsonErr != nil {
			var flat []varietyItem
			if flatErr := json.Unmarshal(response.Content, &flat); flatErr != nil {
				continue
			}
			groups = append(groups, flat)
		}
		for _, group := range groups {
			for _, item := range group {
				unit := item.MeteringUnit
				if unit == "" {
					unit = UnitPerKg
				}
				catalog = append(catalog, Product{
					ID:          item.ID,
					Name:        item.VarietyName,
					Category:    category.VarietyTypeName,
					SubCategory: item.VarietyTypeName,
					Code:        item.VarietyCode,
					Unit:        unit,
				})
			}
		}
	}
	if len(catalog) == 0 {
		return nil, fmt.Errorf("%w: empty product catalog", ErrSourceInvalid)
	}
	p.mu.Lock()
	p.catalog = catalog
	p.catalogAt = time.Now()
	p.mu.Unlock()
	return catalog, nil
}

func (p *Provider) categories(ctx context.Context) ([]categoryItem, error) {
	raw, err := p.postJSON(ctx, "/api/priceQuotationController/getVarietyMajorCategories", url.Values{}, nil)
	if err != nil {
		return nil, err
	}
	var response rawResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, fmt.Errorf("%w: decode category response: %v", ErrSourceInvalid, err)
	}
	if response.Code != 200 {
		return nil, fmt.Errorf("%w: category response code %d", ErrSourceUnavailable, response.Code)
	}
	var items []categoryItem
	if err := json.Unmarshal(response.Content, &items); err != nil {
		return nil, fmt.Errorf("%w: decode categories: %v", ErrSourceInvalid, err)
	}
	return items, nil
}

func (p *Provider) postJSON(ctx context.Context, path string, params url.Values, body any) ([]byte, error) {
	endpoint := p.cfg.BaseURL + path
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("encode request body: %w", err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, reader)
	if err != nil {
		return nil, fmt.Errorf("build price radar request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	req.Header.Set("Referer", p.cfg.BaseURL+"/")
	req.Header.Set("Origin", p.cfg.BaseURL)
	req.Header.Set("Sec-Ch-Ua", `"Chromium";v="146", "Not.A/Brand";v="24", "Microsoft Edge";v="146"`)
	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	req.Header.Set("Sec-Ch-Ua-Platform", `"Windows"`)
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: source status %d", ErrSourceUnavailable, resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: read source body: %v", ErrSourceUnavailable, err)
	}
	return raw, nil
}

func decryptPfsc(value string) ([]byte, error) {
	plain := []byte(value)
	if len(plain) < 16 {
		return nil, fmt.Errorf("cipher text too short")
	}
	iv := plain[:16]
	encoded := plain[16:]
	cipherText, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher([]byte(pfscAESKey))
	if err != nil {
		return nil, err
	}
	if len(cipherText)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("cipher text not block aligned")
	}
	decrypted := make([]byte, len(cipherText))
	mode := cipher.NewCBCDecrypter(block, iv)
	mode.CryptBlocks(decrypted, cipherText)
	return pkcs7Unpad(decrypted)
}

func pkcs7Unpad(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty decrypted data")
	}
	padding := int(data[len(data)-1])
	if padding <= 0 || padding > aes.BlockSize || padding > len(data) {
		return nil, fmt.Errorf("invalid pkcs7 padding")
	}
	return data[:len(data)-padding], nil
}
