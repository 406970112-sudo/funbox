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

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	httpapi "my-first-expo-app/backend/internal/httpapi"
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

	signingKey, err := auth.ResolveSigningKey(cfg.Auth.JWTSecret, cfg.Auth.JWTSecretFile)
	if err != nil {
		log.Fatalf("load auth signing key failed: %v", err)
	}
	authService := auth.NewService(userStore, signingKey, cfg.Auth.TokenTTL)

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

	server := httpapi.NewServer(cfg, ttsService, translationService, authService)

	go func() {
		log.Printf("backend listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

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
