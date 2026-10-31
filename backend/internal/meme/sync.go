package meme

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

func (s *Service) Status() Status { s.statusMu.Lock(); defer s.statusMu.Unlock(); return s.status }
func (s *Service) Sync(ctx context.Context) (err error) {
	if !s.syncMu.TryLock() {
		return fmt.Errorf("sync already running")
	}
	defer s.syncMu.Unlock()
	s.statusMu.Lock()
	s.status.Running = true
	s.status.LastAttempt = time.Now().UTC().Format(time.RFC3339)
	s.status.Error = ""
	s.statusMu.Unlock()
	defer func() {
		s.statusMu.Lock()
		defer s.statusMu.Unlock()
		defer s.persistStatus()
		s.status.Running = false
		if err != nil {
			s.status.Error = err.Error()
		} else {
			s.status.LastSuccess = time.Now().UTC().Format(time.RFC3339)
		}
	}()
	index, e := s.fetch(ctx, "catalog/index.json", 8<<20)
	if e != nil {
		return e
	}
	search, e := s.fetch(ctx, "catalog/search.json", 16<<20)
	if e != nil {
		return e
	}
	var envelope struct {
		Categories []SourceCategory `json:"categories"`
	}
	var images []SourceImage
	if e = json.Unmarshal(index, &envelope); e != nil {
		return fmt.Errorf("invalid category index: %w", e)
	}
	if e = json.Unmarshal(search, &images); e != nil {
		return fmt.Errorf("invalid image index: %w", e)
	}
	if e = s.Store.Import(ctx, envelope.Categories, images); e != nil {
		return e
	}
	s.statusMu.Lock()
	s.status.Images = len(images)
	catalog, _ := s.Store.load(ctx)
	s.status.UniqueImages = len(catalog.Images)
	s.status.Duplicates = len(images) - len(catalog.Images)
	s.status.Categories = len(catalog.Categories)
	s.status.Version = catalog.Version
	s.statusMu.Unlock()
	return nil
}
func (s *Service) persistStatus() {
	b, _ := json.Marshal(s.status)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	s.Store.db.ExecContext(ctx, `INSERT INTO meme_state VALUES('status',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(b))
}
func (s *Service) Mirror(ctx context.Context) {
	if !s.mirrorMu.TryLock() {
		return
	}
	defer s.mirrorMu.Unlock()
	s.statusMu.Lock()
	s.status.Mirroring = true
	s.status.Mirrored = 0
	s.status.Failed = 0
	s.statusMu.Unlock()
	defer func() { s.statusMu.Lock(); defer s.statusMu.Unlock(); s.status.Mirroring = false; s.persistStatus() }()
	jobs := make(chan Image)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for im := range jobs {
				for _, kind := range []string{"thumbnail", "original"} {
					if ctx.Err() != nil {
						return
					}
					_, _, e := s.Media(ctx, im.ID, kind)
					s.statusMu.Lock()
					if e != nil {
						s.status.Failed++
					} else {
						s.status.Mirrored++
					}
					s.statusMu.Unlock()
				}
			}
		}()
	}
	defer wg.Wait()
	defer close(jobs)
	p, e := s.Store.List(ctx, Query{Limit: 100}, "")
	for e == nil {
		for _, im := range p.Items {
			select {
			case jobs <- im:
			case <-ctx.Done():
				return
			}
		}
		if p.NextCursor == "" {
			return
		}
		p, e = s.Store.List(ctx, Query{Limit: 100, Cursor: p.NextCursor}, "")
		if errors.Is(e, ErrStale) {
			p, e = s.Store.List(ctx, Query{Limit: 100}, "")
		}
	}
}
func syncSlot(now time.Time) string {
	local := now.In(zone)
	if local.Hour() < 4 {
		local = local.AddDate(0, 0, -1)
	}
	return local.Format("2006-01-02")
}

// Run catches up missed finalizations independently of the background media mirror.
func (s *Service) Run(ctx context.Context) {
	var mirrors sync.WaitGroup
	defer mirrors.Wait()
	mirror := func() { mirrors.Add(1); go func() { defer mirrors.Done(); s.Mirror(ctx) }() }
	tick := func() {
		if e := s.Store.Freeze(ctx); e != nil {
			log.Printf("meme freeze: %v", e)
		}
		slot := syncSlot(s.Store.now())
		var synced string
		s.Store.db.QueryRowContext(ctx, `SELECT value FROM meme_state WHERE key='sync_slot'`).Scan(&synced)
		if synced != slot {
			if e := s.Sync(ctx); e != nil {
				log.Printf("meme sync: %v", e)
				return
			}
			s.Store.db.ExecContext(ctx, `INSERT INTO meme_state VALUES('sync_slot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, slot)
			mirror()
		}
	}
	tick()
	mirror()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tick()
		}
	}
}
