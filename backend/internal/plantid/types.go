package plantid

import "time"

type Config struct {
	APIKey         string
	BaseURL        string
	Project        string
	MaxMatches     int
	CacheTTL       time.Duration
	RequestTimeout time.Duration
}

type PlantNetSpecies struct {
	ScientificName              string
	ScientificNameWithoutAuthor string
	Genus                       string
	Family                      string
	CommonNames                 []string
	GBIFKey                     int64
}

type Match struct {
	Rank           int     `json:"rank"`
	Score          float64 `json:"score"`
	GBIFKey        int64   `json:"gbifKey"`
	ScientificName string  `json:"scientificName"`
	CommonNameZh   string  `json:"commonNameZh,omitempty"`
	Family         string  `json:"family"`
	FamilyZh       string  `json:"familyZh,omitempty"`
	Genus          string  `json:"genus"`
	Source         string  `json:"source"`
	FetchedAt      string  `json:"fetchedAt"`
}

type PhotoInfo struct {
	UploadedAt string `json:"uploadedAt"`
}

type IdentificationResult struct {
	IdentificationID string    `json:"identificationId"`
	Photo            PhotoInfo `json:"photo"`
	Matches          []Match   `json:"matches"`
	Disclaimer       string    `json:"disclaimer"`
}

type ImageInfo struct {
	URL       string `json:"url"`
	Source    string `json:"source"`
	Credit    string `json:"credit,omitempty"`
	License   string `json:"license,omitempty"`
	CheckedAt string `json:"checkedAt,omitempty"`
}

type SummaryInfo struct {
	Text      string `json:"text"`
	URL       string `json:"url"`
	Source    string `json:"source"`
	FetchedAt string `json:"fetchedAt"`
}

type ObservationsInfo struct {
	Count     int64  `json:"count"`
	Source    string `json:"source"`
	FetchedAt string `json:"fetchedAt"`
}

type SafetyInfo struct {
	State     string `json:"state"`
	Quote     string `json:"quote,omitempty"`
	Source    string `json:"source,omitempty"`
	Note      string `json:"note"`
	CheckedAt string `json:"checkedAt"`
}

type SpeciesDetail struct {
	GBIFKey        int64                 `json:"gbifKey"`
	ScientificName string                `json:"scientificName"`
	CommonNames    []string              `json:"commonNames"`
	Classification SpeciesClassification `json:"classification"`
	Summary        SummaryInfo           `json:"summary,omitempty"`
	Images         []ImageInfo           `json:"images"`
	Observations   ObservationsInfo      `json:"observations,omitempty"`
	Safety         SafetyInfo            `json:"safety"`
	Disclaimer     string                `json:"disclaimer"`
	FetchedAt      string                `json:"fetchedAt"`
}

type SpeciesClassification struct {
	Family   string `json:"family"`
	FamilyZh string `json:"familyZh,omitempty"`
	Genus    string `json:"genus"`
	Order    string `json:"order,omitempty"`
	Class    string `json:"class,omitempty"`
}

type CommonPlant struct {
	GBIFKey        int64  `json:"gbifKey"`
	NameZh         string `json:"nameZh"`
	ScientificName string `json:"scientificName"`
	FamilyZh       string `json:"familyZh"`
	ImageURL       string `json:"imageUrl"`
	ImageSource    string `json:"imageSource"`
	ImageCredit    string `json:"imageCredit,omitempty"`
	FetchedAt      string `json:"fetchedAt"`
}

type SourceEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Purpose     string `json:"purpose"`
	NeedsKey    bool   `json:"needsKey"`
	UpdatedAt   string `json:"updatedAt"`
	DocumentURL string `json:"documentUrl"`
}

type SourcesResponse struct {
	Items     []SourceEntry `json:"items"`
	FetchedAt string        `json:"fetchedAt"`
}

type HistoryItem struct {
	ID             string  `json:"id"`
	ScientificName string  `json:"scientificName"`
	CommonNameZh   string  `json:"commonNameZh,omitempty"`
	FamilyZh       string  `json:"familyZh,omitempty"`
	GBIFKey        int64   `json:"gbifKey"`
	Score          float64 `json:"score"`
	ImageURL       string  `json:"imageUrl,omitempty"`
	CreatedAt      string  `json:"createdAt"`
}

type FeedbackInput struct {
	IdentificationID string `json:"identificationId"`
	Kind             string `json:"kind"`
	Note             string `json:"note,omitempty"`
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
