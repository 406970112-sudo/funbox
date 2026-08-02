package resourcesearch

import (
	"context"
	"database/sql"
	"encoding/json"
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
	ErrSourceNotFound = errors.New("resource search source not found")
	ErrSourceInUse    = errors.New("resource search source still has usage records")
)

type SourceMode string

const (
	SourceModeAggregate SourceMode = "aggregate"
	SourceModeDirect    SourceMode = "direct"
)

type Source struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	Description       string     `json:"description"`
	Category          string     `json:"category"`
	HomepageURL       string     `json:"homepageUrl"`
	SearchURLTemplate string     `json:"searchUrlTemplate"`
	Mode              SourceMode `json:"mode"`
	AdapterKey        string     `json:"adapterKey"`
	LogoType          string     `json:"logoType"`
	LogoText          string     `json:"logoText"`
	LogoBackground    string     `json:"logoBackground"`
	LogoColor         string     `json:"logoColor"`
	LogoImagePath     string     `json:"logoImagePath"`
	DefaultSelected   bool       `json:"defaultSelected"`
	Enabled           bool       `json:"enabled"`
	SortOrder         int        `json:"sortOrder"`
	MaxResults        int        `json:"maxResults"`
	TimeoutMS         int64      `json:"timeoutMs"`
	CacheTTLMS        int64      `json:"cacheTtlMs"`
	CreatedBy         string     `json:"createdBy"`
	UpdatedBy         string     `json:"updatedBy"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	DeletedAt         *time.Time `json:"deletedAt,omitempty"`
}

type SourceInput struct {
	Name              string
	Description       string
	Category          string
	HomepageURL       string
	SearchURLTemplate string
	Mode              SourceMode
	AdapterKey        string
	LogoType          string
	LogoText          string
	LogoBackground    string
	LogoColor         string
	LogoImagePath     string
	DefaultSelected   bool
	Enabled           bool
	SortOrder         int
	MaxResults        int
	TimeoutMS         int64
	CacheTTLMS        int64
}

type SourceFilter struct {
	Query    string
	Category string
	Status   string
}

type HealthCheck struct {
	ID         int64
	SourceID   string
	CheckedAt  time.Time
	Status     SourceStatus
	HTTPStatus int
	LatencyMS  int64
	FinalURL   string
	Message    string
	Trigger    string
}

type TestRun struct {
	ID         int64
	SourceID   string
	OperatorID string
	Query      string
	Status     SourceStatus
	Count      int
	DurationMS int64
	Message    string
	CreatedAt  time.Time
}

type AuditLog struct {
	ID           int64     `json:"id"`
	OperatorID   string    `json:"operatorId"`
	OperatorName string    `json:"operatorName"`
	Action       string    `json:"action"`
	SourceID     string    `json:"sourceId"`
	Before       string    `json:"before"`
	After        string    `json:"after"`
	Result       string    `json:"result"`
	Message      string    `json:"message"`
	CreatedAt    time.Time `json:"createdAt"`
}

type AuditPage struct {
	Logs   []AuditLog `json:"logs"`
	Total  int        `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

type UsageStats struct {
	SourceID      string `json:"sourceId"`
	Name          string `json:"name"`
	SearchCount   int    `json:"searchCount"`
	SuccessCount  int    `json:"successCount"`
	FailureCount  int    `json:"failureCount"`
	TimeoutCount  int    `json:"timeoutCount"`
	AvgDurationMS int64  `json:"avgDurationMs"`
	ResultCount   int    `json:"resultCount"`
}

type TopKeyword struct {
	Keyword string `json:"keyword"`
	Count   int    `json:"count"`
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	if strings.TrimSpace(databasePath) == "" {
		return nil, errors.New("database path is required")
	}

	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create resource search database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open resource search database: %w", err)
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
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS resource_search_sources (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT '综合',
			homepage_url TEXT NOT NULL,
			search_url_template TEXT NOT NULL DEFAULT '',
			mode TEXT NOT NULL DEFAULT 'direct',
			adapter_key TEXT NOT NULL DEFAULT 'homepage_only',
			logo_type TEXT NOT NULL DEFAULT 'text',
			logo_text TEXT NOT NULL DEFAULT '',
			logo_background TEXT NOT NULL DEFAULT '#e7ecff',
			logo_color TEXT NOT NULL DEFAULT '#4b6bff',
			logo_image_path TEXT NOT NULL DEFAULT '',
			default_selected INTEGER NOT NULL DEFAULT 1,
			enabled INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			max_results INTEGER NOT NULL DEFAULT 20,
			timeout_ms INTEGER NOT NULL DEFAULT 12000,
			cache_ttl_ms INTEGER NOT NULL DEFAULT 120000,
			created_by TEXT NOT NULL DEFAULT '',
			updated_by TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0,
			deleted_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS resource_search_health_checks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL REFERENCES resource_search_sources(id),
			checked_at INTEGER NOT NULL,
			status TEXT NOT NULL,
			http_status INTEGER NOT NULL DEFAULT 0,
			latency_ms INTEGER NOT NULL DEFAULT 0,
			final_url TEXT NOT NULL DEFAULT '',
			message TEXT NOT NULL DEFAULT '',
			trigger TEXT NOT NULL DEFAULT 'manual'
		)`,
		`CREATE INDEX IF NOT EXISTS idx_resource_health_source_time
			ON resource_search_health_checks(source_id, checked_at DESC)`,
		`CREATE TABLE IF NOT EXISTS resource_search_test_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL REFERENCES resource_search_sources(id),
			operator_id TEXT NOT NULL DEFAULT '',
			query TEXT NOT NULL,
			status TEXT NOT NULL,
			count INTEGER NOT NULL DEFAULT 0,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			message TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_resource_test_source_time
			ON resource_search_test_runs(source_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS resource_search_audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			operator_id TEXT NOT NULL DEFAULT '',
			operator_name TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			source_id TEXT NOT NULL DEFAULT '',
			before_json TEXT NOT NULL DEFAULT '',
			after_json TEXT NOT NULL DEFAULT '',
			result TEXT NOT NULL DEFAULT 'success',
			message TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_resource_audit_time
			ON resource_search_audit_logs(created_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS resource_search_usage_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_id TEXT NOT NULL REFERENCES resource_search_sources(id),
			keyword TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT '',
			result_count INTEGER NOT NULL DEFAULT 0,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			user_id TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_resource_usage_source_time
			ON resource_search_usage_logs(source_id, created_at)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run resource search database migration: %w", err)
		}
	}
	return s.seedSources()
}

func (s *Store) seedSources() error {
	now := time.Now().UTC().Unix()
	sources := []Source{
		{
			ID:                "laoer-motewan",
			Name:              "老二搜索",
			Description:       "免费网盘资源搜索",
			Category:          "网盘",
			HomepageURL:       "https://laoer.motewan.com/",
			SearchURLTemplate: "https://laoer.motewan.com/s/{keyword}.html",
			Mode:              SourceModeAggregate,
			AdapterKey:        "laoer_sse",
			LogoType:          "text",
			LogoText:          "L2",
			LogoBackground:    "#fff6d9",
			LogoColor:         "#a66d00",
			DefaultSelected:   true,
			Enabled:           true,
			SortOrder:         1,
			MaxResults:        20,
			TimeoutMS:         12000,
			CacheTTLMS:        120000,
			CreatedBy:         "system",
			UpdatedBy:         "system",
		},
		{
			ID:              "quark-pan-search",
			Name:            "夸克盘搜",
			Description:     "综合网盘资源",
			Category:        "网盘",
			HomepageURL:     "https://www.quarkpanso.com/",
			Mode:            SourceModeDirect,
			AdapterKey:      "homepage_only",
			LogoType:        "text",
			LogoText:        "QP",
			LogoBackground:  "#e7ebff",
			LogoColor:       "#4b6bff",
			DefaultSelected: true,
			Enabled:         true,
			SortOrder:       2,
			MaxResults:      20,
			TimeoutMS:       12000,
			CacheTTLMS:      120000,
			CreatedBy:       "system",
			UpdatedBy:       "system",
		},
		{
			ID:              "panyq",
			Name:            "盘友圈",
			Description:     "社区分享资源",
			Category:        "网盘",
			HomepageURL:     "https://panyq.com/",
			Mode:            SourceModeDirect,
			AdapterKey:      "homepage_only",
			LogoType:        "text",
			LogoText:        "YQ",
			LogoBackground:  "#e5f7f1",
			LogoColor:       "#16896d",
			DefaultSelected: true,
			Enabled:         true,
			SortOrder:       3,
			MaxResults:      20,
			TimeoutMS:       12000,
			CacheTTLMS:      120000,
			CreatedBy:       "system",
			UpdatedBy:       "system",
		},
		{
			ID:              "tvso",
			Name:            "TV 搜",
			Description:     "影视内容检索",
			Category:        "影视",
			HomepageURL:     "https://www.tvso.uk/",
			Mode:            SourceModeDirect,
			AdapterKey:      "homepage_only",
			LogoType:        "text",
			LogoText:        "TV",
			LogoBackground:  "#fff0e7",
			LogoColor:       "#e46c2e",
			DefaultSelected: true,
			Enabled:         true,
			SortOrder:       4,
			MaxResults:      20,
			TimeoutMS:       12000,
			CacheTTLMS:      120000,
			CreatedBy:       "system",
			UpdatedBy:       "system",
		},
		{
			ID:              "funletu-pan",
			Name:            "趣盘搜",
			Description:     "网盘资源导航",
			Category:        "网盘",
			HomepageURL:     "https://pan.funletu.com/",
			Mode:            SourceModeDirect,
			AdapterKey:      "homepage_only",
			LogoType:        "text",
			LogoText:        "FL",
			LogoBackground:  "#ffeaf0",
			LogoColor:       "#e74c78",
			DefaultSelected: true,
			Enabled:         true,
			SortOrder:       5,
			MaxResults:      20,
			TimeoutMS:       12000,
			CacheTTLMS:      120000,
			CreatedBy:       "system",
			UpdatedBy:       "system",
		},
		{
			ID:              "yunso",
			Name:            "云搜",
			Description:     "多网盘搜索",
			Category:        "网盘",
			HomepageURL:     "https://www.yunso.net/",
			Mode:            SourceModeDirect,
			AdapterKey:      "homepage_only",
			LogoType:        "text",
			LogoText:        "YS",
			LogoBackground:  "#edf0ff",
			LogoColor:       "#6b5adb",
			DefaultSelected: true,
			Enabled:         true,
			SortOrder:       6,
			MaxResults:      20,
			TimeoutMS:       12000,
			CacheTTLMS:      120000,
			CreatedBy:       "system",
			UpdatedBy:       "system",
		},
	}

	for _, source := range sources {
		if _, err := s.db.Exec(
			`INSERT OR IGNORE INTO resource_search_sources (
				id, name, description, category, homepage_url, search_url_template,
				mode, adapter_key, logo_type, logo_text, logo_background, logo_color,
				logo_image_path, default_selected, enabled, sort_order, max_results,
				timeout_ms, cache_ttl_ms, created_by, updated_by, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			source.ID,
			source.Name,
			source.Description,
			source.Category,
			source.HomepageURL,
			source.SearchURLTemplate,
			source.Mode,
			source.AdapterKey,
			source.LogoType,
			source.LogoText,
			source.LogoBackground,
			source.LogoColor,
			source.LogoImagePath,
			boolInt(source.DefaultSelected),
			boolInt(source.Enabled),
			source.SortOrder,
			source.MaxResults,
			source.TimeoutMS,
			source.CacheTTLMS,
			source.CreatedBy,
			source.UpdatedBy,
			now,
			now,
		); err != nil {
			return fmt.Errorf("seed resource search source %s: %w", source.ID, err)
		}
	}
	return nil
}

func (s *Store) ListSources(ctx context.Context, filter SourceFilter) ([]Source, error) {
	query := `SELECT id, name, description, category, homepage_url, search_url_template,
		mode, adapter_key, logo_type, logo_text, logo_background, logo_color,
		logo_image_path, default_selected, enabled, sort_order, max_results,
		timeout_ms, cache_ttl_ms, created_by, updated_by, created_at, updated_at
		FROM resource_search_sources WHERE deleted_at = 0`
	args := make([]any, 0, 4)
	conditions := make([]string, 0, 3)
	if value := strings.TrimSpace(filter.Query); value != "" {
		conditions = append(conditions, `(name LIKE ? OR homepage_url LIKE ? OR id LIKE ?)`)
		args = append(args, "%"+value+"%", "%"+value+"%", "%"+value+"%")
	}
	if value := strings.TrimSpace(filter.Category); value != "" && value != "全部" {
		conditions = append(conditions, `category = ?`)
		args = append(args, value)
	}
	switch filter.Status {
	case "enabled":
		conditions = append(conditions, `enabled = 1`)
	case "disabled":
		conditions = append(conditions, `enabled = 0`)
	}
	if len(conditions) > 0 {
		query += " AND " + strings.Join(conditions, " AND ")
	}
	query += ` ORDER BY sort_order ASC, updated_at DESC`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list resource search sources: %w", err)
	}
	defer rows.Close()

	sources := make([]Source, 0, 16)
	for rows.Next() {
		source, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate resource search sources: %w", err)
	}
	return sources, nil
}

func (s *Store) GetSource(ctx context.Context, id string) (Source, error) {
	var source Source
	row := s.db.QueryRowContext(ctx,
		`SELECT id, name, description, category, homepage_url, search_url_template,
			mode, adapter_key, logo_type, logo_text, logo_background, logo_color,
			logo_image_path, default_selected, enabled, sort_order, max_results,
			timeout_ms, cache_ttl_ms, created_by, updated_by, created_at, updated_at
		 FROM resource_search_sources WHERE id = ? AND deleted_at = 0`, id)
	source, err := scanSource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Source{}, ErrSourceNotFound
	}
	if err != nil {
		return Source{}, fmt.Errorf("get resource search source: %w", err)
	}
	return source, nil
}

func (s *Store) CreateSource(ctx context.Context, operatorID string, input SourceInput) (Source, error) {
	id := "rs-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	now := time.Now().UTC().Unix()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO resource_search_sources (
			id, name, description, category, homepage_url, search_url_template,
			mode, adapter_key, logo_type, logo_text, logo_background, logo_color,
			logo_image_path, default_selected, enabled, sort_order, max_results,
			timeout_ms, cache_ttl_ms, created_by, updated_by, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		input.Name,
		input.Description,
		input.Category,
		input.HomepageURL,
		input.SearchURLTemplate,
		input.Mode,
		input.AdapterKey,
		input.LogoType,
		input.LogoText,
		input.LogoBackground,
		input.LogoColor,
		input.LogoImagePath,
		boolInt(input.DefaultSelected),
		boolInt(input.Enabled),
		input.SortOrder,
		input.MaxResults,
		input.TimeoutMS,
		input.CacheTTLMS,
		operatorID,
		operatorID,
		now,
		now,
	); err != nil {
		return Source{}, fmt.Errorf("create resource search source: %w", err)
	}
	return s.GetSource(ctx, id)
}

func (s *Store) UpdateSource(ctx context.Context, operatorID, id string, input SourceInput) (Source, error) {
	now := time.Now().UTC().Unix()
	result, err := s.db.ExecContext(ctx,
		`UPDATE resource_search_sources SET
			name = ?, description = ?, category = ?, homepage_url = ?,
			search_url_template = ?, mode = ?, adapter_key = ?, logo_type = ?,
			logo_text = ?, logo_background = ?, logo_color = ?, logo_image_path = ?,
			default_selected = ?, enabled = ?, sort_order = ?, max_results = ?,
			timeout_ms = ?, cache_ttl_ms = ?, updated_by = ?, updated_at = ?
		 WHERE id = ? AND deleted_at = 0`,
		input.Name,
		input.Description,
		input.Category,
		input.HomepageURL,
		input.SearchURLTemplate,
		input.Mode,
		input.AdapterKey,
		input.LogoType,
		input.LogoText,
		input.LogoBackground,
		input.LogoColor,
		input.LogoImagePath,
		boolInt(input.DefaultSelected),
		boolInt(input.Enabled),
		input.SortOrder,
		input.MaxResults,
		input.TimeoutMS,
		input.CacheTTLMS,
		operatorID,
		now,
		id,
	)
	if err != nil {
		return Source{}, fmt.Errorf("update resource search source: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Source{}, err
	}
	if affected == 0 {
		return Source{}, ErrSourceNotFound
	}
	return s.GetSource(ctx, id)
}

func (s *Store) SetSourceEnabled(ctx context.Context, operatorID, id string, enabled bool) (Source, error) {
	now := time.Now().UTC().Unix()
	result, err := s.db.ExecContext(ctx,
		`UPDATE resource_search_sources SET enabled = ?, updated_by = ?, updated_at = ?
		 WHERE id = ? AND deleted_at = 0`,
		boolInt(enabled),
		operatorID,
		now,
		id,
	)
	if err != nil {
		return Source{}, fmt.Errorf("set resource search source enabled: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Source{}, err
	}
	if affected == 0 {
		return Source{}, ErrSourceNotFound
	}
	return s.GetSource(ctx, id)
}

func (s *Store) DeleteSource(ctx context.Context, operatorID, id string) (Source, error) {
	source, err := s.GetSource(ctx, id)
	if err != nil {
		return Source{}, err
	}
	now := time.Now().UTC().Unix()
	result, err := s.db.ExecContext(ctx,
		`UPDATE resource_search_sources SET enabled = 0, deleted_at = ?, updated_by = ?, updated_at = ?
		 WHERE id = ? AND deleted_at = 0`,
		now,
		operatorID,
		now,
		id,
	)
	if err != nil {
		return Source{}, fmt.Errorf("delete resource search source: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Source{}, err
	}
	if affected == 0 {
		return Source{}, ErrSourceNotFound
	}
	return source, nil
}

func (s *Store) CountUsage(ctx context.Context, sourceID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM resource_search_usage_logs WHERE source_id = ?`, sourceID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count resource search usage: %w", err)
	}
	return count, nil
}

func (s *Store) SaveHealthCheck(ctx context.Context, check HealthCheck) error {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO resource_search_health_checks (
			source_id, checked_at, status, http_status, latency_ms, final_url, message, trigger
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		check.SourceID,
		check.CheckedAt.UTC().Unix(),
		check.Status,
		check.HTTPStatus,
		check.LatencyMS,
		check.FinalURL,
		check.Message,
		check.Trigger,
	); err != nil {
		return fmt.Errorf("save resource search health check: %w", err)
	}
	return nil
}

func (s *Store) LatestHealth(ctx context.Context, sourceID string) (HealthCheck, bool, error) {
	var check HealthCheck
	var checkedAt int64
	err := s.db.QueryRowContext(ctx,
		`SELECT id, source_id, checked_at, status, http_status, latency_ms, final_url, message, trigger
		 FROM resource_search_health_checks
		 WHERE source_id = ?
		 ORDER BY checked_at DESC, id DESC
		 LIMIT 1`,
		sourceID,
	).Scan(
		&check.ID,
		&check.SourceID,
		&checkedAt,
		&check.Status,
		&check.HTTPStatus,
		&check.LatencyMS,
		&check.FinalURL,
		&check.Message,
		&check.Trigger,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return HealthCheck{}, false, nil
	}
	if err != nil {
		return HealthCheck{}, false, fmt.Errorf("read latest resource search health: %w", err)
	}
	check.CheckedAt = time.Unix(checkedAt, 0).UTC()
	return check, true, nil
}

func (s *Store) ListHealthChecks(ctx context.Context, sourceID string, limit int) ([]HealthCheck, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, source_id, checked_at, status, http_status, latency_ms, final_url, message, trigger
		 FROM resource_search_health_checks
		 WHERE source_id = ?
		 ORDER BY checked_at DESC, id DESC
		 LIMIT ?`,
		sourceID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list resource search health checks: %w", err)
	}
	defer rows.Close()

	checks := make([]HealthCheck, 0, limit)
	for rows.Next() {
		var check HealthCheck
		var checkedAt int64
		if err := rows.Scan(
			&check.ID,
			&check.SourceID,
			&checkedAt,
			&check.Status,
			&check.HTTPStatus,
			&check.LatencyMS,
			&check.FinalURL,
			&check.Message,
			&check.Trigger,
		); err != nil {
			return nil, fmt.Errorf("scan resource search health check: %w", err)
		}
		check.CheckedAt = time.Unix(checkedAt, 0).UTC()
		checks = append(checks, check)
	}
	return checks, rows.Err()
}

func (s *Store) SaveTestRun(ctx context.Context, run TestRun) error {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO resource_search_test_runs (
			source_id, operator_id, query, status, count, duration_ms, message, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		run.SourceID,
		run.OperatorID,
		run.Query,
		run.Status,
		run.Count,
		run.DurationMS,
		run.Message,
		run.CreatedAt.UTC().Unix(),
	); err != nil {
		return fmt.Errorf("save resource search test run: %w", err)
	}
	return nil
}

func (s *Store) ListTestRuns(ctx context.Context, sourceID string, limit int) ([]TestRun, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, source_id, operator_id, query, status, count, duration_ms, message, created_at
		 FROM resource_search_test_runs
		 WHERE source_id = ?
		 ORDER BY created_at DESC, id DESC
		 LIMIT ?`,
		sourceID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list resource search test runs: %w", err)
	}
	defer rows.Close()

	runs := make([]TestRun, 0, limit)
	for rows.Next() {
		var run TestRun
		var createdAt int64
		if err := rows.Scan(
			&run.ID,
			&run.SourceID,
			&run.OperatorID,
			&run.Query,
			&run.Status,
			&run.Count,
			&run.DurationMS,
			&run.Message,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan resource search test run: %w", err)
		}
		run.CreatedAt = time.Unix(createdAt, 0).UTC()
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) AddAudit(ctx context.Context, log AuditLog) error {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO resource_search_audit_logs (
			operator_id, operator_name, action, source_id, before_json, after_json,
			result, message, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		log.OperatorID,
		log.OperatorName,
		log.Action,
		log.SourceID,
		log.Before,
		log.After,
		log.Result,
		log.Message,
		log.CreatedAt.UTC().Unix(),
	); err != nil {
		return fmt.Errorf("insert resource search audit log: %w", err)
	}
	return nil
}

func (s *Store) ListAuditLogs(ctx context.Context, limit, offset int, action, operator string) (AuditPage, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	where := `WHERE 1 = 1`
	args := make([]any, 0, 3)
	if action != "" {
		where += ` AND action = ?`
		args = append(args, action)
	}
	if operator != "" {
		where += ` AND operator_name LIKE ?`
		args = append(args, "%"+operator+"%")
	}

	var total int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM resource_search_audit_logs `+where, args...,
	).Scan(&total); err != nil {
		return AuditPage{}, fmt.Errorf("count resource search audit logs: %w", err)
	}

	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, operator_id, operator_name, action, source_id, before_json, after_json,
		        result, message, created_at
		 FROM resource_search_audit_logs `+where+`
		 ORDER BY created_at DESC, id DESC
		 LIMIT ? OFFSET ?`,
		queryArgs...,
	)
	if err != nil {
		return AuditPage{}, fmt.Errorf("list resource search audit logs: %w", err)
	}
	defer rows.Close()

	logs := make([]AuditLog, 0, limit)
	for rows.Next() {
		var log AuditLog
		var createdAt int64
		if err := rows.Scan(
			&log.ID,
			&log.OperatorID,
			&log.OperatorName,
			&log.Action,
			&log.SourceID,
			&log.Before,
			&log.After,
			&log.Result,
			&log.Message,
			&createdAt,
		); err != nil {
			return AuditPage{}, fmt.Errorf("scan resource search audit log: %w", err)
		}
		log.CreatedAt = time.Unix(createdAt, 0).UTC()
		logs = append(logs, log)
	}
	if err := rows.Err(); err != nil {
		return AuditPage{}, fmt.Errorf("iterate resource search audit logs: %w", err)
	}
	return AuditPage{Logs: logs, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *Store) LogUsage(ctx context.Context, sourceID, keyword, status string, resultCount int, durationMS int64, userID string) error {
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO resource_search_usage_logs (
			source_id, keyword, status, result_count, duration_ms, user_id, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sourceID,
		keyword,
		status,
		resultCount,
		durationMS,
		userID,
		time.Now().UTC().Unix(),
	); err != nil {
		return fmt.Errorf("log resource search usage: %w", err)
	}
	return nil
}

func (s *Store) Stats(ctx context.Context, days int) ([]UsageStats, error) {
	if days <= 0 {
		days = 7
	}
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour).Unix()
	rows, err := s.db.QueryContext(ctx,
		`SELECT u.source_id, MAX(s.name),
		        COUNT(*),
		        SUM(CASE WHEN u.status IN ('success','direct') THEN 1 ELSE 0 END),
		        SUM(CASE WHEN u.status IN ('error','restricted','unavailable') THEN 1 ELSE 0 END),
		        SUM(CASE WHEN u.status = 'timeout' THEN 1 ELSE 0 END),
		        COALESCE(CAST(SUM(u.duration_ms) AS REAL) / NULLIF(COUNT(*), 0), 0),
		        SUM(u.result_count)
		 FROM resource_search_usage_logs u
		 LEFT JOIN resource_search_sources s ON s.id = u.source_id
		 WHERE u.created_at >= ?
		 GROUP BY u.source_id
		 ORDER BY COUNT(*) DESC`,
		since,
	)
	if err != nil {
		return nil, fmt.Errorf("query resource search stats: %w", err)
	}
	defer rows.Close()

	stats := make([]UsageStats, 0, 16)
	for rows.Next() {
		var item UsageStats
		var avg float64
		var success sql.NullInt64
		var failure sql.NullInt64
		var timeout sql.NullInt64
		var resultCount sql.NullInt64
		var name sql.NullString
		if err := rows.Scan(
			&item.SourceID,
			&name,
			&item.SearchCount,
			&success,
			&failure,
			&timeout,
			&avg,
			&resultCount,
		); err != nil {
			return nil, fmt.Errorf("scan resource search stats: %w", err)
		}
		item.Name = name.String
		item.SuccessCount = int(success.Int64)
		item.FailureCount = int(failure.Int64)
		item.TimeoutCount = int(timeout.Int64)
		item.AvgDurationMS = int64(avg)
		item.ResultCount = int(resultCount.Int64)
		stats = append(stats, item)
	}
	return stats, rows.Err()
}

func (s *Store) TopKeywords(ctx context.Context, days, limit int) ([]TopKeyword, error) {
	if days <= 0 {
		days = 7
	}
	if limit <= 0 || limit > 20 {
		limit = 10
	}
	since := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour).Unix()
	rows, err := s.db.QueryContext(ctx,
		`SELECT keyword, COUNT(*) AS cnt
		 FROM resource_search_usage_logs
		 WHERE created_at >= ? AND keyword <> ''
		 GROUP BY keyword
		 ORDER BY cnt DESC, MAX(created_at) DESC
		 LIMIT ?`,
		since,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query resource search top keywords: %w", err)
	}
	defer rows.Close()

	keywords := make([]TopKeyword, 0, limit)
	for rows.Next() {
		var item TopKeyword
		if err := rows.Scan(&item.Keyword, &item.Count); err != nil {
			return nil, fmt.Errorf("scan resource search top keyword: %w", err)
		}
		keywords = append(keywords, item)
	}
	return keywords, rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSource(row rowScanner) (Source, error) {
	var source Source
	var defaultSelected, enabled int
	var createdAt, updatedAt int64
	if err := row.Scan(
		&source.ID,
		&source.Name,
		&source.Description,
		&source.Category,
		&source.HomepageURL,
		&source.SearchURLTemplate,
		&source.Mode,
		&source.AdapterKey,
		&source.LogoType,
		&source.LogoText,
		&source.LogoBackground,
		&source.LogoColor,
		&source.LogoImagePath,
		&defaultSelected,
		&enabled,
		&source.SortOrder,
		&source.MaxResults,
		&source.TimeoutMS,
		&source.CacheTTLMS,
		&source.CreatedBy,
		&source.UpdatedBy,
		&createdAt,
		&updatedAt,
	); err != nil {
		return Source{}, err
	}
	source.DefaultSelected = defaultSelected == 1
	source.Enabled = enabled == 1
	source.CreatedAt = time.Unix(createdAt, 0).UTC()
	source.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return source, nil
}

func sourceJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
