package meme

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// No proxy: validation and dialing must resolve the same destination, including redirects.
func newOnlineClient(cookie string) *http.Client {
	tr := &http.Transport{MaxIdleConns: 20, MaxIdleConnsPerHost: 4, IdleConnTimeout: 60 * time.Second, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 6 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, e := net.SplitHostPort(address)
			if e != nil || port != "443" {
				return nil, ErrInvalid
			}
			ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
			if e != nil || len(ips) == 0 {
				return nil, fmt.Errorf("source DNS unavailable")
			}
			if e := validateOnlineIPs(ips); e != nil {
				return nil, e
			}
			var last error
			for _, ip := range ips {
				c, e := (&net.Dialer{Timeout: 4 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
				if e == nil {
					return c, nil
				}
				last = e
			}
			return nil, last
		}}
	return &http.Client{Transport: tr, Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return fmt.Errorf("redirect limit")
		}
		if e := validateOnlineURL(req.URL.String()); e != nil {
			return e
		}
		req.Header.Del("Cookie")
		if cookie != "" && req.URL.Hostname() == "www.douyin.com" && len(via) > 0 && via[0].URL.Hostname() == "www.douyin.com" {
			req.Header.Set("Cookie", cookie)
		}
		return nil
	}}
}
func publicIP(ip net.IP) bool {
	a, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	a = a.Unmap()
	if a.Is6() && !netip.MustParsePrefix("2000::/3").Contains(a) {
		return false
	}
	if !a.IsGlobalUnicast() || a.IsPrivate() || a.IsLoopback() || a.IsLinkLocalUnicast() {
		return false
	}
	for _, p := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32", "2001::/23", "2002::/16", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(p).Contains(a) {
			return false
		}
	}
	return true
}
func validateOnlineURL(raw string) error {
	if len(raw) > 4096 {
		return ErrInvalid
	}
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" || u.Port() != "" && u.Port() != "443" {
		return ErrInvalid
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || !strings.Contains(h, ".") || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") || strings.HasSuffix(h, ".") {
		return ErrInvalid
	}
	if ip := net.ParseIP(h); ip != nil && !publicIP(ip) {
		return ErrInvalid
	}
	return nil
}
func onlineFetch(ctx context.Context, client *http.Client, raw, cookie string, max int64) ([]byte, error) {
	if e := validateOnlineURL(raw); e != nil {
		return nil, e
	}
	req, e := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FunboxMeme/1.0)")
	if cookie != "" && req.URL.Hostname() == "www.douyin.com" {
		req.Header.Set("Cookie", cookie)
	}
	res, e := client.Do(req)
	if e != nil {
		return nil, fmt.Errorf("source request failed")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("source HTTP %d", res.StatusCode)
	}
	if res.ContentLength > max {
		return nil, fmt.Errorf("source too large")
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, max+1))
	if e != nil || int64(len(b)) > max {
		return nil, fmt.Errorf("source body unavailable or too large")
	}
	return b, nil
}

func validateOnlineIPs(ips []net.IPAddr) error {
	if len(ips) == 0 {
		return fmt.Errorf("source DNS unavailable")
	}
	for _, ip := range ips {
		if !publicIP(ip.IP) {
			return fmt.Errorf("non-public destination")
		}
	}
	return nil
}
