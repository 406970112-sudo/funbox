package meme

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const upstream = "https://zhaoolee.com/ChineseBQB/"

func validPath(p, prefix string) bool {
	u, e := url.Parse(p)
	if e != nil || u.IsAbs() || u.Host != "" || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(p, prefix) || strings.Contains(p, "..") || strings.ContainsAny(p, "\\%\x00") {
		return false
	}
	return filepath.Base(p) == strings.TrimPrefix(p, prefix)
}

type Service struct {
	Store         *Store
	Dir           string
	base          string
	client        *http.Client
	syncMu        sync.Mutex
	mirrorMu      sync.Mutex
	mediaLocks    sync.Map
	downloadSlots chan struct{}
	statusMu      sync.Mutex
	status        Status
}
type Status struct {
	Mirroring    bool   `json:"mirroring"`
	Running      bool   `json:"running"`
	LastAttempt  string `json:"lastAttempt"`
	LastSuccess  string `json:"lastSuccess"`
	Error        string `json:"error,omitempty"`
	Images       int    `json:"images"`
	UniqueImages int    `json:"uniqueImages"`
	Duplicates   int    `json:"duplicates"`
	Categories   int    `json:"categories"`
	Version      string `json:"version"`
	Mirrored     int    `json:"mirrored"`
	Failed       int    `json:"failed"`
}

func NewService(s *Store, dir string) *Service {
	if strings.TrimSpace(dir) == "" {
		dir = "./storage/memes"
	}
	svc := &Service{downloadSlots: make(chan struct{}, 6), Store: s, Dir: dir, base: upstream, client: &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return fmt.Errorf("redirect forbidden") }}}
	var raw string
	if s.db.QueryRow(`SELECT value FROM meme_state WHERE key='status'`).Scan(&raw) == nil {
		json.Unmarshal([]byte(raw), &svc.status)
		svc.status.Running = false
		svc.status.Mirroring = false
	}
	return svc
}
func (s *Service) fetch(ctx context.Context, p string, max int64) ([]byte, error) {
	if !(validPath(p, "media/") || validPath(p, "thumbs/") || p == "catalog/index.json" || p == "catalog/search.json") {
		return nil, ErrInvalid
	}
	req, e := http.NewRequestWithContext(ctx, "GET", s.base+p, nil)
	if e != nil {
		return nil, e
	}
	res, e := s.client.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("upstream status %d", res.StatusCode)
	}
	if res.ContentLength > max {
		return nil, fmt.Errorf("source too large")
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, max+1))
	if e != nil {
		return nil, e
	}
	if int64(len(b)) > max {
		return nil, fmt.Errorf("source too large")
	}
	return b, nil
}
func (s *Service) Media(ctx context.Context, id, kind string) (string, string, error) {
	if kind != "original" && kind != "thumbnail" {
		return "", "", ErrInvalid
	}
	im, _, e := s.Store.Get(ctx, id, "")
	if e != nil {
		return "", "", e
	}
	p := im.Src
	if kind == "thumbnail" {
		p = im.Thumb
	}
	file := filepath.Join(s.Dir, id+"-"+kind)
	lock, _ := s.mediaLocks.LoadOrStore(id+"-"+kind, &sync.Mutex{})
	mu := lock.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	if cached, err := os.Open(file); err == nil {
		var header [512]byte
		n, _ := cached.Read(header[:])
		cached.Close()
		mime := http.DetectContentType(header[:n])
		if imageMIME(mime) {
			return file, mime, nil
		}
		os.Remove(file)
	}
	select {
	case s.downloadSlots <- struct{}{}:
		defer func() { <-s.downloadSlots }()
	case <-ctx.Done():
		return "", "", ctx.Err()
	}
	b, e := s.fetch(ctx, p, 20<<20)
	if e != nil {
		return "", "", e
	}
	mime := http.DetectContentType(b)
	if !imageMIME(mime) {
		return "", "", fmt.Errorf("invalid media type")
	}
	cfg, _, e := image.DecodeConfig(bytes.NewReader(b))
	if e != nil {
		return "", "", fmt.Errorf("invalid image: %w", e)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > 40000000 {
		return "", "", fmt.Errorf("image dimensions exceed limit")
	}
	if _, _, e = image.Decode(bytes.NewReader(b)); e != nil {
		return "", "", fmt.Errorf("corrupt image: %w", e)
	}
	if kind == "original" {
		h := sha256.Sum256(b)
		if hex.EncodeToString(h[:]) != id {
			return "", "", fmt.Errorf("media content hash mismatch")
		}
	}
	if e = os.MkdirAll(s.Dir, 0755); e != nil {
		return "", "", e
	}
	tmp, e := os.CreateTemp(s.Dir, ".meme-")
	if e != nil {
		return "", "", e
	}
	defer os.Remove(tmp.Name())
	if _, e = tmp.Write(b); e != nil {
		tmp.Close()
		return "", "", e
	}
	if e = tmp.Close(); e != nil {
		return "", "", e
	}
	if e = os.Rename(tmp.Name(), file); e != nil {
		return "", "", e
	}
	return file, mime, nil
}
func imageMIME(m string) bool {
	return m == "image/png" || m == "image/jpeg" || m == "image/gif" || m == "image/webp"
}
