package lottery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ErrGameNotFound  = errors.New("lottery game not found")
	ErrIssueNotFound = errors.New("lottery issue not found")
)

type GameMeta struct {
	Game       string `json:"game"`
	Org        string `json:"org"`
	OrgName    string `json:"orgName"`
	Name       string `json:"name"`
	Schedule   string `json:"schedule"`
	Source     string `json:"source"`
	SourceName string `json:"sourceName"`
	SourceURL  string `json:"sourceUrl"`
	upstreamID string
}

type PrizeGrade struct {
	Grade string `json:"grade"`
	Count string `json:"count"`
	Money string `json:"money"`
}

type GameDraw struct {
	Game        string       `json:"game"`
	Org         string       `json:"org"`
	OrgName     string       `json:"orgName"`
	Name        string       `json:"name"`
	Schedule    string       `json:"schedule"`
	Issue       string       `json:"issue"`
	Date        string       `json:"date"`
	Front       []string     `json:"front"`
	Back        []string     `json:"back"`
	Sales       string       `json:"sales"`
	Pool        string       `json:"pool"`
	PrizeGrades []PrizeGrade `json:"prizeGrades,omitempty"`
}

type LatestGameItem struct {
	Game       string    `json:"game"`
	Org        string    `json:"org"`
	OrgName    string    `json:"orgName"`
	Name       string    `json:"name"`
	Schedule   string    `json:"schedule"`
	Source     string    `json:"source"`
	SourceName string    `json:"sourceName"`
	SourceURL  string    `json:"sourceUrl"`
	Available  bool      `json:"available"`
	Stale      bool      `json:"stale"`
	Latest     *GameDraw `json:"latest,omitempty"`
}

type LatestSnapshot struct {
	Games     []LatestGameItem `json:"games"`
	FetchedAt time.Time        `json:"fetchedAt"`
	Stale     bool             `json:"stale"`
}

type GameHistoryQuery struct {
	Limit  int
	Offset int
	Year   string
	Issue  string
}

type GameHistoryPage struct {
	Game       string     `json:"game"`
	Org        string     `json:"org"`
	OrgName    string     `json:"orgName"`
	Name       string     `json:"name"`
	Schedule   string     `json:"schedule"`
	Source     string     `json:"source"`
	SourceName string     `json:"sourceName"`
	SourceURL  string     `json:"sourceUrl"`
	FetchedAt  time.Time  `json:"fetchedAt"`
	Stale      bool       `json:"stale"`
	Total      int        `json:"total"`
	HasMore    bool       `json:"hasMore"`
	NextOffset int        `json:"nextOffset"`
	Years      []string   `json:"years"`
	Draws      []GameDraw `json:"draws"`
}

type GameIssueDetail struct {
	Game       string    `json:"game"`
	Org        string    `json:"org"`
	OrgName    string    `json:"orgName"`
	Name       string    `json:"name"`
	Schedule   string    `json:"schedule"`
	Source     string    `json:"source"`
	SourceName string    `json:"sourceName"`
	SourceURL  string    `json:"sourceUrl"`
	FetchedAt  time.Time `json:"fetchedAt"`
	Stale      bool      `json:"stale"`
	Draw       GameDraw  `json:"draw"`
	PrevIssue  string    `json:"prevIssue"`
	NextIssue  string    `json:"nextIssue"`
}

var SupportedGames = []GameMeta{
	{
		Game:       "ssq",
		Org:        "cwl",
		OrgName:    "福彩",
		Name:       "双色球",
		Schedule:   "每周二、四、日 21:15",
		Source:     "cwl",
		SourceName: "中国福彩网",
		SourceURL:  "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/",
		upstreamID: "ssq",
	},
	{
		Game:       "dlt",
		Org:        "sport",
		OrgName:    "体彩",
		Name:       "超级大乐透",
		Schedule:   "每周一、三、六 21:25",
		Source:     "sporttery",
		SourceName: "中国体彩网",
		SourceURL:  "https://www.lottery.gov.cn/kj/kjlb.html?dlt",
		upstreamID: "85",
	},
	{
		Game:       "fc3d",
		Org:        "cwl",
		OrgName:    "福彩",
		Name:       "福彩 3D",
		Schedule:   "每日 21:15",
		Source:     "cwl",
		SourceName: "中国福彩网",
		SourceURL:  "https://www.cwl.gov.cn/ygkj/wqkjgg/fc3d/",
		upstreamID: "3d",
	},
	{
		Game:       "pl3",
		Org:        "sport",
		OrgName:    "体彩",
		Name:       "排列 3",
		Schedule:   "每日 21:25",
		Source:     "sporttery",
		SourceName: "中国体彩网",
		SourceURL:  "https://www.lottery.gov.cn/kj/kjlb.html?pls",
		upstreamID: "35",
	},
	{
		Game:       "pl5",
		Org:        "sport",
		OrgName:    "体彩",
		Name:       "排列 5",
		Schedule:   "每日 21:25",
		Source:     "sporttery",
		SourceName: "中国体彩网",
		SourceURL:  "https://www.lottery.gov.cn/kj/kjlb.html?plw",
		upstreamID: "350133",
	},
	{
		Game:       "qxc",
		Org:        "sport",
		OrgName:    "体彩",
		Name:       "七星彩",
		Schedule:   "每周二、五、日 21:25",
		Source:     "sporttery",
		SourceName: "中国体彩网",
		SourceURL:  "https://www.lottery.gov.cn/kj/kjlb.html?qxc",
		upstreamID: "04",
	},
	{
		Game:       "qlc",
		Org:        "cwl",
		OrgName:    "福彩",
		Name:       "七乐彩",
		Schedule:   "每周一、三、五 21:15",
		Source:     "cwl",
		SourceName: "中国福彩网",
		SourceURL:  "https://www.cwl.gov.cn/ygkj/wqkjgg/qlc/",
		upstreamID: "qlc",
	},
}

func FindGameMeta(game string) (GameMeta, bool) {
	key := strings.ToLower(strings.TrimSpace(game))
	for _, item := range SupportedGames {
		if item.Game == key {
			return item, true
		}
	}
	return GameMeta{}, false
}

type DrawServiceConfig struct {
	CacheTTL        time.Duration
	RequestTimeout  time.Duration
	FetchCount      int
	CWLBaseURL      string
	SportteryAPIURL string
}

type gameCacheEntry struct {
	draws     []GameDraw
	fetchedAt time.Time
}

type DrawService struct {
	cfg    DrawServiceConfig
	client *http.Client
	now    func() time.Time

	mu    sync.Mutex
	cache map[string]gameCacheEntry
}

func NewDrawService(cfg DrawServiceConfig) *DrawService {
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 15 * time.Minute
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 10 * time.Second
	}
	if cfg.FetchCount <= 0 {
		cfg.FetchCount = 100
	}
	if strings.TrimSpace(cfg.CWLBaseURL) == "" {
		cfg.CWLBaseURL = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
	}
	if strings.TrimSpace(cfg.SportteryAPIURL) == "" {
		cfg.SportteryAPIURL = "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
	}
	return &DrawService{
		cfg:    cfg,
		client: &http.Client{Timeout: cfg.RequestTimeout},
		now:    time.Now,
		cache:  make(map[string]gameCacheEntry),
	}
}

func (s *DrawService) Latest(ctx context.Context) (LatestSnapshot, error) {
	now := s.now()
	items := make([]LatestGameItem, len(SupportedGames))
	var wg sync.WaitGroup
	var anyAvailable bool
	var anyStale bool
	var mu sync.Mutex

	for i, meta := range SupportedGames {
		wg.Add(1)
		go func(index int, m GameMeta) {
			defer wg.Done()
			draws, _, stale, err := s.getGameDraws(ctx, m)
			item := LatestGameItem{
				Game:       m.Game,
				Org:        m.Org,
				OrgName:    m.OrgName,
				Name:       m.Name,
				Schedule:   m.Schedule,
				Source:     m.Source,
				SourceName: m.SourceName,
				SourceURL:  m.SourceURL,
				Stale:      stale,
			}
			if err == nil && len(draws) > 0 {
				latest := cloneGameDraw(draws[0])
				item.Available = true
				item.Latest = &latest
				mu.Lock()
				anyAvailable = true
				if stale {
					anyStale = true
				}
				mu.Unlock()
			}
			items[index] = item
		}(i, meta)
	}
	wg.Wait()

	if !anyAvailable {
		return LatestSnapshot{}, ErrSourceUnavailable
	}
	return LatestSnapshot{
		Games:     items,
		FetchedAt: now,
		Stale:     anyStale,
	}, nil
}

func (s *DrawService) GameHistory(ctx context.Context, game string, query GameHistoryQuery) (GameHistoryPage, error) {
	meta, ok := FindGameMeta(game)
	if !ok {
		return GameHistoryPage{}, ErrGameNotFound
	}
	draws, fetchedAt, stale, err := s.getGameDraws(ctx, meta)
	if err != nil {
		return GameHistoryPage{}, err
	}

	yearSet := make(map[string]struct{})
	for _, draw := range draws {
		if len(draw.Date) >= 4 {
			yearSet[draw.Date[:4]] = struct{}{}
		}
	}
	years := make([]string, 0, len(yearSet))
	for y := range yearSet {
		years = append(years, y)
	}
	sort.Slice(years, func(i, j int) bool { return years[i] > years[j] })

	yearFilter := strings.TrimSpace(query.Year)
	issueFilter := strings.TrimSpace(query.Issue)
	filtered := make([]GameDraw, 0, len(draws))
	for _, draw := range draws {
		if yearFilter != "" && !strings.HasPrefix(draw.Date, yearFilter) {
			continue
		}
		if issueFilter != "" && !strings.Contains(draw.Issue, issueFilter) {
			continue
		}
		filtered = append(filtered, draw)
	}

	limit := query.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}

	total := len(filtered)
	var pageDraws []GameDraw
	if offset < total {
		end := offset + limit
		if end > total {
			end = total
		}
		pageDraws = make([]GameDraw, 0, end-offset)
		for _, draw := range filtered[offset:end] {
			pageDraws = append(pageDraws, cloneGameDraw(draw))
		}
	} else {
		pageDraws = []GameDraw{}
	}
	hasMore := offset+len(pageDraws) < total
	nextOffset := 0
	if hasMore {
		nextOffset = offset + len(pageDraws)
	}

	return GameHistoryPage{
		Game:       meta.Game,
		Org:        meta.Org,
		OrgName:    meta.OrgName,
		Name:       meta.Name,
		Schedule:   meta.Schedule,
		Source:     meta.Source,
		SourceName: meta.SourceName,
		SourceURL:  meta.SourceURL,
		FetchedAt:  fetchedAt,
		Stale:      stale,
		Total:      total,
		HasMore:    hasMore,
		NextOffset: nextOffset,
		Years:      years,
		Draws:      pageDraws,
	}, nil
}

func (s *DrawService) IssueDetail(ctx context.Context, game string, issue string) (GameIssueDetail, error) {
	meta, ok := FindGameMeta(game)
	if !ok {
		return GameIssueDetail{}, ErrGameNotFound
	}
	draws, fetchedAt, stale, err := s.getGameDraws(ctx, meta)
	if err != nil {
		return GameIssueDetail{}, err
	}
	target := strings.TrimSpace(issue)
	if target == "" || target == "latest" {
		if len(draws) == 0 {
			return GameIssueDetail{}, ErrIssueNotFound
		}
		prevIssue := ""
		if len(draws) > 1 {
			prevIssue = draws[1].Issue
		}
		return GameIssueDetail{
			Game:       meta.Game,
			Org:        meta.Org,
			OrgName:    meta.OrgName,
			Name:       meta.Name,
			Schedule:   meta.Schedule,
			Source:     meta.Source,
			SourceName: meta.SourceName,
			SourceURL:  meta.SourceURL,
			FetchedAt:  fetchedAt,
			Stale:      stale,
			Draw:       cloneGameDraw(draws[0]),
			PrevIssue:  prevIssue,
			NextIssue:  "",
		}, nil
	}

	for i, draw := range draws {
		if draw.Issue == target {
			prevIssue := ""
			nextIssue := ""
			if i+1 < len(draws) {
				prevIssue = draws[i+1].Issue
			}
			if i-1 >= 0 {
				nextIssue = draws[i-1].Issue
			}
			return GameIssueDetail{
				Game:       meta.Game,
				Org:        meta.Org,
				OrgName:    meta.OrgName,
				Name:       meta.Name,
				Schedule:   meta.Schedule,
				Source:     meta.Source,
				SourceName: meta.SourceName,
				SourceURL:  meta.SourceURL,
				FetchedAt:  fetchedAt,
				Stale:      stale,
				Draw:       cloneGameDraw(draw),
				PrevIssue:  prevIssue,
				NextIssue:  nextIssue,
			}, nil
		}
	}
	return GameIssueDetail{}, ErrIssueNotFound
}

func (s *DrawService) getGameDraws(ctx context.Context, meta GameMeta) ([]GameDraw, time.Time, bool, error) {
	now := s.now()
	s.mu.Lock()
	cached, hasCached := s.cache[meta.Game]
	if hasCached && now.Sub(cached.fetchedAt) < s.cfg.CacheTTL {
		draws := cloneGameDraws(cached.draws)
		fetchedAt := cached.fetchedAt
		s.mu.Unlock()
		return draws, fetchedAt, false, nil
	}
	s.mu.Unlock()

	var draws []GameDraw
	var err error
	if meta.Source == "cwl" {
		draws, err = s.fetchCWL(ctx, meta)
	} else {
		draws, err = s.fetchSporttery(ctx, meta)
	}
	if err == nil && len(draws) > 0 {
		s.mu.Lock()
		s.cache[meta.Game] = gameCacheEntry{draws: cloneGameDraws(draws), fetchedAt: now}
		s.mu.Unlock()
		return draws, now, false, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if fallback, ok := s.cache[meta.Game]; ok && len(fallback.draws) > 0 {
		return cloneGameDraws(fallback.draws), fallback.fetchedAt, true, nil
	}
	if err != nil {
		return nil, time.Time{}, false, err
	}
	return nil, time.Time{}, false, ErrSourceInvalid
}

// --- CWL (中国福彩网) Upstream ---

type cwlResponse struct {
	State  int        `json:"state"`
	Result []cwlEntry `json:"result"`
}

type cwlPrizeGrade struct {
	Type      json.RawMessage `json:"type"`
	TypeNum   string          `json:"typenum"`
	TypeMoney string          `json:"typemoney"`
}

type cwlEntry struct {
	Code        string          `json:"code"`
	Date        string          `json:"date"`
	Red         string          `json:"red"`
	Blue        string          `json:"blue"`
	Sales       string          `json:"sales"`
	PoolMoney   string          `json:"poolmoney"`
	PrizeGrades []cwlPrizeGrade `json:"prizegrades"`
}

func (s *DrawService) fetchCWL(ctx context.Context, meta GameMeta) ([]GameDraw, error) {
	endpoint := fmt.Sprintf("%s?name=%s&issueCount=%d", s.cfg.CWLBaseURL, meta.upstreamID, s.cfg.FetchCount)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Referer", meta.SourceURL)
	req.Header.Set("User-Agent", "FunBox/1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: cwl status %d", ErrSourceUnavailable, resp.StatusCode)
	}

	var payload cwlResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceInvalid, err)
	}
	if payload.State != 0 {
		return nil, fmt.Errorf("%w: cwl state %d", ErrSourceInvalid, payload.State)
	}

	draws := make([]GameDraw, 0, len(payload.Result))
	seen := make(map[string]struct{}, len(payload.Result))
	for _, entry := range payload.Result {
		draw, ok := parseCWLEntry(meta, entry)
		if !ok {
			continue
		}
		if _, dup := seen[draw.Issue]; dup {
			continue
		}
		seen[draw.Issue] = struct{}{}
		draws = append(draws, draw)
	}
	if len(draws) == 0 {
		return nil, fmt.Errorf("%w: empty cwl draws", ErrSourceInvalid)
	}
	sort.Slice(draws, func(i, j int) bool { return draws[i].Issue > draws[j].Issue })
	return draws, nil
}

func parseCWLEntry(meta GameMeta, entry cwlEntry) (GameDraw, bool) {
	issue := strings.TrimSpace(entry.Code)
	date := normalizeDate(entry.Date)
	if issue == "" || date == "" {
		return GameDraw{}, false
	}
	redParts := splitTokens(entry.Red)
	blueParts := splitTokens(entry.Blue)

	var front []string
	var back []string
	switch meta.Game {
	case "ssq":
		if len(redParts) != 6 || len(blueParts) != 1 {
			return GameDraw{}, false
		}
		front = padBalls(redParts, 2)
		back = padBalls(blueParts, 2)
	case "qlc":
		if len(redParts) != 7 || len(blueParts) != 1 {
			return GameDraw{}, false
		}
		front = padBalls(redParts, 2)
		back = padBalls(blueParts, 2)
	case "fc3d":
		if len(redParts) != 3 {
			return GameDraw{}, false
		}
		front = redParts
		back = []string{}
	default:
		return GameDraw{}, false
	}

	grades := make([]PrizeGrade, 0, len(entry.PrizeGrades))
	for _, item := range entry.PrizeGrades {
		gradeName := formatCWLGrade(meta.Game, item.Type)
		if gradeName == "" {
			continue
		}
		count := strings.TrimSpace(item.TypeNum)
		money := strings.TrimSpace(item.TypeMoney)
		if count == "" && money == "" {
			continue
		}
		grades = append(grades, PrizeGrade{
			Grade: gradeName,
			Count: count,
			Money: money,
		})
	}

	return GameDraw{
		Game:        meta.Game,
		Org:         meta.Org,
		OrgName:     meta.OrgName,
		Name:        meta.Name,
		Schedule:    meta.Schedule,
		Issue:       issue,
		Date:        date,
		Front:       front,
		Back:        back,
		Sales:       cleanNumeric(entry.Sales),
		Pool:        cleanNumeric(entry.PoolMoney),
		PrizeGrades: grades,
	}, true
}

func formatCWLGrade(game string, raw json.RawMessage) string {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if text == "" {
		return ""
	}
	if game == "fc3d" {
		switch text {
		case "1", "单选", "直选":
			return "直选"
		case "2", "组三":
			return "组选三"
		case "3", "组六":
			return "组选六"
		default:
			return text
		}
	}
	switch text {
	case "1":
		return "一等奖"
	case "2":
		return "二等奖"
	case "3":
		return "三等奖"
	case "4":
		return "四等奖"
	case "5":
		return "五等奖"
	case "6":
		return "六等奖"
	case "7":
		return "七等奖"
	default:
		return text
	}
}

// --- Sporttery (中国体彩网) Upstream ---

type sportteryResponse struct {
	Success bool `json:"success"`
	Value   struct {
		List []sportteryEntry `json:"list"`
	} `json:"value"`
}

type sportteryPrize struct {
	PrizeLevel  string `json:"prizeLevel"`
	StakeCount  string `json:"stakeCount"`
	StakeAmount string `json:"stakeAmount"`
}

type sportteryEntry struct {
	LotteryDrawNum       string           `json:"lotteryDrawNum"`
	LotteryDrawTime      string           `json:"lotteryDrawTime"`
	LotteryDrawResult    string           `json:"lotteryDrawResult"`
	TotalSaleAmount      string           `json:"totalSaleAmount"`
	PoolBalanceAfterdraw string           `json:"poolBalanceAfterdraw"`
	PrizeLevelList       []sportteryPrize `json:"prizeLevelList"`
}

func (s *DrawService) fetchSporttery(ctx context.Context, meta GameMeta) ([]GameDraw, error) {
	endpoint := fmt.Sprintf("%s?gameNo=%s&provinceId=0&pageSize=%d&isVerify=1&pageNo=1", s.cfg.SportteryAPIURL, meta.upstreamID, s.cfg.FetchCount)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Origin", "https://static.sporttery.cn")
	req.Header.Set("Referer", "https://static.sporttery.cn/")
	req.Header.Set("User-Agent", "FunBox/1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: sporttery status %d", ErrSourceUnavailable, resp.StatusCode)
	}

	var payload sportteryResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceInvalid, err)
	}
	if !payload.Success {
		return nil, fmt.Errorf("%w: sporttery unsuccessful", ErrSourceInvalid)
	}

	draws := make([]GameDraw, 0, len(payload.Value.List))
	seen := make(map[string]struct{}, len(payload.Value.List))
	for _, entry := range payload.Value.List {
		draw, ok := parseSportteryEntry(meta, entry)
		if !ok {
			continue
		}
		if _, dup := seen[draw.Issue]; dup {
			continue
		}
		seen[draw.Issue] = struct{}{}
		draws = append(draws, draw)
	}
	if len(draws) == 0 {
		return nil, fmt.Errorf("%w: empty sporttery draws", ErrSourceInvalid)
	}
	sort.Slice(draws, func(i, j int) bool { return draws[i].Issue > draws[j].Issue })
	return draws, nil
}

func parseSportteryEntry(meta GameMeta, entry sportteryEntry) (GameDraw, bool) {
	issue := strings.TrimSpace(entry.LotteryDrawNum)
	date := normalizeDate(entry.LotteryDrawTime)
	if issue == "" || date == "" {
		return GameDraw{}, false
	}
	tokens := splitTokens(entry.LotteryDrawResult)

	var front []string
	var back []string
	switch meta.Game {
	case "dlt":
		if len(tokens) != 7 {
			return GameDraw{}, false
		}
		front = padBalls(tokens[:5], 2)
		back = padBalls(tokens[5:], 2)
	case "pl3":
		if len(tokens) != 3 {
			return GameDraw{}, false
		}
		front = tokens
		back = []string{}
	case "pl5":
		if len(tokens) != 5 {
			return GameDraw{}, false
		}
		front = tokens
		back = []string{}
	case "qxc":
		if len(tokens) != 7 {
			return GameDraw{}, false
		}
		front = tokens[:6]
		back = []string{strings.TrimSpace(tokens[6])}
	default:
		return GameDraw{}, false
	}

	grades := make([]PrizeGrade, 0, len(entry.PrizeLevelList))
	for _, item := range entry.PrizeLevelList {
		grade := strings.TrimSpace(item.PrizeLevel)
		if grade == "" {
			continue
		}
		grades = append(grades, PrizeGrade{
			Grade: grade,
			Count: strings.TrimSpace(item.StakeCount),
			Money: strings.TrimSpace(item.StakeAmount),
		})
	}

	return GameDraw{
		Game:        meta.Game,
		Org:         meta.Org,
		OrgName:     meta.OrgName,
		Name:        meta.Name,
		Schedule:    meta.Schedule,
		Issue:       issue,
		Date:        date,
		Front:       front,
		Back:        back,
		Sales:       cleanNumeric(entry.TotalSaleAmount),
		Pool:        cleanNumeric(entry.PoolBalanceAfterdraw),
		PrizeGrades: grades,
	}, true
}

func splitTokens(raw string) []string {
	cleaned := strings.NewReplacer(",", " ", "+", " ", "|", " ").Replace(strings.TrimSpace(raw))
	if cleaned == "" {
		return nil
	}
	return strings.Fields(cleaned)
}

func padBalls(tokens []string, width int) []string {
	result := make([]string, len(tokens))
	for i, token := range tokens {
		n, err := strconv.Atoi(strings.TrimSpace(token))
		if err == nil && width == 2 {
			result[i] = fmt.Sprintf("%02d", n)
		} else {
			result[i] = strings.TrimSpace(token)
		}
	}
	return result
}

func cleanNumeric(raw string) string {
	text := strings.TrimSpace(strings.ReplaceAll(raw, ",", ""))
	if text == "" || text == "-" || text == "--" {
		return ""
	}
	return text
}

func cloneGameDraw(d GameDraw) GameDraw {
	out := d
	out.Front = append([]string(nil), d.Front...)
	out.Back = append([]string(nil), d.Back...)
	if len(d.PrizeGrades) > 0 {
		out.PrizeGrades = append([]PrizeGrade(nil), d.PrizeGrades...)
	}
	return out
}

func cloneGameDraws(draws []GameDraw) []GameDraw {
	out := make([]GameDraw, len(draws))
	for i, d := range draws {
		out[i] = cloneGameDraw(d)
	}
	return out
}
