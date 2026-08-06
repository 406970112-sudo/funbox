package cooling

type Answers struct {
	WhyBuy         string `json:"whyBuy"`
	OtherReason    string `json:"otherReason,omitempty"`
	SimilarCount   string `json:"similarCount"`
	SimilarInUse   string `json:"similarInUse,omitempty"`
	UsageFrequency string `json:"usageFrequency"`
	WantsAfter24h  string `json:"wantsAfter24h"`
	Note           string `json:"note,omitempty"`
}

type ItemInput struct {
	Name       string  `json:"name"`
	PriceCents int64   `json:"priceCents"`
	Currency   string  `json:"currency"`
	SourceType string  `json:"sourceType"`
	SourceText string  `json:"sourceText"`
	SourceURL  string  `json:"sourceUrl"`
	Answers    Answers `json:"answers"`
}

type DecisionInput struct {
	Action          string `json:"action"`
	FinalPriceCents *int64 `json:"finalPriceCents,omitempty"`
	FinalPurchaseAt string `json:"finalPurchaseAt,omitempty"`
	Note            string `json:"note,omitempty"`
}

type SettingsInput struct {
	MonthlySalaryCents  int64   `json:"monthlySalaryCents,omitempty"`
	MonthlyWorkHours    float64 `json:"monthlyWorkHours,omitempty"`
	HourlyWageCents     int64   `json:"hourlyWageCents,omitempty"`
	WageSource          string  `json:"wageSource,omitempty"`
	NotifyBeforeHours   int     `json:"notifyBeforeHours,omitempty"`
	NotificationEnabled *bool   `json:"notificationEnabled,omitempty"`
}

type RecordFilter struct {
	Status string
	Query  string
	Limit  int
}
