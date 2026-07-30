package imagecompression

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCompressSmartAndQuality(t *testing.T) {
	var providerURL string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, password, ok := r.BasicAuth()
		if !ok || username != "api" || password != "test-key" {
			t.Fatalf("unexpected provider authorization")
		}

		switch r.URL.Path {
		case "/shrink":
			if r.Method != http.MethodPost {
				t.Fatalf("shrink method = %s", r.Method)
			}
			data, err := io.ReadAll(r.Body)
			if err != nil || string(data) != "source-image" {
				t.Fatalf("shrink body = %q, err = %v", data, err)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"input":  map[string]any{"size": len(data), "type": "image/png"},
				"output": map[string]any{"size": 5, "type": "image/png", "url": providerURL + "/output"},
			})
		case "/output":
			if r.Method == http.MethodPost {
				var payload struct {
					Preserve []string `json:"preserve"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || len(payload.Preserve) != 3 {
					t.Fatalf("quality payload = %+v, err = %v", payload, err)
				}
			} else if r.Method != http.MethodGet {
				t.Fatalf("output method = %s", r.Method)
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("small"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	providerURL = provider.URL

	service := NewService("test-key", provider.URL, time.Second)
	for _, mode := range []Mode{ModeSmart, ModeQuality} {
		result, err := service.Compress(context.Background(), []byte("source-image"), mode)
		if err != nil {
			t.Fatalf("compress %s: %v", mode, err)
		}
		if string(result.Data) != "small" || result.OriginalSize != 12 || result.ContentType != "image/png" {
			t.Fatalf("compress %s result = %+v", mode, result)
		}
	}
}

func TestCompressMapsProviderErrors(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer provider.Close()

	service := NewService("test-key", provider.URL, time.Second)
	_, err := service.Compress(context.Background(), []byte("source-image"), ModeSmart)
	if err != ErrQuotaExceeded {
		t.Fatalf("error = %v, want %v", err, ErrQuotaExceeded)
	}
}
