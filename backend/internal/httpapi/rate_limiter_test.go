package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

func TestOrdinaryAPIRequestsDoNotConsumeLimitedRequestClasses(t *testing.T) {
	api := &Server{
		cfg: config.Config{
			Security: config.SecurityConfig{MaxRequestBodyBytes: 1024},
		},
		rateLimiter: NewRateLimiter(time.Minute, 1),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /first", api.withAPIPipeline(okHandler))
	mux.HandleFunc("GET /login", api.withAuthPipeline(okHandler))
	mux.HandleFunc("GET /resource", api.withRateLimitedAPIPipeline("resource-search", okHandler))
	server := httptest.NewServer(api.withGlobalMiddleware(mux))
	t.Cleanup(server.Close)

	assertResponseStatus(t, server.URL+"/first", http.StatusOK)
	assertResponseStatus(t, server.URL+"/first", http.StatusOK)
	assertResponseStatus(t, server.URL+"/login", http.StatusOK)
	assertResponseStatus(t, server.URL+"/resource", http.StatusOK)

	assertRateLimited(t, server.URL+"/login")
	assertRateLimited(t, server.URL+"/resource")
}

func TestClientIPTrustsHeadersOnlyFromLoopbackProxy(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		realIP     string
		forwarded  string
		want       string
	}{
		{
			name:       "nginx real ip",
			remoteAddr: "127.0.0.1:41234",
			realIP:     "203.0.113.10",
			want:       "203.0.113.10",
		},
		{
			name:       "nginx forwarded fallback",
			remoteAddr: "[::1]:41234",
			forwarded:  "198.51.100.3, 203.0.113.11",
			want:       "203.0.113.11",
		},
		{
			name:       "untrusted direct request",
			remoteAddr: "198.51.100.4:41234",
			realIP:     "203.0.113.12",
			forwarded:  "203.0.113.13",
			want:       "198.51.100.4",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			request.Header.Set("X-Real-IP", test.realIP)
			request.Header.Set("X-Forwarded-For", test.forwarded)

			if got := clientIPFromRequest(request); got != test.want {
				t.Fatalf("expected client IP %q, got %q", test.want, got)
			}
		})
	}
}

func okHandler(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func assertResponseStatus(t *testing.T, url string, want int) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer response.Body.Close()
	if response.StatusCode != want {
		t.Fatalf("GET %s: expected status %d, got %d", url, want, response.StatusCode)
	}
}

func assertRateLimited(t *testing.T, url string) {
	t.Helper()
	response, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("GET %s: expected status %d, got %d", url, http.StatusTooManyRequests, response.StatusCode)
	}
	if response.Header.Get("Retry-After") == "" {
		t.Fatalf("GET %s: expected Retry-After header", url)
	}
}
