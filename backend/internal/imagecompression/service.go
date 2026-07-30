package imagecompression

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxProviderResponseBytes = 10 << 20

var (
	ErrAuthentication = errors.New("tinypng authentication failed")
	ErrQuotaExceeded  = errors.New("tinypng quota exceeded")
	ErrProvider       = errors.New("tinypng provider request failed")
)

type Mode string

const (
	ModeSmart   Mode = "smart"
	ModeQuality Mode = "quality"
)

type Result struct {
	ContentType  string
	Data         []byte
	OriginalSize int64
}

type Service struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

func NewService(apiKey string, baseURL string, timeout time.Duration) *Service {
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	return &Service{
		apiKey:  strings.TrimSpace(apiKey),
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  &http.Client{Timeout: timeout},
	}
}

func (s *Service) Compress(ctx context.Context, source []byte, mode Mode) (Result, error) {
	if len(source) == 0 {
		return Result{}, fmt.Errorf("%w: empty source image", ErrProvider)
	}
	if mode != ModeSmart && mode != ModeQuality {
		return Result{}, fmt.Errorf("%w: unsupported compression mode", ErrProvider)
	}

	outputURL, originalSize, contentType, err := s.shrink(ctx, source)
	if err != nil {
		return Result{}, err
	}

	method := http.MethodGet
	var body io.Reader
	if mode == ModeQuality {
		method = http.MethodPost
		body = strings.NewReader(`{"preserve":["copyright","creation","location"]}`)
	}

	request, err := http.NewRequestWithContext(ctx, method, outputURL, body)
	if err != nil {
		return Result{}, fmt.Errorf("%w: create output request", ErrProvider)
	}
	request.SetBasicAuth("api", s.apiKey)
	if mode == ModeQuality {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := s.client.Do(request)
	if err != nil {
		return Result{}, fmt.Errorf("%w: download output: %v", ErrProvider, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return Result{}, providerStatusError(response.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(response.Body, maxProviderResponseBytes+1))
	if err != nil {
		return Result{}, fmt.Errorf("%w: read output: %v", ErrProvider, err)
	}
	if len(data) == 0 || len(data) > maxProviderResponseBytes {
		return Result{}, fmt.Errorf("%w: invalid output size", ErrProvider)
	}
	if headerType := strings.TrimSpace(response.Header.Get("Content-Type")); headerType != "" {
		contentType = strings.Split(headerType, ";")[0]
	}

	return Result{ContentType: contentType, Data: data, OriginalSize: originalSize}, nil
}

func (s *Service) shrink(ctx context.Context, source []byte) (string, int64, string, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.baseURL+"/shrink",
		bytes.NewReader(source),
	)
	if err != nil {
		return "", 0, "", fmt.Errorf("%w: create shrink request", ErrProvider)
	}
	request.SetBasicAuth("api", s.apiKey)
	request.Header.Set("Content-Type", "application/octet-stream")

	response, err := s.client.Do(request)
	if err != nil {
		return "", 0, "", fmt.Errorf("%w: shrink request: %v", ErrProvider, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return "", 0, "", providerStatusError(response.StatusCode)
	}

	var payload struct {
		Input struct {
			Size int64 `json:"size"`
		} `json:"input"`
		Output struct {
			Type string `json:"type"`
			URL  string `json:"url"`
		} `json:"output"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&payload); err != nil {
		return "", 0, "", fmt.Errorf("%w: decode shrink response", ErrProvider)
	}

	outputURL := strings.TrimSpace(payload.Output.URL)
	if outputURL == "" {
		outputURL = strings.TrimSpace(response.Header.Get("Location"))
	}
	parsedURL, err := url.Parse(outputURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return "", 0, "", fmt.Errorf("%w: invalid output URL", ErrProvider)
	}

	originalSize := payload.Input.Size
	if originalSize <= 0 {
		originalSize = int64(len(source))
	}

	return outputURL, originalSize, payload.Output.Type, nil
}

func providerStatusError(statusCode int) error {
	switch statusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrAuthentication
	case http.StatusTooManyRequests:
		return ErrQuotaExceeded
	default:
		return fmt.Errorf("%w: status %d", ErrProvider, statusCode)
	}
}
