package reading

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const defaultYuewenBaseURL = "https://cpapi-i.yuewen.com"

type YuewenConfig struct {
	BaseURL   string
	AppFlag   string
	AppSecret string
	Client    *http.Client
	Now       func() time.Time
}

type YuewenProvider struct {
	baseURL   string
	appFlag   string
	appSecret string
	client    *http.Client
	now       func() time.Time
}

func NewYuewenProvider(config YuewenConfig) *YuewenProvider {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultYuewenBaseURL
	}
	client := config.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	now := config.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &YuewenProvider{baseURL: baseURL, appFlag: strings.TrimSpace(config.AppFlag), appSecret: config.AppSecret, client: client, now: now}
}

func (p *YuewenProvider) Key() string { return "yuewen" }

func SignYuewenParams(secret string, params map[string]string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		if key != "sign" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	var builder strings.Builder
	builder.WriteString(secret)
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteString(params[key])
	}
	sum := md5.Sum([]byte(builder.String()))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

type yuewenResponse struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func (p *YuewenProvider) get(ctx context.Context, path string, params map[string]string, target any) error {
	if p.appFlag == "" || p.appSecret == "" {
		return errors.New("yuewen appflag and appsecret are required")
	}
	values := make(map[string]string, len(params)+2)
	for key, value := range params {
		values[key] = value
	}
	values["appflag"] = p.appFlag
	values["timestamp"] = strconv.FormatInt(p.now().Unix(), 10)
	values["sign"] = SignYuewenParams(p.appSecret, values)
	query := url.Values{}
	for key, value := range values {
		query.Set(key, value)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+path+"?"+query.Encode(), nil)
	if err != nil {
		return fmt.Errorf("create yuewen request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := p.client.Do(request)
	if err != nil {
		return fmt.Errorf("request yuewen: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("yuewen http status %d", response.StatusCode)
	}
	var envelope yuewenResponse
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode yuewen response: %w", err)
	}
	if envelope.Code != 0 {
		return fmt.Errorf("yuewen code %d: %s", envelope.Code, envelope.Msg)
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return fmt.Errorf("decode yuewen data: %w", err)
	}
	return nil
}

func (p *YuewenProvider) ListBooks(ctx context.Context, cursor string) (BookPage, error) {
	page := 1
	if parsed, err := strconv.Atoi(cursor); err == nil && parsed > 0 {
		page = parsed
	}
	var data struct {
		CBIDs   []string `json:"cbids"`
		Page    int      `json:"page"`
		MaxPage int      `json:"maxPage"`
	}
	if err := p.get(ctx, "/book/idlist", map[string]string{"page": strconv.Itoa(page)}, &data); err != nil {
		return BookPage{}, err
	}
	books := make([]ProviderBook, 0, len(data.CBIDs))
	for _, id := range data.CBIDs {
		books = append(books, ProviderBook{ExternalID: id})
	}
	next := ""
	if data.Page < data.MaxPage {
		next = strconv.Itoa(data.Page + 1)
	}
	return BookPage{Books: books, NextCursor: next}, nil
}

func (p *YuewenProvider) GetBook(ctx context.Context, externalID string) (ProviderBook, error) {
	var data struct {
		CBID         string `json:"cbid"`
		Title        string `json:"title"`
		AuthorName   string `json:"authorName"`
		Intro        string `json:"intro"`
		CoverURL     string `json:"coverUrl"`
		WebpCoverURL string `json:"webpCoverUrl"`
		Status       int    `json:"status"`
		AuditStatus  int    `json:"auditStatus"`
		CheckLevel   int    `json:"checkLevel"`
		AllWords     int    `json:"allWords"`
		Tags         []struct {
			Name string `json:"tagName"`
		} `json:"tag"`
	}
	if err := p.get(ctx, "/book/info", map[string]string{"cbid": externalID}, &data); err != nil {
		return ProviderBook{}, err
	}
	if data.AuditStatus != 0 && data.AuditStatus != 19 {
		return ProviderBook{}, fmt.Errorf("%w: yuewen audit status %d", ErrContentUnavailable, data.AuditStatus)
	}
	if data.CheckLevel != 0 && data.CheckLevel < 9 {
		return ProviderBook{}, fmt.Errorf("%w: yuewen check level %d", ErrContentUnavailable, data.CheckLevel)
	}
	tags := make([]string, 0, len(data.Tags))
	for _, tag := range data.Tags {
		if name := strings.TrimSpace(tag.Name); name != "" {
			tags = append(tags, name)
		}
	}
	category := "文学"
	if len(tags) > 0 {
		category = tags[0]
	}
	cover := data.WebpCoverURL
	if cover == "" {
		cover = data.CoverURL
	}
	if strings.HasPrefix(cover, "//") {
		cover = "https:" + cover
	}
	serialStatus := "serializing"
	if data.Status == 50 {
		serialStatus = "completed"
	}
	return ProviderBook{ExternalID: data.CBID, Title: data.Title, Author: data.AuthorName, Intro: data.Intro,
		CoverURL: cover, Category: category, Tags: tags, SerialStatus: serialStatus, WordCount: data.AllWords}, nil
}

func (p *YuewenProvider) ListChapters(ctx context.Context, externalID string, _ string) (ChapterPage, error) {
	var data struct {
		ChapterList []struct {
			Chapters []struct {
				CCID          string `json:"ccid"`
				Title         string `json:"chapterTitle"`
				SortOrder     int    `json:"chapterSort"`
				OriginalWords int    `json:"originalWords"`
			} `json:"chapters"`
		} `json:"chapterList"`
	}
	if err := p.get(ctx, "/book/chapterlist", map[string]string{"cbid": externalID}, &data); err != nil {
		return ChapterPage{}, err
	}
	chapters := make([]ProviderChapter, 0)
	for _, volume := range data.ChapterList {
		for _, chapter := range volume.Chapters {
			chapters = append(chapters, ProviderChapter{ExternalID: chapter.CCID, Title: chapter.Title, SortOrder: chapter.SortOrder, WordCount: chapter.OriginalWords})
		}
	}
	sort.SliceStable(chapters, func(i, j int) bool { return chapters[i].SortOrder < chapters[j].SortOrder })
	return ChapterPage{Chapters: chapters}, nil
}

func (p *YuewenProvider) GetChapter(ctx context.Context, externalBookID, externalChapterID, userID string) (ChapterContent, error) {
	var data struct {
		CBID         string `json:"cbid"`
		CCID         string `json:"ccid"`
		Title        string `json:"chapterName"`
		Order        int    `json:"chapterOrder"`
		Words        int    `json:"wordsCount"`
		Content      string `json:"content"`
		PreviousCCID string `json:"prevCcid"`
		NextCCID     string `json:"nextCcid"`
	}
	params := map[string]string{"cbid": externalBookID, "ccid": externalChapterID, "withcontent": "1"}
	if strings.TrimSpace(userID) != "" {
		params["openid"] = userID
	}
	if err := p.get(ctx, "/chapter/getchapterinfoforfree", params, &data); err != nil {
		return ChapterContent{}, err
	}
	return ChapterContent{BookID: data.CBID, ChapterID: data.CCID, Title: data.Title, Content: data.Content,
		SortOrder: data.Order, WordCount: data.Words, PreviousID: data.PreviousCCID, NextID: data.NextCCID, SourceType: SourceProvider}, nil
}

func (p *YuewenProvider) ListUpdatedBooks(ctx context.Context, from, to time.Time) ([]string, error) {
	return p.listChangedBooks(ctx, "/book/getupdatebooklist", from, to)
}

func (p *YuewenProvider) ListRemovedBooks(ctx context.Context, from, to time.Time) ([]string, error) {
	return p.listChangedBooks(ctx, "/book/getunshelfbooklist", from, to)
}

func (p *YuewenProvider) listChangedBooks(ctx context.Context, path string, from, to time.Time) ([]string, error) {
	var data struct {
		CBIDs []string `json:"cbids"`
	}
	if err := p.get(ctx, path, map[string]string{"starttime": strconv.FormatInt(from.Unix(), 10), "endtime": strconv.FormatInt(to.Unix(), 10)}, &data); err != nil {
		return nil, err
	}
	return data.CBIDs, nil
}
