package reading

import "time"

type SourceType string

const (
	SourceProvider SourceType = "provider"
	SourceAdmin    SourceType = "admin"
)

type PublishStatus string

const (
	StatusDraft     PublishStatus = "draft"
	StatusPublished PublishStatus = "published"
	StatusHidden    PublishStatus = "hidden"
	StatusRemoved   PublishStatus = "removed"
)

type Book struct {
	ID            string           `json:"id"`
	SourceType    SourceType       `json:"sourceType"`
	ProviderKey   string           `json:"providerKey,omitempty"`
	ExternalID    string           `json:"externalId,omitempty"`
	Title         string           `json:"title"`
	Author        string           `json:"author"`
	Intro         string           `json:"intro"`
	CoverURL      string           `json:"coverUrl"`
	Category      string           `json:"category"`
	Tags          []string         `json:"tags"`
	SerialStatus  string           `json:"serialStatus"`
	PublishStatus PublishStatus    `json:"publishStatus"`
	AllowOffline  bool             `json:"allowOffline"`
	ChapterCount  int              `json:"chapterCount"`
	WordCount     int              `json:"wordCount"`
	Rights        *ContentRights   `json:"rights,omitempty"`
	Progress      *ReadingProgress `json:"progress,omitempty"`
	InBookshelf   bool             `json:"inBookshelf"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
}

type Chapter struct {
	ID          string `json:"id"`
	BookID      string `json:"bookId"`
	ExternalID  string `json:"externalId,omitempty"`
	Title       string `json:"title"`
	SortOrder   int    `json:"sortOrder"`
	WordCount   int    `json:"wordCount"`
	ContentPath string `json:"-"`
	ContentHash string `json:"contentHash,omitempty"`
	Status      string `json:"status"`
}

type ChapterContent struct {
	BookID     string     `json:"bookId"`
	ChapterID  string     `json:"chapterId"`
	Title      string     `json:"title"`
	Content    string     `json:"content"`
	SortOrder  int        `json:"sortOrder"`
	WordCount  int        `json:"wordCount"`
	PreviousID string     `json:"previousId,omitempty"`
	NextID     string     `json:"nextId,omitempty"`
	SourceType SourceType `json:"sourceType"`
}

type ContentRights struct {
	BookID     string    `json:"bookId"`
	Licensor   string    `json:"licensor"`
	Scope      string    `json:"scope"`
	ProofNote  string    `json:"proofNote"`
	ValidFrom  time.Time `json:"validFrom"`
	ValidUntil time.Time `json:"validUntil"`
	ReviewedBy string    `json:"reviewedBy,omitempty"`
	ReviewedAt time.Time `json:"reviewedAt,omitempty"`
}

type ReadingProgress struct {
	UserID          string    `json:"userId,omitempty"`
	BookID          string    `json:"bookId"`
	ChapterID       string    `json:"chapterId"`
	ChapterProgress float64   `json:"chapterProgress"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type Bookmark struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId,omitempty"`
	BookID    string    `json:"bookId"`
	ChapterID string    `json:"chapterId"`
	Position  float64   `json:"position"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
}

type ProviderSyncRun struct {
	ID           string    `json:"id"`
	ProviderKey  string    `json:"providerKey"`
	SyncType     string    `json:"syncType"`
	StartedAt    time.Time `json:"startedAt"`
	FinishedAt   time.Time `json:"finishedAt,omitempty"`
	Status       string    `json:"status"`
	Cursor       string    `json:"cursor,omitempty"`
	ErrorSummary string    `json:"errorSummary,omitempty"`
	BookCount    int       `json:"bookCount"`
}

type ImportJob struct {
	ID           string    `json:"id"`
	BookID       string    `json:"bookId,omitempty"`
	FileName     string    `json:"fileName"`
	FilePath     string    `json:"-"`
	Format       string    `json:"format"`
	Status       string    `json:"status"`
	Warnings     []string  `json:"warnings"`
	ErrorSummary string    `json:"errorSummary,omitempty"`
	CreatedBy    string    `json:"createdBy"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ImportResult struct {
	ImportID string    `json:"importId"`
	Book     Book      `json:"book"`
	Chapters []Chapter `json:"chapters"`
	Warnings []string  `json:"warnings"`
}

type BookFilter struct {
	Query      string
	Category   string
	Status     PublishStatus
	PublicOnly bool
}

type BookPatch struct {
	Title        *string
	Author       *string
	Intro        *string
	CoverURL     *string
	Category     *string
	SerialStatus *string
	AllowOffline *bool
	Rights       *ContentRights
}
