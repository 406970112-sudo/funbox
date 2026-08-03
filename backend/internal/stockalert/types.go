package stockalert

import (
	"errors"
	"time"
)

var (
	ErrNotFound             = errors.New("stock alert record not found")
	ErrInvalidInput         = errors.New("stock alert invalid input")
	ErrSourceUnavailable    = errors.New("stock alert source unavailable")
	ErrSourceInvalid        = errors.New("stock alert source invalid")
	ErrInsufficientData     = errors.New("stock alert insufficient data")
	ErrAnalysisUnavailable  = errors.New("stock alert analysis unavailable")
	ErrWatchLimitReached    = errors.New("stock alert watch limit reached")
	ErrAnalysisLimitReached = errors.New("stock alert analysis limit reached")
	ErrDatabasePathEmpty    = errors.New("stock alert database path is empty")
	ErrSendKeyNotConfigured = errors.New("stock alert sendkey not configured")
)

type Symbol struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Market string `json:"market"`
	SecID  string `json:"secId"`
	Region string `json:"region"`
}

type IntradayPoint struct {
	Time     string  `json:"time"`
	Price    float64 `json:"price"`
	AvgPrice float64 `json:"avgPrice"`
	Volume   float64 `json:"volume"`
	Amount   float64 `json:"amount"`
}

type IntradaySnapshot struct {
	Date      string          `json:"date"`
	Points    []IntradayPoint `json:"points"`
	Latest    IntradayPoint   `json:"latest"`
	FetchedAt time.Time       `json:"fetchedAt"`
	Stale     bool            `json:"stale"`
}

type Kline struct {
	Date   string  `json:"date"`
	Open   float64 `json:"open"`
	Close  float64 `json:"close"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Volume float64 `json:"volume"`
	Amount float64 `json:"amount"`
}

type Quote struct {
	Price     float64
	PrevClose float64
	Open      float64
	High      float64
	Low       float64
	ChangePct float64
	Delayed   bool
	FetchedAt time.Time
}

type Features struct {
	LastClose        float64 `json:"lastClose"`
	ChangePct        float64 `json:"changePct"`
	MA5              float64 `json:"ma5"`
	MA10             float64 `json:"ma10"`
	MA20             float64 `json:"ma20"`
	MA60             float64 `json:"ma60"`
	RSI14            float64 `json:"rsi14"`
	DIF              float64 `json:"dif"`
	DEA              float64 `json:"dea"`
	MACD             float64 `json:"macd"`
	BollUpper        float64 `json:"bollUpper"`
	BollMid          float64 `json:"bollMid"`
	BollLower        float64 `json:"bollLower"`
	High60           float64 `json:"high60"`
	Low60            float64 `json:"low60"`
	VolumeRatio      float64 `json:"volumeRatio"`
	Return20         float64 `json:"return20"`
	Return60         float64 `json:"return60"`
	Return90         float64 `json:"return90"`
	MaxDrawdown      float64 `json:"maxDrawdown"`
	IntradayPrice    float64 `json:"intradayPrice"`
	IntradayAvg      float64 `json:"intradayAvg"`
	IntradayAboveAvg bool    `json:"intradayAboveAvg"`
	VolumePerMinute  float64 `json:"volumePerMinute"`
	Latest5mChange   float64 `json:"latest5mChangePct"`
	DataStartDate    string  `json:"dataStartDate"`
	DataEndDate      string  `json:"dataEndDate"`
	KlineCount       int     `json:"klineCount"`
	IntradayPoints   int     `json:"intradayPoints"`
}

type SignalRule struct {
	BuyTrigger        float64  `json:"buyTrigger"`
	BuyConditions     []string `json:"buyConditions"`
	BuyReferenceLow   float64  `json:"buyReferenceLow"`
	BuyReferenceHigh  float64  `json:"buyReferenceHigh"`
	SellTrigger       float64  `json:"sellTrigger"`
	SellConditions    []string `json:"sellConditions"`
	SellReferenceLow  float64  `json:"sellReferenceLow"`
	SellReferenceHigh float64  `json:"sellReferenceHigh"`
	StopLoss          float64  `json:"stopLoss"`
	ValidTradingDays  int      `json:"validTradingDays"`
	Reasons           []string `json:"reasons"`
	Summary           string   `json:"summary"`
}

type Analysis struct {
	ID          string     `json:"id"`
	WatchItemID string     `json:"watchItemId"`
	Model       string     `json:"model"`
	DataEndDate string     `json:"dataEndDate"`
	Rule        SignalRule `json:"rule"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type WatchItem struct {
	ID            string    `json:"id"`
	UserID        string    `json:"userId"`
	SymbolCode    string    `json:"symbolCode"`
	Name          string    `json:"name"`
	Market        string    `json:"market"`
	SecID         string    `json:"secId"`
	Enabled       bool      `json:"enabled"`
	ReminderTypes []string  `json:"reminderTypes"`
	Analysis      *Analysis `json:"analysis,omitempty"`
	ValidUntil    string    `json:"validUntil"`
	CreatedAt     time.Time `json:"createdAt"`
	LatestPrice   float64   `json:"latestPrice,omitempty"`
	AvgPrice      float64   `json:"avgPrice,omitempty"`
	ChangePct     float64   `json:"changePct,omitempty"`
	SignalStatus  string    `json:"signalStatus"`
	IntradayTime  string    `json:"intradayTime,omitempty"`
	QuoteStale    bool      `json:"quoteStale"`
}

type AlertEvent struct {
	ID             string     `json:"id"`
	UserID         string     `json:"userId"`
	WatchItemID    string     `json:"watchItemId"`
	SymbolCode     string     `json:"symbolCode"`
	Name           string     `json:"name"`
	Direction      string     `json:"direction"`
	SignalStrength string     `json:"signalStrength"`
	TriggerTime    time.Time  `json:"triggerTime"`
	TriggerPrice   float64    `json:"triggerPrice"`
	AvgPrice       float64    `json:"avgPrice"`
	Conditions     []string   `json:"conditions"`
	Pushed         bool       `json:"pushed"`
	PushedMessage  string     `json:"pushedMessage"`
	ReadAt         *time.Time `json:"readAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type Settings struct {
	UserID          string    `json:"userId"`
	SendKeyMasked   string    `json:"sendKeyMasked"`
	SendKeyBound    bool      `json:"sendKeyBound"`
	ReminderEnabled bool      `json:"reminderEnabled"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type SearchResult struct {
	Symbols []Symbol `json:"symbols"`
}

const (
	SignalListening     = "listening"
	SignalNearBuy       = "near-buy"
	SignalBuyTriggered  = "buy-triggered"
	SignalSellTriggered = "sell-triggered"
	SignalStopTriggered = "stop-triggered"
	SignalExpired       = "expired"
	SignalDataMissing   = "data-missing"
)

const (
	StrengthConfirmed   = "confirmed"
	StrengthObservation = "observation"
)
