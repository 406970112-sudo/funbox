package homerecommendation

import (
	"errors"
	"time"

	"my-first-expo-app/backend/internal/roles"
)

const (
	KindTool = "tool"
	KindGame = "game"

	SourceConfigured = "configured"
	SourceFallback   = "fallback"

	DefaultFallbackFeatureID = "card-score"
)

var (
	ErrSlotNotFound           = errors.New("home recommendation slot not found")
	ErrFeatureInvalid         = errors.New("home recommendation feature is invalid")
	ErrFeatureNotVisible      = errors.New("home recommendation feature is not visible to any role")
	ErrSlotAlreadyDisabled    = errors.New("home recommendation slot is already disabled")
	ErrLastEnabledSlot        = errors.New("at least one enabled recommendation is required")
	ErrInvalidDateRange       = errors.New("startsOn must not be later than endsOn")
	ErrInvalidWeekday        = errors.New("weekday must be between 1 and 7 without duplicates")
	ErrInvalidOverride        = errors.New("home recommendation override is invalid")
	ErrEventInvalid           = errors.New("home recommendation event is invalid")
)

type FeatureDefinition struct {
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	Tagline        string        `json:"tagline"`
	Description    string        `json:"description"`
	Icon           string        `json:"icon"`
	Category       string        `json:"category"`
	Route          string        `json:"route"`
	AccentColor    string        `json:"accentColor"`
	Badges         []string      `json:"badges"`
	UsageLabel     string        `json:"usageLabel"`
	Status         string        `json:"status"`
	Featured       bool          `json:"featured"`
	HiddenFromList bool          `json:"hiddenFromList"`
	InitialRoles   []roles.Role  `json:"initialRoles"`
}

type Slot struct {
	ID                    string    `json:"id"`
	FeatureID             string    `json:"featureId"`
	FeatureKind           string    `json:"featureKind"`
	Enabled               bool      `json:"enabled"`
	SortOrder             int       `json:"sortOrder"`
	StartsOn              *string   `json:"startsOn"`
	EndsOn                *string   `json:"endsOn"`
	Weekdays              []int     `json:"weekdays"`
	TitleOverride         string    `json:"titleOverride"`
	DescriptionOverride   string    `json:"descriptionOverride"`
	CTALabelOverride      string    `json:"ctaLabelOverride"`
	CreatedBy             string    `json:"createdBy"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedBy             string    `json:"updatedBy"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type SlotInput struct {
	FeatureID           string   `json:"featureId"`
	Enabled             *bool    `json:"enabled"`
	SortOrder           *int     `json:"sortOrder"`
	StartsOn            *string  `json:"startsOn"`
	EndsOn              *string  `json:"endsOn"`
	Weekdays            []int    `json:"weekdays"`
	TitleOverride       string   `json:"titleOverride"`
	DescriptionOverride string   `json:"descriptionOverride"`
	CTALabelOverride    string   `json:"ctaLabelOverride"`
}

type AuditEntry struct {
	ID        string    `json:"id"`
	AdminID   string    `json:"adminId"`
	Action    string    `json:"action"`
	SlotID    string    `json:"slotId"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
}

type SlotStats struct {
	SlotID      string `json:"slotId"`
	FeatureID   string `json:"featureId"`
	Views       int    `json:"views"`
	Clicks      int    `json:"clicks"`
	ClickRate   float64 `json:"clickRate"`
}

type Summary struct {
	EnabledToday   int    `json:"enabledToday"`
	Disabled       int    `json:"disabled"`
	DefaultFeature string `json:"defaultFeature"`
}
