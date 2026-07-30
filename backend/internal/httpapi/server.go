package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/translation"
	"my-first-expo-app/backend/internal/tts"
)

type Server struct {
	authService        *auth.Service
	cfg                config.Config
	rateLimiter        *RateLimiter
	translationService *translation.Service
	ttsService         *tts.Service
}

func NewServer(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
) *http.Server {
	api := &Server{
		authService:        authService,
		cfg:                cfg,
		rateLimiter:        NewRateLimiter(cfg.Security.RateLimitWindow, cfg.Security.RateLimitMax),
		translationService: translationService,
		ttsService:         ttsService,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", api.handleHealthz)
	mux.HandleFunc("GET /api/v1/system/ping", api.handlePing)
	registerImageCompressionRoutes(mux, api)
	mux.HandleFunc("POST /api/v1/auth/register", api.withAPIPipeline(api.handleRegister))
	mux.HandleFunc("POST /api/v1/auth/login", api.withAPIPipeline(api.handleLogin))
	mux.HandleFunc("GET /api/v1/auth/me", api.withAuth(api.handleMe))
	mux.HandleFunc("PATCH /api/v1/users/me", api.withAuth(api.withAPIPipeline(api.handleUpdateProfile)))
	mux.HandleFunc("PATCH /api/v1/users/me/password", api.withAuth(api.withAPIPipeline(api.handleChangePassword)))
	mux.HandleFunc("POST /api/v1/users/me/avatar", api.withAuth(api.withAvatarPipeline(api.handleUploadAvatar)))
	mux.HandleFunc("POST /api/v1/translation/translate", api.withTextPipeline(api.handleTranslate))
	mux.HandleFunc("POST /api/translate", api.withTextPipeline(api.handleTranslate))
	mux.HandleFunc("POST /api/v1/tts/synthesize", api.withTTSPipeline(api.handleSynthesize))
	mux.HandleFunc("POST /api/synthesize", api.withTTSPipeline(api.handleSynthesize))
	mux.HandleFunc("GET /voice/", api.handleServeAudio)
	mux.HandleFunc("GET /avatars/", api.handleServeAvatar)

	handler := api.withGlobalMiddleware(mux)

	return &http.Server{
		Addr:         fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler:      handler,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}
}

func (s *Server) withAPIPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}

		clientIP := clientIPFromRequest(r)
		if retryAfter, limited := s.rateLimiter.Allow(clientIP); limited {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":             "rate_limited",
				"retryAfterSeconds": retryAfter,
			})
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, s.cfg.Security.MaxRequestBodyBytes)
		next.ServeHTTP(w, r)
	}
}

func (s *Server) withAvatarPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}

		clientIP := clientIPFromRequest(r)
		if retryAfter, limited := s.rateLimiter.Allow(clientIP); limited {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":             "rate_limited",
				"retryAfterSeconds": retryAfter,
			})
			return
		}

		next.ServeHTTP(w, r)
	}
}

func (s *Server) withTextPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error": "origin_not_allowed",
			})
			return
		}

		clientIP := clientIPFromRequest(r)
		if retryAfter, limited := s.rateLimiter.Allow(clientIP); limited {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":             "rate_limited",
				"retryAfterSeconds": retryAfter,
			})
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, s.cfg.Security.MaxRequestBodyBytes)
		next.ServeHTTP(w, r)
	}
}

func (s *Server) withGlobalMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("panic recovered: %v", recovered)
				writeJSON(w, http.StatusInternalServerError, map[string]any{
					"error": "internal_server_error",
				})
			}
		}()

		s.applyCORS(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) withTTSPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{
				"error": "origin_not_allowed",
			})
			return
		}

		clientIP := clientIPFromRequest(r)
		if retryAfter, limited := s.rateLimiter.Allow(clientIP); limited {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":             "rate_limited",
				"retryAfterSeconds": retryAfter,
			})
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, s.cfg.Security.MaxRequestBodyBytes)
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"status": "healthy",
	})
}

func (s *Server) handlePing(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"message": "pong",
	})
}

func (s *Server) handleTranslate(w http.ResponseWriter, r *http.Request) {
	if s.translationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":  "translation_not_configured",
			"detail": "DEEPSEEK_API_KEY is not configured on the backend",
		})
		return
	}

	var request translation.TranslateRequest
	if err := decodeJSONBody(r, &request); err != nil {
		statusCode := http.StatusBadRequest
		if errors.Is(err, ErrRequestTooLarge) {
			statusCode = http.StatusRequestEntityTooLarge
		}
		writeJSON(w, statusCode, map[string]any{
			"error":  "invalid_request_body",
			"detail": err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.DeepSeek.RequestTimeout)
	defer cancel()

	result, err := s.translationService.Translate(ctx, request)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "translate_failed",
			"detail": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleSynthesize(w http.ResponseWriter, r *http.Request) {
	if s.ttsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":  "tts_not_configured",
			"detail": "VOLC_APP_ID or VOLC_ACCESS_TOKEN is not configured on the backend",
		})
		return
	}

	var request tts.SynthesizeRequest

	if err := decodeJSONBody(r, &request); err != nil {
		statusCode := http.StatusBadRequest
		if errors.Is(err, ErrRequestTooLarge) {
			statusCode = http.StatusRequestEntityTooLarge
		}
		writeJSON(w, statusCode, map[string]any{
			"error":  "invalid_request_body",
			"detail": err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.TTS.RequestTimeout)
	defer cancel()

	result, err := s.ttsService.Synthesize(ctx, request)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "synthesize_failed",
			"detail": err.Error(),
		})
		return
	}

	audioURL := result.RelativeAudioURL
	if baseURL := strings.TrimSpace(s.cfg.Server.PublicBaseURL); baseURL != "" {
		audioURL = strings.TrimRight(baseURL, "/") + result.RelativeAudioURL
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"audioUrl":   audioURL,
		"fileName":   result.FileName,
		"filePath":   result.FilePath,
		"resourceId": result.ResourceID,
		"success":    true,
	})
}

func (s *Server) handleServeAudio(w http.ResponseWriter, r *http.Request) {
	fileName := filepath.Base(strings.TrimPrefix(r.URL.Path, "/voice/"))
	if fileName == "." || fileName == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "file_not_found",
		})
		return
	}

	filePath := filepath.Join(s.cfg.Storage.AudioDir, fileName)
	file, err := os.Open(filePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error":  "file_not_found",
			"detail": err.Error(),
		})
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error":  "read_file_failed",
			"detail": err.Error(),
		})
		return
	}

	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")

	if len(s.cfg.Server.AllowedOrigins) == 0 {
		w.Header().Set("Access-Control-Allow-Origin", "*")
	} else if origin != "" && s.originAllowed(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}

	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition,Content-Length,X-Original-Size,X-Compressed-Size,X-Compression-Ratio")
}

func (s *Server) allowOrigin(r *http.Request) bool {
	if len(s.cfg.Server.AllowedOrigins) == 0 {
		return true
	}

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}

	return s.originAllowed(origin)
}

func (s *Server) originAllowed(origin string) bool {
	for _, allowed := range s.cfg.Server.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}

	return false
}

var ErrRequestTooLarge = errors.New("request body too large")

func decodeJSONBody(r *http.Request, target any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return ErrRequestTooLarge
		}
		return err
	}

	if err := decoder.Decode(&struct{}{}); err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("request body must contain a single JSON object")
	}

	return nil
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}
