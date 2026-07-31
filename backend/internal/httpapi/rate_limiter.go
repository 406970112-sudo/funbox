package httpapi

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RateLimiter struct {
	buckets map[string]*bucket
	max     int
	mu      sync.Mutex
	window  time.Duration
}

type bucket struct {
	count   int
	resetAt time.Time
}

func NewRateLimiter(window time.Duration, max int) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		max:     max,
		window:  window,
	}
}

func (r *RateLimiter) Allow(key string) (retryAfterSeconds int, limited bool) {
	now := time.Now()

	r.mu.Lock()
	defer r.mu.Unlock()

	for bucketKey, bucketValue := range r.buckets {
		if now.After(bucketValue.resetAt) {
			delete(r.buckets, bucketKey)
		}
	}

	currentBucket, ok := r.buckets[key]
	if !ok || now.After(currentBucket.resetAt) {
		r.buckets[key] = &bucket{
			count:   1,
			resetAt: now.Add(r.window),
		}
		return 0, false
	}

	if currentBucket.count >= r.max {
		return int(currentBucket.resetAt.Sub(now).Seconds()) + 1, true
	}

	currentBucket.count++
	return 0, false
}

func (s *Server) allowRateLimitedRequest(w http.ResponseWriter, r *http.Request, scope string) bool {
	retryAfter, limited := s.rateLimiter.Allow(rateLimitKeyFromRequest(r, scope))
	if !limited {
		return true
	}

	w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	writeJSON(w, http.StatusTooManyRequests, map[string]any{
		"error":             "rate_limited",
		"retryAfterSeconds": retryAfter,
	})
	return false
}

func rateLimitKeyFromRequest(r *http.Request, scope string) string {
	return clientIPFromRequest(r) + "\x00" + scope
}

func clientIPFromRequest(r *http.Request) string {
	remoteIP, ok := normalizedIP(r.RemoteAddr)
	if ok && remoteIP.IsLoopback() {
		if realIP, valid := normalizedIP(r.Header.Get("X-Real-IP")); valid {
			return realIP.String()
		}

		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for index := len(parts) - 1; index >= 0; index-- {
			if forwardedIP, valid := normalizedIP(parts[index]); valid {
				return forwardedIP.String()
			}
		}
	}

	if ok {
		return remoteIP.String()
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func normalizedIP(value string) (net.IP, bool) {
	value = strings.TrimSpace(value)
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	value = strings.Trim(value, "[]")
	parsed := net.ParseIP(value)
	return parsed, parsed != nil
}
