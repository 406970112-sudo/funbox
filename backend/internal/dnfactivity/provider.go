package dnfactivity

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

type Config struct {
	SourceURL          string
	RequestTimeout     time.Duration
	DetailTimeout      time.Duration
}

type Provider struct {
	cfg    Config
	client *http.Client
	detail *http.Client
}

type rawEvent struct {
	Title       string `json:"hdm_3953"`
	StartDate   string `json:"hdrlks_8746"`
	EndDate     string `json:"hdrljs_4715"`
	MobileURL   string `json:"hdrlmd_9188"`
	PCURL       string `json:"hdrlpc_3198"`
	MobileImage string `json:"hdrlmd_6170"`
	PCImage     string `json:"hdrlpc_2742"`
}

type rawEventsResponse struct {
	Events []rawEvent `json:"hdrllb_5208"`
}

var descriptionPattern = regexp.MustCompile(`(?is)<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']`)
var descriptionPatternAlt = regexp.MustCompile(`(?is)<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']`)
var charsetPattern = regexp.MustCompile(`(?i)charset=["']?([a-z0-9_-]+)`)

func NewProvider(cfg Config) *Provider {
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 15 * time.Second
	}
	if cfg.DetailTimeout <= 0 {
		cfg.DetailTimeout = 8 * time.Second
	}
	return &Provider{
		cfg: cfg,
		client: &http.Client{
			Timeout: cfg.RequestTimeout,
		},
		detail: &http.Client{
			Timeout: cfg.DetailTimeout,
		},
	}
}

func (p *Provider) FetchEvents(ctx context.Context) ([]rawEvent, error) {
	endpoint := strings.TrimSpace(p.cfg.SourceURL)
	if endpoint == "" {
		endpoint = "https://mdnf.qq.com/zlkdatasys/web202405_data/events_data.json"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("build dnf activity request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36")
	req.Header.Set("Accept", "application/json,text/plain,*/*")

	var raw []byte
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, requestErr := p.client.Do(req)
		if requestErr != nil {
			lastErr = requestErr
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("dnf activity source status %d", resp.StatusCode)
			continue
		}
		raw = body
		break
	}
	if raw == nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, lastErr)
	}

	var payload rawEventsResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceInvalid, err)
	}
	if len(payload.Events) == 0 {
		return nil, fmt.Errorf("%w: empty events", ErrSourceInvalid)
	}
	return payload.Events, nil
}

func (p *Provider) FetchDescription(ctx context.Context, pageURL string) (string, error) {
	pageURL = normalizeURL(pageURL)
	if pageURL == "" {
		return "", fmt.Errorf("%w: empty activity url", ErrInvalidInput)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36")
	resp, err := p.detail.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("activity page status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	text := decodeHTML(raw)
	for _, pattern := range []*regexp.Regexp{descriptionPattern, descriptionPatternAlt} {
		if match := pattern.FindStringSubmatch(text); len(match) == 2 {
			value := strings.TrimSpace(htmlUnescape(match[1]))
			if value != "" {
				return truncateRunes(value, 240), nil
			}
		}
	}
	return "", nil
}

func decodeHTML(raw []byte) string {
	head := raw
	if len(head) > 2048 {
		head = head[:2048]
	}
	charset := "utf-8"
	if match := charsetPattern.FindSubmatch(head); len(match) == 2 {
		charset = strings.ToLower(string(match[1]))
	}
	switch charset {
	case "gbk", "gb2312", "gb18030", "gbk2312":
		decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(raw)
		if err == nil && utf8.Valid(decoded) {
			return string(decoded)
		}
	}
	if utf8.Valid(raw) {
		return string(raw)
	}
	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(raw)
	if err == nil {
		return string(decoded)
	}
	return string(raw)
}

func htmlUnescape(value string) string {
	replacer := strings.NewReplacer(
		"&amp;", "&",
		"&quot;", `"`,
		"&#39;", "'",
		"&lt;", "<",
		"&gt;", ">",
		"&nbsp;", " ",
	)
	return replacer.Replace(value)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}

func normalizeURL(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "//") {
		return "https:" + value
	}
	return value
}

func sourceIDOf(event rawEvent) string {
	sum := sha1.Sum([]byte(event.Title + "|" + event.StartDate + "|" + event.EndDate + "|" + event.MobileURL + "|" + event.PCURL))
	return hex.EncodeToString(sum[:])
}
