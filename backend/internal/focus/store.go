package focus

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

var (
	ErrNotFound          = errors.New("focus record not found")
	ErrInvalidInput      = errors.New("focus invalid input")
	ErrGoalLimitReached  = errors.New("focus goal limit reached")
	ErrHabitAlreadyDone  = errors.New("focus habit already checked")
	ErrSubtaskPending    = errors.New("focus subtask pending")
	ErrDatabasePathEmpty = errors.New("focus database path is empty")
)

const (
	TaskStatusOpen     = "open"
	TaskStatusDone     = "done"
	TaskStatusArchived = "archived"

	RepeatNone    = "none"
	RepeatDaily   = "daily"
	RepeatWeekly  = "weekly"
	RepeatMonthly = "monthly"
)

type List struct {
	ID         string     `json:"id"`
	UserID     string     `json:"userId"`
	Name       string     `json:"name"`
	Color      string     `json:"color"`
	SortOrder  int        `json:"sortOrder"`
	Archived   bool       `json:"archived"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

type Task struct {
	ID            string     `json:"id"`
	UserID        string     `json:"userId"`
	ListID        string     `json:"listId"`
	Title         string     `json:"title"`
	Note          string     `json:"note"`
	Priority      int        `json:"-"`
	PriorityLabel string     `json:"priority"`
	DueDate       string     `json:"dueDate"`
	DueTime       string     `json:"dueTime"`
	RepeatRule    string     `json:"repeatRule"`
	ParentTaskID  string     `json:"parentTaskId"`
	Status        string     `json:"status"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
	SortOrder     int        `json:"sortOrder"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	Subtasks      []Task     `json:"subtasks"`
}

type Goal struct {
	ID           string     `json:"id"`
	UserID       string     `json:"userId"`
	Date         string     `json:"date"`
	Title        string     `json:"title"`
	SourceTaskID string     `json:"sourceTaskId"`
	SortOrder    int        `json:"sortOrder"`
	Completed    bool       `json:"completed"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type Habit struct {
	ID           string     `json:"id"`
	UserID       string     `json:"userId"`
	Name         string     `json:"name"`
	Icon         string     `json:"icon"`
	Color        string     `json:"color"`
	Frequency    string     `json:"frequency"`
	Weekdays     []int      `json:"weekdays"`
	WeekdaysRaw  string     `json:"-"`
	ReminderTime string     `json:"reminderTime"`
	SortOrder    int        `json:"sortOrder"`
	Archived     bool       `json:"archived"`
	ArchivedAt   *time.Time `json:"archivedAt,omitempty"`
	StreakDays   int        `json:"streakDays"`
	TodayChecked bool       `json:"todayChecked"`
	TotalRecords int        `json:"totalRecords"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type HabitRecord struct {
	ID         string    `json:"id"`
	HabitID    string    `json:"habitId"`
	RecordDate string    `json:"recordDate"`
	CreatedAt  time.Time `json:"createdAt"`
}

type TodayProgress struct {
	TaskCompleted  int `json:"taskCompleted"`
	TaskTotal      int `json:"taskTotal"`
	GoalCompleted  int `json:"goalCompleted"`
	GoalTotal      int `json:"goalTotal"`
	HabitCompleted int `json:"habitCompleted"`
	HabitTotal     int `json:"habitTotal"`
}

type TodaySnapshot struct {
	Date     string        `json:"date"`
	Tasks    []Task        `json:"tasks"`
	Goals    []Goal        `json:"goals"`
	Habits   []Habit       `json:"habits"`
	Progress TodayProgress `json:"progress"`
}

type DayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type ListCount struct {
	ListID string `json:"listId"`
	Name   string `json:"name"`
	Color  string `json:"color"`
	Count  int    `json:"count"`
}

type StatsSnapshot struct {
	Range             string      `json:"range"`
	TaskCompleted     int         `json:"taskCompleted"`
	TaskTotal         int         `json:"taskTotal"`
	TaskRate          float64     `json:"taskRate"`
	GoalCompleted     int         `json:"goalCompleted"`
	GoalTotal         int         `json:"goalTotal"`
	HabitStreakMax    int         `json:"habitStreakMax"`
	HabitTotalRecords int         `json:"habitTotalRecords"`
	Last7Days         []DayCount  `json:"last7Days"`
	ByList            []ListCount `json:"byList"`
}

type CalendarSnapshot struct {
	Month string     `json:"month"`
	Days  []DayCount `json:"days"`
}

type TaskFilter struct {
	ListID     string
	Status     string
	Date       string
	Query      string
	Limit      int
	IncludeAll bool
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create focus database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open focus database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS focus_lists (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			color TEXT NOT NULL DEFAULT '#7e5bef',
			sort_order INTEGER NOT NULL DEFAULT 0,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_focus_lists_user
			ON focus_lists(user_id, sort_order, id)`,
		`CREATE TABLE IF NOT EXISTS focus_tasks (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			list_id TEXT NOT NULL REFERENCES focus_lists(id) ON DELETE CASCADE,
			title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
			note TEXT NOT NULL DEFAULT '',
			priority INTEGER NOT NULL DEFAULT 1 CHECK(priority BETWEEN 0 AND 2),
			due_date TEXT,
			due_time TEXT,
			repeat_rule TEXT NOT NULL DEFAULT 'none'
				CHECK(repeat_rule IN ('none', 'daily', 'weekly', 'monthly')),
			parent_task_id TEXT REFERENCES focus_tasks(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'done', 'archived')),
			completed_at INTEGER,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_focus_tasks_user_due
			ON focus_tasks(user_id, status, due_date, sort_order)`,
		`CREATE INDEX IF NOT EXISTS idx_focus_tasks_parent
			ON focus_tasks(parent_task_id)`,
		`CREATE TABLE IF NOT EXISTS focus_task_completions (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL REFERENCES focus_tasks(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			occurrence_date TEXT NOT NULL,
			completed_at INTEGER NOT NULL,
			UNIQUE(task_id, occurrence_date)
		)`,
		`CREATE TABLE IF NOT EXISTS focus_goals (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			goal_date TEXT NOT NULL,
			title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
			source_task_id TEXT REFERENCES focus_tasks(id) ON DELETE SET NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			completed_at INTEGER,
			created_at INTEGER NOT NULL,
			UNIQUE(user_id, goal_date, source_task_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_focus_goals_user_date
			ON focus_goals(user_id, goal_date, sort_order)`,
		`CREATE TABLE IF NOT EXISTS focus_habits (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			icon TEXT NOT NULL DEFAULT 'check-circle-outline',
			color TEXT NOT NULL DEFAULT '#7e5bef',
			frequency TEXT NOT NULL DEFAULT 'daily'
				CHECK(frequency IN ('daily', 'weekly')),
			weekdays TEXT NOT NULL DEFAULT '',
			reminder_time TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_focus_habits_user
			ON focus_habits(user_id, sort_order, id)`,
		`CREATE TABLE IF NOT EXISTS focus_habit_records (
			id TEXT PRIMARY KEY,
			habit_id TEXT NOT NULL REFERENCES focus_habits(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			record_date TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			UNIQUE(habit_id, record_date)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_focus_habit_records_user_date
			ON focus_habit_records(user_id, record_date)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run focus database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) EnsureDefaultList(ctx context.Context, userID string) (List, error) {
	list, err := s.getDefaultList(ctx, userID)
	if err == nil {
		return list, nil
	}
	if !errors.Is(err, sql.ErrNoRows) && !errors.Is(err, ErrNotFound) {
		return List{}, err
	}
	now := time.Now().UTC()
	created := List{
		ID:        uuid.NewString(),
		UserID:    userID,
		Name:      "收集箱",
		Color:     "#7e5bef",
		SortOrder: 0,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO focus_lists (id, user_id, name, color, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, created.ID, created.UserID, created.Name, created.Color, created.SortOrder,
		created.CreatedAt.Unix(), created.UpdatedAt.Unix(),
	); err != nil {
		return List{}, fmt.Errorf("create default focus list: %w", err)
	}
	return created, nil
}

func (s *Store) getDefaultList(ctx context.Context, userID string) (List, error) {
	return scanList(s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, color, sort_order, archived_at, created_at, updated_at
		FROM focus_lists WHERE user_id = ? ORDER BY sort_order, id LIMIT 1
	`, userID))
}

func (s *Store) ListLists(ctx context.Context, userID string) ([]List, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, name, color, sort_order, archived_at, created_at, updated_at
		FROM focus_lists WHERE user_id = ? ORDER BY archived_at IS NOT NULL, sort_order, id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list focus lists: %w", err)
	}
	defer rows.Close()

	lists := []List{}
	for rows.Next() {
		item, err := scanList(rows)
		if err != nil {
			return nil, err
		}
		lists = append(lists, item)
	}
	return lists, rows.Err()
}

func (s *Store) CreateList(ctx context.Context, userID string, input ListInput) (List, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 40 {
		return List{}, ErrInvalidInput
	}
	color := normalizeColor(input.Color)
	now := time.Now().UTC()
	item := List{
		ID:        uuid.NewString(),
		UserID:    userID,
		Name:      name,
		Color:     color,
		SortOrder: input.SortOrder,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO focus_lists (id, user_id, name, color, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.UserID, item.Name, item.Color, item.SortOrder,
		item.CreatedAt.Unix(), item.UpdatedAt.Unix(),
	); err != nil {
		return List{}, fmt.Errorf("create focus list: %w", err)
	}
	return item, nil
}

func (s *Store) UpdateList(ctx context.Context, userID, listID string, input ListInput) (List, error) {
	current, err := s.getList(ctx, userID, listID)
	if err != nil {
		return List{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name != "" {
		if len([]rune(name)) > 40 {
			return List{}, ErrInvalidInput
		}
		current.Name = name
	}
	if input.Color != "" {
		current.Color = normalizeColor(input.Color)
	}
	if input.Archived != nil {
		current.Archived = *input.Archived
	}
	if input.SortOrder != 0 {
		current.SortOrder = input.SortOrder
	}
	current.UpdatedAt = time.Now().UTC()

	archivedAt := nullableUnix(current.ArchivedAt)
	if current.Archived && current.ArchivedAt == nil {
		at := current.UpdatedAt
		archivedAt = &at
	}
	if !current.Archived {
		archivedAt = nil
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE focus_lists
		SET name = ?, color = ?, sort_order = ?, archived_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, current.Name, current.Color, current.SortOrder, unixOrNil(archivedAt),
		current.UpdatedAt.Unix(), listID, userID,
	); err != nil {
		return List{}, fmt.Errorf("update focus list: %w", err)
	}
	current.ArchivedAt = archivedAt
	return current, nil
}

func (s *Store) DeleteList(ctx context.Context, userID, listID string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM focus_lists WHERE id = ? AND user_id = ?
	`, listID, userID)
	if err != nil {
		return fmt.Errorf("delete focus list: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) getList(ctx context.Context, userID, listID string) (List, error) {
	return scanList(s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, color, sort_order, archived_at, created_at, updated_at
		FROM focus_lists WHERE id = ? AND user_id = ?
	`, listID, userID))
}

func (s *Store) ListTasks(ctx context.Context, userID string, filter TaskFilter) ([]Task, error) {
	query := `
		SELECT id, user_id, list_id, title, note, priority, due_date, due_time,
			repeat_rule, parent_task_id, status, completed_at, sort_order, created_at, updated_at
		FROM focus_tasks WHERE user_id = ?`
	args := []any{userID}
	clauses := []string{}

	if filter.ListID != "" {
		clauses = append(clauses, "list_id = ?")
		args = append(args, filter.ListID)
	}
	switch filter.Status {
	case TaskStatusOpen:
		clauses = append(clauses, "status = 'open'")
	case TaskStatusDone:
		clauses = append(clauses, "status = 'done'")
	case TaskStatusArchived:
		clauses = append(clauses, "status = 'archived'")
	case "overdue":
		clauses = append(clauses, "status = 'open' AND due_date IS NOT NULL AND due_date < ?")
		args = append(args, filter.Date)
	case "today":
		clauses = append(clauses, "status = 'open' AND (due_date = ? OR (due_date IS NULL AND parent_task_id IS NULL))")
		args = append(args, filter.Date)
	}
	if filter.Date != "" && filter.Status == "" {
		clauses = append(clauses, "due_date = ?")
		args = append(args, filter.Date)
	}
	if strings.TrimSpace(filter.Query) != "" {
		clauses = append(clauses, "title LIKE ? ESCAPE '\\'")
		args = append(args, "%"+escapeLike(strings.TrimSpace(filter.Query))+"%")
	}
	if len(clauses) > 0 {
		query += " AND " + strings.Join(clauses, " AND ")
	}
	query += ` ORDER BY
		CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
		CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
		due_date ASC, due_time ASC, priority ASC, sort_order ASC, created_at DESC`
	if filter.Limit > 0 {
		query += " LIMIT ?"
		args = append(args, filter.Limit)
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list focus tasks: %w", err)
	}
	defer rows.Close()

	all := []Task{}
	for rows.Next() {
		item, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		all = append(all, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if filter.IncludeAll {
		return all, nil
	}
	return buildTaskTree(all), nil
}

func buildTaskTree(tasks []Task) []Task {
	roots := []Task{}
	children := map[string][]Task{}
	for _, task := range tasks {
		if task.ParentTaskID != "" {
			children[task.ParentTaskID] = append(children[task.ParentTaskID], task)
		} else {
			roots = append(roots, task)
		}
	}
	for i := range roots {
		roots[i].Subtasks = children[roots[i].ID]
	}
	return roots
}

func (s *Store) CreateTask(ctx context.Context, userID string, input TaskInput) (Task, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" || len([]rune(title)) > 100 {
		return Task{}, ErrInvalidInput
	}
	if len([]rune(strings.TrimSpace(input.Note))) > 1000 {
		return Task{}, ErrInvalidInput
	}
	priority, ok := normalizePriority(input.Priority)
	if !ok {
		return Task{}, ErrInvalidInput
	}
	listID := strings.TrimSpace(input.ListID)
	if listID == "" {
		defaultList, err := s.EnsureDefaultList(ctx, userID)
		if err != nil {
			return Task{}, err
		}
		listID = defaultList.ID
	}
	if _, err := s.getList(ctx, userID, listID); err != nil {
		return Task{}, err
	}
	if !validRepeatRule(input.RepeatRule) {
		if input.RepeatRule == "" {
			input.RepeatRule = RepeatNone
		} else {
			return Task{}, ErrInvalidInput
		}
	}
	if !validRepeatRule(input.RepeatRule) {
		return Task{}, ErrInvalidInput
	}
	if stringValue(input.DueDate) != "" && !validDate(stringValue(input.DueDate)) {
		return Task{}, ErrInvalidInput
	}
	if stringValue(input.DueTime) != "" && !validTime(stringValue(input.DueTime)) {
		return Task{}, ErrInvalidInput
	}
	if input.ParentTaskID != "" {
		parent, err := s.getTask(ctx, userID, input.ParentTaskID)
		if err != nil {
			return Task{}, err
		}
		if parent.ParentTaskID != "" {
			return Task{}, ErrInvalidInput
		}
	}

	now := time.Now().UTC()
	task := Task{
		ID:            uuid.NewString(),
		UserID:        userID,
		ListID:        listID,
		Title:         title,
		Note:          strings.TrimSpace(input.Note),
		Priority:      priority,
		PriorityLabel: priorityLabel(priority),
		DueDate:       stringValue(input.DueDate),
		DueTime:       stringValue(input.DueTime),
		RepeatRule:    input.RepeatRule,
		ParentTaskID:  strings.TrimSpace(input.ParentTaskID),
		Status:        TaskStatusOpen,
		SortOrder:     input.SortOrder,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, fmt.Errorf("begin create focus task: %w", err)
	}
	defer tx.Rollback()
	if err := insertTask(ctx, tx, task); err != nil {
		return Task{}, err
	}
	for _, subInput := range input.Subtasks {
		subInput.ParentTaskID = task.ID
		subInput.ListID = task.ListID
		sub, err := s.createTaskInTx(ctx, tx, userID, subInput)
		if err != nil {
			return Task{}, err
		}
		task.Subtasks = append(task.Subtasks, sub)
	}
	if err := tx.Commit(); err != nil {
		return Task{}, fmt.Errorf("commit create focus task: %w", err)
	}
	return task, nil
}

func (s *Store) UpdateTask(ctx context.Context, userID, taskID string, input TaskInput) (Task, error) {
	current, err := s.getTask(ctx, userID, taskID)
	if err != nil {
		return Task{}, err
	}
	if current.ParentTaskID == "" && len(input.Subtasks) > 0 {
		return Task{}, ErrInvalidInput
	}
	if strings.TrimSpace(input.Title) != "" {
		if len([]rune(strings.TrimSpace(input.Title))) > 100 {
			return Task{}, ErrInvalidInput
		}
		current.Title = strings.TrimSpace(input.Title)
	}
	if input.Note != "" {
		if len([]rune(strings.TrimSpace(input.Note))) > 1000 {
			return Task{}, ErrInvalidInput
		}
		current.Note = strings.TrimSpace(input.Note)
	}
	if input.Priority != "" {
		priority, ok := normalizePriority(input.Priority)
		if !ok {
			return Task{}, ErrInvalidInput
		}
		current.Priority = priority
		current.PriorityLabel = priorityLabel(priority)
	}
	if input.ListID != "" && input.ListID != current.ListID {
		if _, err := s.getList(ctx, userID, input.ListID); err != nil {
			return Task{}, err
		}
		current.ListID = input.ListID
	}
	if input.DueDate != nil {
		value := strings.TrimSpace(*input.DueDate)
		if value != "" && !validDate(value) {
			return Task{}, ErrInvalidInput
		}
		current.DueDate = value
	}
	if input.DueTime != nil {
		value := strings.TrimSpace(*input.DueTime)
		if value != "" && !validTime(value) {
			return Task{}, ErrInvalidInput
		}
		current.DueTime = value
	}
	if input.RepeatRule != "" {
		if !validRepeatRule(input.RepeatRule) {
			return Task{}, ErrInvalidInput
		}
		current.RepeatRule = input.RepeatRule
	}
	if input.Status != "" {
		switch input.Status {
		case TaskStatusOpen, TaskStatusDone, TaskStatusArchived:
			current.Status = input.Status
		default:
			return Task{}, ErrInvalidInput
		}
	}
	current.UpdatedAt = time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, fmt.Errorf("begin update focus task: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE focus_tasks
		SET list_id = ?, title = ?, note = ?, priority = ?, due_date = ?, due_time = ?,
			repeat_rule = ?, status = ?, sort_order = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, current.ListID, current.Title, current.Note, current.Priority, nullString(current.DueDate),
		nullString(current.DueTime), current.RepeatRule, current.Status, current.SortOrder,
		current.UpdatedAt.Unix(), taskID, userID,
	); err != nil {
		return Task{}, fmt.Errorf("update focus task: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Task{}, fmt.Errorf("commit update focus task: %w", err)
	}
	return current, nil
}

func (s *Store) CompleteTask(ctx context.Context, userID, taskID string, completed bool, date string) (Task, error) {
	current, err := s.getTask(ctx, userID, taskID)
	if err != nil {
		return Task{}, err
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return Task{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, fmt.Errorf("begin complete focus task: %w", err)
	}
	defer tx.Rollback()

	if completed {
		if current.Status == TaskStatusDone {
			return current, nil
		}
		if current.ParentTaskID == "" {
			openSubtasks, err := countOpenSubtasks(ctx, tx, taskID)
			if err != nil {
				return Task{}, err
			}
			if openSubtasks > 0 {
				return Task{}, ErrSubtaskPending
			}
		}
		nextDue := current.DueDate
		if current.RepeatRule != RepeatNone {
			nextDue, err = nextOccurrence(current.DueDate, current.RepeatRule)
			if err != nil {
				return Task{}, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE focus_tasks
			SET status = ?, completed_at = ?, due_date = ?, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, TaskStatusDone, now.Unix(), nullString(nextDue), now.Unix(), taskID, userID,
		); err != nil {
			return Task{}, fmt.Errorf("complete focus task: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO focus_task_completions (id, task_id, user_id, occurrence_date, completed_at)
			VALUES (?, ?, ?, ?, ?)
		`, uuid.NewString(), taskID, userID, date, now.Unix(),
		); err != nil {
			return Task{}, fmt.Errorf("record focus task completion: %w", err)
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE focus_tasks
			SET status = 'open', completed_at = NULL, updated_at = ?
			WHERE id = ? AND user_id = ?
		`, now.Unix(), taskID, userID,
		); err != nil {
			return Task{}, fmt.Errorf("reopen focus task: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Task{}, fmt.Errorf("commit complete focus task: %w", err)
	}
	return s.getTask(ctx, userID, taskID)
}

func (s *Store) DeleteTask(ctx context.Context, userID, taskID string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM focus_tasks WHERE id = ? AND user_id = ?
	`, taskID, userID)
	if err != nil {
		return fmt.Errorf("delete focus task: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) getTask(ctx context.Context, userID, taskID string) (Task, error) {
	return scanTask(s.db.QueryRowContext(ctx, `
		SELECT id, user_id, list_id, title, note, priority, due_date, due_time,
			repeat_rule, parent_task_id, status, completed_at, sort_order, created_at, updated_at
		FROM focus_tasks WHERE id = ? AND user_id = ?
	`, taskID, userID))
}

func (s *Store) ListGoals(ctx context.Context, userID, date string) ([]Goal, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, goal_date, title, source_task_id, sort_order, completed_at, created_at
		FROM focus_goals WHERE user_id = ? AND goal_date = ? ORDER BY sort_order, created_at
	`, userID, date)
	if err != nil {
		return nil, fmt.Errorf("list focus goals: %w", err)
	}
	defer rows.Close()

	goals := []Goal{}
	for rows.Next() {
		var item Goal
		var sourceTaskID sql.NullString
		var completedAt sql.NullInt64
		var createdAt int64
		if err := rows.Scan(&item.ID, &item.UserID, &item.Date, &item.Title,
			&sourceTaskID, &item.SortOrder, &completedAt, &createdAt); err != nil {
			return nil, fmt.Errorf("scan focus goal: %w", err)
		}
		item.SourceTaskID = sourceTaskID.String
		item.Completed = completedAt.Valid
		item.CompletedAt = unixToTime(completedAt)
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		goals = append(goals, item)
	}
	return goals, rows.Err()
}

func (s *Store) CreateGoal(ctx context.Context, userID string, input GoalInput) (Goal, error) {
	title := strings.TrimSpace(input.Title)
	date := strings.TrimSpace(input.Date)
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return Goal{}, ErrInvalidInput
	}
	if title == "" || len([]rune(title)) > 100 {
		return Goal{}, ErrInvalidInput
	}
	count, err := s.countGoals(ctx, userID, date)
	if err != nil {
		return Goal{}, err
	}
	if count >= 3 {
		return Goal{}, ErrGoalLimitReached
	}
	if input.SourceTaskID != "" {
		if _, err := s.getTask(ctx, userID, input.SourceTaskID); err != nil {
			return Goal{}, err
		}
	}
	now := time.Now().UTC()
	goal := Goal{
		ID:           uuid.NewString(),
		UserID:       userID,
		Date:         date,
		Title:        title,
		SourceTaskID: strings.TrimSpace(input.SourceTaskID),
		SortOrder:    input.SortOrder,
		CreatedAt:    now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO focus_goals (id, user_id, goal_date, title, source_task_id, sort_order, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, goal.ID, goal.UserID, goal.Date, goal.Title, nullString(goal.SourceTaskID),
		goal.SortOrder, goal.CreatedAt.Unix(),
	); err != nil {
		return Goal{}, fmt.Errorf("create focus goal: %w", err)
	}
	return goal, nil
}

func (s *Store) UpdateGoal(ctx context.Context, userID, goalID string, input GoalInput) (Goal, error) {
	current, err := s.getGoal(ctx, userID, goalID)
	if err != nil {
		return Goal{}, err
	}
	if input.Title != "" {
		if len([]rune(strings.TrimSpace(input.Title))) > 100 {
			return Goal{}, ErrInvalidInput
		}
		current.Title = strings.TrimSpace(input.Title)
	}
	if input.Completed != nil {
		current.Completed = *input.Completed
	}
	now := time.Now().UTC()
	var completedAt any
	if current.Completed {
		completedAt = now.Unix()
	} else {
		completedAt = nil
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE focus_goals
		SET title = ?, completed_at = ?
		WHERE id = ? AND user_id = ?
	`, current.Title, completedAt, goalID, userID,
	); err != nil {
		return Goal{}, fmt.Errorf("update focus goal: %w", err)
	}
	current.CompletedAt = nil
	if current.Completed {
		current.CompletedAt = &now
	}
	return current, nil
}

func (s *Store) DeleteGoal(ctx context.Context, userID, goalID string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM focus_goals WHERE id = ? AND user_id = ?
	`, goalID, userID)
	if err != nil {
		return fmt.Errorf("delete focus goal: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) getGoal(ctx context.Context, userID, goalID string) (Goal, error) {
	var item Goal
	var sourceTaskID sql.NullString
	var completedAt sql.NullInt64
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, user_id, goal_date, title, source_task_id, sort_order, completed_at, created_at
		FROM focus_goals WHERE id = ? AND user_id = ?
	`, goalID, userID).Scan(&item.ID, &item.UserID, &item.Date, &item.Title,
		&sourceTaskID, &item.SortOrder, &completedAt, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Goal{}, ErrNotFound
	}
	if err != nil {
		return Goal{}, fmt.Errorf("get focus goal: %w", err)
	}
	item.SourceTaskID = sourceTaskID.String
	item.Completed = completedAt.Valid
	item.CompletedAt = unixToTime(completedAt)
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	return item, nil
}

func (s *Store) countGoals(ctx context.Context, userID, date string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM focus_goals WHERE user_id = ? AND goal_date = ?
	`, userID, date).Scan(&count); err != nil {
		return 0, fmt.Errorf("count focus goals: %w", err)
	}
	return count, nil
}

func (s *Store) ListHabits(ctx context.Context, userID, date string) ([]Habit, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, name, icon, color, frequency, weekdays, reminder_time,
			sort_order, archived_at, created_at, updated_at
		FROM focus_habits WHERE user_id = ? ORDER BY archived_at IS NOT NULL, sort_order, id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list focus habits: %w", err)
	}
	defer rows.Close()

	habits := []Habit{}
	for rows.Next() {
		item, err := scanHabit(rows)
		if err != nil {
			return nil, err
		}
		habits = append(habits, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return s.enrichHabits(ctx, habits, date)
}

func (s *Store) CreateHabit(ctx context.Context, userID string, input HabitInput) (Habit, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 40 {
		return Habit{}, ErrInvalidInput
	}
	if input.Frequency != "daily" && input.Frequency != "weekly" {
		return Habit{}, ErrInvalidInput
	}
	for _, weekday := range input.Weekdays {
		if weekday < 1 || weekday > 7 {
			return Habit{}, ErrInvalidInput
		}
	}
	if stringValue(input.ReminderTime) != "" && !validTime(stringValue(input.ReminderTime)) {
		return Habit{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	item := Habit{
		ID:           uuid.NewString(),
		UserID:       userID,
		Name:         name,
		Icon:         strings.TrimSpace(input.Icon),
		Color:        normalizeColor(input.Color),
		Frequency:    input.Frequency,
		WeekdaysRaw:  weekdaysString(input.Weekdays),
		ReminderTime: stringValue(input.ReminderTime),
		SortOrder:    input.SortOrder,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if item.Icon == "" {
		item.Icon = "check-circle-outline"
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO focus_habits (id, user_id, name, icon, color, frequency, weekdays,
			reminder_time, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.UserID, item.Name, item.Icon, item.Color, item.Frequency,
		item.WeekdaysRaw, nullString(item.ReminderTime), item.SortOrder,
		item.CreatedAt.Unix(), item.UpdatedAt.Unix(),
	); err != nil {
		return Habit{}, fmt.Errorf("create focus habit: %w", err)
	}
	item.Weekdays = parseWeekdays(item.WeekdaysRaw)
	return item, nil
}

func (s *Store) UpdateHabit(ctx context.Context, userID, habitID string, input HabitInput) (Habit, error) {
	current, err := s.getHabit(ctx, userID, habitID)
	if err != nil {
		return Habit{}, err
	}
	if strings.TrimSpace(input.Name) != "" {
		if len([]rune(strings.TrimSpace(input.Name))) > 40 {
			return Habit{}, ErrInvalidInput
		}
		current.Name = strings.TrimSpace(input.Name)
	}
	if input.Icon != "" {
		current.Icon = input.Icon
	}
	if input.Color != "" {
		current.Color = normalizeColor(input.Color)
	}
	if input.Frequency != "" {
		if input.Frequency != "daily" && input.Frequency != "weekly" {
			return Habit{}, ErrInvalidInput
		}
		current.Frequency = input.Frequency
	}
	if len(input.Weekdays) > 0 {
		for _, weekday := range input.Weekdays {
			if weekday < 1 || weekday > 7 {
				return Habit{}, ErrInvalidInput
			}
		}
		current.WeekdaysRaw = weekdaysString(input.Weekdays)
		current.Weekdays = input.Weekdays
	}
	if input.ReminderTime != nil {
		value := strings.TrimSpace(*input.ReminderTime)
		if value != "" && !validTime(value) {
			return Habit{}, ErrInvalidInput
		}
		current.ReminderTime = value
	}
	if input.Archived != nil {
		current.Archived = *input.Archived
	}
	current.UpdatedAt = time.Now().UTC()
	archivedAt := nullableUnix(current.ArchivedAt)
	if current.Archived && current.ArchivedAt == nil {
		at := current.UpdatedAt
		archivedAt = &at
	}
	if !current.Archived {
		archivedAt = nil
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE focus_habits
		SET name = ?, icon = ?, color = ?, frequency = ?, weekdays = ?,
			reminder_time = ?, sort_order = ?, archived_at = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, current.Name, current.Icon, current.Color, current.Frequency, current.WeekdaysRaw,
		nullString(current.ReminderTime), current.SortOrder, unixOrNil(archivedAt),
		current.UpdatedAt.Unix(), habitID, userID,
	); err != nil {
		return Habit{}, fmt.Errorf("update focus habit: %w", err)
	}
	current.ArchivedAt = archivedAt
	current.TodayChecked = false
	return current, nil
}

func (s *Store) getHabit(ctx context.Context, userID, habitID string) (Habit, error) {
	return scanHabit(s.db.QueryRowContext(ctx, `
		SELECT id, user_id, name, icon, color, frequency, weekdays, reminder_time,
			sort_order, archived_at, created_at, updated_at
		FROM focus_habits WHERE id = ? AND user_id = ?
	`, habitID, userID))
}

func (s *Store) AddHabitRecord(ctx context.Context, userID, habitID, date string) (HabitRecord, error) {
	habit, err := s.getHabit(ctx, userID, habitID)
	if err != nil {
		return HabitRecord{}, err
	}
	if habit.Archived {
		return HabitRecord{}, ErrInvalidInput
	}
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return HabitRecord{}, ErrInvalidInput
	}
	var exists int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM focus_habit_records WHERE habit_id = ? AND record_date = ?
	`, habitID, date).Scan(&exists); err != nil {
		return HabitRecord{}, fmt.Errorf("check focus habit record: %w", err)
	}
	if exists > 0 {
		return HabitRecord{}, ErrHabitAlreadyDone
	}
	record := HabitRecord{
		ID:         uuid.NewString(),
		HabitID:    habitID,
		RecordDate: date,
		CreatedAt:  time.Now().UTC(),
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO focus_habit_records (id, habit_id, user_id, record_date, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, record.ID, habitID, userID, date, record.CreatedAt.Unix(),
	); err != nil {
		return HabitRecord{}, fmt.Errorf("add focus habit record: %w", err)
	}
	return record, nil
}

func (s *Store) RemoveHabitRecord(ctx context.Context, userID, habitID, recordID string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM focus_habit_records
		WHERE id = ? AND habit_id = ? AND user_id = ?
	`, recordID, habitID, userID)
	if err != nil {
		return fmt.Errorf("remove focus habit record: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RemoveHabitRecordByDate(ctx context.Context, userID, habitID, date string) error {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	if !validDate(date) {
		return ErrInvalidInput
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM focus_habit_records
		WHERE habit_id = ? AND user_id = ? AND record_date = ?
	`, habitID, userID, date)
	if err != nil {
		return fmt.Errorf("remove focus habit record by date: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Today(ctx context.Context, userID, date string) (TodaySnapshot, error) {
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	tasks, err := s.ListTasks(ctx, userID, TaskFilter{IncludeAll: true})
	if err != nil {
		return TodaySnapshot{}, err
	}
	goals, err := s.ListGoals(ctx, userID, date)
	if err != nil {
		return TodaySnapshot{}, err
	}
	habits, err := s.ListHabits(ctx, userID, date)
	if err != nil {
		return TodaySnapshot{}, err
	}

	todayTasks := []Task{}
	taskDone := 0
	taskTotal := 0
	for _, task := range tasks {
		if task.ParentTaskID != "" {
			continue
		}
		if task.Status == TaskStatusDone && task.CompletedAt != nil {
			if time.Unix(task.CompletedAt.Unix(), 0).Format("2006-01-02") == date {
				todayTasks = append(todayTasks, task)
			}
			continue
		}
		if task.Status == TaskStatusOpen && (task.DueDate == date || task.DueDate == "" || task.DueDate < date) {
			todayTasks = append(todayTasks, task)
		}
	}
	todayTasks = buildTaskTree(todayTasks)
	for _, task := range todayTasks {
		taskTotal++
		if task.Status == TaskStatusDone {
			taskDone++
		}
	}
	goalDone := 0
	for _, goal := range goals {
		if goal.Completed {
			goalDone++
		}
	}
	habitDone := 0
	for _, habit := range habits {
		if habit.TodayChecked {
			habitDone++
		}
	}
	return TodaySnapshot{
		Date:   date,
		Tasks:  todayTasks,
		Goals:  goals,
		Habits: habits,
		Progress: TodayProgress{
			TaskCompleted:  taskDone,
			TaskTotal:      taskTotal,
			GoalCompleted:  goalDone,
			GoalTotal:      len(goals),
			HabitCompleted: habitDone,
			HabitTotal:     len(habits),
		},
	}, nil
}

func (s *Store) Stats(ctx context.Context, userID, rangeID string) (StatsSnapshot, error) {
	start, end := statsRange(rangeID)
	stats := StatsSnapshot{
		Range: rangeID,
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0)
		FROM focus_tasks
		WHERE user_id = ? AND status IN ('open', 'done')
			AND (completed_at IS NULL OR completed_at BETWEEN ? AND ?)
	`, userID, start.Unix(), end.Unix()).Scan(&stats.TaskTotal, &stats.TaskCompleted); err != nil {
		return StatsSnapshot{}, fmt.Errorf("load focus task stats: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END), 0)
		FROM focus_goals
		WHERE user_id = ? AND goal_date BETWEEN ? AND ?
	`, userID, start.Format("2006-01-02"), end.Format("2006-01-02")).Scan(
		&stats.GoalTotal, &stats.GoalCompleted,
	); err != nil {
		return StatsSnapshot{}, fmt.Errorf("load focus goal stats: %w", err)
	}
	var habitTotal int64
	var latestRecord int64
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(MAX(created_at), 0)
		FROM focus_habit_records
		WHERE user_id = ? AND record_date BETWEEN ? AND ?
	`, userID, start.Format("2006-01-02"), end.Format("2006-01-02")).Scan(
		&habitTotal, &latestRecord,
	); err != nil {
		return StatsSnapshot{}, fmt.Errorf("load focus habit stats: %w", err)
	}
	stats.HabitTotalRecords = int(habitTotal)
	if stats.TaskTotal > 0 {
		stats.TaskRate = float64(stats.TaskCompleted) / float64(stats.TaskTotal)
	}
	last7, err := s.last7Days(ctx, userID)
	if err != nil {
		return StatsSnapshot{}, err
	}
	stats.Last7Days = last7
	byList, err := s.taskCountByList(ctx, userID)
	if err != nil {
		return StatsSnapshot{}, err
	}
	stats.ByList = byList
	streak, err := s.maxStreak(ctx, userID, rangeID)
	if err != nil {
		return StatsSnapshot{}, err
	}
	stats.HabitStreakMax = streak
	return stats, nil
}

func (s *Store) Calendar(ctx context.Context, userID, month string) (CalendarSnapshot, error) {
	if !validMonth(month) {
		return CalendarSnapshot{}, ErrInvalidInput
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT record_date, COUNT(*)
		FROM focus_habit_records
		WHERE user_id = ? AND record_date LIKE ?
		GROUP BY record_date ORDER BY record_date
	`, userID, month+"-%")
	if err != nil {
		return CalendarSnapshot{}, fmt.Errorf("load focus calendar: %w", err)
	}
	defer rows.Close()
	days := []DayCount{}
	for rows.Next() {
		var item DayCount
		if err := rows.Scan(&item.Date, &item.Count); err != nil {
			return CalendarSnapshot{}, fmt.Errorf("scan focus calendar: %w", err)
		}
		days = append(days, item)
	}
	return CalendarSnapshot{Month: month, Days: days}, rows.Err()
}

func (s *Store) last7Days(ctx context.Context, userID string) ([]DayCount, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT date(completed_at, 'unixepoch', 'localtime') AS day, COUNT(*)
		FROM focus_task_completions
		WHERE user_id = ? AND completed_at >= ?
		GROUP BY day ORDER BY day
	`, userID, time.Now().Add(-6*24*time.Hour).Unix())
	if err != nil {
		return nil, fmt.Errorf("load focus last7: %w", err)
	}
	defer rows.Close()
	byDate := map[string]int{}
	for rows.Next() {
		var date string
		var count int
		if err := rows.Scan(&date, &count); err != nil {
			return nil, fmt.Errorf("scan focus last7: %w", err)
		}
		byDate[date] = count
	}
	result := make([]DayCount, 0, 7)
	for i := 6; i >= 0; i-- {
		date := time.Now().Add(-time.Duration(i) * 24 * time.Hour).Format("2006-01-02")
		result = append(result, DayCount{Date: date, Count: byDate[date]})
	}
	return result, rows.Err()
}

func (s *Store) taskCountByList(ctx context.Context, userID string) ([]ListCount, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id, l.name, l.color, COUNT(t.id)
		FROM focus_lists l
		LEFT JOIN focus_tasks t ON t.list_id = l.id AND t.status = 'done' AND t.user_id = ?
		WHERE l.user_id = ?
		GROUP BY l.id, l.name, l.color
		ORDER BY COUNT(t.id) DESC, l.sort_order
	`, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("load focus list counts: %w", err)
	}
	defer rows.Close()
	items := []ListCount{}
	for rows.Next() {
		var item ListCount
		if err := rows.Scan(&item.ListID, &item.Name, &item.Color, &item.Count); err != nil {
			return nil, fmt.Errorf("scan focus list count: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) maxStreak(ctx context.Context, userID, rangeID string) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT record_date FROM focus_habit_records
		WHERE user_id = ? ORDER BY record_date DESC
	`, userID)
	if err != nil {
		return 0, fmt.Errorf("load focus streaks: %w", err)
	}
	defer rows.Close()
	dates := []time.Time{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return 0, fmt.Errorf("scan focus streak: %w", err)
		}
		parsed, err := time.Parse("2006-01-02", raw)
		if err == nil {
			dates = append(dates, parsed)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(dates) == 0 {
		return 0, nil
	}
	max := 1
	current := 1
	for i := 1; i < len(dates); i++ {
		if dates[i-1].AddDate(0, 0, -1).Equal(dates[i]) {
			current++
		} else {
			current = 1
		}
		if current > max {
			max = current
		}
	}
	return max, nil
}

func (s *Store) enrichHabits(ctx context.Context, habits []Habit, date string) ([]Habit, error) {
	for i := range habits {
		habits[i].Weekdays = parseWeekdays(habits[i].WeekdaysRaw)
		var checked int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM focus_habit_records
			WHERE habit_id = ? AND record_date = ?
		`, habits[i].ID, date).Scan(&checked); err != nil {
			return nil, fmt.Errorf("check focus habit record: %w", err)
		}
		habits[i].TodayChecked = checked > 0
		var records int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM focus_habit_records WHERE habit_id = ?
		`, habits[i].ID).Scan(&records); err != nil {
			return nil, fmt.Errorf("count focus habit records: %w", err)
		}
		habits[i].TotalRecords = records
		streak, err := s.habitStreak(ctx, habits[i].ID, date)
		if err != nil {
			return nil, err
		}
		habits[i].StreakDays = streak
	}
	return habits, nil
}

func (s *Store) habitStreak(ctx context.Context, habitID, date string) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT record_date FROM focus_habit_records
		WHERE habit_id = ? AND record_date <= ? ORDER BY record_date DESC
	`, habitID, date)
	if err != nil {
		return 0, fmt.Errorf("load focus habit streak: %w", err)
	}
	defer rows.Close()
	dates := []time.Time{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return 0, fmt.Errorf("scan focus habit streak: %w", err)
		}
		parsed, err := time.Parse("2006-01-02", raw)
		if err == nil {
			dates = append(dates, parsed)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(dates) == 0 {
		return 0, nil
	}
	streak := 1
	for i := 1; i < len(dates); i++ {
		if dates[i-1].AddDate(0, 0, -1).Equal(dates[i]) {
			streak++
		} else {
			break
		}
	}
	return streak, nil
}

func (s *Store) createTaskInTx(ctx context.Context, tx *sql.Tx, userID string, input TaskInput) (Task, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" || len([]rune(title)) > 100 {
		return Task{}, ErrInvalidInput
	}
	if input.RepeatRule == "" {
		input.RepeatRule = RepeatNone
	}
	if !validRepeatRule(input.RepeatRule) {
		return Task{}, ErrInvalidInput
	}
	priority, ok := normalizePriority(input.Priority)
	if !ok {
		return Task{}, ErrInvalidInput
	}
	listID := strings.TrimSpace(input.ListID)
	if listID == "" {
		list, err := s.EnsureDefaultList(ctx, userID)
		if err != nil {
			return Task{}, err
		}
		listID = list.ID
	}
	now := time.Now().UTC()
	task := Task{
		ID:            uuid.NewString(),
		UserID:        userID,
		ListID:        listID,
		Title:         title,
		Note:          strings.TrimSpace(input.Note),
		Priority:      priority,
		PriorityLabel: priorityLabel(priority),
		DueDate:       stringValue(input.DueDate),
		DueTime:       stringValue(input.DueTime),
		RepeatRule:    input.RepeatRule,
		ParentTaskID:  strings.TrimSpace(input.ParentTaskID),
		Status:        TaskStatusOpen,
		SortOrder:     input.SortOrder,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := insertTask(ctx, tx, task); err != nil {
		return Task{}, err
	}
	return task, nil
}

func insertTask(ctx context.Context, q queryer, task Task) error {
	if _, err := q.ExecContext(ctx, `
		INSERT INTO focus_tasks (
			id, user_id, list_id, title, note, priority, due_date, due_time,
			repeat_rule, parent_task_id, status, completed_at, sort_order, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, task.ID, task.UserID, task.ListID, task.Title, task.Note, task.Priority,
		nullString(task.DueDate), nullString(task.DueTime), task.RepeatRule,
		nullString(task.ParentTaskID), task.Status, nil, task.SortOrder,
		task.CreatedAt.Unix(), task.UpdatedAt.Unix(),
	); err != nil {
		return fmt.Errorf("insert focus task: %w", err)
	}
	return nil
}

func countOpenSubtasks(ctx context.Context, q queryer, parentID string) (int, error) {
	var count int
	if err := q.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM focus_tasks
		WHERE parent_task_id = ? AND status = 'open'
	`, parentID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count open focus subtasks: %w", err)
	}
	return count, nil
}

func scanList(row interface{ Scan(...any) error }) (List, error) {
	var item List
	var archivedAt sql.NullInt64
	var createdAt, updatedAt int64
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.Color, &item.SortOrder,
		&archivedAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return List{}, ErrNotFound
		}
		return List{}, fmt.Errorf("scan focus list: %w", err)
	}
	item.Archived = archivedAt.Valid
	item.ArchivedAt = unixToTime(archivedAt)
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func scanTask(row interface{ Scan(...any) error }) (Task, error) {
	var item Task
	var listID, title, note, repeatRule, status string
	var parentTaskIDNull sql.NullString
	var priority int
	var dueDate, dueTime sql.NullString
	var completedAt sql.NullInt64
	var sortOrder int
	var createdAt, updatedAt int64
	if err := row.Scan(&item.ID, &item.UserID, &listID, &title, &note, &priority,
		&dueDate, &dueTime, &repeatRule, &parentTaskIDNull, &status, &completedAt,
		&sortOrder, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Task{}, ErrNotFound
		}
		return Task{}, fmt.Errorf("scan focus task: %w", err)
	}
	item.ListID = listID
	item.Title = title
	item.Note = note
	item.Priority = priority
	item.PriorityLabel = priorityLabel(priority)
	item.DueDate = dueDate.String
	item.DueTime = dueTime.String
	item.RepeatRule = repeatRule
	item.ParentTaskID = parentTaskIDNull.String
	item.Status = status
	item.CompletedAt = unixToTime(completedAt)
	item.SortOrder = sortOrder
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func scanHabit(row interface{ Scan(...any) error }) (Habit, error) {
	var item Habit
	var archivedAt sql.NullInt64
	var reminderTime sql.NullString
	var createdAt, updatedAt int64
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.Icon, &item.Color,
		&item.Frequency, &item.WeekdaysRaw, &reminderTime, &item.SortOrder,
		&archivedAt, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Habit{}, ErrNotFound
		}
		return Habit{}, fmt.Errorf("scan focus habit: %w", err)
	}
	item.Archived = archivedAt.Valid
	item.ArchivedAt = unixToTime(archivedAt)
	item.ReminderTime = reminderTime.String
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	item.Weekdays = parseWeekdays(item.WeekdaysRaw)
	return item, nil
}

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func priorityLabel(priority int) string {
	switch priority {
	case 0:
		return "high"
	case 2:
		return "low"
	default:
		return "medium"
	}
}

func normalizePriority(value string) (int, bool) {
	switch value {
	case "high", "高":
		return 0, true
	case "low", "低":
		return 2, true
	case "medium", "中", "":
		return 1, true
	default:
		return 0, false
	}
}

func validRepeatRule(value string) bool {
	switch value {
	case RepeatNone, RepeatDaily, RepeatWeekly, RepeatMonthly:
		return true
	default:
		return false
	}
}

func validDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func validMonth(value string) bool {
	_, err := time.Parse("2006-01", value)
	return err == nil
}

func validTime(value string) bool {
	_, err := time.Parse("15:04", value)
	return err == nil
}

func nextOccurrence(dueDate, rule string) (string, error) {
	if dueDate == "" || rule == RepeatNone {
		return "", nil
	}
	parsed, err := time.Parse("2006-01-02", dueDate)
	if err != nil {
		return "", ErrInvalidInput
	}
	switch rule {
	case RepeatDaily:
		return parsed.AddDate(0, 0, 1).Format("2006-01-02"), nil
	case RepeatWeekly:
		return parsed.AddDate(0, 0, 7).Format("2006-01-02"), nil
	case RepeatMonthly:
		return parsed.AddDate(0, 1, 0).Format("2006-01-02"), nil
	default:
		return "", ErrInvalidInput
	}
}

func normalizeColor(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "#7e5bef"
	}
	return value
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func parseWeekdays(raw string) []int {
	if strings.TrimSpace(raw) == "" {
		return []int{}
	}
	parts := strings.Split(raw, ",")
	result := []int{}
	for _, part := range parts {
		var weekday int
		if _, err := fmt.Sscanf(strings.TrimSpace(part), "%d", &weekday); err == nil {
			result = append(result, weekday)
		}
	}
	return result
}

func weekdaysString(weekdays []int) string {
	parts := make([]string, 0, len(weekdays))
	for _, weekday := range weekdays {
		parts = append(parts, fmt.Sprintf("%d", weekday))
	}
	return strings.Join(parts, ",")
}

func statsRange(rangeID string) (time.Time, time.Time) {
	now := time.Now()
	if rangeID == "week" {
		weekday := int(now.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		start := now.AddDate(0, 0, -(weekday - 1))
		start = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, start.Location())
		return start, now
	}
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	return start, now
}

func unixOrNil(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Unix()
}

func unixToTime(value sql.NullInt64) *time.Time {
	if !value.Valid {
		return nil
	}
	parsed := time.Unix(value.Int64, 0).UTC()
	return &parsed
}

func nullableUnix(value *time.Time) *time.Time {
	return value
}

func nullString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
