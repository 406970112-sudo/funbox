package procrastinator

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathRequired
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create procrastinator database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open procrastinator database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS procrastination_goals (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 60),
			note TEXT NOT NULL DEFAULT '',
			deadline TEXT,
			status TEXT NOT NULL DEFAULT 'active'
				CHECK(status IN ('active', 'completed', 'archived')),
			completed_at INTEGER,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_procrastination_goals_user
			ON procrastination_goals(user_id, status, created_at)`,
		`CREATE TABLE IF NOT EXISTS procrastination_steps (
			id TEXT PRIMARY KEY,
			goal_id TEXT NOT NULL REFERENCES procrastination_goals(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 60),
			note TEXT NOT NULL DEFAULT '',
			estimated_minutes INTEGER NOT NULL CHECK(estimated_minutes BETWEEN 1 AND 120),
			sort_order INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending'
				CHECK(status IN ('pending', 'started', 'completed')),
			started_at INTEGER,
			completed_at INTEGER,
			xp_earned INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_procrastination_steps_goal
			ON procrastination_steps(goal_id, sort_order)`,
		`CREATE INDEX IF NOT EXISTS idx_procrastination_steps_user
			ON procrastination_steps(user_id, status)`,
		`CREATE TABLE IF NOT EXISTS procrastination_events (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			goal_id TEXT NOT NULL,
			step_id TEXT,
			event_type TEXT NOT NULL
				CHECK(event_type IN ('step_completed', 'step_undone', 'goal_completed', 'goal_completed_undo')),
			xp_delta INTEGER NOT NULL,
			event_date TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_procrastination_events_user_date
			ON procrastination_events(user_id, event_date, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_procrastination_events_goal
			ON procrastination_events(goal_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run procrastinator migration: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateGoal(ctx context.Context, userID string, input GoalInput) (Goal, error) {
	if err := validateGoalInput(input); err != nil {
		return Goal{}, err
	}
	now := time.Now().UTC()
	goalID := uuid.NewString()
	goal := Goal{
		ID:        goalID,
		UserID:    userID,
		Title:     strings.TrimSpace(input.Title),
		Note:      strings.TrimSpace(input.Note),
		Deadline:  strings.TrimSpace(input.Deadline),
		Status:    GoalStatusActive,
		CreatedAt: now,
		UpdatedAt: now,
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Goal{}, fmt.Errorf("begin create procrastinator goal: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO procrastination_goals (
			id, user_id, title, note, deadline, status, completed_at, archived_at,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)
	`, goal.ID, goal.UserID, goal.Title, goal.Note, nullString(goal.Deadline),
		goal.CreatedAt.Unix(), goal.UpdatedAt.Unix()); err != nil {
		return Goal{}, fmt.Errorf("insert procrastinator goal: %w", err)
	}
	for index, inputStep := range input.Steps {
		if inputStep.SortOrder == 0 {
			inputStep.SortOrder = index + 1
		}
		if err := insertStep(ctx, tx, userID, goalID, inputStep, now); err != nil {
			return Goal{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Goal{}, fmt.Errorf("commit create procrastinator goal: %w", err)
	}
	return s.GetGoal(ctx, userID, goalID)
}

func (s *Store) ListGoals(ctx context.Context, userID, status string) ([]Goal, error) {
	if status == "" {
		status = GoalStatusActive
	}
	query := `
		SELECT id, user_id, title, note, deadline, status, completed_at, archived_at,
			created_at, updated_at
		FROM procrastination_goals
		WHERE user_id = ? AND status = ?
		ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
			created_at DESC
	`
	rows, err := s.db.QueryContext(ctx, query, userID, status)
	if err != nil {
		return nil, fmt.Errorf("list procrastinator goals: %w", err)
	}
	goals := []Goal{}
	for rows.Next() {
		goal, err := scanGoal(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		goals = append(goals, goal)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range goals {
		if err := s.decorateGoal(ctx, s.db, &goals[index]); err != nil {
			return nil, err
		}
	}
	return goals, nil
}

func (s *Store) GetGoal(ctx context.Context, userID, goalID string) (Goal, error) {
	goal, err := loadGoalByID(ctx, s.db, userID, goalID)
	if err != nil {
		return Goal{}, err
	}
	steps, err := loadSteps(ctx, s.db, goalID)
	if err != nil {
		return Goal{}, err
	}
	goal.Steps = steps
	if err := s.decorateGoal(ctx, s.db, &goal); err != nil {
		return Goal{}, err
	}
	return goal, nil
}

func (s *Store) UpdateGoal(ctx context.Context, userID, goalID string, input UpdateGoalInput) (Goal, error) {
	goal, err := loadGoalByID(ctx, s.db, userID, goalID)
	if err != nil {
		return Goal{}, err
	}
	if input.Title != nil {
		title, err := normalizeTitle(stringValue(input.Title), 60)
		if err != nil {
			return Goal{}, err
		}
		goal.Title = title
	}
	if input.Note != nil {
		note := strings.TrimSpace(stringValue(input.Note))
		if len([]rune(note)) > 500 {
			return Goal{}, ErrInvalidInput
		}
		goal.Note = note
	}
	if input.Deadline != nil {
		deadline := strings.TrimSpace(stringValue(input.Deadline))
		if !validDate(deadline) {
			return Goal{}, ErrInvalidInput
		}
		goal.Deadline = deadline
	}
	if input.Status != nil {
		status := strings.TrimSpace(stringValue(input.Status))
		if status != GoalStatusActive && status != GoalStatusArchived {
			return Goal{}, ErrInvalidInput
		}
		goal.Status = status
	}
	now := time.Now().UTC()
	goal.UpdatedAt = now
	if goal.Status == GoalStatusActive {
		goal.CompletedAt = nil
		goal.ArchivedAt = nil
	}
	if goal.Status == GoalStatusArchived && goal.ArchivedAt == nil {
		goal.ArchivedAt = &now
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE procrastination_goals
		SET title = ?, note = ?, deadline = ?, status = ?, completed_at = ?,
			archived_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, goal.Title, goal.Note, nullString(goal.Deadline), goal.Status, nullUnix(goal.CompletedAt),
		nullUnix(goal.ArchivedAt), goal.UpdatedAt.Unix(), goalID, userID); err != nil {
		return Goal{}, fmt.Errorf("update procrastinator goal: %w", err)
	}
	return s.GetGoal(ctx, userID, goalID)
}

func (s *Store) AddStep(ctx context.Context, userID, goalID string, input StepInput) (Goal, error) {
	if err := validateStepInput(input); err != nil {
		return Goal{}, err
	}
	goal, err := loadGoalByID(ctx, s.db, userID, goalID)
	if err != nil {
		return Goal{}, err
	}
	if goal.Status != GoalStatusActive {
		return Goal{}, ErrInvalidInput
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM procrastination_steps WHERE goal_id = ?
	`, goalID).Scan(&count); err != nil {
		return Goal{}, fmt.Errorf("count procrastinator steps: %w", err)
	}
	if count >= MaxSteps {
		return Goal{}, ErrInvalidInput
	}
	var maxSort int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(sort_order), 0) FROM procrastination_steps WHERE goal_id = ?
	`, goalID).Scan(&maxSort); err != nil {
		return Goal{}, fmt.Errorf("max procrastinator step order: %w", err)
	}
	if input.SortOrder == 0 {
		input.SortOrder = maxSort + 1
	}
	if err := insertStep(ctx, s.db, userID, goalID, input, time.Now().UTC()); err != nil {
		return Goal{}, err
	}
	return s.GetGoal(ctx, userID, goalID)
}

func (s *Store) UpdateStep(ctx context.Context, userID, goalID, stepID string, input UpdateStepInput) (Goal, error) {
	step, err := loadStepByID(ctx, s.db, userID, stepID)
	if err != nil {
		return Goal{}, err
	}
	if step.GoalID != goalID {
		return Goal{}, ErrNotFound
	}
	if input.Title != nil {
		title, err := normalizeTitle(stringValue(input.Title), 60)
		if err != nil {
			return Goal{}, err
		}
		step.Title = title
	}
	if input.Note != nil {
		note := strings.TrimSpace(stringValue(input.Note))
		if len([]rune(note)) > 200 {
			return Goal{}, ErrInvalidInput
		}
		step.Note = note
	}
	if input.EstimatedMinutes != nil {
		if *input.EstimatedMinutes < 1 || *input.EstimatedMinutes > 120 {
			return Goal{}, ErrInvalidInput
		}
		step.EstimatedMinutes = *input.EstimatedMinutes
	}
	if input.SortOrder != nil {
		step.SortOrder = *input.SortOrder
	}
	step.UpdatedAt = time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE procrastination_steps
		SET title = ?, note = ?, estimated_minutes = ?, sort_order = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, step.Title, step.Note, step.EstimatedMinutes, step.SortOrder,
		step.UpdatedAt.Unix(), stepID, userID); err != nil {
		return Goal{}, fmt.Errorf("update procrastinator step: %w", err)
	}
	return s.GetGoal(ctx, userID, goalID)
}

func (s *Store) DeleteStep(ctx context.Context, userID, goalID, stepID string) (Goal, error) {
	step, err := loadStepByID(ctx, s.db, userID, stepID)
	if err != nil {
		return Goal{}, err
	}
	if step.GoalID != goalID {
		return Goal{}, ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Goal{}, fmt.Errorf("begin delete procrastinator step: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM procrastination_steps WHERE id = ? AND user_id = ?
	`, stepID, userID); err != nil {
		return Goal{}, fmt.Errorf("delete procrastinator step: %w", err)
	}
	if err := recomputeGoalCompletion(ctx, tx, userID, goalID, time.Now().UTC(), time.Now().Format("2006-01-02")); err != nil {
		return Goal{}, err
	}
	if err := tx.Commit(); err != nil {
		return Goal{}, fmt.Errorf("commit delete procrastinator step: %w", err)
	}
	return s.GetGoal(ctx, userID, goalID)
}

func (s *Store) StartStep(ctx context.Context, userID, stepID string) (Goal, error) {
	step, err := loadStepByID(ctx, s.db, userID, stepID)
	if err != nil {
		return Goal{}, err
	}
	if step.Status != StepStatusPending {
		return Goal{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE procrastination_steps
		SET status = 'started', started_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, now.Unix(), now.Unix(), stepID, userID); err != nil {
		return Goal{}, fmt.Errorf("start procrastinator step: %w", err)
	}
	return s.GetGoal(ctx, userID, step.GoalID)
}

func (s *Store) CompleteStep(ctx context.Context, userID, stepID, date string) (Goal, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return Goal{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Goal{}, fmt.Errorf("begin complete procrastinator step: %w", err)
	}
	defer tx.Rollback()
	step, err := loadStepByID(ctx, tx, userID, stepID)
	if err != nil {
		return Goal{}, err
	}
	if step.Status == StepStatusCompleted {
		return Goal{}, ErrAlreadyCompleted
	}
	actualSeconds := 0
	if step.StartedAt != nil {
		actualSeconds = int(now.Sub(*step.StartedAt).Seconds())
		if actualSeconds < 0 {
			actualSeconds = 0
		}
	}
	xp := StepXP(step.EstimatedMinutes)
	if _, err := tx.ExecContext(ctx, `
		UPDATE procrastination_steps
		SET status = 'completed', completed_at = ?, xp_earned = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, now.Unix(), xp, now.Unix(), stepID, userID); err != nil {
		return Goal{}, fmt.Errorf("complete procrastinator step: %w", err)
	}
	if err := insertEvent(ctx, tx, Event{
		ID:        uuid.NewString(),
		UserID:    userID,
		GoalID:    step.GoalID,
		StepID:    step.ID,
		EventType: EventStepCompleted,
		XPDelta:   xp,
		EventDate: date,
		CreatedAt: now,
	}); err != nil {
		return Goal{}, err
	}
	if err := recomputeGoalCompletion(ctx, tx, userID, step.GoalID, now, date); err != nil {
		return Goal{}, err
	}
	if err := tx.Commit(); err != nil {
		return Goal{}, fmt.Errorf("commit complete procrastinator step: %w", err)
	}
	return s.GetGoal(ctx, userID, step.GoalID)
}

func (s *Store) UndoStep(ctx context.Context, userID, stepID, date string) (Goal, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return Goal{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Goal{}, fmt.Errorf("begin undo procrastinator step: %w", err)
	}
	defer tx.Rollback()
	step, err := loadStepByID(ctx, tx, userID, stepID)
	if err != nil {
		return Goal{}, err
	}
	if step.Status != StepStatusCompleted {
		return Goal{}, ErrStepNotCompleted
	}
	xp := step.XPEarned
	if _, err := tx.ExecContext(ctx, `
		UPDATE procrastination_steps
		SET status = 'pending', started_at = NULL, completed_at = NULL,
			xp_earned = 0, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, now.Unix(), stepID, userID); err != nil {
		return Goal{}, fmt.Errorf("undo procrastinator step: %w", err)
	}
	if err := insertEvent(ctx, tx, Event{
		ID:        uuid.NewString(),
		UserID:    userID,
		GoalID:    step.GoalID,
		StepID:    step.ID,
		EventType: EventStepUndone,
		XPDelta:   -xp,
		EventDate: date,
		CreatedAt: now,
	}); err != nil {
		return Goal{}, err
	}
	if err := recomputeGoalCompletion(ctx, tx, userID, step.GoalID, now, date); err != nil {
		return Goal{}, err
	}
	if err := tx.Commit(); err != nil {
		return Goal{}, fmt.Errorf("commit undo procrastinator step: %w", err)
	}
	return s.GetGoal(ctx, userID, step.GoalID)
}

func (s *Store) Home(ctx context.Context, userID, date string) (Home, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return Home{}, ErrInvalidInput
	}
	goals, err := s.ListGoals(ctx, userID, GoalStatusActive)
	if err != nil {
		return Home{}, err
	}
	home := Home{Date: date, Goals: goals, Events: []Event{}}
	for index := range goals {
		if goals[index].CompletedSteps < goals[index].TotalSteps {
			home.CurrentGoal = &goals[index]
			break
		}
	}
	if home.CurrentGoal != nil {
		detail, err := s.GetGoal(ctx, userID, home.CurrentGoal.ID)
		if err != nil {
			return Home{}, err
		}
		home.CurrentGoal = &detail
		for index := range detail.Steps {
			if detail.Steps[index].Status != StepStatusCompleted {
				home.CurrentStep = &detail.Steps[index]
				break
			}
		}
	}
	ledger, err := s.Ledger(ctx, userID, LedgerFilter{Limit: 12})
	if err != nil {
		return Home{}, err
	}
	home.Events = ledger.Events
	home.TotalXP = ledger.TotalXP
	home.TodayXP, err = s.sumXPByDate(ctx, userID, date)
	if err != nil {
		return Home{}, err
	}
	home.Level, home.LevelProgress, home.NextLevelXP = LevelFromXP(home.TotalXP)
	return home, nil
}

func (s *Store) Ledger(ctx context.Context, userID string, filter LedgerFilter) (Ledger, error) {
	query := `
		SELECT e.id, e.user_id, e.goal_id, e.step_id, e.event_type, e.xp_delta,
			e.event_date, e.created_at, g.title, COALESCE(s.title, '')
		FROM procrastination_events e
		JOIN procrastination_goals g ON g.id = e.goal_id
		LEFT JOIN procrastination_steps s ON s.id = e.step_id
		WHERE e.user_id = ?`
	args := []any{userID}
	if filter.GoalID != "" {
		query += " AND e.goal_id = ?"
		args = append(args, filter.GoalID)
	}
	if filter.From != "" {
		query += " AND e.event_date >= ?"
		args = append(args, filter.From)
	}
	if filter.To != "" {
		query += " AND e.event_date <= ?"
		args = append(args, filter.To)
	}
	query += " ORDER BY e.created_at DESC, e.id DESC"
	if filter.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Ledger{}, fmt.Errorf("list procrastinator ledger: %w", err)
	}
	defer rows.Close()
	events := []Event{}
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return Ledger{}, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return Ledger{}, err
	}
	var totalXP int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(xp_delta), 0) FROM procrastination_events WHERE user_id = ?
	`, userID).Scan(&totalXP); err != nil {
		return Ledger{}, fmt.Errorf("sum procrastinator XP: %w", err)
	}
	return Ledger{TotalXP: totalXP, Events: events}, nil
}

func (s *Store) Stats(ctx context.Context, userID, rangeID string) (Stats, error) {
	today := time.Now().Format("2006-01-02")
	start := statsRangeStart(rangeID)
	stats := Stats{Range: rangeID, Last7Days: []DayCount{}}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM procrastination_steps
		WHERE user_id = ? AND status = 'completed'
	`, userID).Scan(&stats.StepsCompleted); err != nil {
		return Stats{}, fmt.Errorf("count procrastinator completed steps: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM procrastination_goals WHERE user_id = ? AND status = 'completed'
	`, userID).Scan(&stats.GoalsCompleted); err != nil {
		return Stats{}, fmt.Errorf("count procrastinator completed goals: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM procrastination_goals WHERE user_id = ? AND status != 'archived'
	`, userID).Scan(&stats.TotalGoals); err != nil {
		return Stats{}, fmt.Errorf("count procrastinator goals: %w", err)
	}
	var err error
	stats.TodayXP, err = s.sumXPByDate(ctx, userID, today)
	if err != nil {
		return Stats{}, err
	}
	if rangeID == "all" {
		if err := s.db.QueryRowContext(ctx, `
			SELECT COALESCE(SUM(xp_delta), 0) FROM procrastination_events WHERE user_id = ?
		`, userID).Scan(&stats.RangeXP); err != nil {
			return Stats{}, fmt.Errorf("sum procrastinator range XP: %w", err)
		}
	} else {
		if err := s.db.QueryRowContext(ctx, `
			SELECT COALESCE(SUM(xp_delta), 0) FROM procrastination_events
			WHERE user_id = ? AND event_date >= ?
		`, userID, start.Format("2006-01-02")).Scan(&stats.RangeXP); err != nil {
			return Stats{}, fmt.Errorf("sum procrastinator range XP: %w", err)
		}
	}
	stats.StreakDays, err = s.currentStreak(ctx, userID, today)
	if err != nil {
		return Stats{}, err
	}
	stats.Last7Days, err = s.last7Days(ctx, userID, today)
	if err != nil {
		return Stats{}, err
	}
	return stats, nil
}

func (s *Store) decorateGoal(ctx context.Context, q queryer, goal *Goal) error {
	var total, completed, estimated, remaining, xpEarned int
	if err := q.QueryRowContext(ctx, `
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(estimated_minutes), 0),
			COALESCE(SUM(CASE WHEN status != 'completed' THEN estimated_minutes ELSE 0 END), 0),
			COALESCE(SUM(xp_earned), 0)
		FROM procrastination_steps WHERE goal_id = ?
	`, goal.ID).Scan(&total, &completed, &estimated, &remaining, &xpEarned); err != nil {
		return fmt.Errorf("decorate procrastinator goal: %w", err)
	}
	var expected int
	if err := q.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(
			CASE WHEN estimated_minutes <= 25 THEN 5 + estimated_minutes ELSE 30 END
		), 0)
		FROM procrastination_steps WHERE goal_id = ?
	`, goal.ID).Scan(&expected); err != nil {
		return fmt.Errorf("decorate procrastinator goal XP: %w", err)
	}
	if total > 0 {
		expected += GoalBonusXP()
	}
	goal.TotalSteps = total
	goal.CompletedSteps = completed
	goal.EstimatedMinutes = estimated
	goal.RemainingMinutes = remaining
	goal.XPEarned = xpEarned
	goal.ExpectedXP = expected
	return nil
}

func (s *Store) sumXPByDate(ctx context.Context, userID, date string) (int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(xp_delta), 0) FROM procrastination_events
		WHERE user_id = ? AND event_date = ?
	`, userID, date).Scan(&total); err != nil {
		return 0, fmt.Errorf("sum procrastinator date XP: %w", err)
	}
	return total, nil
}

func (s *Store) currentStreak(ctx context.Context, userID, today string) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT event_date FROM procrastination_events
		WHERE user_id = ? AND xp_delta > 0 AND event_date <= ?
		ORDER BY event_date DESC
	`, userID, today)
	if err != nil {
		return 0, fmt.Errorf("load procrastinator streak: %w", err)
	}
	defer rows.Close()
	dates := []string{}
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			return 0, err
		}
		dates = append(dates, date)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(dates) == 0 {
		return 0, nil
	}
	anchor := today
	if dates[0] != today {
		yesterday := addDays(today, -1)
		if dates[0] != yesterday {
			return 0, nil
		}
		anchor = yesterday
	}
	streak := 0
	current := anchor
	for _, date := range dates {
		if date == current {
			streak++
			current = addDays(current, -1)
		}
	}
	return streak, nil
}

func (s *Store) last7Days(ctx context.Context, userID, today string) ([]DayCount, error) {
	counts := map[string]int{}
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_date, COUNT(*) FROM procrastination_events
		WHERE user_id = ? AND xp_delta > 0 AND event_date >= ?
		GROUP BY event_date
	`, userID, addDays(today, -6))
	if err != nil {
		return nil, fmt.Errorf("load procrastinator last7: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			return nil, err
		}
		counts[date] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make([]DayCount, 0, 7)
	for i := 6; i >= 0; i-- {
		date := addDays(today, -i)
		result = append(result, DayCount{Date: date, Count: counts[date]})
	}
	return result, nil
}

func recomputeGoalCompletion(ctx context.Context, q queryer, userID, goalID string, now time.Time, date string) error {
	var total, completed int
	if err := q.QueryRowContext(ctx, `
		SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0)
		FROM procrastination_steps WHERE goal_id = ?
	`, goalID).Scan(&total, &completed); err != nil {
		return fmt.Errorf("count procrastinator goal completion: %w", err)
	}
	var status string
	if err := q.QueryRowContext(ctx, `
		SELECT status FROM procrastination_goals WHERE id = ? AND user_id = ?
	`, goalID, userID).Scan(&status); err != nil {
		return err
	}
	switch {
	case total > 0 && completed == total && status != GoalStatusCompleted:
		if _, err := q.ExecContext(ctx, `
			UPDATE procrastination_goals
			SET status = 'completed', completed_at = ?, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, now.Unix(), now.Unix(), goalID, userID); err != nil {
			return fmt.Errorf("complete procrastinator goal: %w", err)
		}
		return insertEvent(ctx, q, Event{
			ID:        uuid.NewString(),
			UserID:    userID,
			GoalID:    goalID,
			EventType: EventGoalCompleted,
			XPDelta:   GoalBonusXP(),
			EventDate: date,
			CreatedAt: now,
		})
	case status == GoalStatusCompleted && (total == 0 || completed < total):
		if _, err := q.ExecContext(ctx, `
			UPDATE procrastination_goals
			SET status = 'active', completed_at = NULL, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, now.Unix(), goalID, userID); err != nil {
			return fmt.Errorf("reopen procrastinator goal: %w", err)
		}
		return insertEvent(ctx, q, Event{
			ID:        uuid.NewString(),
			UserID:    userID,
			GoalID:    goalID,
			EventType: EventGoalCompletedUndo,
			XPDelta:   -GoalBonusXP(),
			EventDate: date,
			CreatedAt: now,
		})
	}
	return nil
}

func insertStep(ctx context.Context, q queryer, userID, goalID string, input StepInput, now time.Time) error {
	step := Step{
		ID:               uuid.NewString(),
		GoalID:           goalID,
		UserID:           userID,
		Title:            strings.TrimSpace(input.Title),
		Note:             strings.TrimSpace(input.Note),
		EstimatedMinutes: input.EstimatedMinutes,
		SortOrder:        input.SortOrder,
		Status:           StepStatusPending,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO procrastination_steps (
			id, goal_id, user_id, title, note, estimated_minutes, sort_order,
			status, started_at, completed_at, xp_earned, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, ?, ?)
	`, step.ID, step.GoalID, step.UserID, step.Title, step.Note,
		step.EstimatedMinutes, step.SortOrder, step.CreatedAt.Unix(), step.UpdatedAt.Unix())
	if err != nil {
		return fmt.Errorf("insert procrastinator step: %w", err)
	}
	return nil
}

func insertEvent(ctx context.Context, q queryer, event Event) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO procrastination_events (
			id, user_id, goal_id, step_id, event_type, xp_delta, event_date, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, event.ID, event.UserID, event.GoalID, nullString(event.StepID), event.EventType,
		event.XPDelta, event.EventDate, event.CreatedAt.Unix())
	if err != nil {
		return fmt.Errorf("insert procrastinator event: %w", err)
	}
	return nil
}

func loadGoalByID(ctx context.Context, q queryer, userID, goalID string) (Goal, error) {
	row := q.QueryRowContext(ctx, `
		SELECT id, user_id, title, note, deadline, status, completed_at, archived_at,
			created_at, updated_at
		FROM procrastination_goals WHERE id = ? AND user_id = ?
	`, goalID, userID)
	return scanGoal(row)
}

func loadSteps(ctx context.Context, q queryer, goalID string) ([]Step, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, goal_id, user_id, title, note, estimated_minutes, sort_order,
			status, started_at, completed_at, xp_earned, created_at, updated_at
		FROM procrastination_steps WHERE goal_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, goalID)
	if err != nil {
		return nil, fmt.Errorf("list procrastinator steps: %w", err)
	}
	defer rows.Close()
	steps := []Step{}
	for rows.Next() {
		step, err := scanStep(rows)
		if err != nil {
			return nil, err
		}
		steps = append(steps, step)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return steps, nil
}

func loadStepByID(ctx context.Context, q queryer, userID, stepID string) (Step, error) {
	row := q.QueryRowContext(ctx, `
		SELECT id, goal_id, user_id, title, note, estimated_minutes, sort_order,
			status, started_at, completed_at, xp_earned, created_at, updated_at
		FROM procrastination_steps WHERE id = ? AND user_id = ?
	`, stepID, userID)
	return scanStep(row)
}

func scanGoal(row interface{ Scan(...any) error }) (Goal, error) {
	var goal Goal
	var deadline sql.NullString
	var status string
	var completedAt, archivedAt sql.NullInt64
	var createdAt, updatedAt int64
	if err := row.Scan(&goal.ID, &goal.UserID, &goal.Title, &goal.Note, &deadline,
		&status, &completedAt, &archivedAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Goal{}, ErrNotFound
		}
		return Goal{}, fmt.Errorf("scan procrastinator goal: %w", err)
	}
	goal.Deadline = deadline.String
	goal.Status = status
	goal.CompletedAt = unixTime(completedAt)
	goal.ArchivedAt = unixTime(archivedAt)
	goal.CreatedAt = time.Unix(createdAt, 0).UTC()
	goal.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return goal, nil
}

func scanStep(row interface{ Scan(...any) error }) (Step, error) {
	var step Step
	var status string
	var startedAt, completedAt sql.NullInt64
	var createdAt, updatedAt int64
	if err := row.Scan(&step.ID, &step.GoalID, &step.UserID, &step.Title, &step.Note,
		&step.EstimatedMinutes, &step.SortOrder, &status, &startedAt, &completedAt,
		&step.XPEarned, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Step{}, ErrNotFound
		}
		return Step{}, fmt.Errorf("scan procrastinator step: %w", err)
	}
	step.Status = status
	step.StartedAt = unixTime(startedAt)
	step.CompletedAt = unixTime(completedAt)
	if step.StartedAt != nil && step.CompletedAt != nil {
		seconds := int(step.CompletedAt.Sub(*step.StartedAt).Seconds())
		if seconds > 0 {
			step.ActualSeconds = seconds
		}
	}
	step.CreatedAt = time.Unix(createdAt, 0).UTC()
	step.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return step, nil
}

func scanEvent(row interface{ Scan(...any) error }) (Event, error) {
	var event Event
	var stepID sql.NullString
	var goalTitle, stepTitle string
	var createdAt int64
	if err := row.Scan(&event.ID, &event.UserID, &event.GoalID, &stepID, &event.EventType,
		&event.XPDelta, &event.EventDate, &createdAt, &goalTitle, &stepTitle); err != nil {
		return Event{}, fmt.Errorf("scan procrastinator event: %w", err)
	}
	event.StepID = stepID.String
	event.GoalTitle = goalTitle
	event.StepTitle = stepTitle
	event.CreatedAt = time.Unix(createdAt, 0).UTC()
	return event, nil
}

func validateGoalInput(input GoalInput) error {
	if _, err := normalizeTitle(input.Title, 60); err != nil {
		return err
	}
	if len([]rune(strings.TrimSpace(input.Note))) > 500 {
		return ErrInvalidInput
	}
	if !validDate(strings.TrimSpace(input.Deadline)) {
		return ErrInvalidInput
	}
	if len(input.Steps) < MinSteps || len(input.Steps) > MaxSteps {
		return ErrInvalidInput
	}
	for _, step := range input.Steps {
		if err := validateStepInput(step); err != nil {
			return err
		}
	}
	return nil
}

func validateStepInput(input StepInput) error {
	if _, err := normalizeTitle(input.Title, 60); err != nil {
		return err
	}
	if len([]rune(strings.TrimSpace(input.Note))) > 200 {
		return ErrInvalidInput
	}
	if input.EstimatedMinutes < 1 || input.EstimatedMinutes > 120 {
		return ErrInvalidInput
	}
	return nil
}

func statsRangeStart(rangeID string) time.Time {
	now := time.Now()
	switch rangeID {
	case "week":
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		return time.Date(now.Year(), now.Month(), now.Day()-weekday+1, 0, 0, 0, 0, now.Location())
	case "all":
		return time.Time{}
	default:
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	}
}

func addDays(date string, days int) string {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return parsed.AddDate(0, 0, days).Format("2006-01-02")
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullUnix(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Unix()
}

func unixTime(value sql.NullInt64) *time.Time {
	if !value.Valid {
		return nil
	}
	parsed := time.Unix(value.Int64, 0).UTC()
	return &parsed
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
