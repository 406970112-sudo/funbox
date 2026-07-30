package httpapi

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

func TestImageCompressionHTTPFlow(t *testing.T) {
	var providerURL string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/shrink":
			data := map[string]any{
				"input":  map[string]any{"size": 82, "type": "image/png"},
				"output": map[string]any{"size": 7, "type": "image/png", "url": providerURL + "/output"},
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(data)
		case "/output":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("smaller"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	providerURL = provider.URL

	cfg := config.Config{
		Security: config.SecurityConfig{RateLimitMax: 20, RateLimitWindow: time.Minute},
		TinyPNG: config.TinyPNGConfig{
			APIKey:         "test-key",
			BaseURL:        provider.URL,
			MaxImageBytes:  5 << 20,
			RequestTimeout: time.Second,
		},
	}
	api := &Server{cfg: cfg, rateLimiter: NewRateLimiter(20*time.Minute, 20)}
	mux := http.NewServeMux()
	registerImageCompressionRoutes(mux, api)
	server := httptest.NewServer(api.withGlobalMiddleware(mux))
	defer server.Close()

	statusResponse, err := server.Client().Get(server.URL + "/api/v1/image-compression/status")
	if err != nil {
		t.Fatalf("get status: %v", err)
	}
	defer statusResponse.Body.Close()
	if statusResponse.StatusCode != http.StatusOK {
		t.Fatalf("status code = %d", statusResponse.StatusCode)
	}

	imageBuffer := &bytes.Buffer{}
	inputImage := image.NewRGBA(image.Rect(0, 0, 2, 2))
	inputImage.Set(0, 0, color.RGBA{R: 75, G: 107, B: 255, A: 255})
	if err := png.Encode(imageBuffer, inputImage); err != nil {
		t.Fatalf("encode image: %v", err)
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	filePart, err := writer.CreateFormFile("image", "sample.png")
	if err != nil {
		t.Fatalf("create image field: %v", err)
	}
	if _, err := filePart.Write(imageBuffer.Bytes()); err != nil {
		t.Fatalf("write image field: %v", err)
	}
	_ = writer.WriteField("mode", "smart")
	if err := writer.Close(); err != nil {
		t.Fatalf("close form: %v", err)
	}

	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/image-compression/compress", body)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("compress image: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("compress status = %d", response.StatusCode)
	}
	if response.Header.Get("X-Compressed-Size") != "7" || response.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("unexpected response headers: %+v", response.Header)
	}
}
