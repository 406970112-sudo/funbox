package meme

// Provider endpoints and field mappings adapted from o98k-ok/meme (README: MIT).
// See NOTICE-meme-online.md. The HTTP and media security boundary is local code.
import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

func allowedMediaHost(id, raw string) bool {
	u, e := url.Parse(raw)
	if e != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	suffix := func(root string) bool { return h == root || strings.HasSuffix(h, "."+root) }
	switch id {
	case "doutula":
		return suffix("doutupk.com")
	case "pdan":
		return suffix("pinoss.com") || suffix("pdan.com.cn")
	case "douyin":
		return suffix("byteimg.com") || suffix("douyinpic.com") || suffix("douyincdn.com") || suffix("pstatp.com") || suffix("ibyteimg.com")
	case "sougou":
		return true
	}
	return false
}
func (en *onlineEngine) searchProvider(ctx context.Context, id, q string, page, limit int) ([]onlineCandidate, bool, error) {
	var raw string
	switch id {
	case "doutula":
		raw = "https://www.doutupk.com/search?" + url.Values{"keyword": {q}, "page": {strconv.Itoa(page)}, "type": {"photo"}, "more": {"1"}}.Encode()
	case "pdan":
		raw = "https://pdan.com.cn/?" + url.Values{"s": {q}, "paged": {strconv.Itoa(page)}}.Encode()
	case "sougou":
		raw = "https://pic.sogou.com/napi/pc/searchList?" + url.Values{"mode": {"1"}, "tagQSign": {"表情包,5e604ff6"}, "start": {strconv.Itoa((page - 1) * 48)}, "xml_len": {"48"}, "query": {q}, "channel": {"pc_pic"}, "scene": {"pic_result"}}.Encode()
	case "douyin":
		raw = "https://www.douyin.com/aweme/v1/web/im/resource/emoticon/search?" + url.Values{"device_platform": {"webapp"}, "aid": {"1128"}, "keyword": {q}, "cursor": {strconv.Itoa((page - 1) * 10)}}.Encode()
	default:
		return nil, false, ErrInvalid
	}
	b, e := onlineFetch(ctx, en.client, raw, en.cookie, 3<<20)
	if e != nil {
		return nil, false, e
	}
	if id == "doutula" || id == "pdan" {
		return parseOnlineHTML(id, b, raw, page)
	}
	return parseOnlineJSON(id, b, raw)
}
func parseOnlineJSON(id string, b []byte, pageURL string) ([]onlineCandidate, bool, error) {
	out := []onlineCandidate{}
	if id == "sougou" {
		var d struct {
			Status int `json:"status"`
			Data   *struct {
				Items []struct {
					Loc      string `json:"locImageLink"`
					Thumb    string `json:"thumbUrl"`
					Original string `json:"oriPicUrl"`
					Title    string `json:"title"`
				} `json:"items"`
			} `json:"data"`
		}
		if json.Unmarshal(b, &d) != nil || d.Status != 0 || d.Data == nil || d.Data.Items == nil {
			return nil, false, fmt.Errorf("source rejected request or changed schema")
		}
		for _, v := range d.Data.Items {
			raw := v.Original
			if raw == "" {
				raw = v.Loc
			}
			if raw == "" {
				raw = v.Thumb
			}
			out = append(out, onlineCandidate{URL: normalizeImageURL(raw), Title: v.Title, PageURL: "https://pic.sogou.com/pics"})
		}
		return out, len(d.Data.Items) == 48, nil
	}
	var d struct {
		Status int `json:"status_code"`
		More   int `json:"has_more"`
		Data   *struct {
			More int `json:"has_more"`
			List []struct {
				Author struct {
					Name string `json:"name"`
				} `json:"author"`
				Origin struct {
					URLs []string `json:"url_list"`
				} `json:"origin"`
			} `json:"sticker_list"`
		} `json:"emoticon_data"`
	}
	if json.Unmarshal(b, &d) != nil || d.Status != 0 || d.Data == nil || d.Data.List == nil {
		return nil, false, fmt.Errorf("source rejected request or changed schema")
	}
	for _, v := range d.Data.List {
		if len(v.Origin.URLs) > 0 {
			out = append(out, onlineCandidate{URL: normalizeImageURL(v.Origin.URLs[0]), Title: v.Author.Name, PageURL: "https://www.douyin.com/"})
		}
	}
	return out, d.More == 1 || d.Data.More == 1, nil
}
func normalizeImageURL(raw string) string {
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "http://") {
		return "https://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}
func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
func class(n *html.Node, key string) bool {
	for _, c := range strings.Fields(attr(n, "class")) {
		if c == key {
			return true
		}
	}
	return false
}
func nodeText(n *html.Node) string {
	var out strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			out.WriteString(n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.TrimSpace(out.String())
}
func parseOnlineHTML(id string, b []byte, pageURL string, page int) ([]onlineCandidate, bool, error) {
	doc, e := html.Parse(bytes.NewReader(b))
	if e != nil {
		return nil, false, e
	}
	out := []onlineCandidate{}
	more := false
	recognized := false
	base, _ := url.Parse(pageURL)
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "a" {
			// Only provider-owned pagination URLs can claim another page.
			if href, e := url.Parse(attr(n, "href")); e == nil {
				u := base.ResolveReference(href)
				label := nodeText(n)
				if u.Hostname() == base.Hostname() && (attr(n, "rel") == "next" || class(n, "next") || strings.Contains(label, "下一页")) && u.String() != pageURL {
					more = true
				}
			}
			result := id == "doutula" && class(n, "col-xs-6") && class(n, "col-md-2") || id == "pdan" && class(n, "imageLink")
			if result {
				recognized = true
				var img *html.Node
				var p *html.Node
				var find func(*html.Node)
				find = func(v *html.Node) {
					if v.Data == "img" && img == nil {
						img = v
					}
					if v.Data == "p" && p == nil {
						p = v
					}
					for c := v.FirstChild; c != nil; c = c.NextSibling {
						find(c)
					}
				}
				find(n)
				if img != nil {
					raw := attr(img, "data-original")
					if raw == "" {
						raw = attr(img, "data-src")
					}
					if raw == "" {
						raw = attr(img, "src")
					}
					raw = normalizeImageURL(raw)
					title := attr(n, "title")
					if title == "" {
						title = attr(img, "alt")
					}
					if title == "" && p != nil {
						title = nodeText(p)
					}
					pageRef := pageURL
					if href, e := url.Parse(attr(n, "href")); e == nil && attr(n, "href") != "" {
						u := base.ResolveReference(href)
						if u.Hostname() == base.Hostname() {
							pageRef = u.String()
						}
					}
					if allowedMediaHost(id, raw) && validateOnlineURL(raw) == nil {
						thumb := ""
						if id == "pdan" {
							if u, e := url.Parse(raw); e == nil && u.RawQuery == "imageMogr2/thumbnail/200x" {
								thumb = raw
								u.RawQuery = ""
								raw = u.String()
							}
						}
						out = append(out, onlineCandidate{URL: raw, ThumbURL: thumb, Title: title, PageURL: pageRef})
					}
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	text := nodeText(doc)
	if !recognized && !strings.Contains(text, "没有找到") && !strings.Contains(text, "没有搜索到") && !strings.Contains(text, "未找到") && !strings.Contains(text, "暂无") {
		return nil, false, fmt.Errorf("source HTML changed or access blocked")
	}
	if recognized && len(out) == 0 {
		return nil, false, fmt.Errorf("source images unavailable")
	}
	if len(out) > 120 {
		out = out[:120]
	}
	return out, more, nil
}
