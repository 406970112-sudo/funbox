package priceradar

import (
	"errors"
	"io"
	"time"
)

const (
	ReportStatusPending  = "pending"
	ReportStatusVerified = "verified"
	ReportStatusRejected = "rejected"
	ReportStatusOffline  = "offline"

	StoreTypeSupermarket = "supermarket"
	StoreTypeWetMarket   = "wet_market"
	StoreTypeCommunity   = "community_store"
	StoreTypeOther       = "other"

	UnitPer500g    = "元/500克"
	UnitPerKg      = "元/公斤"
	UnitPerJin     = "元/斤"
	UnitPerPortion = "元/份"

	EvidenceVisibilityPublic   = "public"
	EvidenceVisibilityReviewer = "reviewer_only"

	ObjectionStatusPending  = "pending"
	ObjectionStatusResolved = "resolved"
)

var (
	ErrInvalidInput      = errors.New("price radar invalid input")
	ErrProductNotFound   = errors.New("price radar product not found")
	ErrReportNotFound    = errors.New("price radar report not found")
	ErrSourceUnavailable = errors.New("price radar source unavailable")
	ErrSourceInvalid     = errors.New("price radar source invalid")
	ErrImagesTooMany     = errors.New("price radar too many images")
	ErrImageTooLarge     = errors.New("price radar image too large")
	ErrImageTypeInvalid  = errors.New("price radar image type invalid")
)

type Product struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	SubCategory string `json:"subCategory"`
	Code        string `json:"code"`
	Unit        string `json:"unit"`
}

type Market struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	EnterpriseName string  `json:"enterpriseName"`
	ProvinceCode   string  `json:"provinceCode"`
	ProvinceName   string  `json:"provinceName"`
	Address        string  `json:"address"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
}

type OfficialPrice struct {
	MarketID       string  `json:"marketId"`
	MarketName     string  `json:"marketName"`
	EnterpriseName string  `json:"enterpriseName"`
	Price          float64 `json:"price"`
	Unit           string  `json:"unit"`
	CapturedAt     string  `json:"capturedAt"`
	Source         string  `json:"source"`
	SourceURL      string  `json:"sourceUrl"`
}

type SourceStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updatedAt"`
	Detail    string `json:"detail"`
}

type UserSummary struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type Evidence struct {
	ID          string `json:"id"`
	ReportID    string `json:"reportId"`
	URL         string `json:"url"`
	ContentType string `json:"contentType"`
	SizeBytes   int64  `json:"sizeBytes"`
	Visibility  string `json:"visibility"`
	SortOrder   int    `json:"sortOrder"`
	StoredName  string `json:"-"`
}

type Report struct {
	ID           string      `json:"id"`
	ProductID    string      `json:"productId"`
	ProductName  string      `json:"productName"`
	StoreName    string      `json:"storeName"`
	StoreType    string      `json:"storeType"`
	Address      string      `json:"address"`
	Price        float64     `json:"price"`
	Unit         string      `json:"unit"`
	PurchaseDate string      `json:"purchaseDate"`
	Latitude     float64     `json:"latitude"`
	Longitude    float64     `json:"longitude"`
	Status       string      `json:"status"`
	Images       []Evidence  `json:"images"`
	User         UserSummary `json:"user"`
	CreatedAt    time.Time   `json:"createdAt"`
	VerifiedAt   *time.Time  `json:"verifiedAt,omitempty"`
	DecisionNote string      `json:"decisionNote,omitempty"`
	ReviewerID   string      `json:"-"`
}

type Objection struct {
	ID         string      `json:"id"`
	ReportID   string      `json:"reportId"`
	User       UserSummary `json:"user"`
	Reason     string      `json:"reason"`
	Body       string      `json:"body"`
	Status     string      `json:"status"`
	Images     []Evidence  `json:"images"`
	CreatedAt  time.Time   `json:"createdAt"`
	ResolvedAt *time.Time  `json:"resolvedAt,omitempty"`
	Resolution string      `json:"resolution,omitempty"`
	ReviewerID string      `json:"-"`
}

type Comment struct {
	ID        string      `json:"id"`
	ReportID  string      `json:"reportId"`
	User      UserSummary `json:"user"`
	Body      string      `json:"body"`
	Status    string      `json:"status"`
	CreatedAt time.Time   `json:"createdAt"`
}

type DiscussionItem struct {
	Type   string `json:"type"`
	Object any    `json:"object"`
}

type SearchResult struct {
	Product           Product         `json:"product"`
	OfficialReference []OfficialPrice `json:"officialReference"`
	NearbyReports     []Report        `json:"nearbyReports"`
	Sources           []SourceStatus  `json:"sources"`
	FetchedAt         string          `json:"fetchedAt"`
	Stale             bool            `json:"stale"`
}

type CreateReportInput struct {
	ProductID    string
	ProductName  string
	StoreName    string
	StoreType    string
	Price        float64
	Unit         string
	PurchaseDate string
	Address      string
	Latitude     float64
	Longitude    float64
}

type CreateObjectionInput struct {
	ReportID string
	Reason   string
	Body     string
	Images   []Upload
}

type CreateCommentInput struct {
	ReportID string
	Body     string
}

type Upload struct {
	Reader io.Reader
}
