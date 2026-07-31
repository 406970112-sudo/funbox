package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv         string
	Auth           AuthConfig
	Database       DatabaseConfig
	Server         ServerConfig
	Security       SecurityConfig
	Storage        StorageConfig
	DeepSeek       DeepSeekConfig
	Lottery        LotteryConfig
	News           NewsConfig
	ResourceSearch ResourceSearchConfig
	TinyPNG        TinyPNGConfig
	TTS            TTSConfig
	Volc           VolcConfig
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

type ResourceSearchConfig struct {
	CacheTTL       time.Duration
	MaxResults     int
	RequestTimeout time.Duration
}

type LotteryConfig struct {
	CacheTTL       time.Duration
	FetchCount     int
	MinimumDraws   int
	Referer        string
	RequestTimeout time.Duration
	SourceURL      string
}

type NewsConfig struct {
	FeedURLs           []string
	Lookback           time.Duration
	MaxArticlesPerFeed int
	MaxEvents          int
	RefreshInterval    time.Duration
	RequestTimeout     time.Duration
	SummaryLimit       int
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

type DeepSeekConfig struct {
	APIKey         string
	BaseURL        string
	MaxTextLength  int
	Model          string
	RequestTimeout time.Duration
}

type TinyPNGConfig struct {
	APIKey         string
	BaseURL        string
	MaxImageBytes  int64
	RequestTimeout time.Duration
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
		DeepSeek: DeepSeekConfig{
			APIKey:         envFirst("DEEPSEEK_API_KEY", ""),
			BaseURL:        envFirst("DEEPSEEK_API_URL", "https://api.deepseek.com"),
			MaxTextLength:  intFirst("TRANSLATION_MAX_TEXT_LENGTH", "", "8000"),
			Model:          envFirst("DEEPSEEK_TRANSLATION_MODEL", "deepseek-chat"),
			RequestTimeout: durationFromMs("DEEPSEEK_REQUEST_TIMEOUT_MS", "", "120000"),
		},
		Lottery: LotteryConfig{
			CacheTTL:       durationFromMs("LOTTERY_CACHE_TTL_MS", "", "900000"),
			FetchCount:     intFirst("LOTTERY_FETCH_COUNT", "", "400"),
			MinimumDraws:   intFirst("LOTTERY_MINIMUM_DRAWS", "", "360"),
			Referer:        envFirst("LOTTERY_REFERER", "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/"),
			RequestTimeout: durationFromMs("LOTTERY_REQUEST_TIMEOUT_MS", "", "10000"),
			SourceURL:      envFirst("LOTTERY_SOURCE_URL", "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=400"),
		},
		News: NewsConfig{
			FeedURLs: splitCSV(envFirst(
				"NEWS_RSS_FEEDS",
				"https://36kr.com/feed,https://www.ifanr.com/feed,https://www.solidot.org/index.rss,https://feeds.bbci.co.uk/zhongwen/simp/rss.xml",
			)),
			Lookback:           durationFromHours("NEWS_LOOKBACK_HOURS", "48"),
			MaxArticlesPerFeed: intFirst("NEWS_MAX_ARTICLES_PER_FEED", "", "20"),
			MaxEvents:          intFirst("NEWS_MAX_EVENTS", "", "60"),
			RefreshInterval:    durationFromMs("NEWS_REFRESH_INTERVAL_MS", "", "900000"),
			RequestTimeout:     durationFromMs("NEWS_REQUEST_TIMEOUT_MS", "", "12000"),
			SummaryLimit:       intFirst("NEWS_SUMMARY_LIMIT", "", "8"),
		},
		ResourceSearch: ResourceSearchConfig{
			CacheTTL:       durationFromMs("RESOURCE_SEARCH_CACHE_TTL_MS", "", "120000"),
			MaxResults:     intFirst("RESOURCE_SEARCH_MAX_RESULTS", "", "20"),
			RequestTimeout: durationFromMs("RESOURCE_SEARCH_REQUEST_TIMEOUT_MS", "", "12000"),
		},
		TinyPNG: TinyPNGConfig{
			APIKey:         envFirst("TINYPNG_API_KEY", ""),
			BaseURL:        envFirst("TINYPNG_API_URL", "https://api.tinify.com"),
			MaxImageBytes:  int64(intFirst("TINYPNG_MAX_IMAGE_BYTES", "", "5242880")),
			RequestTimeout: durationFromMs("TINYPNG_REQUEST_TIMEOUT_MS", "", "60000"),
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

func durationFromHours(key string, defaultValue string) time.Duration {
	value := envFirst(key, defaultValue)
	parsed, err := strconv.Atoi(value)
	if err != nil {
		parsed, _ = strconv.Atoi(defaultValue)
	}
	return time.Duration(parsed) * time.Hour
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
