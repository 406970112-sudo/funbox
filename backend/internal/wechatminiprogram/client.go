package wechatminiprogram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	defaultBaseURL        = "https://api.weixin.qq.com"
	defaultEnvVersion     = "release"
	defaultResponseLimit  = 2 << 20
	maxInviteSceneRunes   = 32
	tokenRefreshSafeDelta = 5 * time.Minute
)

var ErrCodeUnavailable = errors.New("wechat mini program code unavailable")

type Config struct {
	AppID          string
	AppSecret      string
	BaseURL        string
	Page           string
	EnvVersion     string
	Width          int
	CheckPath      bool
	RequestTimeout time.Duration
}

type Client struct {
	cfg        Config
	httpClient *http.Client
	now        func() time.Time

	tokenMu        sync.Mutex
	accessToken    string
	tokenExpiresAt time.Time
}

type APIError struct {
	Code    int
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("wechat api error %d: %s", e.Code, e.Message)
}

func NewClient(cfg Config) (*Client, error) {
	cfg.AppID = strings.TrimSpace(cfg.AppID)
	cfg.AppSecret = strings.TrimSpace(cfg.AppSecret)
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.Page = strings.TrimSpace(cfg.Page)
	cfg.EnvVersion = strings.ToLower(strings.TrimSpace(cfg.EnvVersion))
	if cfg.AppID == "" {
		return nil, errors.New("wechat mini program app id is required")
	}
	if cfg.AppSecret == "" {
		return nil, errors.New("wechat mini program app secret is required")
	}
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBaseURL
	}
	if cfg.Page == "" {
		return nil, errors.New("wechat mini program code page is required")
	}
	if cfg.EnvVersion == "" {
		cfg.EnvVersion = defaultEnvVersion
	}
	if cfg.Width == 0 {
		cfg.Width = 430
	}
	if cfg.Width < 280 || cfg.Width > 1280 {
		return nil, errors.New("wechat mini program code width must be between 280 and 1280")
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 10 * time.Second
	}
	return &Client{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: cfg.RequestTimeout},
		now:        time.Now,
	}, nil
}

func (c *Client) Generate(ctx context.Context, scene string) ([]byte, string, int, error) {
	scene = strings.TrimSpace(scene)
	if scene == "" || len([]rune(scene)) > maxInviteSceneRunes {
		return nil, "", 0, errors.New("wechat mini program scene is invalid")
	}

	token, err := c.getAccessToken(ctx, false)
	if err != nil {
		return nil, "", 0, err
	}
	data, mediaType, apiErr, err := c.generateWithToken(ctx, token, scene)
	if err != nil {
		return nil, "", 0, err
	}
	if apiErr != nil && isAccessTokenError(apiErr.Code) {
		token, refreshErr := c.getAccessToken(ctx, true)
		if refreshErr != nil {
			return nil, "", 0, refreshErr
		}
		data, mediaType, apiErr, err = c.generateWithToken(ctx, token, scene)
		if err != nil {
			return nil, "", 0, err
		}
	}
	if apiErr != nil {
		return nil, "", 0, apiErr
	}
	if len(data) == 0 {
		return nil, "", 0, fmt.Errorf("%w: empty image response", ErrCodeUnavailable)
	}
	if !strings.HasPrefix(mediaType, "image/") {
		return nil, "", 0, fmt.Errorf("%w: unexpected media type %q", ErrCodeUnavailable, mediaType)
	}
	return data, mediaType, c.cfg.Width, nil
}

func (c *Client) generateWithToken(ctx context.Context, token, scene string) ([]byte, string, *APIError, error) {
	payload := struct {
		Scene      string `json:"scene"`
		Page       string `json:"page"`
		CheckPath  bool   `json:"check_path"`
		EnvVersion string `json:"env_version"`
		Width      int    `json:"width"`
		AutoColor  bool   `json:"auto_color"`
		IsHyaline  bool   `json:"is_hyaline"`
	}{
		Scene:      scene,
		Page:       c.cfg.Page,
		CheckPath:  c.cfg.CheckPath,
		EnvVersion: c.cfg.EnvVersion,
		Width:      c.cfg.Width,
	}
	body, contentType, statusCode, err := c.postJSON(ctx, "/wxa/getwxacodeunlimit?access_token="+token, payload)
	if err != nil {
		return nil, "", nil, err
	}
	if statusCode < http.StatusOK || statusCode >= http.StatusMultipleChoices {
		if apiErr := parseAPIError(body); apiErr != nil {
			return nil, "", apiErr, nil
		}
		return nil, "", nil, fmt.Errorf("wechat mini program code request failed with HTTP %d", statusCode)
	}
	if apiErr := parseAPIError(body); apiErr != nil {
		return nil, "", apiErr, nil
	}
	return body, contentType, nil, nil
}

func (c *Client) getAccessToken(ctx context.Context, force bool) (string, error) {
	c.tokenMu.Lock()
	defer c.tokenMu.Unlock()

	now := c.now()
	if !force && c.accessToken != "" && now.Before(c.tokenExpiresAt) {
		return c.accessToken, nil
	}

	payload := struct {
		GrantType    string `json:"grant_type"`
		AppID        string `json:"appid"`
		Secret       string `json:"secret"`
		ForceRefresh bool   `json:"force_refresh"`
	}{
		GrantType:    "client_credential",
		AppID:        c.cfg.AppID,
		Secret:       c.cfg.AppSecret,
		ForceRefresh: force,
	}
	body, _, statusCode, err := c.postJSON(ctx, "/cgi-bin/stable_token", payload)
	if err != nil {
		return "", err
	}
	if statusCode < http.StatusOK || statusCode >= http.StatusMultipleChoices {
		if apiErr := parseAPIError(body); apiErr != nil {
			return "", apiErr
		}
		return "", fmt.Errorf("wechat access token request failed with HTTP %d", statusCode)
	}

	var response struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return "", fmt.Errorf("decode wechat access token response: %w", err)
	}
	if response.ErrCode != 0 {
		return "", &APIError{Code: response.ErrCode, Message: response.ErrMsg}
	}
	if strings.TrimSpace(response.AccessToken) == "" || response.ExpiresIn <= 0 {
		return "", errors.New("wechat access token response is incomplete")
	}

	ttl := time.Duration(response.ExpiresIn) * time.Second
	margin := tokenRefreshSafeDelta
	if ttl <= margin*2 {
		margin = ttl / 2
	}
	c.accessToken = response.AccessToken
	c.tokenExpiresAt = now.Add(ttl - margin)
	return c.accessToken, nil
}

func (c *Client) postJSON(ctx context.Context, path string, payload any) ([]byte, string, int, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, "", 0, fmt.Errorf("encode wechat request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.BaseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return nil, "", 0, fmt.Errorf("create wechat request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, "", 0, fmt.Errorf("call wechat api: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, defaultResponseLimit+1))
	if err != nil {
		return nil, "", 0, fmt.Errorf("read wechat response: %w", err)
	}
	if len(body) > defaultResponseLimit {
		return nil, "", 0, errors.New("wechat response exceeded size limit")
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
	return body, contentType, response.StatusCode, nil
}

func parseAPIError(body []byte) *APIError {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil
	}
	var response struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if err := json.Unmarshal(trimmed, &response); err != nil || response.ErrCode == 0 {
		return nil
	}
	return &APIError{Code: response.ErrCode, Message: response.ErrMsg}
}

func isAccessTokenError(code int) bool {
	switch code {
	case 40001, 40014, 42001:
		return true
	default:
		return false
	}
}
