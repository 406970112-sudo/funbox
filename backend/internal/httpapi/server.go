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

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/feedback"
	"my-first-expo-app/backend/internal/focus"
	"my-first-expo-app/backend/internal/lottery"
	"my-first-expo-app/backend/internal/lotterylab"
	"my-first-expo-app/backend/internal/marketradar"
	"my-first-expo-app/backend/internal/membership"
	"my-first-expo-app/backend/internal/news"
	"my-first-expo-app/backend/internal/reading"
	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/recommendation"
	"my-first-expo-app/backend/internal/resourcesearch"
	"my-first-expo-app/backend/internal/score"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/translation"
	"my-first-expo-app/backend/internal/tts"
)

type Server struct {
	accessStore           *access.Store
	authService           *auth.Service
	cfg                   config.Config
	feedbackService       *feedback.Service
	focusStore            *focus.Store
	rateLimiter           *RateLimiter
	realtimeHub           *realtime.Hub
	lotteryService        lotteryHistoryService
	lotteryLabService     lotteryLabHistoryService
	marketRadarService    marketRadarSnapshotService
	membershipService     *membership.Service
	newsService           newsFeedService
	readingService        *reading.Service
	readingImporter       *reading.Importer
	recommendationService *recommendation.Service
	resourceSearchService resourceSearchService
	scoreService          *score.Service
	socialStore           *social.Store
	translationService    *translation.Service
	ttsService            *tts.Service
}

func NewServer(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(cfg, ttsService, translationService, authService, socialStore, accessStore, nil, nil, nil, nil, nil, nil, scoreServices...)
}

func NewServerWithNews(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(cfg, ttsService, translationService, authService, socialStore, accessStore, newsService, nil, nil, nil, nil, nil, scoreServices...)
}

func NewServerWithReadingAndNews(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	readingService *reading.Service,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(
		cfg,
		ttsService,
		translationService,
		authService,
		socialStore,
		accessStore,
		newsService,
		readingService,
		nil,
		nil,
		nil,
		nil,
		scoreServices...,
	)
}

func NewServerWithReadingNewsAndFeedback(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	readingService *reading.Service,
	feedbackService *feedback.Service,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(
		cfg,
		ttsService,
		translationService,
		authService,
		socialStore,
		accessStore,
		newsService,
		readingService,
		feedbackService,
		nil,
		nil,
		nil,
		scoreServices...,
	)
}

func NewServerWithReadingNewsFeedbackAndFocus(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	readingService *reading.Service,
	feedbackService *feedback.Service,
	focusStore *focus.Store,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(
		cfg,
		ttsService,
		translationService,
		authService,
		socialStore,
		accessStore,
		newsService,
		readingService,
		feedbackService,
		focusStore,
		nil,
		nil,
		scoreServices...,
	)
}

func NewServerWithMembership(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	readingService *reading.Service,
	feedbackService *feedback.Service,
	focusStore *focus.Store,
	membershipService *membership.Service,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(
		cfg,
		ttsService,
		translationService,
		authService,
		socialStore,
		accessStore,
		newsService,
		readingService,
		feedbackService,
		focusStore,
		membershipService,
		nil,
		scoreServices...,
	)
}

func NewServerWithMembershipAndRecommendation(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	readingService *reading.Service,
	feedbackService *feedback.Service,
	focusStore *focus.Store,
	membershipService *membership.Service,
	recommendationService *recommendation.Service,
	scoreServices ...*score.Service,
) *http.Server {
	return newServer(
		cfg,
		ttsService,
		translationService,
		authService,
		socialStore,
		accessStore,
		newsService,
		readingService,
		feedbackService,
		focusStore,
		membershipService,
		recommendationService,
		scoreServices...,
	)
}

func newServer(
	cfg config.Config,
	ttsService *tts.Service,
	translationService *translation.Service,
	authService *auth.Service,
	socialStore *social.Store,
	accessStore *access.Store,
	newsService *news.Service,
	readingService *reading.Service,
	feedbackService *feedback.Service,
	focusStore *focus.Store,
	membershipService *membership.Service,
	recommendationService *recommendation.Service,
	scoreServices ...*score.Service,
) *http.Server {
	var scoreService *score.Service
	if len(scoreServices) > 0 {
		scoreService = scoreServices[0]
	}
	var readingImporter *reading.Importer
	if readingService != nil {
		readingImporter = reading.NewImporter(readingService.Store(), reading.ImporterOptions{
			StorageDir:          cfg.Storage.ReadingDir,
			MaxUploadBytes:      cfg.Storage.MaxReadingUploadBytes,
			MaxExtractedBytes:   cfg.Storage.MaxReadingExtractedBytes,
			MaxEntries:          2000,
			MaxCompressionRatio: 1000,
		})
	}
	api := &Server{
		accessStore:           accessStore,
		authService:           authService,
		cfg:                   cfg,
		feedbackService:       feedbackService,
		focusStore:            focusStore,
		rateLimiter:           NewRateLimiter(cfg.Security.RateLimitWindow, cfg.Security.RateLimitMax),
		realtimeHub:           realtime.NewHub(),
		lotteryService:        lottery.NewService(cfg.Lottery),
		lotteryLabService:     lotterylab.NewService(lotterylab.Config{}),
		marketRadarService:    marketradar.NewService(marketradar.Config(cfg.MarketRadar)),
		membershipService:     membershipService,
		newsService:           newsService,
		readingService:        readingService,
		readingImporter:       readingImporter,
		recommendationService: recommendationService,
		resourceSearchService: resourcesearch.NewService(cfg.ResourceSearch),
		scoreService:          scoreService,
		socialStore:           socialStore,
		translationService:    translationService,
		ttsService:            ttsService,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", api.handleHealthz)
	mux.HandleFunc("GET /api/v1/system/ping", api.handlePing)
	mux.HandleFunc("GET /api/v1/features", api.withOptionalAuth(api.withAPIPipeline(api.handleVisibleFeatures)))
	mux.HandleFunc("GET /api/v1/membership/features", api.withAuth(api.withAPIPipeline(api.handleMembershipFeatureMatrix)))
	mux.HandleFunc("GET /api/v1/membership/payment", api.withAuth(api.withAPIPipeline(api.handleMembershipPaymentInfo)))
	mux.HandleFunc("GET /api/v1/admin/membership/settings", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminMembershipSettings))))
	mux.HandleFunc("POST /api/v1/admin/membership/payment/qr", api.withAuth(api.withAdmin(api.withPaymentQRUploadPipeline(api.handleAdminUploadPaymentQR))))
	mux.HandleFunc("DELETE /api/v1/admin/membership/payment/qr", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminRemovePaymentQR))))
	mux.HandleFunc("PUT /api/v1/admin/membership/payment/note", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminUpdatePaymentNote))))
	mux.HandleFunc("GET /payment-qr/", api.handleServePaymentQR)
	mux.HandleFunc("GET /api/v1/admin/features", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminFeatures))))
	mux.HandleFunc("PUT /api/v1/admin/features/{featureID}/roles", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleUpdateFeatureRoles))))
	mux.HandleFunc("PUT /api/v1/admin/features/{featureID}/grants", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleUpdateFeatureGrant))))
	mux.HandleFunc("GET /api/v1/admin/users", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminUsers))))
	mux.HandleFunc("GET /api/v1/admin/users/{userID}", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminUser))))
	mux.HandleFunc("PATCH /api/v1/admin/users/{userID}/role", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleUpdateAdminUserRole))))
	mux.HandleFunc("GET /api/v1/admin/users/{userID}/role-changes", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminUserRoleChanges))))
	registerImageCompressionRoutes(mux, api)
	registerLotteryRoutes(mux, api)
	registerLotteryLabRoutes(mux, api)
	registerMarketRadarRoutes(mux, api)
	registerNewsRoutes(mux, api)
	registerResourceSearchRoutes(mux, api)
	registerReadingRoutes(mux, api)
	registerAdminReadingRoutes(mux, api)
	registerFeedbackRoutes(mux, api)
	registerFocusRoutes(mux, api)
	registerRecommendationRoutes(mux, api)
	mux.HandleFunc("POST /api/v1/auth/register", api.withAuthPipeline(api.handleRegister))
	mux.HandleFunc("POST /api/v1/auth/login", api.withAuthPipeline(api.handleLogin))
	mux.HandleFunc("POST /api/v1/auth/password-recovery/question", api.withAuthPipeline(api.handleRecoveryQuestion))
	mux.HandleFunc("POST /api/v1/auth/password-recovery/verify", api.withAuthPipeline(api.handleRecoveryAnswer))
	mux.HandleFunc("POST /api/v1/auth/password-recovery/reset", api.withAuthPipeline(api.handleRecoveryReset))
	mux.HandleFunc("GET /api/v1/auth/me", api.withAuth(api.handleMe))
	mux.HandleFunc("PATCH /api/v1/users/me", api.withAuth(api.withAPIPipeline(api.handleUpdateProfile)))
	mux.HandleFunc("PATCH /api/v1/users/me/password", api.withAuth(api.withAPIPipeline(api.handleChangePassword)))
	mux.HandleFunc("POST /api/v1/users/me/avatar", api.withAuth(api.withAvatarPipeline(api.handleUploadAvatar)))
	mux.HandleFunc("GET /api/v1/users/search", api.withAuth(api.withAPIPipeline(api.handleSearchUsers)))
	mux.HandleFunc("POST /api/v1/friend-requests", api.withAuth(api.withRateLimitedAPIPipeline("friend-request", api.handleCreateFriendRequest)))
	mux.HandleFunc("GET /api/v1/friend-requests", api.withAuth(api.withAPIPipeline(api.handleListFriendRequests)))
	mux.HandleFunc("POST /api/v1/friend-requests/{requestID}/accept", api.withAuth(api.withAPIPipeline(api.handleAcceptFriendRequest)))
	mux.HandleFunc("POST /api/v1/friend-requests/{requestID}/reject", api.withAuth(api.withAPIPipeline(api.handleRejectFriendRequest)))
	mux.HandleFunc("GET /api/v1/friends", api.withAuth(api.withAPIPipeline(api.handleListFriends)))
	mux.HandleFunc("GET /api/v1/conversations", api.withAuth(api.withAPIPipeline(api.handleListConversations)))
	mux.HandleFunc("GET /api/v1/conversations/{conversationID}/messages", api.withAuth(api.withAPIPipeline(api.handleListMessages)))
	mux.HandleFunc("POST /api/v1/conversations/{conversationID}/messages", api.withAuth(api.withAPIPipeline(api.handleCreateMessage)))
	mux.HandleFunc("POST /api/v1/conversations/{conversationID}/read", api.withAuth(api.withAPIPipeline(api.handleMarkConversationRead)))
	mux.HandleFunc("POST /api/v1/realtime/ticket", api.withAuth(api.withAPIPipeline(api.handleCreateRealtimeTicket)))
	mux.HandleFunc("GET /api/v1/realtime/ws", api.handleRealtime)
	registerScoreRoutes(mux, api)
	mux.HandleFunc("POST /api/v1/game-matches", api.withAuth(api.withRateLimitedAPIPipeline("game-match", api.handleCreateGameMatch)))
	mux.HandleFunc("GET /api/v1/game-matches", api.withAuth(api.withAPIPipeline(api.handleListGameMatches)))
	mux.HandleFunc("GET /api/v1/game-matches/{matchID}", api.withAuth(api.withAPIPipeline(api.handleGetGameMatch)))
	mux.HandleFunc("POST /api/v1/game-matches/{matchID}/accept", api.withAuth(api.withAPIPipeline(api.handleAcceptGameMatch)))
	mux.HandleFunc("POST /api/v1/game-matches/{matchID}/decline", api.withAuth(api.withAPIPipeline(api.handleDeclineGameMatch)))
	mux.HandleFunc("POST /api/v1/game-matches/{matchID}/moves", api.withAuth(api.withRateLimitedAPIPipeline("game-move", api.handleCreateGameMove)))
	mux.HandleFunc("POST /api/v1/game-matches/{matchID}/resign", api.withAuth(api.withAPIPipeline(api.handleResignGameMatch)))
	mux.HandleFunc("POST /api/v1/game-scores", api.withAuth(api.withRateLimitedAPIPipeline("game-score", api.handleCreateGameScore)))
	mux.HandleFunc("GET /api/v1/game-leaderboards/{gameID}", api.withAuth(api.withAPIPipeline(api.handleGetGameLeaderboard)))
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
	return s.withJSONPipeline("", next)
}

func (s *Server) withAuthPipeline(next http.HandlerFunc) http.HandlerFunc {
	return s.withJSONPipeline("auth", next)
}

func (s *Server) withRateLimitedAPIPipeline(scope string, next http.HandlerFunc) http.HandlerFunc {
	return s.withJSONPipeline(scope, next)
}

func (s *Server) withJSONPipeline(scope string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}

		if scope != "" && !s.allowRateLimitedRequest(w, r, scope) {
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

		if !s.allowRateLimitedRequest(w, r, "avatar") {
			return
		}

		next.ServeHTTP(w, r)
	}
}

func (s *Server) withReadingUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "reading-upload") {
			return
		}
		limit := s.cfg.Storage.MaxReadingUploadBytes
		if limit <= 0 {
			limit = 50 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit+(1<<20))
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

		if !s.allowRateLimitedRequest(w, r, "text") {
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

		if !s.allowRateLimitedRequest(w, r, "tts") {
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

	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition,Content-Length,Retry-After,X-Original-Size,X-Compressed-Size,X-Compression-Ratio")
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
