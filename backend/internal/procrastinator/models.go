package procrastinator

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrNotFound             = errors.New("procrastinator record not found")
	ErrInvalidInput         = errors.New("procrastinator invalid input")
	ErrAlreadyCompleted     = errors.New("procrastinator step already completed")
	ErrStepNotCompleted     = errors.New("procrastinator step not completed")
	ErrDatabasePathRequired = errors.New("procrastinator database path is required")
	ErrAIUnavailable        = errors.New("procrastinator AI unavailable")
)

const (
	GoalStatusActive    = "active"
	GoalStatusCompleted = "completed"
	GoalStatusArchived  = "archived"

	StepStatusPending   = "pending"
	StepStatusStarted   = "started"
	StepStatusCompleted = "completed"

	EventStepCompleted     = "step_completed"
	EventStepUndone        = "step_undone"
	EventGoalCompleted     = "goal_completed"
	EventGoalCompletedUndo = "goal_completed_undo"

	MinSteps = 2
	MaxSteps = 20
)

type Goal struct {
	ID               string     `json:"id"`
	UserID           string     `json:"userId"`
	Title            string     `json:"title"`
	Note             string     `json:"note"`
	Deadline         string     `json:"deadline"`
	Status           string     `json:"status"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	ArchivedAt       *time.Time `json:"archivedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
	Steps            []Step     `json:"steps,omitempty"`
	TotalSteps       int        `json:"totalSteps"`
	CompletedSteps   int        `json:"completedSteps"`
	EstimatedMinutes int        `json:"estimatedMinutes"`
	RemainingMinutes int        `json:"remainingMinutes"`
	XPEarned         int        `json:"xpEarned"`
	ExpectedXP       int        `json:"expectedXP"`
}

type Step struct {
	ID               string     `json:"id"`
	GoalID           string     `json:"goalId"`
	UserID           string     `json:"userId"`
	Title            string     `json:"title"`
	Note             string     `json:"note"`
	EstimatedMinutes int        `json:"estimatedMinutes"`
	SortOrder        int        `json:"sortOrder"`
	Status           string     `json:"status"`
	StartedAt        *time.Time `json:"startedAt,omitempty"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	ActualSeconds    int        `json:"actualSeconds"`
	XPEarned         int        `json:"xpEarned"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type Event struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	GoalID    string    `json:"goalId"`
	StepID    string    `json:"stepId"`
	EventType string    `json:"eventType"`
	XPDelta   int       `json:"xpDelta"`
	EventDate string    `json:"eventDate"`
	CreatedAt time.Time `json:"createdAt"`
	GoalTitle string    `json:"goalTitle"`
	StepTitle string    `json:"stepTitle"`
}

type StepInput struct {
	Title            string `json:"title"`
	Note             string `json:"note"`
	EstimatedMinutes int    `json:"estimatedMinutes"`
	SortOrder        int    `json:"sortOrder"`
}

type GoalInput struct {
	Title    string      `json:"title"`
	Note     string      `json:"note"`
	Deadline string      `json:"deadline"`
	Steps    []StepInput `json:"steps"`
}

type UpdateGoalInput struct {
	Title    *string `json:"title,omitempty"`
	Note     *string `json:"note,omitempty"`
	Deadline *string `json:"deadline,omitempty"`
	Status   *string `json:"status,omitempty"`
}

type UpdateStepInput struct {
	Title            *string `json:"title,omitempty"`
	Note             *string `json:"note,omitempty"`
	EstimatedMinutes *int    `json:"estimatedMinutes,omitempty"`
	SortOrder        *int    `json:"sortOrder,omitempty"`
}

type Home struct {
	Date          string  `json:"date"`
	TotalXP       int     `json:"totalXP"`
	TodayXP       int     `json:"todayXP"`
	Level         int     `json:"level"`
	LevelProgress int     `json:"levelProgress"`
	NextLevelXP   int     `json:"nextLevelXP"`
	CurrentGoal   *Goal   `json:"currentGoal,omitempty"`
	CurrentStep   *Step   `json:"currentStep,omitempty"`
	Goals         []Goal  `json:"goals"`
	Events        []Event `json:"events"`
}

type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type Stats struct {
	Range          string     `json:"range"`
	StepsCompleted int        `json:"stepsCompleted"`
	TodayXP        int        `json:"todayXP"`
	RangeXP        int        `json:"rangeXP"`
	StreakDays     int        `json:"streakDays"`
	GoalsCompleted int        `json:"goalsCompleted"`
	TotalGoals     int        `json:"totalGoals"`
	Last7Days      []DayCount `json:"last7Days"`
}

type Ledger struct {
	TotalXP int     `json:"totalXP"`
	Events  []Event `json:"events"`
}

type SuggestRequest struct {
	Title string `json:"title"`
	Note  string `json:"note"`
}

type SuggestResult struct {
	Summary string          `json:"summary"`
	Steps   []SuggestedStep `json:"steps"`
}

type SuggestedStep struct {
	Title            string `json:"title"`
	EstimatedMinutes int    `json:"estimatedMinutes"`
}

type LedgerFilter struct {
	GoalID string
	From   string
	To     string
	Limit  int
}

func StepXP(estimatedMinutes int) int {
	xp := 5 + estimatedMinutes
	if xp > 30 {
		return 30
	}
	if xp < 1 {
		return 1
	}
	return xp
}

func GoalBonusXP() int {
	return 20
}

func LevelFromXP(totalXP int) (level, progress, next int) {
	if totalXP < 0 {
		totalXP = 0
	}
	level = totalXP/50 + 1
	progress = totalXP % 50
	next = 50 - progress
	return level, progress, next
}

func normalizeTitle(value string, maxLength int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ErrInvalidInput
	}
	if len([]rune(value)) > maxLength {
		return "", ErrInvalidInput
	}
	return value, nil
}

func validDate(value string) bool {
	if value == "" {
		return true
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}
