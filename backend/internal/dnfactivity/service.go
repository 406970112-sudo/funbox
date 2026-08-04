package dnfactivity

import (
	"context"
	"log"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	sourceLabel = "地下城与勇士：起源 官方网站"
	sourceURL   = "https://mdnf.qq.com/zlkdatasys/web202405_data/events_data.json"
)

type ServiceConfig struct {
	SourceURL      string
	SyncInterval   time.Duration
	CacheTTL       time.Duration
	PageSize       int
	MaxFavorites   int
	DetailTimeout  time.Duration
}

type Service struct {
	cfg       ServiceConfig
	store     *Store
	provider  *Provider
	mu        sync.Mutex
	lastSync  time.Time
	attempted sync.Map
}

func NewService(cfg ServiceConfig, store *Store) *Service {
	if cfg.SyncInterval <= 0 {
		cfg.SyncInterval = 30 * time.Minute
	}
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 30 * time.Minute
	}
	if cfg.PageSize <= 0 {
		cfg.PageSize = 20
	}
	if cfg.MaxFavorites <= 0 {
		cfg.MaxFavorites = 30
	}
	if cfg.DetailTimeout <= 0 {
		cfg.DetailTimeout = 8 * time.Second
	}
	return &Service{
		cfg:      cfg,
		store:    store,
		provider: NewProvider(ProviderConfig(cfg)),
	}
}

func ProviderConfig(cfg ServiceConfig) Config {
	return Config{
		SourceURL:      cfg.SourceURL,
		RequestTimeout: 15 * time.Second,
		DetailTimeout:  cfg.DetailTimeout,
	}
}

func (s *Service) Run(ctx context.Context) {
	if err := s.Sync(ctx); err != nil {
		log.Printf("dnf activity initial sync failed: %v", err)
	}
	ticker := time.NewTicker(s.cfg.SyncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.Sync(ctx); err != nil {
				log.Printf("dnf activity sync failed: %v", err)
			}
		}
	}
}

func (s *Service) Sync(ctx context.Context) error {
	events, err := s.provider.FetchEvents(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	rows := make([]activityRow, 0, len(events))
	for _, event := range events {
		rows = append(rows, activityRow{
			ID:          sourceIDOf(event),
			SourceID:    sourceIDOf(event),
			Title:       strings.TrimSpace(event.Title),
			StartDate:   normalizeDate(event.StartDate),
			EndDate:     normalizeDate(event.EndDate),
			MobileURL:   normalizeURL(event.MobileURL),
			PCURL:       normalizeURL(event.PCURL),
			MobileImage: normalizeURL(event.MobileImage),
			PCImage:     normalizeURL(event.PCImage),
			FetchedAt:   now,
		})
	}
	if err := s.store.ReplaceActivities(ctx, rows); err != nil {
		return err
	}
	s.mu.Lock()
	s.lastSync = now
	s.mu.Unlock()
	return nil
}

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	rows, fetchedAt, stale, err := s.loadRows(ctx)
	if err != nil {
		return Overview{}, err
	}
	today := time.Now().Format("2006-01-02")
	activities := make([]Activity, 0, len(rows))
	overview := Overview{
		Source:    sourceLabel,
		SourceURL: s.cfg.SourceURL,
		FetchedAt: fetchedAt,
		Stale:     stale,
	}
	for _, row := range rows {
		activity := s.toActivity(row, today, stale)
		switch activity.Status {
		case StatusOngoing:
			overview.Ongoing++
		case StatusUpcoming:
			overview.Upcoming++
		case StatusEnded:
			overview.Ended++
		case StatusUnknown:
			overview.Unknown++
		}
		if activity.Status == StatusOngoing {
			overview.OngoingActivities = append(overview.OngoingActivities, activity)
		}
		activities = append(activities, activity)
	}
	overview.Total = len(activities)
	sort.Slice(overview.OngoingActivities, func(i, j int) bool {
		return overview.OngoingActivities[i].EndDate < overview.OngoingActivities[j].EndDate
	})
	endingSoon := append([]Activity(nil), overview.OngoingActivities...)
	if len(endingSoon) > 3 {
		endingSoon = endingSoon[:3]
	}
	overview.EndingSoon = endingSoon
	return overview, nil
}

func (s *Service) List(ctx context.Context, query ListQuery) (ActivityList, error) {
	rows, _, stale, err := s.loadRows(ctx)
	if err != nil {
		return ActivityList{}, err
	}
	today := time.Now().Format("2006-01-02")
	queryText := strings.ToLower(strings.TrimSpace(query.Query))
	status := strings.TrimSpace(query.Status)
	activities := make([]Activity, 0, len(rows))
	for _, row := range rows {
		activity := s.toActivity(row, today, stale)
		if status != "" && string(activity.Status) != status {
			continue
		}
		if queryText != "" && !strings.Contains(strings.ToLower(activity.Title), queryText) {
			continue
		}
		activities = append(activities, activity)
	}
	sortActivities(activities, query.Sort)
	total := len(activities)
	pageSize := query.PageSize
	if pageSize <= 0 {
		pageSize = s.cfg.PageSize
	}
	page := query.Page
	if page <= 0 {
		page = 1
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return ActivityList{
		Items:    activities[start:end],
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

func (s *Service) Get(ctx context.Context, id string) (Activity, error) {
	row, err := s.store.GetActivity(ctx, id)
	if err != nil {
		return Activity{}, err
	}
	if row.Description == "" && (row.MobileURL != "" || row.PCURL != "") {
		if _, loaded := s.attempted.LoadOrStore(id, true); !loaded {
			pageURL := row.MobileURL
			if pageURL == "" {
				pageURL = row.PCURL
			}
			ctx, cancel := context.WithTimeout(ctx, s.cfg.DetailTimeout)
			description, fetchErr := s.provider.FetchDescription(ctx, pageURL)
			cancel()
			if fetchErr == nil && description != "" {
				_ = s.store.UpdateDescription(ctx, id, description)
				row.Description = description
			}
		}
	}
	today := time.Now().Format("2006-01-02")
	_, _, stale, err := s.loadRows(ctx)
	if err != nil {
		return Activity{}, err
	}
	return s.toActivity(row, today, stale), nil
}

func (s *Service) Calendar(ctx context.Context, year int, month int) (CalendarMonth, error) {
	rows, _, _, err := s.loadRows(ctx)
	if err != nil {
		return CalendarMonth{}, err
	}
	if year <= 0 {
		year = time.Now().Year()
	}
	if month < 1 || month > 12 {
		return CalendarMonth{}, ErrInvalidInput
	}
	first := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.Local)
	daysInMonth := first.AddDate(0, 1, -1).Day()
	result := CalendarMonth{Year: year, Month: month}
	for day := 1; day <= daysInMonth; day++ {
		date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.Local).Format("2006-01-02")
		calendarDay := CalendarDay{Date: date, ActivityIDs: make([]string, 0)}
		for _, row := range rows {
			if row.StartDate == "" || row.EndDate == "" {
				continue
			}
			if row.StartDate <= date && date <= row.EndDate {
				calendarDay.ActivityIDs = append(calendarDay.ActivityIDs, row.ID)
			}
		}
		result.Days = append(result.Days, calendarDay)
	}
	return result, nil
}

func (s *Service) Share(ctx context.Context, id string) (ShareInfo, error) {
	row, err := s.store.GetActivity(ctx, id)
	if err != nil {
		return ShareInfo{}, err
	}
	activityURL := row.MobileURL
	if activityURL == "" {
		activityURL = row.PCURL
	}
	imageURL := row.MobileImage
	if imageURL == "" {
		imageURL = row.PCImage
	}
	text := buildShareText(row.Title, row.StartDate, row.EndDate)
	return ShareInfo{
		ActivityID: row.ID,
		Title:      row.Title,
		URL:        activityURL,
		StartDate:  row.StartDate,
		EndDate:    row.EndDate,
		ImageURL:   imageURL,
		Text:       text,
	}, nil
}

func (s *Service) AddFavorite(ctx context.Context, userID string, activityID string) error {
	count, err := s.store.CountFavorites(ctx, userID)
	if err != nil {
		return err
	}
	if count >= s.cfg.MaxFavorites {
		return ErrFavoriteLimit
	}
	if _, err := s.store.GetActivity(ctx, activityID); err != nil {
		return err
	}
	return s.store.AddFavorite(ctx, userID, activityID)
}

func (s *Service) RemoveFavorite(ctx context.Context, userID string, activityID string) error {
	return s.store.RemoveFavorite(ctx, userID, activityID)
}

func (s *Service) ListFavorites(ctx context.Context, userID string) ([]Favorite, error) {
	ids, err := s.store.ListFavoriteIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	result := make([]Favorite, 0, len(ids))
	for _, id := range ids {
		row, err := s.store.GetActivity(ctx, id)
		if err != nil {
			continue
		}
		result = append(result, Favorite{
			ActivityID: row.ID,
			Title:      row.Title,
			StartDate:  row.StartDate,
			EndDate:    row.EndDate,
			ImageURL:   row.MobileImage,
			CreatedAt:  row.FetchedAt,
		})
	}
	return result, nil
}

func (s *Service) loadRows(ctx context.Context) ([]activityRow, time.Time, bool, error) {
	s.mu.Lock()
	lastSync := s.lastSync
	s.mu.Unlock()
	if lastSync.IsZero() {
		if err := s.Sync(ctx); err != nil {
			// 同步失败时仍读取上次成功落库数据，标记 stale。
			rows, listErr := s.store.ListActivities(ctx)
			if listErr != nil || len(rows) == 0 {
				return nil, time.Time{}, false, err
			}
			return rows, maxFetchedAt(rows), true, nil
		}
		lastSync = s.lastSync
	}
	rows, err := s.store.ListActivities(ctx)
	if err != nil {
		return nil, time.Time{}, false, err
	}
	if len(rows) == 0 {
		return nil, time.Time{}, false, ErrSourceUnavailable
	}
	stale := time.Since(lastSync) > s.cfg.CacheTTL
	return rows, maxFetchedAt(rows), stale, nil
}

func (s *Service) toActivity(row activityRow, today string, stale bool) Activity {
	activity := Activity{
		ID:          row.ID,
		SourceID:    row.SourceID,
		Title:       row.Title,
		StartDate:   row.StartDate,
		EndDate:     row.EndDate,
		MobileURL:   row.MobileURL,
		PCURL:       row.PCURL,
		MobileImage: row.MobileImage,
		PCImage:     row.PCImage,
		Description: row.Description,
		FetchedAt:   row.FetchedAt,
		Stale:       stale,
	}
	activity.Status, activity.DaysLeft = activityStatus(row.StartDate, row.EndDate, today)
	return activity
}

func activityStatus(startDate string, endDate string, today string) (ActivityStatus, int) {
	if startDate == "" || endDate == "" {
		return StatusUnknown, 0
	}
	if startDate > endDate {
		return StatusUnknown, 0
	}
	if today < startDate {
		return StatusUpcoming, 0
	}
	if today > endDate {
		return StatusEnded, 0
	}
	daysLeft := daysBetween(today, endDate)
	return StatusOngoing, daysLeft
}

func daysBetween(from string, to string) int {
	fromTime, errFrom := time.Parse("2006-01-02", from)
	toTime, errTo := time.Parse("2006-01-02", to)
	if errFrom != nil || errTo != nil {
		return 0
	}
	return int(toTime.Sub(fromTime).Hours() / 24)
}

func sortActivities(items []Activity, sortKey string) {
	switch strings.TrimSpace(sortKey) {
	case "start":
		sort.SliceStable(items, func(i, j int) bool {
			left, right := items[i], items[j]
			if left.StartDate != right.StartDate {
				return left.StartDate < right.StartDate
			}
			return left.EndDate < right.EndDate
		})
	case "fetched":
		sort.SliceStable(items, func(i, j int) bool {
			return items[i].FetchedAt.After(items[j].FetchedAt)
		})
	default:
		sort.SliceStable(items, func(i, j int) bool {
			left, right := items[i], items[j]
			if left.Status != right.Status {
				return statusOrder(left.Status) < statusOrder(right.Status)
			}
			if left.EndDate != right.EndDate {
				return left.EndDate < right.EndDate
			}
			return left.FetchedAt.After(right.FetchedAt)
		})
	}
}

func statusOrder(status ActivityStatus) int {
	switch status {
	case StatusOngoing:
		return 0
	case StatusUpcoming:
		return 1
	case StatusEnded:
		return 2
	default:
		return 3
	}
}

func normalizeDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 10 {
		value = value[:10]
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}

func maxFetchedAt(rows []activityRow) time.Time {
	var result time.Time
	for _, row := range rows {
		if row.FetchedAt.After(result) {
			result = row.FetchedAt
		}
	}
	return result
}

func buildShareText(title string, startDate string, endDate string) string {
	var period string
	switch {
	case startDate != "" && endDate != "":
		period = startDate + " ~ " + endDate
	case startDate != "":
		period = startDate + " 起"
	case endDate != "":
		period = endDate + " 前"
	}
	if period != "" {
		return title + " · " + period + " · 地下城与勇士：起源 官方活动"
	}
	return title + " · 地下城与勇士：起源 官方活动"
}
