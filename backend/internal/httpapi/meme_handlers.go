package httpapi

import (
	"context"
	"errors"
	"log"
	"my-first-expo-app/backend/internal/meme"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func registerMemeRoutes(mux *http.ServeMux, s *Server) {
	public := func(pattern string, h http.HandlerFunc) {
		mux.HandleFunc(pattern, s.withOptionalAuth(s.withAPIPipeline(s.memeAvailable(h))))
	}
	private := func(pattern string, h http.HandlerFunc) {
		mux.HandleFunc(pattern, s.withAuth(s.withAPIPipeline(s.memeAvailable(h))))
	}
	admin := func(pattern string, h http.HandlerFunc) {
		mux.HandleFunc(pattern, s.withAuth(s.withAdmin(s.withAPIPipeline(s.memeAvailable(h)))))
	}
	public("GET /api/v1/memes", s.handleMemes)
	public("GET /api/v1/memes/categories", s.handleMemeCategories)
	public("GET /api/v1/memes/rankings", s.handleMemeRankings)
	public("GET /api/v1/memes/ranking-dates", s.handleMemeDates)
	public("GET /api/v1/memes/{id}", s.handleMemeDetail)
	mux.HandleFunc("POST /api/v1/memes/events", s.withOptionalAuth(s.withRateLimitedAPIPipeline("meme-events", s.memeAvailable(s.handleMemeEvent))))
	mux.HandleFunc("GET /api/v1/meme-media/{id}/{kind}", s.withOptionalAuth(s.withJSONPipelineAndLimiter("meme-media", s.memeMediaLimiter(), s.memeAvailable(s.handleMemeMedia))))
	private("GET /api/v1/memes/favorites", s.handleMemes)
	private("PUT /api/v1/memes/{id}/favorite", s.handleMemeFavorite)
	private("DELETE /api/v1/memes/{id}/favorite", s.handleMemeFavorite)
	admin("GET /api/v1/admin/memes/status", s.handleMemeStatus)
	admin("POST /api/v1/admin/memes/sync", s.handleMemeSync)
	admin("PUT /api/v1/admin/memes/{id}", s.handleMemeAdmin)
}
func (s *Server) memeAvailable(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.memeService == nil {
			writeJSON(w, 503, map[string]any{"error": "memes_unavailable"})
			return
		}
		next(w, r)
	}
}
func (s *Server) memeUser(r *http.Request) string {
	if u, ok := authenticatedUserFromContext(r.Context()); ok {
		return u.ID
	}
	return ""
}
func (s *Server) memeURL(r *http.Request, path string) string {
	if path == "" || strings.HasPrefix(path, "http") {
		return path
	}
	base := strings.TrimRight(s.cfg.Server.PublicBaseURL, "/")
	if base == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return base + path
}
func (s *Server) memeImages(r *http.Request, images []meme.Image) {
	for i := range images {
		images[i].URL = s.memeURL(r, images[i].URL)
		images[i].ThumbnailURL = s.memeURL(r, images[i].ThumbnailURL)
	}
}
func (s *Server) memeError(w http.ResponseWriter, e error) {
	code := 500
	name := "memes_failed"
	switch {
	case errors.Is(e, meme.ErrInvalid):
		code = 400
		name = "memes_invalid"
	case errors.Is(e, meme.ErrStale):
		code = 409
		name = "memes_catalog_changed"
	case errors.Is(e, meme.ErrNotFound):
		code = 404
		name = "meme_not_found"
	default:
		log.Printf("memes: %v", e)
	}
	writeJSON(w, code, map[string]any{"error": name})
}
func (s *Server) handleMemes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 36
	if raw := q.Get("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 100 {
			s.memeError(w, meme.ErrInvalid)
			return
		}
		limit = n
	}
	p, e := s.memeService.Store.List(r.Context(), meme.Query{Q: q.Get("q"), Category: q.Get("category"), Animated: q.Get("animated"), Sort: q.Get("sort"), Cursor: q.Get("cursor"), Limit: limit, Favorites: strings.HasSuffix(r.URL.Path, "/favorites")}, s.memeUser(r))
	if e != nil {
		s.memeError(w, e)
		return
	}
	s.memeImages(r, p.Items)
	writeJSON(w, 200, p)
}
func (s *Server) handleMemeCategories(w http.ResponseWriter, r *http.Request) {
	items, source, e := s.memeService.Store.Categories(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("group"))
	if e != nil {
		s.memeError(w, e)
		return
	}
	for i := range items {
		items[i].CoverURL = s.memeURL(r, items[i].CoverURL)
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": len(items), "source": source})
}
func (s *Server) handleMemeDetail(w http.ResponseWriter, r *http.Request) {
	im, related, e := s.memeService.Store.Get(r.Context(), r.PathValue("id"), s.memeUser(r))
	if e != nil {
		s.memeError(w, e)
		return
	}
	one := []meme.Image{im}
	s.memeImages(r, one)
	s.memeImages(r, related)
	writeJSON(w, 200, map[string]any{"image": one[0], "related": related})
}
func (s *Server) handleMemeRankings(w http.ResponseWriter, r *http.Request) {
	p, e := s.memeService.Store.Rankings(r.Context(), r.URL.Query().Get("period"), r.URL.Query().Get("date"))
	if e != nil {
		s.memeError(w, e)
		return
	}
	s.memeImages(r, p.Items)
	writeJSON(w, 200, p)
}
func (s *Server) handleMemeDates(w http.ResponseWriter, r *http.Request) {
	items, e := s.memeService.Store.Dates(r.Context())
	if e != nil {
		s.memeError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"dates": items, "nextCursor": ""})
}
func (s *Server) handleMemeEvent(w http.ResponseWriter, r *http.Request) {
	var b struct {
		ImageID     string `json:"imageId"`
		Type        string `json:"type"`
		EventID     string `json:"eventId"`
		AnonymousID string `json:"anonymousId"`
	}
	if e := decodeJSONBody(r, &b); e != nil {
		writeRequestBodyError(w, e)
		return
	}
	var accepted bool
	var e error
	if user := s.memeUser(r); user != "" {
		accepted, e = s.memeService.Store.RecordUserEvent(r.Context(), b.ImageID, b.Type, b.EventID, user)
	} else {
		accepted, e = s.memeService.Store.Event(r.Context(), b.ImageID, b.Type, b.EventID, b.AnonymousID)
	}
	if e != nil {
		s.memeError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"accepted": accepted})
}
func (s *Server) handleMemeFavorite(w http.ResponseWriter, r *http.Request) {
	add := r.Method == "PUT"
	if e := s.memeService.Store.Favorite(r.Context(), r.PathValue("id"), s.memeUser(r), add); e != nil {
		s.memeError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"favorite": add})
}
func (s *Server) handleMemeMedia(w http.ResponseWriter, r *http.Request) {
	file, mime, e := s.memeService.Media(r.Context(), r.PathValue("id"), r.PathValue("kind"))
	if e != nil {
		if errors.Is(e, meme.ErrNotFound) || errors.Is(e, meme.ErrInvalid) {
			s.memeError(w, e)
		} else {
			writeJSON(w, 502, map[string]any{"error": "meme_media_unavailable"})
		}
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeFile(w, r, file)
}
func (s *Server) handleMemeStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.memeService.Status())
}
func (s *Server) handleMemeSync(w http.ResponseWriter, r *http.Request) {
	ctx := s.memeContext
	if ctx == nil {
		ctx = context.Background()
	}
	go func() {
		job, cancel := context.WithTimeout(ctx, 6*time.Hour)
		defer cancel()
		if e := s.memeService.Sync(job); e == nil {
			s.memeService.Mirror(job)
		}
	}()
	writeJSON(w, 202, map[string]any{"accepted": true})
}
func (s *Server) handleMemeAdmin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Hidden *bool    `json:"hidden"`
		Labels []string `json:"labels"`
	}
	if e := decodeJSONBody(r, &b); e != nil {
		writeRequestBodyError(w, e)
		return
	}
	if e := s.memeService.Store.AdminPatch(r.Context(), r.PathValue("id"), b.Hidden, b.Labels); e != nil {
		s.memeError(w, e)
		return
	}
	writeJSON(w, 200, map[string]any{"success": true})
}

func (s *Server) memeMediaLimiter() *RateLimiter {
	if s.memeMediaRateLimiter != nil {
		return s.memeMediaRateLimiter
	}
	return s.rateLimiter
}
