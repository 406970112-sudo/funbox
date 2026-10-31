package meme

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func fixture(n int) ([]SourceCategory, []SourceImage) {
	c := []SourceCategory{{Slug: "cats", Title: "猫"}, {Slug: "dogs", Title: "狗"}}
	a := []SourceImage{}
	for i := 0; i < n; i++ {
		a = append(a, SourceImage{Src: fmt.Sprintf("media/%064x.png", i+1), Thumb: fmt.Sprintf("thumbs/%064x.webp", i+1), Label: fmt.Sprintf("开心%d", i), Category: "cats", Width: 10, Height: 10})
	}
	return c, a
}
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestAtomicImportDedupSearchAndCursor(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	c, a := fixture(3)
	dup := a[0]
	dup.Category = "dogs"
	dup.Label = "快乐"
	a = append(a, dup)
	if e := s.Import(ctx, c, a); e != nil {
		t.Fatal(e)
	}
	p, e := s.List(ctx, Query{Q: "快乐"}, "")
	if e != nil || p.Total != 1 || len(p.Items[0].Categories) != 2 {
		t.Fatalf("dedup %+v %v", p, e)
	}
	p, _ = s.List(ctx, Query{Limit: 1}, "")
	if p.NextCursor == "" {
		t.Fatal("missing cursor")
	}
	if e := s.Import(ctx, c, nil); e == nil {
		t.Fatal("accepted empty snapshot")
	}
	after, _ := s.List(ctx, Query{}, "")
	if after.Total != 3 {
		t.Fatal(after.Total)
	}
	if _, e = s.List(ctx, Query{Cursor: "bad"}, ""); !errors.Is(e, ErrInvalid) {
		t.Fatalf("cursor %v", e)
	}
	a[0].Label = "changed"
	s.Import(ctx, c, a)
	if _, e = s.List(ctx, Query{Cursor: p.NextCursor}, ""); !errors.Is(e, ErrStale) {
		t.Fatalf("stale %v", e)
	}
}
func TestEventsFavoritesRankingAndHistory(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	c, a := fixture(10)
	s.Import(ctx, c, a)
	now := time.Date(2026, 10, 30, 16, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	p, _ := s.List(ctx, Query{}, "")
	id := p.Items[0].ID
	ok, e := s.Event(ctx, id, "view", "evt1", "anon")
	if !ok || e != nil {
		t.Fatal(ok, e)
	}
	ok, _ = s.Event(ctx, id, "view", "evt2", "anon")
	if ok {
		t.Fatal("duplicate actor scored")
	}
	s.Favorite(ctx, id, "user", true)
	s.Favorite(ctx, id, "user", false)
	s.Favorite(ctx, id, "user", true)
	r, _ := s.Rankings(ctx, "day", "")
	if r.Mode != "curated" || r.Items[0].Rank != 0 {
		t.Fatal(r)
	}
	for _, im := range p.Items {
		for j := 0; j < 3; j++ {
			s.Event(ctx, im.ID, "save", fmt.Sprintf("%s-%d", im.ID, j), fmt.Sprint(j))
		}
	}
	r, _ = s.Rankings(ctx, "day", "")
	if r.Mode != "ranking" || len(r.Items) != 10 || r.Items[0].Score != 19 {
		t.Fatalf("ranking %+v", r)
	}
	now = now.Add(25 * time.Hour)
	if e := s.Freeze(ctx); e != nil {
		t.Fatal(e)
	}
	r, _ = s.Rankings(ctx, "day", "2026-10-31")
	if !r.IsFinal || r.Mode != "ranking" {
		t.Fatal(r)
	}
	s.AdminUpdate(ctx, id, true, nil)
	r, _ = s.Rankings(ctx, "day", "2026-10-31")
	if len(r.Items) != 9 || r.Notice == "" {
		t.Fatal(r)
	}
}
func TestSourceCountsIncludeRepeatedResourcesWithinCategory(t *testing.T) {
	s := newTestStore(t)
	c, a := fixture(1)
	c = c[:1]
	c[0].Count = 2
	a = append(a, a[0])
	if e := s.Import(context.Background(), c, a); e != nil {
		t.Fatalf("upstream record count includes duplicate: %v", e)
	}
	p, _ := s.List(context.Background(), Query{}, "")
	if p.Total != 1 {
		t.Fatal(p.Total)
	}
}
func TestNewestUsesFirstImportAndLabelPatchPreservesHide(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	c, a := fixture(2)
	now := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	s.Import(ctx, c, a[1:])
	now = now.Add(time.Hour)
	s.Import(ctx, c, a)
	p, e := s.List(ctx, Query{Sort: "newest"}, "")
	if e != nil || p.Items[0].ID != fmt.Sprintf("%064x", 1) {
		t.Fatalf("newest: %+v %v", p, e)
	}
	id := p.Items[0].ID
	s.AdminUpdate(ctx, id, true, nil)
	if e = s.AdminPatch(ctx, id, nil, []string{"alias"}); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.Get(ctx, id, ""); e != ErrNotFound {
		t.Fatal("label patch unhid image", e)
	}
}
func TestFavoritesPaginationDetectsMutation(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	c, a := fixture(3)
	s.Import(ctx, c, a)
	p, _ := s.List(ctx, Query{}, "")
	for _, im := range p.Items {
		s.Favorite(ctx, im.ID, "u", true)
	}
	f, _ := s.List(ctx, Query{Favorites: true, Limit: 1}, "u")
	s.Favorite(ctx, p.Items[0].ID, "u", false)
	if _, e := s.List(ctx, Query{Favorites: true, Limit: 1, Cursor: f.NextCursor}, "u"); e != ErrStale {
		t.Fatalf("favorite collection changed silently: %v", e)
	}
}
func TestFavoritesRetainUnavailableItemsAndAllowRemoval(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	c, a := fixture(3)
	s.Import(ctx, c, a)
	p, _ := s.List(ctx, Query{}, "")
	for _, im := range p.Items {
		s.Favorite(ctx, im.ID, "u", true)
	}
	s.AdminUpdate(ctx, p.Items[1].ID, true, nil)
	if e := s.Import(ctx, c, a[1:]); e != nil {
		t.Fatal(e)
	}
	f, e := s.List(ctx, Query{Favorites: true}, "u")
	if e != nil || f.Total != 3 {
		t.Fatalf("lost unavailable favorites: %+v %v", f, e)
	}
	n := 0
	for _, im := range f.Items {
		if im.Unavailable {
			n++
			if im.URL != "" || im.ThumbnailURL != "" || im.Label != "内容已下架" {
				t.Fatal(im)
			}
			if e = s.Favorite(ctx, im.ID, "u", false); e != nil {
				t.Fatal(e)
			}
		}
	}
	if n != 2 {
		t.Fatal(n)
	}
	f, _ = s.List(ctx, Query{Favorites: true}, "u")
	if f.Total != 1 {
		t.Fatal(f.Total)
	}
}
