package meme

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestOnlineURLGuard(t *testing.T) {
	for _, raw := range []string{"http://example.com/a.png", "https://127.0.0.1/a", "https://[::1]/a", "https://169.254.169.254/a", "https://user:pass@example.com/a", "https://example.com:8080/a", "https://localhost/a"} {
		if validateOnlineURL(raw) == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "::1", "fc00::1", "fe80::1", "fec0::1", "fec0::abcd:1", "64:ff9b:1::10.0.0.1", "::ffff:127.0.0.1", "100.100.100.200", "2001:db8::1"} {
		if publicIP(net.ParseIP(ip)) {
			t.Errorf("public %s", ip)
		}
	}
}
func TestOnlinePartialCacheAndPersistence(t *testing.T) {
	ctx := context.Background()
	st, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	svc := NewService(st, t.TempDir())
	calls := 0
	svc.online.providers = []onlineProvider{
		{OnlineSource: OnlineSource{ID: "doutula", Title: "斗图啦", Enabled: true}, search: func(context.Context, string, int, int) ([]onlineCandidate, bool, error) {
			calls++
			return []onlineCandidate{{URL: "https://img.doutupk.com/test.gif", Title: "猫", PageURL: "https://www.doutupk.com/search"}}, false, nil
		}},
		{OnlineSource: OnlineSource{ID: "pdan", Title: "胖哒", Enabled: true}, search: func(context.Context, string, int, int) ([]onlineCandidate, bool, error) {
			return nil, false, errors.New("secret upstream error")
		}},
	}
	p, e := svc.OnlineSearch(ctx, "猫", nil, 1, 36, "u")
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Items) != 1 || p.Sources[1].Status != "error" || strings.Contains(p.Sources[1].Message, "secret") {
		t.Fatalf("partial: %+v", p)
	}
	id := p.Items[0].ID
	if e = st.Favorite(ctx, id, "u", true); e != nil {
		t.Fatal(e)
	}
	p, e = svc.OnlineSearch(ctx, "猫", nil, 1, 36, "u")
	if e != nil || !p.Cached || calls != 1 || !p.Items[0].Favorite {
		t.Fatalf("cache %+v %v", p, e)
	}
	local, e := st.List(ctx, Query{}, "u")
	if e != nil || local.Total != 0 {
		t.Fatalf("catalog polluted %+v %v", local, e)
	}
	fav, e := st.List(ctx, Query{Favorites: true}, "u")
	if e != nil || len(fav.Items) != 1 || fav.Items[0].Unavailable {
		t.Fatalf("favorite %+v %v", fav, e)
	}
	if _, _, e = st.Get(ctx, id, "u"); e != nil {
		t.Fatal(e)
	}
	if _, e = st.Event(ctx, id, "view", "e", "a"); e != nil {
		t.Fatal(e)
	}
	if e = st.AdminUpdate(ctx, id, true, nil); e != nil {
		t.Fatal(e)
	}
	if _, _, e = st.Get(ctx, id, ""); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	p, e = svc.OnlineSearch(ctx, "猫", nil, 1, 36, "")
	if e != nil || len(p.Items) != 0 {
		t.Fatalf("hidden cached item %+v %v", p, e)
	}
}
func TestOnlineParserAndPagination(t *testing.T) {
	b := []byte(`<html><a class="col-xs-6 col-md-2" href="/photo/1"><img class="image_dtb" data-original="http://img.doutupk.com/a.gif"><p>猫猫</p></a><a href="/search?keyword=x&amp;page=2" rel="next">下一页</a></html>`)
	items, more, e := parseOnlineHTML("doutula", b, "https://www.doutupk.com/search", 1)
	if e != nil || len(items) != 1 || !more || items[0].URL != "https://img.doutupk.com/a.gif" || items[0].Title != "猫猫" {
		t.Fatalf("%+v %v %v", items, more, e)
	}
	_, _, e = parseOnlineHTML("doutula", []byte(`<html>captcha</html>`), "https://www.doutupk.com/search", 1)
	if e == nil {
		t.Fatal("unrecognized source page reported empty")
	}
}

func TestOnlineLiveProviders(t *testing.T) {
	if os.Getenv("MEME_TEST_LIVE") != "1" {
		t.Skip("set MEME_TEST_LIVE=1 for provider integration probe")
	}
	st, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	svc := NewService(st, t.TempDir())
	for _, id := range []string{"doutula", "pdan", "sougou"} {
		p, e := svc.OnlineSearch(context.Background(), "猫", []string{id}, 1, 3, "")
		if e != nil {
			t.Fatal(e)
		}
		t.Logf("%s items=%d more=%t statuses=%+v", id, len(p.Items), p.HasMore, p.Sources)
		if len(p.Items) > 0 {
			file, mime, e := svc.Media(context.Background(), p.Items[0].ID, "original")
			if e != nil {
				t.Errorf("%s actual media: %v", id, e)
			} else {
				info, _ := os.Stat(file)
				t.Logf("%s verified %s bytes=%d", id, mime, info.Size())
			}
			second, e := svc.OnlineSearch(context.Background(), "猫", []string{id}, 2, 3, "")
			if e != nil {
				t.Fatal(e)
			}
			if len(second.Items) > 0 && second.Items[0].ID == p.Items[0].ID {
				t.Errorf("%s replayed first page", id)
			}
			t.Logf("%s page2 items=%d more=%t status=%+v", id, len(second.Items), second.HasMore, second.Sources)
		}
	}
}

type onlineRoundTrip func(*http.Request) (*http.Response, error)

func (f onlineRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestOnlineFetchBoundsAndRedirectCookie(t *testing.T) {
	ctx := context.Background()
	client := newOnlineClient("server-secret")
	hops := 0
	client.Transport = onlineRoundTrip(func(r *http.Request) (*http.Response, error) {
		hops++
		if hops == 1 {
			if r.Header.Get("Cookie") != "server-secret" {
				t.Fatal("missing source cookie")
			}
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://example.com/image"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
		}
		if r.Header.Get("Cookie") != "" {
			t.Fatal("cookie leaked")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("12345")), Request: r}, nil
	})
	if _, e := onlineFetch(ctx, client, "https://www.douyin.com/start", "server-secret", 4); e == nil {
		t.Fatal("unbounded response accepted")
	}
	client.Transport = onlineRoundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://127.0.0.1/metadata"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	if _, e := onlineFetch(ctx, client, "https://example.com/image", "", 100); e == nil {
		t.Fatal("private redirect accepted")
	}
}
func TestOnlineMediaAndImportIsolation(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "meme.db")
	st, e := OpenStore(path)
	if e != nil {
		t.Fatal(e)
	}
	svc := NewService(st, t.TempDir())
	im, e := st.registerOnline(ctx, OnlineSource{ID: "doutula", Title: "斗图啦"}, onlineCandidate{URL: "https://img.doutupk.com/cat.png", Title: "猫"})
	if e != nil {
		t.Fatal(e)
	}
	cats, images := fixture(10)
	if e = st.Import(ctx, cats, images); e != nil {
		t.Fatal(e)
	}
	if e = st.Favorite(ctx, im.ID, "u", true); e != nil {
		t.Fatal(e)
	}
	if e = st.Import(ctx, cats, images); e != nil {
		t.Fatal(e)
	}
	local, _ := st.List(ctx, Query{}, "")
	if local.Total != 10 {
		t.Fatal("online polluted catalog")
	}
	st.Close()
	st, e = OpenStore(path)
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	svc.Store = st
	if got, _, e := st.Get(ctx, im.ID, "u"); e != nil || !got.Favorite {
		t.Fatalf("persistence %+v %v", got, e)
	}
	body := []byte("<html>access denied</html>")
	svc.online.mediaClient.Transport = onlineRoundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Request: r}, nil
	})
	if _, _, e = svc.Media(ctx, im.ID, "original"); e == nil {
		t.Fatal("HTML accepted as image")
	}
	var buf bytes.Buffer
	png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 2, 3)))
	body = buf.Bytes()
	file, mime, e := svc.Media(ctx, im.ID, "original")
	if e != nil || mime != "image/png" {
		t.Fatalf("media %s %v", mime, e)
	}
	if _, e = os.Stat(file); e != nil {
		t.Fatal(e)
	}
	if e = st.AdminUpdate(ctx, im.ID, true, nil); e != nil {
		t.Fatal(e)
	}
	if _, _, e = svc.Media(ctx, im.ID, "original"); !errors.Is(e, ErrNotFound) {
		t.Fatalf("hidden cached media served %v", e)
	}
}
func TestOnlineNoReplayAndBlockedJSON(t *testing.T) {
	for _, b := range []string{`{"status":1,"data":null}`, `{"status":0,"data":{}}`, `{}`} {
		if _, _, e := parseOnlineJSON("sougou", []byte(b), ""); e == nil {
			t.Fatalf("accepted %s", b)
		}
	}
	items, _, e := parseOnlineHTML("pdan", []byte(`<a class="imageLink image loading" href="https://pdan.com.cn/13604.html"><img src="https://pinoss.com/pdan123/i/pdan1/2026/10/H2.gif?imageMogr2/thumbnail/200x" alt="猫"></a>`), "https://pdan.com.cn/?s=cat", 1)
	if e != nil || len(items) != 1 || items[0].PageURL != "https://pdan.com.cn/13604.html" {
		t.Fatalf("current pdan %+v %v", items, e)
	}
}

func TestOnlineMediaCacheBound(t *testing.T) {
	dir := t.TempDir()
	svc := &Service{Dir: dir}
	for i := 0; i < 5; i++ {
		if e := os.WriteFile(filepath.Join(dir, fmt.Sprintf("online-%d-original", i)), []byte("1234"), 0600); e != nil {
			t.Fatal(e)
		}
	}
	if e := os.WriteFile(filepath.Join(dir, "catalog-original"), []byte("keep"), 0600); e != nil {
		t.Fatal(e)
	}
	svc.pruneOnlineMedia("online-4-original", 2, 8)
	entries, _ := os.ReadDir(dir)
	count := 0
	for _, v := range entries {
		if strings.HasPrefix(v.Name(), "online-") {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("cache entries %d", count)
	}
	if _, e := os.Stat(filepath.Join(dir, "online-4-original")); e != nil {
		t.Fatal("removed current media", e)
	}
	if _, e := os.Stat(filepath.Join(dir, "catalog-original")); e != nil {
		t.Fatal("removed catalog", e)
	}
}

func TestOnlineAggregatePaginationRetainsSourceRemainder(t *testing.T) {
	st, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	svc := NewService(st, t.TempDir())
	calls := map[string]int{}
	var mu sync.Mutex
	svc.online.providers = nil
	for _, id := range []string{"doutula", "pdan"} {
		id := id
		host := "img.doutupk.com"
		if id == "pdan" {
			host = "pinoss.com"
		}
		svc.online.providers = append(svc.online.providers, onlineProvider{OnlineSource: OnlineSource{ID: id, Title: id, Enabled: true}, search: func(_ context.Context, _ string, page, limit int) ([]onlineCandidate, bool, error) {
			mu.Lock()
			calls[id]++
			mu.Unlock()
			out := []onlineCandidate{}
			for n := 0; n < 4; n++ {
				out = append(out, onlineCandidate{URL: fmt.Sprintf("https://%s/%d-%d.png", host, page, n), Title: fmt.Sprint(page, n)})
			}
			return out, page < 2, nil
		}})
	}
	seen := map[string]bool{}
	for page := 1; page <= 4; page++ {
		p, e := svc.OnlineSearch(context.Background(), "猫", nil, page, 4, "")
		if e != nil || len(p.Items) != 4 || p.HasMore != (page < 4) {
			t.Fatalf("page %d %+v %v", page, p, e)
		}
		for _, im := range p.Items {
			if seen[im.ID] {
				t.Fatalf("repeated image on page%d", page)
			}
			seen[im.ID] = true
		}
	}
	if len(seen) != 16 || calls["doutula"] != 2 || calls["pdan"] != 2 {
		t.Fatalf("lost or refetched %d %+v", len(seen), calls)
	}
	p, e := svc.OnlineSearch(context.Background(), "猫", nil, 1, 4, "")
	if e != nil || !p.Cached || len(p.Items) != 4 {
		t.Fatalf("previous page %+v %v", p, e)
	}
}

func TestPdanRegistersOriginalAndThumbnail(t *testing.T) {
	raw := "https://pinoss.com/pdan123/cat.gif?imageMogr2/thumbnail/200x"
	items, _, e := parseOnlineHTML("pdan", []byte(`<a class="imageLink"><img src="`+raw+`" alt="猫"></a>`), "https://pdan.com.cn/?s=cat", 1)
	if e != nil || len(items) != 1 {
		t.Fatal(items, e)
	}
	if items[0].URL != "https://pinoss.com/pdan123/cat.gif" || items[0].ThumbURL != raw {
		t.Fatalf("original/thumbnail %+v", items[0])
	}
	st, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	im, e := st.registerOnline(context.Background(), OnlineSource{ID: "pdan", Title: "胖哒"}, items[0])
	if e != nil {
		t.Fatal(e)
	}
	im, _, e = st.Get(context.Background(), im.ID, "")
	if e != nil || im.Src == im.Thumb || im.Thumb != raw {
		t.Fatal(im, e)
	}
}

func TestOnlineConcurrentSessionsAndBounds(t *testing.T) {
	st, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	svc := NewService(st, t.TempDir())
	calls := 0
	var callsMu sync.Mutex
	svc.online.providers = []onlineProvider{{OnlineSource: OnlineSource{ID: "doutula", Title: "斗图啦", Enabled: true}, search: func(context.Context, string, int, int) ([]onlineCandidate, bool, error) {
		callsMu.Lock()
		calls++
		callsMu.Unlock()
		return []onlineCandidate{{URL: "https://img.doutupk.com/cat.png", Title: "猫"}}, false, nil
	}}}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, e := svc.OnlineSearch(context.Background(), "猫", nil, 1, 4, "")
			if e != nil || len(p.Items) != 1 {
				t.Errorf("concurrent %+v %v", p, e)
			}
		}()
	}
	wg.Wait()
	if calls != 1 {
		t.Fatalf("same query fanout %d", calls)
	}
	for i := 0; i < 24; i++ {
		if _, e := svc.OnlineSearch(context.Background(), fmt.Sprintf("猫%d", i), nil, 1, 4, ""); e != nil {
			t.Fatal(e)
		}
	}
	if len(svc.online.sessions) > 16 {
		t.Fatalf("unbounded query sessions: %d", len(svc.online.sessions))
	}
}

func TestOnlineDNSRejectsMixedPublicAndSiteLocalIPv6(t *testing.T) {
	if e := validateOnlineIPs([]net.IPAddr{{IP: net.ParseIP("2606:4700:4700::1111")}, {IP: net.ParseIP("fec0::1")}}); e == nil {
		t.Fatal("mixed DNS answer permits site-local IPv6")
	}
	if e := validateOnlineIPs([]net.IPAddr{{IP: net.ParseIP("2606:4700:4700::1111")}}); e != nil {
		t.Fatal("public IPv6 blocked", e)
	}
}

func TestOnlineCancelledPageRetryRetainsConsumedItems(t *testing.T) {
	st, e := OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer st.Close()
	svc := NewService(st, t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	cancelOnce := true
	svc.online.providers = []onlineProvider{{OnlineSource: OnlineSource{ID: "doutula", Title: "斗图啦", Enabled: true}, search: func(_ context.Context, _ string, page, limit int) ([]onlineCandidate, bool, error) {
		if page == 2 && cancelOnce {
			cancelOnce = false
			cancel()
		}
		out := []onlineCandidate{}
		for n := 0; n < 2; n++ {
			out = append(out, onlineCandidate{URL: fmt.Sprintf("https://img.doutupk.com/%d-%d.png", page, n), Title: fmt.Sprintf("%d-%d", page, n)})
		}
		return out, page < 2, nil
	}}}
	if _, e = svc.OnlineSearch(ctx, "猫", nil, 1, 3, ""); e == nil {
		t.Fatal("expected cancelled build")
	}
	p, e := svc.OnlineSearch(context.Background(), "猫", nil, 1, 3, "")
	if e != nil {
		t.Fatal(e)
	}
	if len(p.Items) != 3 || p.Items[0].Title != "1-0" || p.Items[1].Title != "1-1" || p.Items[2].Title != "2-0" || !p.HasMore {
		t.Fatalf("cancelled build lost consumed items: %+v", p)
	}
	p, e = svc.OnlineSearch(context.Background(), "猫", nil, 2, 3, "")
	if e != nil || len(p.Items) != 1 || p.Items[0].Title != "2-1" || p.HasMore {
		t.Fatalf("remainder %+v %v", p, e)
	}
}
