package homeconsumables

import "time"

type CategoryInput struct {
	Name              string `json:"name"`
	Icon              string `json:"icon"`
	Color             string `json:"color"`
	DefaultUnit       string `json:"defaultUnit"`
	DefaultRemindDays int    `json:"defaultRemindDays"`
	SortOrder         int    `json:"sortOrder"`
	Archived          *bool  `json:"archived"`
}

type ItemInput struct {
	CategoryID            string   `json:"categoryId"`
	Name                  string   `json:"name"`
	Unit                  string   `json:"unit"`
	CurrentStock          *float64 `json:"currentStock"`
	CurrentCycleStartedAt *string  `json:"currentCycleStartedAt"`
	RemindDays            int      `json:"remindDays"`
	Note                  string   `json:"note"`
	Source                string   `json:"source"`
	Status                string   `json:"status"`
}

type EventInput struct {
	EventType   string     `json:"eventType"`
	Quantity    float64    `json:"quantity"`
	OccurredAt  *time.Time `json:"occurredAt"`
	Source      string     `json:"source"`
	Note        string     `json:"note"`
	EvidenceURL string     `json:"evidenceUrl"`
}

type ImportItem struct {
	Item         ItemInput    `json:"item"`
	CategoryName string       `json:"categoryName"`
	Events       []EventInput `json:"events"`
}

type ImportPayload struct {
	Items []ImportItem `json:"items"`
}
