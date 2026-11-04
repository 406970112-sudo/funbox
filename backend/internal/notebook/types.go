package notebook

import (
	"errors"
	"time"
)

const (
	DefaultBookWork  = "工作"
	DefaultBookLife  = "生活"
	DefaultBookIdeas = "灵感"

	DefaultPageSize      = 50
	MaxPageSize          = 100
	MaxBooks             = 20
	MaxBookNameRunes     = 20
	MaxNoteTitleRunes    = 80
	MaxNoteBodyRunes     = 20000
	MaxTags              = 8
	MaxTagRunes          = 20
	MaxChecklistItems    = 50
	MaxChecklistRunes    = 200
	MaxImagesPerNote     = 4
	MaxAudioPerNote      = 1
	MaxImageBytes        = 5 << 20
	MaxAudioBytes        = 10 << 20
	MediaKindImage       = "image"
	MediaKindAudio       = "audio"
	NoteStatusActive     = "active"
	NoteStatusDeleted    = "deleted"
	DefaultBookColorWork = "#2d5bff"
	DefaultBookColorLife = "#20a97a"
	DefaultBookColorIdea = "#ff765e"
)

var (
	ErrNotFound          = errors.New("notebook record not found")
	ErrBookNotFound      = errors.New("notebook book not found")
	ErrNoteNotFound      = errors.New("notebook note not found")
	ErrInvalidInput      = errors.New("notebook invalid input")
	ErrBookLimitReached  = errors.New("notebook book limit reached")
	ErrBookNameExists    = errors.New("notebook book name already exists")
	ErrBookNotEmpty      = errors.New("notebook book is not empty")
	ErrMediaLimitReached = errors.New("notebook media limit reached")
	ErrMediaTooLarge     = errors.New("notebook media is too large")
	ErrMediaTypeInvalid  = errors.New("notebook media type is invalid")
	ErrDatabasePathEmpty = errors.New("notebook database path is empty")
)

type Book struct {
	ID        string    `json:"id"`
	UserID    string    `json:"-"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	SortOrder int       `json:"sortOrder"`
	NoteCount int       `json:"noteCount"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ChecklistItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Done bool   `json:"done"`
}

type Media struct {
	ID          string    `json:"id"`
	NoteID      string    `json:"noteId"`
	OwnerID     string    `json:"-"`
	Kind        string    `json:"kind"`
	ContentType string    `json:"contentType"`
	URL         string    `json:"url"`
	ByteSize    int64     `json:"byteSize"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Note struct {
	ID        string          `json:"id"`
	BookID    string          `json:"bookId"`
	BookName  string          `json:"bookName"`
	BookColor string          `json:"bookColor"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Checklist []ChecklistItem `json:"checklist"`
	Tags      []string        `json:"tags"`
	Pinned    bool            `json:"pinned"`
	Favorite  bool            `json:"favorite"`
	Media     []Media         `json:"media"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

type BookInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

type NoteInput struct {
	BookID    string          `json:"bookId"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Checklist []ChecklistItem `json:"checklist"`
	Tags      []string        `json:"tags"`
	Pinned    bool            `json:"pinned"`
	Favorite  bool            `json:"favorite"`
}

type NotePatch struct {
	BookID    *string          `json:"bookId"`
	Title     *string          `json:"title"`
	Body      *string          `json:"body"`
	Checklist *[]ChecklistItem `json:"checklist"`
	Tags      *[]string        `json:"tags"`
	Pinned    *bool            `json:"pinned"`
	Favorite  *bool            `json:"favorite"`
}

type NoteFilter struct {
	BookID   string
	Query    string
	Tag      string
	Favorite bool
	Limit    int
	Offset   int
}

type NoteList struct {
	Notes   []Note `json:"notes"`
	HasMore bool   `json:"hasMore"`
}
