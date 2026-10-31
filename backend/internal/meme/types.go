package meme

import "errors"

var ErrInvalid = errors.New("invalid meme request")
var ErrStale = errors.New("catalog changed")
var ErrNotFound = errors.New("meme unavailable")

type CategoryRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}
type Category struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	OriginalTitle string `json:"originalTitle,omitempty"`
	Count         int    `json:"count"`
	CoverURL      string `json:"coverUrl"`
	Group         string `json:"group"`
}
type Image struct {
	Unavailable  bool          `json:"unavailable,omitempty"`
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Label        string        `json:"label"`
	URL          string        `json:"url"`
	ThumbnailURL string        `json:"thumbnailUrl"`
	Width        int           `json:"width"`
	Height       int           `json:"height"`
	Animated     bool          `json:"animated"`
	Bytes        int64         `json:"bytes"`
	Format       string        `json:"format"`
	Categories   []CategoryRef `json:"categories"`
	Favorite     bool          `json:"favorite,omitempty"`
	Rank         int           `json:"rank,omitempty"`
	Score        int           `json:"score,omitempty"`
	Src          string        `json:"-"`
	Thumb        string        `json:"-"`
}
type Source struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	SyncedAt string `json:"syncedAt"`
}
type Page struct {
	Items      []Image `json:"items"`
	NextCursor string  `json:"nextCursor"`
	Total      int     `json:"total"`
	Version    string  `json:"version,omitempty"`
	Source     Source  `json:"source"`
}
type SourceCategory struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Count int    `json:"count"`
}
type SourceImage struct {
	Src           string `json:"src"`
	Thumb         string `json:"thumb"`
	Label         string `json:"label"`
	Name          string `json:"name"`
	Category      string `json:"category"`
	CategoryTitle string `json:"categoryTitle"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	Animated      bool   `json:"animated"`
	Bytes         int64  `json:"bytes"`
}
type Query struct {
	Q, Category, Animated, Sort, Cursor string
	Limit                               int
	Favorites                           bool
}
type Ranking struct {
	Items            []Image `json:"items"`
	Mode             string  `json:"mode"`
	Period           string  `json:"period"`
	Date             string  `json:"date"`
	UpdatedAt        string  `json:"updatedAt"`
	AlgorithmVersion string  `json:"algorithmVersion"`
	DataSince        string  `json:"dataSince"`
	IsFinal          bool    `json:"isFinal"`
	Notice           string  `json:"notice,omitempty"`
}
