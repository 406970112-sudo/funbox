package novelagent

import "time"

type Role string

const (
	RolePlanner  Role = "planner"
	RoleWriter   Role = "writer"
	RoleReviewer Role = "reviewer"
)

type WorkflowStatus string

const (
	StatusPlanning        WorkflowStatus = "A_DISCUSSION"
	StatusReady           WorkflowStatus = "A_READY"
	StatusApproved        WorkflowStatus = "A_APPROVED"
	StatusWriting         WorkflowStatus = "WRITING"
	StatusReviewing       WorkflowStatus = "REVIEWING"
	StatusRevisionWriting WorkflowStatus = "REVISION_WRITING"
	StatusReopenPlanning  WorkflowStatus = "REOPEN_PLANNING"
	StatusCompleted       WorkflowStatus = "COMPLETED"
	StatusFailed          WorkflowStatus = "FAILED"
)

type WorkflowInput struct {
	Premise         string   `json:"premise"`
	Genre           string   `json:"genre,omitempty"`
	Tone            string   `json:"tone,omitempty"`
	Keywords        []string `json:"keywords,omitempty"`
	ReferenceTitle  string   `json:"referenceTitle,omitempty"`
	ReferenceSample string   `json:"referenceSample,omitempty"`
	StyleDimensions []string `json:"styleDimensions,omitempty"`
}

type Message struct {
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

type ReferenceBible struct {
	Structure string   `json:"structure"`
	Pacing    string   `json:"pacing"`
	Motifs    []string `json:"motifs"`
}

type ReferenceStyleProfile struct {
	Enabled    []string         `json:"enabled"`
	Dimensions []StyleDimension `json:"dimensions"`
	SafetyNote string           `json:"safetyNote"`
}

type StyleDimension struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type ReferenceAnalysis struct {
	Title                 string                `json:"title"`
	ReferenceBible        ReferenceBible        `json:"referenceBible"`
	ReferenceStyleProfile ReferenceStyleProfile `json:"referenceStyleProfile"`
	EnabledDimensions     []string              `json:"enabledDimensions"`
}

type CastMember struct {
	Name string `json:"name"`
	Role string `json:"role"`
	Note string `json:"note"`
}

type ChapterPlan struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type Outline struct {
	Hook           string        `json:"hook"`
	Logline        string        `json:"logline"`
	Setting        string        `json:"setting"`
	Cast           []CastMember  `json:"cast"`
	Beats          []string      `json:"beats"`
	Chapters       []ChapterPlan `json:"chapters"`
	ReferenceNote  string        `json:"referenceNote"`
	MustKeep       []string      `json:"mustKeep"`
	MustAvoid      []string      `json:"mustAvoid"`
	ApprovalStatus string        `json:"approvalStatus"`
}

type Plan struct {
	Reference   ReferenceAnalysis `json:"reference"`
	Outline     Outline           `json:"outline"`
	ApprovedAt  *time.Time        `json:"approvedAt,omitempty"`
	PlanVersion int               `json:"planVersion"`
}

type Draft struct {
	Title            string   `json:"title"`
	Subtitle         string   `json:"subtitle"`
	Paragraphs       []string `json:"paragraphs"`
	WordCount        int      `json:"wordCount"`
	Revision         int      `json:"revision"`
	SceneID          string   `json:"sceneId"`
	ActiveRevisionID string   `json:"activeRevisionId"`
	SourceHook       string   `json:"sourceHook"`
	StyleApplied     string   `json:"styleApplied"`
	StyleDimensions  []string `json:"styleDimensions"`
}

type ReviewIssue struct {
	Type     string `json:"type"`
	Message  string `json:"message"`
	Location string `json:"location"`
	Severity string `json:"severity"`
	Route    string `json:"route"`
	Evidence string `json:"evidence"`
}

type ReviewCheck struct {
	ID       string        `json:"id"`
	Label    string        `json:"label"`
	Status   string        `json:"status"`
	Severity string        `json:"severity"`
	Evidence string        `json:"evidence"`
	Issues   []ReviewIssue `json:"issues"`
}

type Review struct {
	Round        int           `json:"round"`
	Pass         bool          `json:"pass"`
	Score        int           `json:"score"`
	Summary      string        `json:"summary"`
	Route        string        `json:"route"`
	Issues       []string      `json:"issues"`
	IssueDetails []ReviewIssue `json:"issueDetails"`
	CheckResults []ReviewCheck `json:"checkResults"`
}

type Workflow struct {
	ID           string         `json:"workflowId"`
	OwnerID      string         `json:"-"`
	Status       WorkflowStatus `json:"status"`
	Version      int            `json:"version"`
	Input        WorkflowInput  `json:"input"`
	AMessages    []Message      `json:"aMessages"`
	DraftPlan    *Plan          `json:"draftPlan,omitempty"`
	ApprovedPlan *Plan          `json:"approvedPlan,omitempty"`
	Draft        *Draft         `json:"draft,omitempty"`
	Review       *Review        `json:"review,omitempty"`
	Attempts     int            `json:"attempts"`
	LastError    string         `json:"lastError,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

type GenerateRequest struct {
	Role         Role
	SystemPrompt string
	UserPrompt   string
	OutputSchema map[string]any
}

type GenerateResponse struct {
	Content          string
	Model            string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}
