package news

import (
	"context"
	"errors"
	"sync"
	"time"

	"my-first-expo-app/backend/internal/config"
)

type Service struct {
	cfg          config.NewsConfig
	source       Source
	summarizer   Summarizer
	refreshMu    sync.Mutex
	mu           sync.RWMutex
	snapshot     *FeedSnapshot
	summaryCache map[string]Summary
	initialReady chan struct{}
	readyOnce    sync.Once
}

func NewService(cfg config.NewsConfig, source Source, summarizer Summarizer) *Service {
	if cfg.RefreshInterval <= 0 {
		cfg.RefreshInterval = 15 * time.Minute
	}
	if cfg.Lookback <= 0 {
		cfg.Lookback = 48 * time.Hour
	}
	if cfg.MaxEvents <= 0 {
		cfg.MaxEvents = 60
	}
	if cfg.SummaryLimit < 0 {
		cfg.SummaryLimit = 0
	}
	return &Service{
		cfg:          cfg,
		source:       source,
		summarizer:   summarizer,
		summaryCache: make(map[string]Summary),
		initialReady: make(chan struct{}),
	}
}

func (s *Service) Feed(ctx context.Context) (FeedSnapshot, error) {
	if snapshot, exists := s.currentSnapshot(); exists {
		return snapshot, nil
	}

	refreshResult := make(chan error, 1)
	go func() {
		refreshResult <- s.Refresh(ctx)
	}()

	select {
	case <-s.initialReady:
		if snapshot, exists := s.currentSnapshot(); exists {
			return snapshot, nil
		}
		return FeedSnapshot{}, ErrSourcesUnavailable
	case err := <-refreshResult:
		if err != nil {
			return FeedSnapshot{}, err
		}
		if snapshot, exists := s.currentSnapshot(); exists {
			return snapshot, nil
		}
		return FeedSnapshot{}, ErrSourcesUnavailable
	case <-ctx.Done():
		return FeedSnapshot{}, ctx.Err()
	}
}

func (s *Service) Refresh(ctx context.Context) error {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()

	if s.source == nil {
		return s.handleRefreshError(ErrSourcesUnavailable)
	}
	articles, err := s.source.Fetch(ctx)
	if err != nil {
		return s.handleRefreshError(err)
	}

	now := time.Now().UTC()
	cutoff := now.Add(-s.cfg.Lookback)
	recent := make([]Article, 0, len(articles))
	for _, article := range articles {
		if article.PublishedAt.IsZero() {
			article.PublishedAt = now
		}
		if article.PublishedAt.Before(cutoff) {
			continue
		}
		recent = append(recent, article)
	}
	events := BuildEvents(recent, now, s.cfg.MaxEvents)
	for index := range events {
		event := &events[index]
		if cached, exists := s.cachedSummary(event.ContentHash); exists {
			event.Summary = cached
			continue
		}
		event.Summary = ExtractiveSummary(*event)
	}

	s.publishSnapshot(FeedSnapshot{
		GeneratedAt: now,
		Stale:       false,
		DailyBrief:  buildDailyBrief(events),
		Events:      events,
	})

	for index := range events {
		event := &events[index]
		if event.Summary.Status == "generated" {
			continue
		}
		if index < s.cfg.SummaryLimit && s.summarizer != nil {
			summary, summarizeErr := s.summarizer.Summarize(ctx, *event)
			if summarizeErr == nil {
				event.Summary = summary
				s.storeSummary(event.ContentHash, summary)
				continue
			}
		}
	}

	s.publishSnapshot(FeedSnapshot{
		GeneratedAt: now,
		Stale:       false,
		DailyBrief:  buildDailyBrief(events),
		Events:      events,
	})
	return nil
}

func (s *Service) Run(ctx context.Context) {
	_ = s.Refresh(ctx)
	ticker := time.NewTicker(s.cfg.RefreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = s.Refresh(ctx)
		}
	}
}

func (s *Service) handleRefreshError(err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot != nil {
		s.snapshot.Stale = true
		return nil
	}
	if errors.Is(err, ErrSourcesUnavailable) {
		return ErrSourcesUnavailable
	}
	return errors.Join(ErrSourcesUnavailable, err)
}

func (s *Service) cachedSummary(contentHash string) (Summary, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	summary, exists := s.summaryCache[contentHash]
	return summary, exists
}

func (s *Service) storeSummary(contentHash string, summary Summary) {
	s.mu.Lock()
	s.summaryCache[contentHash] = summary
	s.mu.Unlock()
}

func (s *Service) currentSnapshot() (FeedSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.snapshot == nil {
		return FeedSnapshot{}, false
	}
	return cloneSnapshot(*s.snapshot), true
}

func (s *Service) publishSnapshot(snapshot FeedSnapshot) {
	copy := cloneSnapshot(snapshot)
	s.mu.Lock()
	s.snapshot = &copy
	s.readyOnce.Do(func() {
		close(s.initialReady)
	})
	s.mu.Unlock()
}

func buildDailyBrief(events []Event) DailyBrief {
	keyPoints := make([]string, 0, minInt(3, len(events)))
	for _, event := range events {
		if len(keyPoints) == 3 {
			break
		}
		if event.Summary.OneSentence != "" {
			keyPoints = append(keyPoints, event.Summary.OneSentence)
		}
	}
	return DailyBrief{
		Title:      "三分钟，了解今天真正重要的事",
		KeyPoints:  keyPoints,
		EventCount: len(events),
	}
}

func cloneSnapshot(snapshot FeedSnapshot) FeedSnapshot {
	clone := snapshot
	clone.DailyBrief.KeyPoints = append([]string(nil), snapshot.DailyBrief.KeyPoints...)
	clone.Events = append([]Event(nil), snapshot.Events...)
	for index := range clone.Events {
		event := &clone.Events[index]
		event.Sources = append([]SourceReference(nil), event.Sources...)
		event.Timeline = append([]TimelineItem(nil), event.Timeline...)
		event.Articles = append([]Article(nil), event.Articles...)
		event.Summary.KeyPoints = append([]KeyPoint(nil), event.Summary.KeyPoints...)
		for pointIndex := range event.Summary.KeyPoints {
			event.Summary.KeyPoints[pointIndex].SourceIDs = append([]string(nil), event.Summary.KeyPoints[pointIndex].SourceIDs...)
		}
	}
	return clone
}
