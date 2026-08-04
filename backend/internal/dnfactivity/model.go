package dnfactivity

import (
	"errors"
	"time"
)

type ActivityStatus string

const (
	StatusOngoing ActivityStatus = "ongoing"
	StatusUpcoming ActivityStatus = "upcoming"
	StatusEnded ActivityStatus = "ended"
	StatusUnknown ActivityStatus = "unknown"
)

var (
	ErrSourceUnavailable = errors.New("dnf activity source unavailable")
	ErrSourceInvalid     = errors.New("dnf activity source invalid")
	ErrNotFound          = errors.New("dnf activity not found")
	ErrInvalidInput      = errors.New("dnf activity invalid input")
	ErrFavoriteLimit     = errors.New("dnf activity favorite limit reached")
)

type Activity struct {
	ID          string         `json:"id"`
	SourceID    string         `json:"sourceId"`
	Title       string         `json:"title"`
	StartDate   string         `json:"startDate,omitempty"`
	EndDate     string         `json:"endDate,omitempty"`
	Status      ActivityStatus `json:"status"`
	DaysLeft    int            `json:"daysLeft,omitempty"`
	MobileURL   string         `json:"mobileUrl,omitempty"`
	PCURL       string         `json:"pcUrl,omitempty"`
	MobileImage string         `json:"mobileImage,omitempty"`
	PCImage     string         `json:"pcImage,omitempty"`
	Description string         `json:"description,omitempty"`
	FetchedAt   time.Time      `json:"fetchedAt"`
	Stale       bool           `json:"stale"`
}

type Overview struct {
	Total              int        `json:"total"`
	Ongoing            int        `json:"ongoing"`
	Upcoming           int        `json:"upcoming"`
	Ended              int        `json:"ended"`
	Unknown            int        `json:"unknown"`
	OngoingActivities  []Activity `json:"ongoingActivities"`
	EndingSoon         []Activity `json:"endingSoon"`
	Source             string     `json:"source"`
	SourceURL          string     `json:"sourceUrl"`
	FetchedAt          time.Time  `json:"fetchedAt"`
	Stale              bool       `json:"stale"`
}

type ListQuery struct {
	Status   string
	Query    string
	Sort     string
	Page     int
	PageSize int
}

type ActivityList struct {
	Items    []Activity `json:"items"`
	Total    int        `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"pageSize"`
}

type CalendarDay struct {
	Date        string   `json:"date"`
	ActivityIDs []string `json:"activityIds"`
}

type CalendarMonth struct {
	Year  int           `json:"year"`
	Month int           `json:"month"`
	Days  []CalendarDay `json:"days"`
}

type ShareInfo struct {
	ActivityID string `json:"activityId"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	StartDate  string `json:"startDate,omitempty"`
	EndDate    string `json:"endDate,omitempty"`
	ImageURL   string `json:"imageUrl,omitempty"`
	Text       string `json:"text"`
}

type Favorite struct {
	ActivityID string    `json:"activityId"`
	Title      string    `json:"title"`
	StartDate  string    `json:"startDate,omitempty"`
	EndDate    string    `json:"endDate,omitempty"`
	ImageURL   string    `json:"imageUrl,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}
