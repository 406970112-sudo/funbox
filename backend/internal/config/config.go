package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv   string
	Auth     AuthConfig
	Database DatabaseConfig
	Server   ServerConfig
	Security SecurityConfig
	Storage  StorageConfig
	OpenAI   OpenAIConfig
	TTS      TTSConfig
	Volc     VolcConfig
}

type AuthConfig struct {
	JWTSecret     string
	JWTSecretFile string
	TokenTTL      time.Duration
}

type DatabaseConfig struct {
	Path string
}

type ServerConfig struct {
	AllowedOrigins []string
	Host           string
	Port           int
	PublicBaseURL  string
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
}

type SecurityConfig struct {
	MaxRequestBodyBytes int64
	RateLimitMax        int
	RateLimitWindow     time.Duration
}

type StorageConfig struct {
	AudioDir       string
	AvatarDir      string
	MaxAvatarBytes int64
}

type TTSConfig struct {
	MaxContextLength int
	MaxTextLength    int
	RequestTimeout   time.Duration
}

type OpenAIConfig struct {
	APIKey          string
	MaxTextLength   int
	Model           string
	ReasoningEffort string
	RequestTimeout  time.Duration
}

type VolcConfig struct {
	AccessToken string
	AppID       string
	Endpoint    string
	ResourceID  string
}

func Load() (Config, error) {
	cfg := Config{
		AppEnv: envFirst("APP_ENV", "NODE_ENV", "development"),
		Auth: AuthConfig{
			JWTSecret:     envFirst("AUTH_JWT_SECRET", ""),
			JWTSecretFile: envFirst("AUTH_JWT_SECRET_FILE", "data/jwt-secret"),
			TokenTTL:      durationFromMs("AUTH_TOKEN_TTL_MS", "", "604800000"),
		},
		Database: DatabaseConfig{
			Path: envFirst("DATABASE_PATH", "data/app.db"),
		},
		Server: ServerConfig{
			AllowedOrigins: splitCSV(envFirst("CORS_ALLOWED_ORIGINS", "VOICE_ALLOWED_ORIGINS", "")),
			Host:           envFirst("SERVER_HOST", "VOICE_SERVER_HOST", "0.0.0.0"),
			Port:           intFirst("SERVER_PORT", "VOICE_SERVER_PORT", "3000"),
			PublicBaseURL:  envFirst("SERVER_PUBLIC_BASE_URL", "VOICE_PUBLIC_BASE_URL", ""),
			ReadTimeout:    durationFromMs("SERVER_READ_TIMEOUT_MS", "", "15000"),
			WriteTimeout:   durationFromMs("SERVER_WRITE_TIMEOUT_MS", "", "15000"),
		},
		Security: SecurityConfig{
			MaxRequestBodyBytes: int64(intFirst("MAX_REQUEST_BODY_BYTES", "VOICE_MAX_REQUEST_BYTES", "65536")),
			RateLimitMax:        intFirst("RATE_LIMIT_MAX_REQUESTS", "VOICE_RATE_LIMIT_MAX_REQUESTS", "30"),
			RateLimitWindow:     durationFromMs("RATE_LIMIT_WINDOW_MS", "VOICE_RATE_LIMIT_WINDOW_MS", "900000"),
		},
		Storage: StorageConfig{
			AudioDir:       envFirst("STORAGE_AUDIO_DIR", "VOICE_OUTPUT_DIR", "voice"),
			AvatarDir:      envFirst("STORAGE_AVATAR_DIR", "data/avatars"),
			MaxAvatarBytes: int64(intFirst("STORAGE_MAX_AVATAR_BYTES", "", "3145728")),
		},
		OpenAI: OpenAIConfig{
			APIKey:          envFirst("OPENAI_API_KEY", ""),
			MaxTextLength:   intFirst("TRANSLATION_MAX_TEXT_LENGTH", "", "8000"),
			Model:           envFirst("OPENAI_TRANSLATION_MODEL", "gpt-5.4"),
			ReasoningEffort: envFirst("OPENAI_REASONING_EFFORT", "low"),
			RequestTimeout:  durationFromMs("OPENAI_REQUEST_TIMEOUT_MS", "", "120000"),
		},
		TTS: TTSConfig{
			MaxContextLength: intFirst("TTS_MAX_CONTEXT_LENGTH", "VOICE_MAX_CONTEXT_LENGTH", "1000"),
			MaxTextLength:    intFirst("TTS_MAX_TEXT_LENGTH", "VOICE_MAX_TEXT_LENGTH", "5000"),
			RequestTimeout:   durationFromMs("TTS_REQUEST_TIMEOUT_MS", "", "120000"),
		},
		Volc: VolcConfig{
			AccessToken: envFirst("VOLC_ACCESS_TOKEN", ""),
			AppID:       envFirst("VOLC_APP_ID", ""),
			Endpoint: envFirst(
				"VOLC_ENDPOINT",
				"wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream",
			),
			ResourceID: envFirst("VOLC_RESOURCE_ID", ""),
		},
	}

	return cfg, nil
}

func envFirst(keys ...string) string {
	if len(keys) == 0 {
		return ""
	}

	defaultValue := keys[len(keys)-1]
	for _, key := range keys[:len(keys)-1] {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}

	return defaultValue
}

func intFirst(key string, fallbackKey string, defaultValue string) int {
	value := envFirst(key, fallbackKey, defaultValue)
	parsed, err := strconv.Atoi(value)
	if err != nil {
		parsed, _ = strconv.Atoi(defaultValue)
		return parsed
	}

	return parsed
}

func durationFromMs(key string, fallbackKey string, defaultValue string) time.Duration {
	value := envFirst(key, fallbackKey, defaultValue)
	parsed, err := strconv.Atoi(value)
	if err != nil {
		parsed, _ = strconv.Atoi(defaultValue)
		return time.Duration(parsed) * time.Millisecond
	}

	return time.Duration(parsed) * time.Millisecond
}

func splitCSV(value string) []string {
	if value == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}

	return result
}
