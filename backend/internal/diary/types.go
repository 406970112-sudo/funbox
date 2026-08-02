package diary

import (
	"errors"
	"time"
)

const (
	NotebookStatusActive  = "active"
	NotebookStatusDeleted = "deleted"

	EntryStatusActive  = "active"
	EntryStatusDeleted = "deleted"

	MaxNotebookNameRunes = 30
	MaxEntryTitleRunes   = 50
	MaxEntryContentRunes = 10000
	MinPasswordRunes     = 6
	MaxPasswordRunes     = 32
	UnlockTTL            = 30 * time.Minute
	MaxDiaryImages       = 9
	MaxImageBytes        = 5 << 20
	DefaultPageSize      = 30
	MaxPageSize          = 100
)

var (
	ErrNotFound         = errors.New("diary record not found")
	ErrForbidden        = errors.New("diary operation is forbidden")
	ErrInvalidInput     = errors.New("diary invalid input")
	ErrLocked           = errors.New("diary notebook is locked")
	ErrPasswordInvalid  = errors.New("diary password is invalid")
	ErrPasswordMismatch = errors.New("diary password does not match")
	ErrNoPassword       = errors.New("diary notebook has no password")
	ErrPasswordSet      = errors.New("diary password already set")
	ErrImageTooLarge    = errors.New("diary image is too large")
	ErrImagesTooMany    = errors.New("diary has too many images")
	ErrImageTypeInvalid = errors.New("diary image type is invalid")
	ErrDateInvalid      = errors.New("diary entry date is invalid")
	ErrDBPathEmpty      = errors.New("diary database path is empty")
)

type Notebook struct {
	ID              string    `json:"id"`
	OwnerID         string    `json:"ownerId"`
	Name            string    `json:"name"`
	CoverColor      string    `json:"coverColor"`
	HasPassword     bool      `json:"hasPassword"`
	PasswordVersion int       `json:"passwordVersion"`
	PasswordHash    string    `json:"-"`
	KeySalt         string    `json:"-"`
	DataKeyEnc      string    `json:"-"`
	ReminderEnabled bool      `json:"reminderEnabled"`
	ReminderTime    string    `json:"reminderTime"`
	Status          string    `json:"status"`
	EntryCount      int       `json:"entryCount"`
	LastEntryDate   string    `json:"lastEntryDate"`
	CurrentStreak   int       `json:"currentStreak"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type Media struct {
	ID          string `json:"id"`
	StoredName  string `json:"-"`
	ContentType string `json:"contentType"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	SortOrder   int    `json:"sortOrder"`
}

type Entry struct {
	ID               string    `json:"id"`
	NotebookID       string    `json:"notebookId"`
	OwnerID          string    `json:"ownerId"`
	EntryDate        string    `json:"date"`
	Title            string    `json:"title"`
	Content          string    `json:"content"`
	ContentEncrypted bool      `json:"-"`
	Mood             string    `json:"mood"`
	Weather          string    `json:"weather"`
	Status           string    `json:"status"`
	Media            []Media   `json:"media"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type DaySummary struct {
	Date  string `json:"date"`
	Mood  string `json:"mood"`
	Count int    `json:"count"`
}

type CalendarSnapshot struct {
	Month string       `json:"month"`
	Days  []DaySummary `json:"days"`
}

type MoodCount struct {
	Mood  string `json:"mood"`
	Count int    `json:"count"`
}

type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type Stats struct {
	NotebookID    string      `json:"notebookId"`
	EntryCount    int         `json:"entryCount"`
	MonthCount    int         `json:"monthCount"`
	CurrentStreak int         `json:"currentStreak"`
	Last7Days     []DayCount  `json:"last7Days"`
	Moods         []MoodCount `json:"moods"`
}

type NotebookInput struct {
	Name            string  `json:"name"`
	CoverColor      string  `json:"coverColor"`
	Password        *string `json:"password"`
	ReminderEnabled *bool   `json:"reminderEnabled"`
	ReminderTime    *string `json:"reminderTime"`
}

type PasswordInput struct {
	Action  string `json:"action"`
	Current string `json:"current"`
	New     string `json:"new"`
}

type EntryInput struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Mood    string `json:"mood"`
	Weather string `json:"weather"`
}
