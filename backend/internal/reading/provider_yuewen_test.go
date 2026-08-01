package reading

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSignYuewenParamsMatchesOfficialAlgorithm(t *testing.T) {
	got := SignYuewenParams("secret", map[string]string{
		"timestamp": "1700000000",
		"appflag":   "demo",
		"cbid":      "100",
	})
	if got != "7FBB80712B0E89E6316C8A2870603317" {
		t.Fatalf("signature = %q", got)
	}
}

func TestYuewenProviderMapsBookChapterListAndContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("appflag") != "demo" || r.URL.Query().Get("sign") == "" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/book/idlist":
			_, _ = w.Write([]byte(`{"code":0,"msg":"成功","data":{"cbids":["100"],"page":1,"maxPage":1}}`))
		case "/book/info":
			_, _ = w.Write([]byte(`{"code":0,"msg":"成功","data":{"cbid":"100","title":"官方测试书","authorName":"阅文作者","intro":"简介","coverUrl":"//example.com/cover.jpg","status":50,"auditStatus":19,"checkLevel":15,"tag":[{"tagName":"科幻"}]}}`))
		case "/book/chapterlist":
			_, _ = w.Write([]byte(`{"code":0,"msg":"成功","data":{"cbid":"100","chapterList":[{"cvid":"v1","vName":"正文","volumeSort":1,"chapters":[{"ccid":"c1","chapterTitle":"第一章","chapterSort":1,"originalWords":1234}]}]}}`))
		case "/chapter/getchapterinfoforfree":
			_, _ = w.Write([]byte(`{"code":0,"msg":"成功","data":{"cbid":"100","ccid":"c1","chapterName":"第一章","chapterOrder":1,"wordsCount":1234,"content":"这是实时正文。"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	provider := NewYuewenProvider(YuewenConfig{
		BaseURL:   server.URL,
		AppFlag:   "demo",
		AppSecret: "secret",
		Client:    server.Client(),
		Now:       func() time.Time { return time.Unix(1700000000, 0) },
	})
	page, err := provider.ListBooks(context.Background(), "1")
	if err != nil || len(page.Books) != 1 || page.Books[0].ExternalID != "100" {
		t.Fatalf("book page = %+v, err = %v", page, err)
	}
	book, err := provider.GetBook(context.Background(), "100")
	if err != nil || book.Title != "官方测试书" || book.CoverURL != "https://example.com/cover.jpg" {
		t.Fatalf("book = %+v, err = %v", book, err)
	}
	chapters, err := provider.ListChapters(context.Background(), "100", "")
	if err != nil || len(chapters.Chapters) != 1 || chapters.Chapters[0].Title != "第一章" {
		t.Fatalf("chapters = %+v, err = %v", chapters, err)
	}
	content, err := provider.GetChapter(context.Background(), "100", "c1", "user-1")
	if err != nil || content.Content != "这是实时正文。" {
		t.Fatalf("content = %+v, err = %v", content, err)
	}
}
