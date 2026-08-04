package daysleft

type CategoryInput struct {
	Name              string `json:"name"`
	Icon              string `json:"icon"`
	Color             string `json:"color"`
	ReminderLeadDays  int    `json:"reminderLeadDays"`
	DefaultRecordType string `json:"defaultRecordType"`
	SortOrder         int    `json:"sortOrder"`
	Archived          *bool  `json:"archived"`
}

type RecordInput struct {
	CategoryID        string  `json:"categoryId"`
	Name              string  `json:"name"`
	RecordType        string  `json:"recordType"`
	StartDate         *string `json:"startDate"`
	ExpiryDate        *string `json:"expiryDate"`
	ValidityValue     int     `json:"validityValue"`
	ValidityUnit      string  `json:"validityUnit"`
	CycleUnit         string  `json:"cycleUnit"`
	CycleInterval     int     `json:"cycleInterval"`
	ReminderLeadDays  int     `json:"reminderLeadDays"`
	Note              string  `json:"note"`
	Status            string  `json:"status"`
	Source            string  `json:"source"`
	Verified          *bool   `json:"verified"`
	VerifiedAt        *string `json:"verifiedAt"`
	LastRenewedAt     *string `json:"lastRenewedAt"`
	EvidenceURL       string  `json:"evidenceUrl"`
}

type RenewInput struct {
	NewExpiryDate string `json:"newExpiryDate"`
	Note          string `json:"note"`
	CycleUnit     string `json:"cycleUnit"`
	CycleInterval int    `json:"cycleInterval"`
	EvidenceURL   string `json:"evidenceUrl"`
}

type CompleteInput struct {
	Note string `json:"note"`
}

type EvidenceInput struct {
	Kind string `json:"kind"`
}
