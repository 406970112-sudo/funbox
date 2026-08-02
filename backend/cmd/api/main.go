package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/feedback"
	"my-first-expo-app/backend/internal/focus"
	"my-first-expo-app/backend/internal/foodrecommendation"
	httpapi "my-first-expo-app/backend/internal/httpapi"
	"my-first-expo-app/backend/internal/membership"
	"my-first-expo-app/backend/internal/news"
	"my-first-expo-app/backend/internal/reading"
	"my-first-expo-app/backend/internal/recommendation"
	"my-first-expo-app/backend/internal/score"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/translation"
	"my-first-expo-app/backend/internal/tts"
	"my-first-expo-app/backend/internal/user"
)

func main() {
	loadEnvFiles()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	userStore, err := user.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open user database failed: %v", err)
	}
	defer userStore.Close()
	socialStore, err := social.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open social database failed: %v", err)
	}
	defer socialStore.Close()
	accessStore, err := access.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open access database failed: %v", err)
	}
	defer accessStore.Close()
	readingStore, err := reading.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open reading database failed: %v", err)
	}
	defer readingStore.Close()
	feedbackStore, err := feedback.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open feedback database failed: %v", err)
	}
	defer feedbackStore.Close()
	membershipStore, err := membership.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open membership database failed: %v", err)
	}
	defer membershipStore.Close()
	scoreStore, err := score.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open score database failed: %v", err)
	}
	defer scoreStore.Close()
	focusStore, err := focus.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open focus database failed: %v", err)
	}
	defer focusStore.Close()
	recommendationStore, err := recommendation.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open recommendation database failed: %v", err)
	}
	defer recommendationStore.Close()
	foodRecommendationStore, err := foodrecommendation.OpenStore(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open food recommendation database failed: %v", err)
	}
	defer foodRecommendationStore.Close()
	registry, err := access.Registry()
	if err != nil {
		log.Fatalf("load feature registry failed: %v", err)
	}
	if err := accessStore.SyncRegistry(context.Background(), registry); err != nil {
		log.Fatalf("sync feature registry failed: %v", err)
	}

	signingKey, err := auth.ResolveSigningKey(cfg.Auth.JWTSecret, cfg.Auth.JWTSecretFile)
	if err != nil {
		log.Fatalf("load auth signing key failed: %v", err)
	}
	authService := auth.NewService(userStore, signingKey, cfg.Auth.TokenTTL)
	scoreService := score.NewService(scoreStore, signingKey, 7*24*time.Hour)

	var readingProvider reading.Provider
	switch cfg.Reading.ProviderMode {
	case "mock":
		readingProvider = reading.NewMockProvider()
	case "yuewen":
		if cfg.Reading.YuewenAppFlag == "" || cfg.Reading.YuewenAppSecret == "" {
			log.Printf("reading provider disabled: missing READING_YUEWEN_APPFLAG or READING_YUEWEN_APPSECRET")
		} else {
			readingProvider = reading.NewYuewenProvider(reading.YuewenConfig{
				BaseURL:   cfg.Reading.YuewenBaseURL,
				AppFlag:   cfg.Reading.YuewenAppFlag,
				AppSecret: cfg.Reading.YuewenAppSecret,
			})
		}
	case "", "disabled":
		log.Printf("online reading provider disabled")
	default:
		log.Printf("reading provider disabled: unsupported mode %q", cfg.Reading.ProviderMode)
	}
	readingService := reading.NewService(readingStore, readingProvider, reading.ServiceOptions{
		LibraryEnabled: cfg.Reading.LibraryEnabled,
		StorageDir:     cfg.Storage.ReadingDir,
	})
	if readingProvider != nil && readingProvider.Key() == "mock-yuewen" && cfg.Reading.LibraryEnabled {
		if _, err := readingService.SyncProvider(context.Background(), "startup"); err != nil {
			log.Printf("seed mock reading provider failed: %v", err)
		}
	}
	feedbackService := feedback.NewService(
		feedbackStore,
		cfg.Storage.FeedbackDir,
		cfg.Storage.MaxFeedbackImageBytes,
		cfg.Storage.MaxFeedbackImages,
	)
	membershipService := membership.NewService(
		membershipStore,
		cfg.Storage.PaymentQRDir,
		cfg.Storage.MaxPaymentQRBytes,
	)

	var ttsService *tts.Service
	if cfg.Volc.AppID != "" && cfg.Volc.AccessToken != "" {
		ttsProvider := tts.NewVolcEngineProvider(cfg.Volc)
		ttsService = tts.NewService(cfg, ttsProvider)
	} else {
		log.Printf("tts disabled: missing VOLC_APP_ID or VOLC_ACCESS_TOKEN")
	}

	var translationService *translation.Service
	if cfg.DeepSeek.APIKey != "" {
		translationService = translation.NewService(cfg.DeepSeek)
	} else {
		log.Printf("translation disabled: missing DEEPSEEK_API_KEY")
	}
	recommendationService := recommendation.NewService(cfg.DeepSeek, recommendationStore)
	foodPOIProvider := foodrecommendation.NewPOIProvider(foodrecommendation.POIConfig{
		AmapKey:         cfg.FoodRecommendation.AmapKey,
		AmapBaseURL:     cfg.FoodRecommendation.AmapBaseURL,
		OverpassBaseURL: cfg.FoodRecommendation.OverpassBaseURL,
		Enabled:         cfg.FoodRecommendation.POIEnabled,
		Timeout:         cfg.FoodRecommendation.POITimeout,
	})
	foodRecommendationService := foodrecommendation.NewServiceWithPOI(cfg.DeepSeek, foodRecommendationStore, foodPOIProvider)

	newsSource := news.NewRSSSource(
		&http.Client{Timeout: cfg.News.RequestTimeout},
		cfg.News.FeedURLs,
		cfg.News.MaxArticlesPerFeed,
	)
	newsService := news.NewService(cfg.News, newsSource, news.NewDeepSeekSummarizer(cfg.DeepSeek))
	backgroundContext, cancelBackground := context.WithCancel(context.Background())
	defer cancelBackground()
	go newsService.Run(backgroundContext)

	server := httpapi.NewServerWithMembershipRecommendationAndFood(
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
		foodRecommendationService,
		scoreService,
	)

	go func() {
		log.Printf("backend listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	cancelBackground()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func loadEnvFiles() {
	candidates := []string{
		".env",
		filepath.Join("backend", ".env"),
		filepath.Join("email-agent", "backend", ".env"),
		filepath.Join("..", "email-agent", "backend", ".env"),
	}

	for _, filePath := range candidates {
		if _, err := os.Stat(filePath); err == nil {
			if err := godotenv.Load(filePath); err != nil {
				log.Printf("load env file failed for %s: %v", filePath, err)
			}
		}
	}
}
