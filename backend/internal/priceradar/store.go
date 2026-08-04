package priceradar

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

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, errors.New("price radar database path is required")
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create price radar database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open price radar database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS price_radar_reports (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			product_id TEXT NOT NULL,
			product_name TEXT NOT NULL,
			store_name TEXT NOT NULL,
			store_type TEXT NOT NULL DEFAULT 'wet_market',
			address TEXT NOT NULL DEFAULT '',
			price REAL NOT NULL,
			unit TEXT NOT NULL DEFAULT '元/500克',
			purchase_date TEXT NOT NULL,
			latitude REAL NOT NULL DEFAULT 0,
			longitude REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			decision_note TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			verified_at INTEGER,
			reviewer_id TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_price_radar_reports_product
			ON price_radar_reports(product_id, status, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS price_radar_evidence (
			id TEXT PRIMARY KEY,
			report_id TEXT NOT NULL REFERENCES price_radar_reports(id) ON DELETE CASCADE,
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			visibility TEXT NOT NULL DEFAULT 'public',
			sort_order INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_price_radar_evidence_report
			ON price_radar_evidence(report_id, sort_order)`,
		`CREATE TABLE IF NOT EXISTS price_radar_objections (
			id TEXT PRIMARY KEY,
			report_id TEXT NOT NULL REFERENCES price_radar_reports(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			reason TEXT NOT NULL,
			body TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			resolution TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			resolved_at INTEGER,
			reviewer_id TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_price_radar_objections_report
			ON price_radar_objections(report_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS price_radar_objection_evidence (
			id TEXT PRIMARY KEY,
			objection_id TEXT NOT NULL REFERENCES price_radar_objections(id) ON DELETE CASCADE,
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			visibility TEXT NOT NULL DEFAULT 'public',
			sort_order INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS price_radar_comments (
			id TEXT PRIMARY KEY,
			report_id TEXT NOT NULL REFERENCES price_radar_reports(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			body TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_price_radar_comments_report
			ON price_radar_comments(report_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run price radar database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateReport(ctx context.Context, report Report, images []Evidence) (Report, error) {
	if report.ID == "" {
		report.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Report{}, fmt.Errorf("begin price radar report transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO price_radar_reports (
			id, user_id, product_id, product_name, store_name, store_type, address,
			price, unit, purchase_date, latitude, longitude, status, decision_note,
			created_at, verified_at, reviewer_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		report.ID,
		report.User.ID,
		report.ProductID,
		report.ProductName,
		report.StoreName,
		report.StoreType,
		report.Address,
		report.Price,
		report.Unit,
		report.PurchaseDate,
		report.Latitude,
		report.Longitude,
		report.Status,
		report.DecisionNote,
		now.Unix(),
		nil,
		"",
	); err != nil {
		return Report{}, fmt.Errorf("insert price radar report: %w", err)
	}

	for _, image := range images {
		if image.ID == "" {
			image.ID = uuid.NewString()
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO price_radar_evidence (
				id, report_id, stored_name, content_type, size_bytes, visibility, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
			image.ID,
			report.ID,
			image.StoredName,
			image.ContentType,
			image.SizeBytes,
			image.Visibility,
			image.SortOrder,
		); err != nil {
			return Report{}, fmt.Errorf("insert price radar evidence: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Report{}, fmt.Errorf("commit price radar report: %w", err)
	}
	report.Images = images
	report.CreatedAt = now
	return report, nil
}

func (s *Store) ListReports(ctx context.Context, productID string, includePending bool, limit, offset int) ([]Report, int, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	query := `SELECT COUNT(*) FROM price_radar_reports WHERE product_id = ?`
	args := []any{productID}
	if !includePending {
		query += ` AND status = ?`
		args = append(args, ReportStatusVerified)
	}
	var total int
	if err := s.db.QueryRowContext(ctx, query, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count price radar reports: %w", err)
	}

	query = `
		SELECT r.id, r.user_id, r.product_id, r.product_name, r.store_name, r.store_type,
			r.address, r.price, r.unit, r.purchase_date, r.latitude, r.longitude,
			r.status, r.decision_note, r.created_at, r.verified_at, r.reviewer_id,
			u.username, u.display_name
		FROM price_radar_reports r
		JOIN users u ON u.id = r.user_id
		WHERE r.product_id = ?
	`
	listArgs := []any{productID}
	if !includePending {
		query += ` AND r.status = ?`
		listArgs = append(listArgs, ReportStatusVerified)
	}
	query += ` ORDER BY r.created_at DESC, r.rowid DESC LIMIT ? OFFSET ?`
	listArgs = append(listArgs, limit, offset)

	rows, err := s.db.QueryContext(ctx, query, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list price radar reports: %w", err)
	}

	reports := make([]Report, 0, limit)
	reportIDs := make([]string, 0, limit)
	for rows.Next() {
		report, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		reports = append(reports, report)
		reportIDs = append(reportIDs, report.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate price radar reports: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, 0, fmt.Errorf("close price radar reports: %w", err)
	}
	evidenceMap, err := s.evidenceForReports(ctx, reportIDs)
	if err != nil {
		return nil, 0, err
	}
	for index := range reports {
		reports[index].Images = evidenceMap[reports[index].ID]
	}
	return reports, total, nil
}

func (s *Store) GetReport(ctx context.Context, reportID string) (Report, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT r.id, r.user_id, r.product_id, r.product_name, r.store_name, r.store_type,
			r.address, r.price, r.unit, r.purchase_date, r.latitude, r.longitude,
			r.status, r.decision_note, r.created_at, r.verified_at, r.reviewer_id,
			u.username, u.display_name
		FROM price_radar_reports r
		JOIN users u ON u.id = r.user_id
		WHERE r.id = ?
	`, reportID)
	report, err := scanReport(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Report{}, ErrReportNotFound
	}
	if err != nil {
		return Report{}, fmt.Errorf("get price radar report: %w", err)
	}
	images, err := s.evidenceForReports(ctx, []string{report.ID})
	if err != nil {
		return Report{}, err
	}
	report.Images = images[report.ID]
	return report, nil
}

func (s *Store) GetEvidence(ctx context.Context, reportID, evidenceID string) (Evidence, error) {
	var image Evidence
	err := s.db.QueryRowContext(ctx, `
		SELECT id, report_id, stored_name, content_type, size_bytes, visibility, sort_order
		FROM price_radar_evidence WHERE report_id = ? AND id = ?
	`, reportID, evidenceID).Scan(
		&image.ID,
		&image.ReportID,
		&image.StoredName,
		&image.ContentType,
		&image.SizeBytes,
		&image.Visibility,
		&image.SortOrder,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Evidence{}, ErrReportNotFound
	}
	if err != nil {
		return Evidence{}, fmt.Errorf("get price radar evidence: %w", err)
	}
	return image, nil
}

func (s *Store) GetObjectionEvidence(ctx context.Context, evidenceID string) (Evidence, error) {
	var image Evidence
	var objectionID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id, objection_id, stored_name, content_type, size_bytes, visibility, sort_order
		FROM price_radar_objection_evidence WHERE id = ?
	`, evidenceID).Scan(
		&image.ID,
		&objectionID,
		&image.StoredName,
		&image.ContentType,
		&image.SizeBytes,
		&image.Visibility,
		&image.SortOrder,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Evidence{}, ErrReportNotFound
	}
	if err != nil {
		return Evidence{}, fmt.Errorf("get price radar objection evidence: %w", err)
	}
	image.ReportID = objectionID
	return image, nil
}

func (s *Store) CreateComment(ctx context.Context, comment Comment) error {
	if comment.ID == "" {
		comment.ID = uuid.NewString()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO price_radar_comments (id, report_id, user_id, body, status, created_at)
		VALUES (?, ?, ?, ?, 'active', ?)
	`, comment.ID, comment.ReportID, comment.User.ID, comment.Body, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("insert price radar comment: %w", err)
	}
	return nil
}

func (s *Store) CreateObjection(ctx context.Context, objection Objection, images []Evidence) error {
	if objection.ID == "" {
		objection.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin price radar objection transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO price_radar_objections (
			id, report_id, user_id, reason, body, status, resolution,
			created_at, resolved_at, reviewer_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '')
	`,
		objection.ID,
		objection.ReportID,
		objection.User.ID,
		objection.Reason,
		objection.Body,
		objection.Status,
		objection.Resolution,
		now.Unix(),
	); err != nil {
		return fmt.Errorf("insert price radar objection: %w", err)
	}
	for _, image := range images {
		if image.ID == "" {
			image.ID = uuid.NewString()
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO price_radar_objection_evidence (
				id, objection_id, stored_name, content_type, size_bytes, visibility, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`,
			image.ID,
			objection.ID,
			image.StoredName,
			image.ContentType,
			image.SizeBytes,
			image.Visibility,
			image.SortOrder,
		); err != nil {
			return fmt.Errorf("insert price radar objection evidence: %w", err)
		}
	}
	return tx.Commit()
}

func (s *Store) ListComments(ctx context.Context, reportID string) ([]Comment, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.report_id, c.body, c.status, c.created_at,
			u.id, u.username, u.display_name
		FROM price_radar_comments c
		JOIN users u ON u.id = c.user_id
		WHERE c.report_id = ? AND c.status = 'active'
		ORDER BY c.created_at DESC, c.rowid DESC
	`, reportID)
	if err != nil {
		return nil, fmt.Errorf("list price radar comments: %w", err)
	}
	defer rows.Close()
	comments := make([]Comment, 0)
	for rows.Next() {
		var comment Comment
		var createdAt int64
		if err := rows.Scan(
			&comment.ID,
			&comment.ReportID,
			&comment.Body,
			&comment.Status,
			&createdAt,
			&comment.User.ID,
			&comment.User.Username,
			&comment.User.DisplayName,
		); err != nil {
			return nil, fmt.Errorf("scan price radar comment: %w", err)
		}
		comment.CreatedAt = time.Unix(createdAt, 0).UTC()
		comments = append(comments, comment)
	}
	return comments, rows.Err()
}

func (s *Store) ListObjections(ctx context.Context, reportID string) ([]Objection, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT o.id, o.report_id, o.reason, o.body, o.status, o.resolution,
			o.created_at, o.resolved_at, o.reviewer_id,
			u.id, u.username, u.display_name
		FROM price_radar_objections o
		JOIN users u ON u.id = o.user_id
		WHERE o.report_id = ?
		ORDER BY o.created_at DESC, o.rowid DESC
	`, reportID)
	if err != nil {
		return nil, fmt.Errorf("list price radar objections: %w", err)
	}
	objections := make([]Objection, 0)
	objectionIDs := make([]string, 0)
	for rows.Next() {
		var objection Objection
		var createdAt, resolvedAt sql.NullInt64
		if err := rows.Scan(
			&objection.ID,
			&objection.ReportID,
			&objection.Reason,
			&objection.Body,
			&objection.Status,
			&objection.Resolution,
			&createdAt,
			&resolvedAt,
			&objection.ReviewerID,
			&objection.User.ID,
			&objection.User.Username,
			&objection.User.DisplayName,
		); err != nil {
			return nil, fmt.Errorf("scan price radar objection: %w", err)
		}
		objection.CreatedAt = time.Unix(createdAt.Int64, 0).UTC()
		if resolvedAt.Valid {
			value := time.Unix(resolvedAt.Int64, 0).UTC()
			objection.ResolvedAt = &value
		}
		objections = append(objections, objection)
		objectionIDs = append(objectionIDs, objection.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate price radar objections: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close price radar objections: %w", err)
	}
	evidenceMap, err := s.objectionEvidence(ctx, objectionIDs)
	if err != nil {
		return nil, err
	}
	for index := range objections {
		objections[index].Images = evidenceMap[objections[index].ID]
	}
	return objections, nil
}

func (s *Store) ListMyReports(ctx context.Context, userID string) ([]Report, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.user_id, r.product_id, r.product_name, r.store_name, r.store_type,
			r.address, r.price, r.unit, r.purchase_date, r.latitude, r.longitude,
			r.status, r.decision_note, r.created_at, r.verified_at, r.reviewer_id,
			u.username, u.display_name
		FROM price_radar_reports r
		JOIN users u ON u.id = r.user_id
		WHERE r.user_id = ?
		ORDER BY r.created_at DESC, r.rowid DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list my price radar reports: %w", err)
	}
	reports := make([]Report, 0)
	reportIDs := make([]string, 0)
	for rows.Next() {
		report, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		reports = append(reports, report)
		reportIDs = append(reportIDs, report.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate my price radar reports: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close my price radar reports: %w", err)
	}
	evidenceMap, err := s.evidenceForReports(ctx, reportIDs)
	if err != nil {
		return nil, err
	}
	for index := range reports {
		reports[index].Images = evidenceMap[reports[index].ID]
	}
	return reports, rows.Err()
}

func (s *Store) ListPendingReports(ctx context.Context) ([]Report, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.user_id, r.product_id, r.product_name, r.store_name, r.store_type,
			r.address, r.price, r.unit, r.purchase_date, r.latitude, r.longitude,
			r.status, r.decision_note, r.created_at, r.verified_at, r.reviewer_id,
			u.username, u.display_name
		FROM price_radar_reports r
		JOIN users u ON u.id = r.user_id
		WHERE r.status = 'pending'
		ORDER BY r.created_at DESC, r.rowid DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, fmt.Errorf("list pending price radar reports: %w", err)
	}
	reports := make([]Report, 0)
	reportIDs := make([]string, 0)
	for rows.Next() {
		report, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		reports = append(reports, report)
		reportIDs = append(reportIDs, report.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending price radar reports: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close pending price radar reports: %w", err)
	}
	evidenceMap, err := s.evidenceForReports(ctx, reportIDs)
	if err != nil {
		return nil, err
	}
	for index := range reports {
		reports[index].Images = evidenceMap[reports[index].ID]
	}
	return reports, rows.Err()
}

func (s *Store) ListPendingObjections(ctx context.Context) ([]Objection, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT o.id, o.report_id, o.reason, o.body, o.status, o.resolution,
			o.created_at, o.resolved_at, o.reviewer_id,
			u.id, u.username, u.display_name
		FROM price_radar_objections o
		JOIN users u ON u.id = o.user_id
		WHERE o.status = 'pending'
		ORDER BY o.created_at DESC, o.rowid DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list pending price radar objections: %w", err)
	}
	objections := make([]Objection, 0)
	objectionIDs := make([]string, 0)
	for rows.Next() {
		var objection Objection
		var createdAt, resolvedAt sql.NullInt64
		if err := rows.Scan(
			&objection.ID,
			&objection.ReportID,
			&objection.Reason,
			&objection.Body,
			&objection.Status,
			&objection.Resolution,
			&createdAt,
			&resolvedAt,
			&objection.ReviewerID,
			&objection.User.ID,
			&objection.User.Username,
			&objection.User.DisplayName,
		); err != nil {
			return nil, fmt.Errorf("scan pending price radar objection: %w", err)
		}
		objection.CreatedAt = time.Unix(createdAt.Int64, 0).UTC()
		if resolvedAt.Valid {
			value := time.Unix(resolvedAt.Int64, 0).UTC()
			objection.ResolvedAt = &value
		}
		objections = append(objections, objection)
		objectionIDs = append(objectionIDs, objection.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate pending price radar objections: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close pending price radar objections: %w", err)
	}
	evidenceMap, err := s.objectionEvidence(ctx, objectionIDs)
	if err != nil {
		return nil, err
	}
	for index := range objections {
		objections[index].Images = evidenceMap[objections[index].ID]
	}
	return objections, nil
}

func (s *Store) DecideReport(ctx context.Context, reportID, action, reviewerID, note string) error {
	status := ReportStatusVerified
	switch action {
	case "reject":
		status = ReportStatusRejected
	case "offline":
		status = ReportStatusOffline
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE price_radar_reports
		SET status = ?, decision_note = ?, reviewer_id = ?, verified_at = ?
		WHERE id = ?
	`, status, note, reviewerID, time.Now().UTC().Unix(), reportID)
	if err != nil {
		return fmt.Errorf("update price radar report decision: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("price radar report decision rows: %w", err)
	}
	if affected == 0 {
		return ErrReportNotFound
	}
	return nil
}

func (s *Store) DecideObjection(ctx context.Context, objectionID, action, reviewerID, resolution string) error {
	status := ObjectionStatusResolved
	if action == "keep" {
		status = "resolved_keep"
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE price_radar_objections
		SET status = ?, resolution = ?, reviewer_id = ?, resolved_at = ?
		WHERE id = ?
	`, status, resolution, reviewerID, time.Now().UTC().Unix(), objectionID)
	if err != nil {
		return fmt.Errorf("update price radar objection decision: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("price radar objection decision rows: %w", err)
	}
	if affected == 0 {
		return ErrReportNotFound
	}
	return nil
}

func (s *Store) evidenceForReports(ctx context.Context, reportIDs []string) (map[string][]Evidence, error) {
	result := make(map[string][]Evidence, len(reportIDs))
	if len(reportIDs) == 0 {
		return result, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(reportIDs)), ",")
	args := make([]any, 0, len(reportIDs))
	for _, id := range reportIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, report_id, stored_name, content_type, size_bytes, visibility, sort_order
		FROM price_radar_evidence
		WHERE report_id IN (`+placeholders+`)
		ORDER BY report_id, sort_order
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("list price radar evidence: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var image Evidence
		if err := rows.Scan(
			&image.ID,
			&image.ReportID,
			&image.StoredName,
			&image.ContentType,
			&image.SizeBytes,
			&image.Visibility,
			&image.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan price radar evidence: %w", err)
		}
		result[image.ReportID] = append(result[image.ReportID], image)
	}
	return result, rows.Err()
}

func (s *Store) objectionEvidence(ctx context.Context, objectionIDs []string) (map[string][]Evidence, error) {
	result := make(map[string][]Evidence, len(objectionIDs))
	if len(objectionIDs) == 0 {
		return result, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(objectionIDs)), ",")
	args := make([]any, 0, len(objectionIDs))
	for _, id := range objectionIDs {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, objection_id, stored_name, content_type, size_bytes, visibility, sort_order
		FROM price_radar_objection_evidence
		WHERE objection_id IN (`+placeholders+`)
		ORDER BY objection_id, sort_order
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("list price radar objection evidence: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var image Evidence
		var objectionID string
		if err := rows.Scan(
			&image.ID,
			&objectionID,
			&image.StoredName,
			&image.ContentType,
			&image.SizeBytes,
			&image.Visibility,
			&image.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan price radar objection evidence: %w", err)
		}
		image.ReportID = objectionID
		result[objectionID] = append(result[objectionID], image)
	}
	return result, rows.Err()
}

func scanReport(scanner interface{ Scan(...any) error }) (Report, error) {
	var report Report
	var createdAt, verifiedAt sql.NullInt64
	err := scanner.Scan(
		&report.ID,
		&report.User.ID,
		&report.ProductID,
		&report.ProductName,
		&report.StoreName,
		&report.StoreType,
		&report.Address,
		&report.Price,
		&report.Unit,
		&report.PurchaseDate,
		&report.Latitude,
		&report.Longitude,
		&report.Status,
		&report.DecisionNote,
		&createdAt,
		&verifiedAt,
		&report.ReviewerID,
		&report.User.Username,
		&report.User.DisplayName,
	)
	if err != nil {
		return Report{}, err
	}
	report.CreatedAt = time.Unix(createdAt.Int64, 0).UTC()
	if verifiedAt.Valid {
		value := time.Unix(verifiedAt.Int64, 0).UTC()
		report.VerifiedAt = &value
	}
	return report, nil
}
