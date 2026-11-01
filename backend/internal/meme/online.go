package meme

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type OnlineSource struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
}
type OnlineSourceStatus struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}
type OnlinePage struct {
	Items   []Image              `json:"items"`
	Page    int                  `json:"page"`
	HasMore bool                 `json:"hasMore"`
	Sources []OnlineSourceStatus `json:"sources"`
	Cached  bool                 `json:"cached"`
	Notice  string               `json:"notice,omitempty"`
}
type onlineCandidate struct {
	URL, Title, PageURL, ThumbURL string
	Width, Height                 int
}
type onlineProvider struct {
	OnlineSource
	search func(context.Context, string, int, int) ([]onlineCandidate, bool, error)
}
type onlineEngine struct {
	mu          sync.Mutex
	providers   []onlineProvider
	sessions    map[string]*onlineSession
	slots       chan struct{}
	client      *http.Client
	mediaClient *http.Client
	cookie      string
}

var ErrOnlineBusy = errors.New("online search busy")

func newOnlineEngine() *onlineEngine {
	cookie := strings.TrimSpace(os.Getenv("MEME_DOUYIN_COOKIE"))
	mediaClient := newOnlineClient("")
	mediaClient.Timeout = 25 * time.Second
	en := &onlineEngine{mediaClient: mediaClient, sessions: map[string]*onlineSession{}, slots: make(chan struct{}, 4), client: newOnlineClient(cookie), cookie: cookie}
	allowed := os.Getenv("MEME_ONLINE_SOURCES")
	if allowed == "" {
		allowed = "doutula,pdan,sougou,douyin"
	}
	for _, s := range []OnlineSource{{ID: "doutula", Title: "斗图啦"}, {ID: "pdan", Title: "胖哒（皮蛋表情包）"}, {ID: "sougou", Title: "搜狗表情"}, {ID: "qudoutu", Title: "趣斗图"}, {ID: "doutub", Title: "表情包API"}, {ID: "douyin", Title: "抖音"}} {
		s.Enabled = strings.Contains(","+allowed+",", ","+s.ID+",") && os.Getenv("MEME_ONLINE_ENABLED") != "false"
		if !s.Enabled {
			s.Reason = "服务端未启用此来源"
		}
		if s.ID == "qudoutu" || s.ID == "doutub" {
			s.Enabled = false
			s.Reason = "来源接口暂不可用"
		}
		if s.ID == "douyin" && cookie == "" {
			s.Enabled = false
			s.Reason = "服务端未配置抖音 Cookie"
		}
		id := s.ID
		en.providers = append(en.providers, onlineProvider{OnlineSource: s, search: func(ctx context.Context, q string, page, limit int) ([]onlineCandidate, bool, error) {
			return en.searchProvider(ctx, id, q, page, limit)
		}})
	}
	return en
}
func (s *Service) OnlineSources() []OnlineSource {
	out := []OnlineSource{}
	for _, p := range s.online.providers {
		out = append(out, p.OnlineSource)
	}
	return out
}

type onlineSourceState struct {
	provider onlineProvider
	page     int
	more     bool
	queue    []Image
	status   OnlineSourceStatus
}
type onlineSession struct {
	mu     sync.Mutex
	until  time.Time
	pages  []OnlinePage
	states []onlineSourceState
	seen   map[string]bool
	next   int
}

func (s *Service) OnlineSearch(ctx context.Context, q string, ids []string, page, limit int, user string) (OnlinePage, error) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	empty := OnlinePage{Items: []Image{}, Sources: []OnlineSourceStatus{}, Page: page}
	q = strings.TrimSpace(q)
	if q == "" || !utf8.ValidString(q) || len([]rune(q)) > 80 || page < 1 || page > 50 || limit < 1 || limit > 60 || len(ids) > 6 {
		return empty, ErrInvalid
	}
	wanted := map[string]bool{}
	for _, id := range ids {
		if id == "" {
			return empty, ErrInvalid
		}
		wanted[id] = true
	}
	providers := []onlineProvider{}
	for _, p := range s.online.providers {
		if len(ids) == 0 || wanted[p.ID] {
			providers = append(providers, p)
			delete(wanted, p.ID)
		}
	}
	if len(wanted) > 0 {
		return empty, ErrInvalid
	}
	selected := []string{}
	for _, p := range providers {
		selected = append(selected, p.ID)
	}
	sort.Strings(selected)
	key := fmt.Sprintf("%s|%s|%d", q, strings.Join(selected, ","), limit)
	en := s.online
	en.mu.Lock()
	session := en.sessions[key]
	if session == nil || time.Now().After(session.until) {
		if len(en.sessions) >= 16 {
			for k, v := range en.sessions {
				if time.Now().After(v.until) {
					delete(en.sessions, k)
				}
			}
			if len(en.sessions) >= 16 {
				for k := range en.sessions {
					delete(en.sessions, k)
					break
				}
			}
		}
		session = &onlineSession{until: time.Now().Add(3 * time.Minute), seen: map[string]bool{}}
		for _, p := range providers {
			status := OnlineSourceStatus{ID: p.ID, Title: p.Title, Status: "empty"}
			if !p.Enabled {
				status.Status = "disabled"
				status.Message = p.Reason
			}
			session.states = append(session.states, onlineSourceState{provider: p, more: p.Enabled, status: status})
		}
		en.sessions[key] = session
	}
	en.mu.Unlock()
	session.mu.Lock()
	defer session.mu.Unlock()
	cached := page <= len(session.pages)
	for len(session.pages) < page {
		if e := ctx.Err(); e != nil {
			return empty, e
		}

		// Building a page consumes queues and advances upstream cursors. Keep a
		// logical snapshot until the whole page succeeds; persisted image rows
		// are idempotent and can safely outlive an interrupted page attempt.
		states := append([]onlineSourceState(nil), session.states...)
		for i := range states {
			states[i].queue = append([]Image(nil), states[i].queue...)
		}
		seen := make(map[string]bool, len(session.seen))
		for id, present := range session.seen {
			seen[id] = present
		}
		previousNext := session.next
		next, e := s.nextOnlinePage(ctx, session, q, limit)
		if e == nil {
			e = ctx.Err()
		}
		if e != nil {
			session.states, session.seen, session.next = states, seen, previousNext
			return empty, e
		}
		session.pages = append(session.pages, next)
		if !next.HasMore && len(session.pages) < page {
			empty.Notice = next.Notice
			empty.Sources = next.Sources
			return empty, nil
		}
	}
	out := session.pages[page-1]
	out.Cached = cached
	out.Items = s.filterOnline(ctx, out.Items, user)
	return out, nil
}
func (s *Service) nextOnlinePage(ctx context.Context, session *onlineSession, q string, limit int) (OnlinePage, error) {
	out := OnlinePage{Items: []Image{}, Sources: []OnlineSourceStatus{}, Page: len(session.pages) + 1, Notice: "联网结果按来源聚合，不代表热度排名；图片权利归原作者。"}
	for len(out.Items) < limit {
		if e := ctx.Err(); e != nil {
			return out, e
		}
		type result struct {
			items   []onlineCandidate
			more    bool
			err     error
			fetched bool
		}
		results := make([]result, len(session.states))
		var wg sync.WaitGroup
		for i := range session.states {
			st := &session.states[i]
			if len(st.queue) > 0 || !st.more {
				continue
			}
			if st.page >= 50 {
				st.more = false
				continue
			}
			st.page++
			wg.Add(1)
			go func(i int, p onlineProvider, page int) {
				defer wg.Done()
				results[i].fetched = true
				select {
				case s.online.slots <- struct{}{}:
					defer func() { <-s.online.slots }()
				default:
					results[i].err = ErrOnlineBusy
					return
				}
				c, cancel := context.WithTimeout(ctx, 8*time.Second)
				defer cancel()
				results[i].items, results[i].more, results[i].err = p.search(c, q, page, limit)
			}(i, st.provider, st.page)
		}
		wg.Wait()
		for i, r := range results {
			if !r.fetched {
				continue
			}
			st := &session.states[i]
			st.more = r.more
			st.status.Message = ""
			if r.err != nil {
				st.more = false
				st.status.Status = "error"
				st.status.Message = "来源暂不可用，请稍后重试"
				continue
			}
			st.status.Status = "ok"
			for n, c := range r.items {
				if n >= 120 {
					break
				}
				if validateOnlineURL(c.URL) != nil || !allowedMediaHost(st.provider.ID, c.URL) {
					continue
				}
				im, e := s.Store.registerOnline(ctx, st.provider.OnlineSource, c)
				if e != nil {
					return out, e
				}
				if !session.seen[im.ID] {
					st.queue = append(st.queue, im)
					session.seen[im.ID] = true
				}
			}
			if len(st.queue) == 0 {
				st.more = false
				st.status.Status = "empty"
				if len(r.items) > 0 {
					st.status.Status = "error"
					st.status.Message = "来源没有可用的新图片，请稍后重试"
				}
			}
		}
		added := false
		for n := 0; n < len(session.states) && len(out.Items) < limit; n++ {
			i := session.next % len(session.states)
			session.next = (i + 1) % len(session.states)
			st := &session.states[i]
			if len(st.queue) > 0 {
				out.Items = append(out.Items, st.queue[0])
				st.queue = st.queue[1:]
				added = true
			}
		}
		if !added {
			break
		}
	}
	for _, st := range session.states {
		out.Sources = append(out.Sources, st.status)
		out.HasMore = out.HasMore || len(st.queue) > 0 || st.more
		if st.status.Status == "error" {
			s.online.mu.Lock()
			session.until = time.Now().Add(10 * time.Second)
			s.online.mu.Unlock()
		}
	}
	if out.Page >= 50 {
		out.HasMore = false
		out.Notice += " 已达到本次搜索的分页上限，请细化关键词。"
	}
	return out, nil
}

func (s *Service) filterOnline(ctx context.Context, items []Image, user string) []Image {
	out := []Image{}
	for _, im := range items {
		if current, _, e := s.Store.Get(ctx, im.ID, user); e == nil {
			out = append(out, current)
		}
	}
	return out
}
func (s *Store) registerOnline(ctx context.Context, source OnlineSource, c onlineCandidate) (Image, error) {
	h := sha256.Sum256([]byte(source.ID + "\x00" + c.URL))
	id := "online-" + hex.EncodeToString(h[:])
	title := strings.TrimSpace(c.Title)
	r := []rune(title)
	if len(r) > 200 {
		title = string(r[:200])
	}
	if title == "" {
		title = source.Title
	}
	page := c.PageURL
	if validateOnlineURL(page) != nil {
		page = ""
	}
	format := ""
	low := strings.ToLower(strings.Split(c.URL, "?")[0])
	for _, f := range []string{"gif", "png", "jpg", "jpeg", "webp"} {
		if strings.HasSuffix(low, "."+f) {
			format = f
		}
	}
	im := Image{ID: id, Title: title, Label: title, URL: "/api/v1/meme-media/" + id + "/original", ThumbnailURL: "/api/v1/meme-media/" + id + "/thumbnail", Animated: format == "gif", Format: format, Categories: []CategoryRef{}, SourceID: source.ID, SourceName: source.Title, SourcePageURL: page}
	thumb := c.ThumbURL
	if validateOnlineURL(thumb) != nil || !allowedMediaHost(source.ID, thumb) {
		thumb = c.URL
	}
	raw, _ := json.Marshal(storedImage{Image: im, Src: c.URL, Thumb: thumb})
	_, e := s.db.ExecContext(ctx, `INSERT INTO meme_online(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, id, string(raw))
	return im, e
}
func (s *Store) getOnline(ctx context.Context, id, user string) (Image, error) {
	var raw string
	var hidden bool
	var labels string
	e := s.db.QueryRowContext(ctx, `SELECT o.data,COALESCE(a.hidden,0),COALESCE(a.labels,'') FROM meme_online o LEFT JOIN meme_admin a ON a.id=o.id WHERE o.id=?`, id).Scan(&raw, &hidden, &labels)
	if e != nil || hidden {
		return Image{}, ErrNotFound
	}
	var v storedImage
	if json.Unmarshal([]byte(raw), &v) != nil {
		return Image{}, ErrNotFound
	}
	im := v.Image
	im.Src = v.Src
	im.Thumb = v.Thumb
	im.Label = strings.TrimSpace(im.Label + " " + labels)
	if user != "" {
		var n int
		s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM meme_favorites WHERE user_id=? AND image_id=?`, user, id).Scan(&n)
		im.Favorite = n > 0
	}
	return im, nil
}

// Persistent image records are retained for favorites; downloaded bytes are evictable.
func (s *Service) pruneOnlineMedia(current string, maxFiles int, maxBytes int64) {
	s.onlineMediaMu.Lock()
	defer s.onlineMediaMu.Unlock()
	entries, e := os.ReadDir(s.Dir)
	if e != nil {
		return
	}
	type cached struct {
		name     string
		size     int64
		modified time.Time
	}
	files := []cached{}
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "online-") {
			continue
		}
		info, e := entry.Info()
		if e != nil {
			continue
		}
		files = append(files, cached{entry.Name(), info.Size(), info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool {
		if files[i].modified.Equal(files[j].modified) {
			return files[i].name < files[j].name
		}
		return files[i].modified.Before(files[j].modified)
	})
	count := len(files)
	for _, f := range files {
		if count <= maxFiles && total <= maxBytes {
			break
		}
		if f.name == current {
			continue
		}
		if os.Remove(filepath.Join(s.Dir, f.name)) == nil {
			count--
			total -= f.size
		}
	}
}
