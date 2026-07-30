package resourcesearch

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var sizePattern = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)`)

type laoerProvider struct {
	baseURL string
	client  *http.Client
}

type laoerSearchItem struct {
	IsType int    `json:"is_type"`
	Title  string `json:"title"`
	URL    string `json:"url"`
}

func newLaoerProvider(client *http.Client, baseURL string) *laoerProvider {
	return &laoerProvider{baseURL: strings.TrimRight(baseURL, "/"), client: client}
}

func (p *laoerProvider) SourceID() string {
	return laoerSourceID
}

func (p *laoerProvider) Search(ctx context.Context, query string, limit int) ([]providerResult, error) {
	endpoint := p.baseURL + "/api/other/web_search?title=" + url.QueryEscape(query) + "&is_type=0"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Referer", laoerSearchURL(query))
	request.Header.Set("User-Agent", "FunBox/1.0 resource-search")

	response, err := p.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("laoer search returned status %d", response.StatusCode)
	}

	results := make([]providerResult, 0, limit)
	seen := make(map[string]struct{})
	scanner := bufio.NewScanner(io.LimitReader(response.Body, 2<<20))
	scanner.Buffer(make([]byte, 4096), 256<<10)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			break
		}
		var item laoerSearchItem
		if err := json.Unmarshal([]byte(payload), &item); err != nil {
			continue
		}
		item.Title = cleanLaoerTitle(item.Title)
		if item.Title == "" || item.URL == "" {
			continue
		}
		if _, exists := seen[item.URL]; exists {
			continue
		}
		seen[item.URL] = struct{}{}
		results = append(results, providerResult{
			Category:  "网盘资源",
			DiskType:  laoerDiskType(item.IsType),
			Reference: item.URL,
			Size:      extractSize(item.Title),
			Title:     item.Title,
		})
		if len(results) >= limit {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func (p *laoerProvider) Resolve(ctx context.Context, item providerResult) (ResolvedResult, error) {
	body, err := json.Marshal(map[string]string{
		"title": item.Title,
		"url":   url.QueryEscape(item.Reference),
	})
	if err != nil {
		return ResolvedResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/api/other/save_url", bytes.NewReader(body))
	if err != nil {
		return ResolvedResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Referer", p.baseURL+"/")
	request.Header.Set("User-Agent", "FunBox/1.0 resource-search")

	response, err := p.client.Do(request)
	if err != nil {
		return ResolvedResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ResolvedResult{}, fmt.Errorf("laoer resolve returned status %d", response.StatusCode)
	}
	var payload struct {
		Code int `json:"code"`
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&payload); err != nil {
		return ResolvedResult{}, err
	}
	if payload.Code != http.StatusOK {
		return ResolvedResult{}, fmt.Errorf("laoer resolve rejected request: %s", payload.Message)
	}
	parsed, err := url.Parse(payload.Data.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ResolvedResult{}, errors.New("laoer resolve returned invalid target url")
	}
	return ResolvedResult{TargetURL: parsed.String()}, nil
}

func cleanLaoerTitle(value string) string {
	value = strings.TrimSpace(value)
	for _, prefix := range []string{"名称：", "资源标题：", "片:"} {
		value = strings.TrimSpace(strings.TrimPrefix(value, prefix))
	}
	return value
}

func extractSize(value string) string {
	match := sizePattern.FindStringSubmatch(value)
	if len(match) != 3 {
		return ""
	}
	return strings.ToUpper(match[1] + " " + match[2])
}

func laoerDiskType(value int) string {
	switch value {
	case 1:
		return "阿里云盘"
	case 2:
		return "百度网盘"
	case 3:
		return "UC 网盘"
	case 4:
		return "迅雷网盘"
	default:
		return "夸克网盘"
	}
}
