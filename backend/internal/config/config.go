package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv             string
	Auth               AuthConfig
	Database           DatabaseConfig
	Server             ServerConfig
	Security           SecurityConfig
	Storage            StorageConfig
	DeepSeek           DeepSeekConfig
	FoodRecommendation FoodRecommendationConfig
	Lottery            LotteryConfig
	News               NewsConfig
	PlantID            PlantIDConfig
	ResourceSearch     ResourceSearchConfig
	MarketRadar        MarketRadarConfig
	StockAlert         StockAlertConfig
	Reading            ReadingConfig
	TinyPNG            TinyPNGConfig
	TTS                TTSConfig
	Volc               VolcConfig
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

type MarketRadarConfig struct {
	CacheTTL       time.Duration
	HistoryBaseURL string
	QuoteBaseURL   string
	RequestTimeout time.Duration
}

type StockAlertConfig struct {
	CacheTTL            time.Duration
	MonitorInterval     time.Duration
	IntradayRefresh     time.Duration
	QuoteBaseURL        string
	DelayedQuoteBaseURL string
	HistoryBaseURL      string
	SearchBaseURL       string
	RequestTimeout      time.Duration
	MaxWatchPerUser     int
	AnalysisDailyLimit  int
	MinKlines           int
	QuoteMaxAge         time.Duration
	SendKey             string
	Secret              string
	Enabled             bool
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
	AudioDir                 string
	AvatarDir                string
	BlogDir                  string
	DiaryDir                 string
	FeedbackDir              string
	MomentDir                string
	PaymentQRDir             string
	ReadingDir               string
	MaxAvatarBytes           int64
	MaxBlogCoverBytes        int64
	MaxDiaryImageBytes       int64
	MaxDiaryImages           int
	MaxFeedbackImageBytes    int64
	MaxFeedbackImages        int
	MaxMomentImageBytes      int64
	MaxMomentImages          int
	MaxPaymentQRBytes        int64
	MaxReadingUploadBytes    int64
	MaxReadingExtractedBytes int64
}

type ReadingConfig struct {
	LibraryEnabled  bool
	ProviderMode    string
	YuewenBaseURL   string
	YuewenAppFlag   string
	YuewenAppSecret string
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
	StockModel     string
	RequestTimeout time.Duration
}

type FoodRecommendationConfig struct {
	AmapKey         string
	AmapBaseURL     string
	OverpassBaseURL string
	POIEnabled      bool
	POITimeout      time.Duration
}

type PlantIDConfig struct {
	APIKey         string
	BaseURL        string
	Project        string
	MaxMatches     int
	CacheTTL       time.Duration
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
	appEnv := envFirst("APP_ENV", "NODE_ENV", "development")
	providerDefault := "mock"
	libraryDefault := "true"
	if strings.EqualFold(appEnv, "production") {
		providerDefault = "disabled"
		libraryDefault = "false"
	}
	cfg := Config{
		AppEnv: appEnv,
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
			AudioDir:                 envFirst("STORAGE_AUDIO_DIR", "VOICE_OUTPUT_DIR", "voice"),
			AvatarDir:                envFirst("STORAGE_AVATAR_DIR", "data/avatars"),
			BlogDir:                  envFirst("STORAGE_BLOG_DIR", "data/blog"),
			DiaryDir:                 envFirst("STORAGE_DIARY_DIR", "data/diary-images"),
			FeedbackDir:              envFirst("STORAGE_FEEDBACK_DIR", "data/feedback-images"),
			MomentDir:                envFirst("STORAGE_MOMENT_DIR", "data/moments"),
			PaymentQRDir:             envFirst("STORAGE_PAYMENT_QR_DIR", "data/payment-qr"),
			ReadingDir:               envFirst("STORAGE_READING_DIR", "data/reading"),
			MaxAvatarBytes:           int64(intFirst("STORAGE_MAX_AVATAR_BYTES", "", "3145728")),
			MaxBlogCoverBytes:        int64(intFirst("STORAGE_MAX_BLOG_COVER_BYTES", "", "2097152")),
			MaxDiaryImageBytes:       int64(intFirst("STORAGE_MAX_DIARY_IMAGE_BYTES", "", "5242880")),
			MaxDiaryImages:           intFirst("STORAGE_MAX_DIARY_IMAGES", "", "9"),
			MaxFeedbackImageBytes:    int64(intFirst("STORAGE_MAX_FEEDBACK_IMAGE_BYTES", "", "5242880")),
			MaxFeedbackImages:        intFirst("STORAGE_MAX_FEEDBACK_IMAGES", "", "3"),
			MaxMomentImageBytes:      int64(intFirst("STORAGE_MAX_MOMENT_IMAGE_BYTES", "", "5242880")),
			MaxMomentImages:          intFirst("STORAGE_MAX_MOMENT_IMAGES", "", "9"),
			MaxPaymentQRBytes:        int64(intFirst("STORAGE_MAX_PAYMENT_QR_BYTES", "", "2097152")),
			MaxReadingUploadBytes:    int64(intFirst("STORAGE_MAX_READING_UPLOAD_BYTES", "", "52428800")),
			MaxReadingExtractedBytes: int64(intFirst("STORAGE_MAX_READING_EXTRACTED_BYTES", "", "209715200")),
		},
		Reading: ReadingConfig{
			LibraryEnabled:  boolFirst("READING_LIBRARY_ENABLED", libraryDefault),
			ProviderMode:    strings.ToLower(envFirst("READING_PROVIDER_MODE", providerDefault)),
			YuewenBaseURL:   envFirst("READING_YUEWEN_BASE_URL", "https://cpapi-i.yuewen.com"),
			YuewenAppFlag:   envFirst("READING_YUEWEN_APPFLAG", ""),
			YuewenAppSecret: envFirst("READING_YUEWEN_APPSECRET", ""),
		},
		DeepSeek: DeepSeekConfig{
			APIKey:         envFirst("DEEPSEEK_API_KEY", ""),
			BaseURL:        envFirst("DEEPSEEK_API_URL", "https://api.deepseek.com"),
			MaxTextLength:  intFirst("TRANSLATION_MAX_TEXT_LENGTH", "", "8000"),
			Model:          envFirst("DEEPSEEK_TRANSLATION_MODEL", "deepseek-chat"),
			StockModel:     envFirst("DEEPSEEK_STOCK_MODEL", "deepseek-v4-flash"),
			RequestTimeout: durationFromMs("DEEPSEEK_REQUEST_TIMEOUT_MS", "", "120000"),
		},
		FoodRecommendation: FoodRecommendationConfig{
			AmapKey:         envFirst("AMAP_WEB_API_KEY", "AMAP_KEY", ""),
			AmapBaseURL:     envFirst("AMAP_WEB_API_URL", "https://restapi.amap.com"),
			OverpassBaseURL: envFirst("OVERPASS_API_URL", "https://overpass-api.de/api/interpreter"),
			POIEnabled:      boolFirst("FOOD_POI_ENABLED", "true"),
			POITimeout:      durationFromMs("FOOD_POI_TIMEOUT_MS", "", "3000"),
		},
		PlantID: PlantIDConfig{
			APIKey:         envFirst("PLANTNET_API_KEY", ""),
			BaseURL:        envFirst("PLANTNET_API_URL", "https://my-api.plantnet.org"),
			Project:        envFirst("PLANTNET_PROJECT", "all"),
			MaxMatches:     intFirst("PLANT_ID_MAX_MATCHES", "", "5"),
			CacheTTL:       durationFromMs("PLANT_ID_CACHE_TTL_MS", "", "86400000"),
			RequestTimeout: durationFromMs("PLANT_ID_TIMEOUT_MS", "", "45000"),
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
		MarketRadar: MarketRadarConfig{
			CacheTTL:       durationFromMs("MARKET_RADAR_CACHE_TTL_MS", "", "120000"),
			HistoryBaseURL: envFirst("MARKET_RADAR_HISTORY_BASE_URL", "https://push2his.eastmoney.com"),
			QuoteBaseURL:   envFirst("MARKET_RADAR_QUOTE_BASE_URL", "https://push2delay.eastmoney.com"),
			RequestTimeout: durationFromMs("MARKET_RADAR_REQUEST_TIMEOUT_MS", "", "12000"),
		},
		StockAlert: StockAlertConfig{
			CacheTTL:            durationFromMs("STOCK_ALERT_CACHE_TTL_MS", "", "60000"),
			MonitorInterval:     durationFromMs("STOCK_ALERT_MONITOR_INTERVAL_MS", "", "10000"),
			IntradayRefresh:     durationFromMs("STOCK_ALERT_INTRADAY_REFRESH_MS", "", "30000"),
			QuoteBaseURL:        envFirst("STOCK_ALERT_QUOTE_BASE_URL", "https://push2.eastmoney.com"),
			DelayedQuoteBaseURL: envFirst("STOCK_ALERT_DELAYED_QUOTE_BASE_URL", "https://push2delay.eastmoney.com"),
			HistoryBaseURL:      envFirst("STOCK_ALERT_HISTORY_BASE_URL", "https://push2his.eastmoney.com"),
			SearchBaseURL:       envFirst("STOCK_ALERT_SEARCH_BASE_URL", "https://searchapi.eastmoney.com"),
			RequestTimeout:      durationFromMs("STOCK_ALERT_REQUEST_TIMEOUT_MS", "", "12000"),
			MaxWatchPerUser:     intFirst("STOCK_ALERT_MAX_WATCH_PER_USER", "", "10"),
			AnalysisDailyLimit:  intFirst("STOCK_ALERT_ANALYSIS_DAILY_LIMIT", "", "10"),
			MinKlines:           intFirst("STOCK_ALERT_MIN_KLINES", "", "60"),
			QuoteMaxAge:         durationFromMs("STOCK_ALERT_QUOTE_MAX_AGE_MS", "", "15000"),
			SendKey:             envFirst("STOCK_ALERT_SENDKEY", ""),
			Secret:              envFirst("STOCK_ALERT_SECRET", "funbox-stock-alert-secret"),
			Enabled:             boolFirst("STOCK_ALERT_ENABLED", "false"),
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

func boolFirst(key string, defaultValue string) bool {
	value := strings.ToLower(strings.TrimSpace(envFirst(key, defaultValue)))
	return value == "1" || value == "true" || value == "yes" || value == "on"
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
