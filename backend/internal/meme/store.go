package meme

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type storedImage struct {
	Image      Image
	Src, Thumb string
}
type catalog struct {
	FirstSeen  map[string]string
	Version    string
	Source     Source
	Categories []Category
	Images     []storedImage
}
type Store struct {
	db      *sql.DB
	now     func() time.Time
	mu      sync.Mutex
	cacheMu sync.RWMutex
	cache   *catalog
}

func OpenStore(path string) (*Store, error) {
	if path == "" {
		return nil, ErrInvalid
	}
	if path != ":memory:" {
		if e := os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			return nil, e
		}
	}
	db, e := sql.Open("sqlite", path)
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: time.Now}
	_, e = db.Exec(`PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS meme_catalog(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS meme_admin(id TEXT PRIMARY KEY,hidden INTEGER NOT NULL DEFAULT 0,labels TEXT NOT NULL DEFAULT '');CREATE TABLE IF NOT EXISTS meme_favorites(user_id TEXT,image_id TEXT,created TEXT,PRIMARY KEY(user_id,image_id));CREATE TABLE IF NOT EXISTS meme_events(day TEXT,image_id TEXT,actor TEXT,type TEXT,event_id TEXT,score INTEGER,UNIQUE(day,image_id,actor,type),UNIQUE(actor,event_id));CREATE TABLE IF NOT EXISTS meme_snapshots(day TEXT PRIMARY KEY,data TEXT);CREATE TABLE IF NOT EXISTS meme_state(key TEXT PRIMARY KEY,value TEXT);`)
	if e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) load(ctx context.Context) (catalog, error) {
	s.cacheMu.Lock()
	cached := s.cache
	defer s.cacheMu.Unlock()
	if cached != nil {
		return *cached, nil
	}
	var c catalog
	var raw string
	e := s.db.QueryRowContext(ctx, `SELECT data FROM meme_catalog WHERE id=1`).Scan(&raw)
	if e == sql.ErrNoRows {
		return catalog{Images: []storedImage{}, Categories: []Category{}}, nil
	}
	if e != nil {
		return c, e
	}
	e = json.Unmarshal([]byte(raw), &c)
	if e == nil {
		s.cache = &c
	}
	return c, e
}
func (s *Store) Import(ctx context.Context, cats []SourceCategory, images []SourceImage) error {
	if len(cats) == 0 || len(images) == 0 {
		return ErrInvalid
	}
	c := catalog{Source: Source{"ChineseBQB", "https://zhaoolee.com/ChineseBQB/", s.now().UTC().Format(time.RFC3339)}, Categories: []Category{}, Images: []storedImage{}}
	old, e := s.load(ctx)
	if e != nil {
		return e
	}
	c.FirstSeen = map[string]string{}
	for id, date := range old.FirstSeen {
		c.FirstSeen[id] = date
	}
	titles := map[string]string{}
	for _, v := range cats {
		if v.Slug == "" || v.Title == "" || titles[v.Slug] != "" {
			return ErrInvalid
		}
		titles[v.Slug] = v.Title
	}
	byID := map[string]*storedImage{}
	counts := map[string]int{}
	rawCounts := map[string]int{}
	covers := map[string]string{}
	for _, v := range images {
		rawCounts[v.Category]++
		if !validPath(v.Src, "media/") || !validPath(v.Thumb, "thumbs/") || titles[v.Category] == "" || v.Width < 0 || v.Height < 0 || v.Bytes < 0 {
			return ErrInvalid
		}
		id := strings.TrimSuffix(filepath.Base(v.Src), filepath.Ext(v.Src))
		if len(id) != 64 {
			return ErrInvalid
		}
		if _, e := hex.DecodeString(id); e != nil {
			return ErrInvalid
		}
		im := byID[id]
		if im == nil {
			label := v.Label
			if label == "" {
				label = v.Name
			}
			im = &storedImage{Image: Image{ID: id, Title: label, Label: label, URL: "/api/v1/meme-media/" + id + "/original", ThumbnailURL: "/api/v1/meme-media/" + id + "/thumbnail", Width: v.Width, Height: v.Height, Bytes: v.Bytes, Animated: v.Animated, Format: strings.TrimPrefix(filepath.Ext(v.Src), "."), Categories: []CategoryRef{}}, Src: v.Src, Thumb: v.Thumb}
			byID[id] = im
		}
		if !strings.Contains(im.Image.Label, v.Label) {
			im.Image.Label += " " + v.Label
		}
		found := false
		for _, r := range im.Image.Categories {
			if r.ID == v.Category {
				found = true
			}
		}
		if !found {
			im.Image.Categories = append(im.Image.Categories, CategoryRef{v.Category, titles[v.Category]})
			counts[v.Category]++
			covers[v.Category] = im.Image.ThumbnailURL
		}
	}
	for _, v := range cats {
		if v.Count > 0 && rawCounts[v.Slug] != v.Count {
			return fmt.Errorf("incomplete category %s: %w", v.Slug, ErrInvalid)
		}
		c.Categories = append(c.Categories, Category{ID: v.Slug, Title: v.Title, OriginalTitle: v.Title, Count: counts[v.Slug], CoverURL: covers[v.Slug], Group: "原生分类"})
	}
	for _, v := range byID {
		if c.FirstSeen[v.Image.ID] == "" {
			c.FirstSeen[v.Image.ID] = s.now().UTC().Format(time.RFC3339Nano)
		}
		c.Images = append(c.Images, *v)
	}
	sort.Slice(c.Images, func(i, j int) bool { return c.Images[i].Image.ID < c.Images[j].Image.ID })
	digest, _ := json.Marshal(struct {
		C []Category
		I []storedImage
	}{c.Categories, c.Images})
	h := sha256.Sum256(digest)
	c.Version = hex.EncodeToString(h[:12])
	raw, _ := json.Marshal(c)
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var oldRaw string
	if e = tx.QueryRowContext(ctx, `SELECT data FROM meme_catalog WHERE id=1`).Scan(&oldRaw); e == nil {
		var old catalog
		json.Unmarshal([]byte(oldRaw), &old)
		if len(c.Images)*2 < len(old.Images) {
			return fmt.Errorf("suspicious truncated snapshot: %w", ErrInvalid)
		}
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO meme_catalog VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, string(raw)); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `INSERT OR IGNORE INTO meme_state VALUES('data_since',?)`, s.now().UTC().Format(time.RFC3339))
	if e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	s.cacheMu.Lock()
	s.cache = &c
	s.cacheMu.Unlock()
	return nil
}
func (s *Store) visible(ctx context.Context, user string) (catalog, []Image, error) {
	c, e := s.load(ctx)
	if e != nil {
		return c, nil, e
	}
	hidden := map[string]bool{}
	labels := map[string]string{}
	rows, e := s.db.QueryContext(ctx, `SELECT id,hidden,labels FROM meme_admin`)
	if e != nil {
		return c, nil, e
	}
	for rows.Next() {
		var id, l string
		var h bool
		rows.Scan(&id, &h, &l)
		hidden[id] = h
		labels[id] = l
	}
	rows.Close()
	favs := map[string]bool{}
	if user != "" {
		rows, e = s.db.QueryContext(ctx, `SELECT image_id FROM meme_favorites WHERE user_id=?`, user)
		if e != nil {
			return c, nil, e
		}
		for rows.Next() {
			var id string
			rows.Scan(&id)
			favs[id] = true
		}
		rows.Close()
	}
	out := []Image{}
	for _, v := range c.Images {
		if hidden[v.Image.ID] {
			continue
		}
		im := v.Image
		im.Src = v.Src
		im.Thumb = v.Thumb
		im.Label += " " + labels[im.ID]
		im.Label = strings.TrimSpace(im.Label)
		im.Favorite = favs[im.ID]
		out = append(out, im)
	}
	return c, out, nil
}
func (s *Store) List(ctx context.Context, q Query, user string) (Page, error) {
	c, all, e := s.visible(ctx, user)
	if q.Favorites {
		known := map[string]bool{}
		for _, im := range all {
			known[im.ID] = true
		}
		rows, err := s.db.QueryContext(ctx, `SELECT image_id FROM meme_favorites WHERE user_id=? ORDER BY image_id`, user)
		if err != nil {
			return Page{}, err
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return Page{}, err
			}
			if !known[id] {
				all = append(all, Image{ID: id, Title: "内容已下架", Label: "内容已下架", Categories: []CategoryRef{}, Favorite: true, Unavailable: true})
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return Page{}, err
		}
		sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	}
	versionHash := sha256.New()
	for _, im := range all {
		if !q.Favorites || im.Favorite {
			versionHash.Write([]byte(im.ID + ":" + im.Label + "\n"))
		}
	}
	version := c.Version + "-" + hex.EncodeToString(versionHash.Sum(nil)[:8])
	p := Page{Items: []Image{}, Source: c.Source, Version: version}
	if e != nil {
		return p, e
	}
	if q.Sort != "" && q.Sort != "default" && q.Sort != "newest" || q.Animated != "" && q.Animated != "true" && q.Animated != "false" {
		return p, ErrInvalid
	}
	start := 0
	finger := fmt.Sprintf("%s|%s|%s|%s|%t|%s", q.Q, q.Category, q.Animated, q.Sort, q.Favorites, user)
	hash := sha256.Sum256([]byte(finger))
	filter := hex.EncodeToString(hash[:8])
	if q.Cursor != "" {
		b, e := base64.RawURLEncoding.DecodeString(q.Cursor)
		parts := strings.Split(string(b), ":")
		if e != nil || len(parts) != 3 {
			return p, ErrInvalid
		}
		if parts[0] != version {
			return p, ErrStale
		}
		if parts[2] != filter {
			return p, ErrInvalid
		}
		start, e = strconv.Atoi(parts[1])
		if e != nil || start < 0 {
			return p, ErrInvalid
		}
	}
	for _, im := range all {
		if q.Favorites && !im.Favorite || q.Animated != "" && strconv.FormatBool(im.Animated) != q.Animated {
			continue
		}
		text := im.Label + " " + im.Title
		match := q.Category == ""
		for _, cat := range im.Categories {
			text += " " + cat.Title
			if cat.ID == q.Category {
				match = true
			}
		}
		if !match || !strings.Contains(strings.ToLower(text), strings.ToLower(strings.TrimSpace(q.Q))) {
			continue
		}
		p.Items = append(p.Items, im)
	}
	if q.Sort == "newest" {
		sort.Slice(p.Items, func(i, j int) bool {
			if c.FirstSeen[p.Items[i].ID] == c.FirstSeen[p.Items[j].ID] {
				return p.Items[i].ID < p.Items[j].ID
			}
			return c.FirstSeen[p.Items[i].ID] > c.FirstSeen[p.Items[j].ID]
		})
	}
	p.Total = len(p.Items)
	if start > p.Total {
		return p, ErrInvalid
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 36
	}
	if limit > 100 {
		limit = 100
	}
	end := start + limit
	if end > p.Total {
		end = p.Total
	}
	p.Items = p.Items[start:end]
	if end < p.Total {
		p.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%s:%d:%s", version, end, filter)))
	}
	return p, nil
}
func (s *Store) Categories(ctx context.Context, q, group string) ([]Category, Source, error) {
	c, all, e := s.visible(ctx, "")
	out := []Category{}
	counts := map[string]int{}
	covers := map[string]string{}
	for _, im := range all {
		for _, cat := range im.Categories {
			counts[cat.ID]++
			covers[cat.ID] = im.ThumbnailURL
		}
	}
	for _, cat := range c.Categories {
		cat.Count = counts[cat.ID]
		cat.CoverURL = covers[cat.ID]
		if strings.Contains(strings.ToLower(cat.Title), strings.ToLower(q)) && (group == "" || group == cat.Group) {
			out = append(out, cat)
		}
	}
	return out, c.Source, e
}
func (s *Store) Get(ctx context.Context, id, user string) (Image, []Image, error) {
	_, all, e := s.visible(ctx, user)
	if e != nil {
		return Image{}, nil, e
	}
	for _, im := range all {
		if im.ID == id {
			related := []Image{}
			for _, other := range all {
				if other.ID == id {
					continue
				}
				match := false
				for _, a := range im.Categories {
					for _, b := range other.Categories {
						if a.ID == b.ID {
							match = true
						}
					}
				}
				if match && len(related) < 12 {
					related = append(related, other)
				}
			}
			return im, related, nil
		}
	}
	return Image{}, nil, ErrNotFound
}
func (s *Store) AdminUpdate(ctx context.Context, id string, hidden bool, labels []string) error {
	c, e := s.load(ctx)
	if e != nil {
		return e
	}
	found := false
	for _, im := range c.Images {
		if im.Image.ID == id {
			found = true
		}
	}
	if !found {
		return ErrNotFound
	}
	if len(strings.Join(labels, " ")) > 2000 {
		return ErrInvalid
	}
	if labels == nil {
		_, e = s.db.ExecContext(ctx, `INSERT INTO meme_admin(id,hidden) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET hidden=excluded.hidden`, id, hidden)
	} else {
		_, e = s.db.ExecContext(ctx, `INSERT INTO meme_admin VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET hidden=excluded.hidden,labels=excluded.labels`, id, hidden, strings.Join(labels, " "))
	}
	return e
}

func (s *Store) AdminPatch(ctx context.Context, id string, hidden *bool, labels []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := false
	if hidden != nil {
		h = *hidden
	} else {
		if e := s.db.QueryRowContext(ctx, `SELECT hidden FROM meme_admin WHERE id=?`, id).Scan(&h); e != nil && e != sql.ErrNoRows {
			return e
		}
	}
	return s.AdminUpdate(ctx, id, h, labels)
}
