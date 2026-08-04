package stockalert

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type klineCacheEntry struct {
	klines    []Kline
	fetchedAt time.Time
}

type Service struct {
	store      *Store
	provider   *Provider
	deepseek   *DeepSeekClient
	cfg        Config
	now        func() time.Time
	client     *http.Client
	klineMu    sync.Mutex
	klineCache map[string]klineCacheEntry
}

func NewService(cfg Config, store *Store) *Service {
	if cfg.MinKlines <= 0 {
		cfg.MinKlines = 60
	}
	if cfg.MaxWatchPerUser <= 0 {
		cfg.MaxWatchPerUser = 10
	}
	if cfg.AnalysisDailyLimit <= 0 {
		cfg.AnalysisDailyLimit = 10
	}
	if cfg.MonitorInterval <= 0 {
		cfg.MonitorInterval = 10 * time.Second
	}
	return &Service{
		store:      store,
		provider:   NewProvider(cfg),
		deepseek:   NewDeepSeekClient(cfg.DeepSeekBaseURL, cfg.DeepSeekAPIKey, cfg.DeepSeekModel, cfg.DeepSeekRequestTimeout),
		cfg:        cfg,
		now:        time.Now,
		client:     &http.Client{Timeout: 12 * time.Second},
		klineCache: make(map[string]klineCacheEntry),
	}
}

func (s *Service) Search(ctx context.Context, query string) ([]Symbol, error) {
	symbols, err := s.provider.SearchSymbols(ctx, query)
	if err != nil {
		return nil, err
	}
	s.enrichSearchQuotes(ctx, symbols)
	return symbols, nil
}

func (s *Service) AddWatch(ctx context.Context, userID string, query string) (WatchItem, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return WatchItem{}, fmt.Errorf("%w: query required", ErrInvalidInput)
	}
	symbols, err := s.provider.SearchSymbols(ctx, query)
	if err != nil {
		return WatchItem{}, err
	}
	return s.addWatch(ctx, userID, symbols[0])
}

func (s *Service) AddWatchBySymbol(ctx context.Context, userID string, symbol Symbol) (WatchItem, error) {
	symbol.Code = strings.TrimSpace(symbol.Code)
	symbol.Name = strings.TrimSpace(symbol.Name)
	symbol.Market = strings.TrimSpace(symbol.Market)
	symbol.SecID = strings.TrimSpace(symbol.SecID)
	if symbol.Code == "" || symbol.Name == "" || symbol.Market == "" || symbol.SecID == "" {
		return WatchItem{}, fmt.Errorf("%w: symbol fields required", ErrInvalidInput)
	}
	return s.addWatch(ctx, userID, symbol)
}

func (s *Service) addWatch(ctx context.Context, userID string, symbol Symbol) (WatchItem, error) {
	count, err := s.store.CountWatchItems(ctx, userID)
	if err != nil {
		return WatchItem{}, err
	}
	if count >= s.cfg.MaxWatchPerUser {
		return WatchItem{}, ErrWatchLimitReached
	}
	today := s.now().Format("2006-01-02")
	used, err := s.store.CountAnalysesToday(ctx, userID, today)
	if err != nil {
		return WatchItem{}, err
	}

	klines, err := s.getKlines(ctx, symbol.SecID, symbol.Code, symbol.Market)
	if err != nil {
		return WatchItem{}, err
	}
	if len(klines) < s.cfg.MinKlines {
		return WatchItem{}, fmt.Errorf("%w: %d klines, need %d", ErrInsufficientData, len(klines), s.cfg.MinKlines)
	}
	intraday, err := s.getIntraday(ctx, symbol.SecID, symbol.Code, symbol.Market)
	if err != nil {
		return WatchItem{}, err
	}
	quote, err := s.fetchQuoteWithFallback(ctx, symbol.SecID, symbol.Code, symbol.Market)
	if err != nil {
		return WatchItem{}, err
	}
	features, err := BuildFeatures(klines, intraday, quote)
	if err != nil {
		return WatchItem{}, err
	}
	var rule SignalRule
	var analysisErr error
	if used < s.cfg.AnalysisDailyLimit {
		rule, analysisErr = s.deepseek.Analyze(ctx, features)
	} else {
		analysisErr = ErrAnalysisLimitReached
	}

	validUntil := ""
	if analysisErr == nil && rule.ValidTradingDays > 0 {
		validUntil = tradingDaysFrom(s.now(), rule.ValidTradingDays)
	}
	item, err := s.store.GetWatchItem(ctx, userID, symbol.Code)
	if errors.Is(err, ErrNotFound) {
		item = WatchItem{
			ID:            uuid.NewString(),
			UserID:        userID,
			SymbolCode:    symbol.Code,
			Name:          symbol.Name,
			Market:        symbol.Market,
			SecID:         symbol.SecID,
			Enabled:       true,
			ReminderTypes: []string{"buy", "sell", "stop"},
			ValidUntil:    validUntil,
			CreatedAt:     s.now(),
		}
		if err := s.store.AddWatchItem(ctx, item); err != nil {
			return WatchItem{}, err
		}
	} else if err != nil {
		return WatchItem{}, err
	}
	if analysisErr == nil {
		analysis := Analysis{
			WatchItemID: item.ID,
			Model:       s.deepseek.Model,
			DataEndDate: features.DataEndDate,
			Rule:        rule,
		}
		if err := s.store.AttachAnalysis(ctx, item.ID, analysis, validUntil); err != nil {
			return WatchItem{}, err
		}
	}
	return s.GetWatch(ctx, userID, symbol.Code)
}

func (s *Service) enrichSearchQuotes(ctx context.Context, symbols []Symbol) {
	limit := len(symbols)
	if limit > 8 {
		limit = 8
	}
	workers := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for index := 0; index < limit; index++ {
		if !symbols[index].Tradable {
			continue
		}
		wg.Add(1)
		workers <- struct{}{}
		go func(symbol *Symbol) {
			defer wg.Done()
			defer func() { <-workers }()
			quote, err := s.fetchQuoteWithFallback(ctx, symbol.SecID, symbol.Code, symbol.Market)
			if err != nil {
				return
			}
			symbol.LatestPrice = quote.Price
			symbol.ChangePct = quote.ChangePct
		}(&symbols[index])
	}
	wg.Wait()
}

func (s *Service) ListWatch(ctx context.Context, userID string) ([]WatchItem, error) {
	items, err := s.store.ListWatchItems(ctx, userID)
	if err != nil {
		return nil, err
	}
	for index := range items {
		analysis, err := s.store.GetAnalysis(ctx, items[index].ID)
		if err == nil {
			items[index].Analysis = analysis
		}
		s.refreshItem(ctx, &items[index])
	}
	return items, nil
}

func (s *Service) GetWatch(ctx context.Context, userID string, symbolCode string) (WatchItem, error) {
	item, err := s.store.GetWatchItem(ctx, userID, symbolCode)
	if err != nil {
		return WatchItem{}, err
	}
	analysis, err := s.store.GetAnalysis(ctx, item.ID)
	if err == nil {
		item.Analysis = analysis
	}
	s.refreshItem(ctx, &item)
	return item, nil
}

func (s *Service) UpdateWatch(ctx context.Context, userID string, symbolCode string, enabled *bool, reminderTypes []string) (WatchItem, error) {
	if len(reminderTypes) > 0 {
		allowed := map[string]bool{"buy": true, "sell": true, "stop": true}
		for _, kind := range reminderTypes {
			if !allowed[kind] {
				return WatchItem{}, fmt.Errorf("%w: invalid reminder type", ErrInvalidInput)
			}
		}
	}
	_, err := s.store.UpdateWatchItem(ctx, userID, symbolCode, enabled, reminderTypes)
	if err != nil {
		return WatchItem{}, err
	}
	return s.GetWatch(ctx, userID, symbolCode)
}

func (s *Service) ListReminders(ctx context.Context, userID string, symbolCode string) ([]Reminder, error) {
	if symbolCode != "" {
		item, err := s.store.GetWatchItem(ctx, userID, symbolCode)
		if err != nil {
			return nil, err
		}
		return s.store.ListRemindersByWatchItem(ctx, userID, item.ID)
	}
	return s.store.ListReminders(ctx, userID)
}

func (s *Service) CreateReminder(ctx context.Context, userID string, symbolCode string, input ReminderInput) (Reminder, error) {
	item, err := s.store.GetWatchItem(ctx, userID, symbolCode)
	if err != nil {
		return Reminder{}, err
	}
	if input.RuleType == ReminderAI {
		refreshed, reanalyzeErr := s.Reanalyze(ctx, userID, symbolCode)
		if reanalyzeErr != nil {
			return Reminder{}, reanalyzeErr
		}
		item = refreshed
	}
	reminder, err := normalizeReminderInput(input)
	if err != nil {
		return Reminder{}, err
	}
	now := s.now()
	reminder.ID = uuid.NewString()
	reminder.UserID = userID
	reminder.WatchItemID = item.ID
	reminder.SymbolCode = item.SymbolCode
	reminder.Name = item.Name
	reminder.CreatedAt = now
	reminder.UpdatedAt = now
	if err := s.store.CreateReminder(ctx, reminder); err != nil {
		return Reminder{}, err
	}
	return reminder, nil
}

func (s *Service) UpdateReminder(ctx context.Context, userID string, reminderID string, input ReminderInput) (Reminder, error) {
	current, err := s.store.GetReminder(ctx, userID, reminderID)
	if err != nil {
		return Reminder{}, err
	}
	next, err := normalizeReminderInput(input)
	if err != nil {
		return Reminder{}, err
	}
	current.RuleType = next.RuleType
	current.Direction = next.Direction
	current.Threshold = next.Threshold
	current.TimeRange = next.TimeRange
	current.ValidDays = next.ValidDays
	current.Channels = next.Channels
	if input.Enabled != nil {
		current.Enabled = *input.Enabled
	}
	current.UpdatedAt = s.now()
	if err := s.store.UpdateReminder(ctx, current); err != nil {
		return Reminder{}, err
	}
	return current, nil
}

func (s *Service) DeleteReminder(ctx context.Context, userID string, reminderID string) error {
	return s.store.DeleteReminder(ctx, userID, reminderID)
}

func (s *Service) DeleteWatch(ctx context.Context, userID string, symbolCode string) error {
	return s.store.DeleteWatchItem(ctx, userID, symbolCode)
}

func (s *Service) Reanalyze(ctx context.Context, userID string, symbolCode string) (WatchItem, error) {
	item, err := s.store.GetWatchItem(ctx, userID, symbolCode)
	if err != nil {
		return WatchItem{}, err
	}
	today := s.now().Format("2006-01-02")
	used, err := s.store.CountAnalysesToday(ctx, userID, today)
	if err != nil {
		return WatchItem{}, err
	}
	if used >= s.cfg.AnalysisDailyLimit {
		return WatchItem{}, ErrAnalysisLimitReached
	}
	klines, err := s.getKlines(ctx, item.SecID, item.SymbolCode, item.Market)
	if err != nil {
		return WatchItem{}, err
	}
	if len(klines) < s.cfg.MinKlines {
		return WatchItem{}, fmt.Errorf("%w: %d klines, need %d", ErrInsufficientData, len(klines), s.cfg.MinKlines)
	}
	intraday, err := s.getIntraday(ctx, item.SecID, item.SymbolCode, item.Market)
	if err != nil {
		return WatchItem{}, err
	}
	quote, err := s.fetchQuoteWithFallback(ctx, item.SecID, item.SymbolCode, item.Market)
	if err != nil {
		return WatchItem{}, err
	}
	features, err := BuildFeatures(klines, intraday, quote)
	if err != nil {
		return WatchItem{}, err
	}
	rule, err := s.deepseek.Analyze(ctx, features)
	if err != nil {
		return WatchItem{}, err
	}
	analysis := Analysis{
		WatchItemID: item.ID,
		Model:       s.deepseek.Model,
		DataEndDate: features.DataEndDate,
		Rule:        rule,
	}
	if err := s.store.AttachAnalysis(ctx, item.ID, analysis, tradingDaysFrom(s.now(), rule.ValidTradingDays)); err != nil {
		return WatchItem{}, err
	}
	return s.GetWatch(ctx, userID, symbolCode)
}

func (s *Service) Intraday(ctx context.Context, userID string, symbolCode string) (IntradaySnapshot, error) {
	if _, err := s.store.GetWatchItem(ctx, userID, symbolCode); err != nil {
		return IntradaySnapshot{}, err
	}
	item, err := s.store.GetWatchItem(ctx, userID, symbolCode)
	if err != nil {
		return IntradaySnapshot{}, err
	}
	return s.getIntraday(ctx, item.SecID, item.SymbolCode, item.Market)
}

func (s *Service) Events(ctx context.Context, userID string, limit int) ([]AlertEvent, int, error) {
	events, err := s.store.ListEvents(ctx, userID, limit)
	if err != nil {
		return nil, 0, err
	}
	unread := 0
	for _, event := range events {
		if event.ReadAt == nil {
			unread++
		}
	}
	return events, unread, nil
}

func (s *Service) MarkEventsRead(ctx context.Context, userID string, eventIDs []string) error {
	return s.store.MarkEventsRead(ctx, userID, eventIDs)
}

func (s *Service) GetSettings(ctx context.Context, userID string) (Settings, error) {
	return s.store.GetSettings(ctx, userID)
}

func (s *Service) SaveSettings(ctx context.Context, userID string, sendKey string, reminderEnabled bool) (Settings, error) {
	sendKey = strings.TrimSpace(sendKey)
	if err := s.store.SaveSettings(ctx, userID, sendKey, reminderEnabled); err != nil {
		return Settings{}, err
	}
	return s.store.GetSettings(ctx, userID)
}

func (s *Service) TestPush(ctx context.Context, userID string) (map[string]any, error) {
	sendKey, err := s.resolveSendKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	if sendKey == "" {
		return nil, ErrSendKeyNotConfigured
	}
	response, err := s.pushServerChan(ctx, sendKey,
		"FunBox 股票交易提醒测试",
		"测试推送成功\n\n如果收到这条消息，说明 Server酱 已配置完成。\n\n仅供信息参考，不构成投资建议。",
		"FunBox 股票提醒测试")
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"code":    response.Code,
		"message": response.Message,
	}, nil
}

func (s *Service) Run(ctx context.Context) {
	if !s.cfg.Enabled {
		return
	}
	ticker := time.NewTicker(s.cfg.MonitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Service) tick(ctx context.Context) {
	items, err := s.store.ListAllWatchItems(ctx)
	if err != nil {
		return
	}
	for _, item := range items {
		if !item.Enabled || !s.isTradingTime(item.Market) {
			continue
		}
		if item.ValidUntil != "" && item.ValidUntil < s.now().Format("2006-01-02") {
			continue
		}
		analysis, err := s.store.GetAnalysis(ctx, item.ID)
		if err != nil || analysis == nil {
			continue
		}
		item.Analysis = analysis
		quote, err := s.provider.FetchQuote(ctx, item.SecID, false)
		if err != nil {
			continue
		}
		klines, err := s.getKlines(ctx, item.SecID, item.SymbolCode, item.Market)
		if err != nil {
			continue
		}
		intraday, err := s.getIntraday(ctx, item.SecID, item.SymbolCode, item.Market)
		if err != nil {
			intraday = IntradaySnapshot{}
		}
		features, err := BuildFeatures(klines, intraday, quote)
		if err != nil {
			continue
		}
		reminders, _ := s.store.ListRemindersByWatchItem(ctx, item.UserID, item.ID)
		hasCustomReminder := false
		for _, reminder := range reminders {
			if reminder.Enabled {
				hasCustomReminder = true
			}
		}
		for _, reminder := range reminders {
			if !reminder.Enabled || !containsString(reminder.Channels, ChannelApp) {
				continue
			}
			date := s.now().In(shanghaiLocation()).Format("2006-01-02")
			duplicate, _ := s.store.HasReminderEventOnDate(ctx, reminder.ID, date)
			if duplicate {
				continue
			}
			triggered, conditions := s.evaluateReminder(reminder, item, features, quote)
			if !triggered {
				continue
			}
			event := AlertEvent{
				ID:             uuid.NewString(),
				UserID:         item.UserID,
				WatchItemID:    item.ID,
				ReminderID:     reminder.ID,
				ReminderLabel:  reminderLabel(reminder),
				SymbolCode:     item.SymbolCode,
				Name:           item.Name,
				Direction:      reminder.Direction,
				SignalStrength: StrengthConfirmed,
				TriggerTime:    s.now(),
				TriggerPrice:   quote.Price,
				AvgPrice:       features.IntradayAvg,
				Conditions:     conditions,
				CreatedAt:      s.now(),
			}
			if err := s.store.AddEvent(ctx, event); err != nil {
				continue
			}
			if !containsString(reminder.Channels, ChannelServerChan) {
				continue
			}
			sendKey, err := s.resolveSendKey(ctx, item.UserID)
			if err != nil || sendKey == "" {
				_ = s.store.UpdateEventPush(ctx, event.ID, false, "sendkey_not_configured")
				continue
			}
			ok, message := s.pushReminder(ctx, sendKey, item, reminder, quote, features)
			_ = s.store.UpdateEventPush(ctx, event.ID, ok, message)
		}
		if hasCustomReminder {
			continue
		}
		direction, strength, triggered := evaluateSignal(item, features, quote)
		if !triggered || !containsString(item.ReminderTypes, direction) {
			continue
		}
		date := s.now().In(shanghaiLocation()).Format("2006-01-02")
		if strength == StrengthConfirmed {
			duplicate, _ := s.store.HasConfirmedEventOnDate(ctx, item.ID, direction, date)
			if duplicate {
				continue
			}
		} else {
			within, _ := s.store.HasEventWithin(ctx, item.ID, direction, 30)
			if within {
				continue
			}
		}
		event := AlertEvent{
			ID:             uuid.NewString(),
			UserID:         item.UserID,
			WatchItemID:    item.ID,
			SymbolCode:     item.SymbolCode,
			Name:           item.Name,
			Direction:      direction,
			SignalStrength: strength,
			TriggerTime:    s.now(),
			TriggerPrice:   quote.Price,
			AvgPrice:       features.IntradayAvg,
			Conditions:     signalConditions(analysis.Rule, direction),
			CreatedAt:      s.now(),
		}
		if err := s.store.AddEvent(ctx, event); err != nil {
			continue
		}
		if strength != StrengthConfirmed {
			continue
		}
		sendKey, err := s.resolveSendKey(ctx, item.UserID)
		if err != nil || sendKey == "" {
			_ = s.store.UpdateEventPush(ctx, event.ID, false, "sendkey_not_configured")
			continue
		}
		ok, message := s.pushSignal(ctx, sendKey, item, direction, quote, features)
		_ = s.store.UpdateEventPush(ctx, event.ID, ok, message)
	}
}

func (s *Service) refreshItem(ctx context.Context, item *WatchItem) {
	quote, err := s.fetchQuoteWithFallback(ctx, item.SecID, item.SymbolCode, item.Market)
	if err != nil {
		item.SignalStatus = SignalDataMissing
		item.QuoteStale = true
		return
	}
	item.LatestPrice = quote.Price
	item.ChangePct = quote.ChangePct
	if intraday, err := s.getIntraday(ctx, item.SecID, item.SymbolCode, item.Market); err == nil && len(intraday.Points) > 0 {
		item.AvgPrice = intraday.Latest.AvgPrice
		item.IntradayTime = intraday.Latest.Time
	}
	item.SignalStatus = computeStatus(*item, quote)
}

func (s *Service) fetchQuoteWithFallback(ctx context.Context, secID string, code string, market string) (Quote, error) {
	quote, err := s.provider.FetchQuote(ctx, secID, false)
	if err == nil {
		return quote, nil
	}
	quote, delayedErr := s.provider.FetchQuote(ctx, secID, true)
	if delayedErr != nil {
		tencentQuote, tencentErr := s.provider.FetchQuoteTencent(ctx, code, market)
		if tencentErr != nil {
			return Quote{}, fmt.Errorf("%w: eastmoney quote=%v tencent quote=%v", ErrSourceUnavailable, err, tencentErr)
		}
		tencentQuote.Delayed = true
		return tencentQuote, nil
	}
	return quote, nil
}

func (s *Service) getKlines(ctx context.Context, secID string, code string, market string) ([]Kline, error) {
	s.klineMu.Lock()
	entry, exists := s.klineCache[secID]
	s.klineMu.Unlock()
	if exists && s.now().Sub(entry.fetchedAt) < 30*time.Minute {
		return entry.klines, nil
	}
	klines, err := s.provider.FetchKlines(ctx, secID)
	if errors.Is(err, ErrSourceUnavailable) {
		fallback, fallbackErr := s.provider.FetchKlinesTencent(ctx, code, market)
		if fallbackErr != nil {
			return nil, fmt.Errorf("%w: eastmoney kline=%v tencent kline=%v", ErrSourceUnavailable, err, fallbackErr)
		}
		klines = fallback
		err = nil
	}
	if err != nil {
		return nil, err
	}
	s.klineMu.Lock()
	s.klineCache[secID] = klineCacheEntry{klines: klines, fetchedAt: s.now()}
	s.klineMu.Unlock()
	return klines, nil
}

func (s *Service) getIntraday(ctx context.Context, secID string, code string, market string) (IntradaySnapshot, error) {
	intraday, err := s.provider.FetchIntraday(ctx, secID)
	if err == nil {
		return intraday, nil
	}
	if !errors.Is(err, ErrSourceUnavailable) {
		return IntradaySnapshot{}, err
	}
	fallback, fallbackErr := s.provider.FetchIntradayTencent(ctx, code, market)
	if fallbackErr != nil {
		return IntradaySnapshot{}, fmt.Errorf("%w: eastmoney intraday=%v tencent intraday=%v", ErrSourceUnavailable, err, fallbackErr)
	}
	return fallback, nil
}

func (s *Service) resolveSendKey(ctx context.Context, userID string) (string, error) {
	key, err := s.store.SendKey(ctx, userID)
	if err != nil {
		return "", err
	}
	if key != "" {
		return key, nil
	}
	return s.cfg.SendKey, nil
}

func (s *Service) pushSignal(ctx context.Context, sendKey string, item WatchItem, direction string, quote Quote, features Features) (bool, string) {
	label := directionLabel(direction)
	title := fmt.Sprintf("FunBox提醒 | %s(%s) 分时%s信号触发", item.Name, item.SymbolCode, label)
	desp := fmt.Sprintf(
		"**%s %s**\n\n- 触发时刻：%s\n- 最新分时价：%.2f\n- 分时均价：%.2f\n- 触发价：%.2f\n\n仅供信息参考，不构成投资建议。",
		item.Name, label, s.now().Format("2006-01-02 15:04:05"), quote.Price, features.IntradayAvg, triggerPriceForDirection(item.Analysis.Rule, direction),
	)
	short := fmt.Sprintf("%s %s %.2f", item.Name, label, quote.Price)
	response, err := s.pushServerChan(ctx, sendKey, title, desp, short)
	if err != nil {
		return false, err.Error()
	}
	if response.Code != 0 {
		return false, fmt.Sprintf("serverchan code=%d %s", response.Code, response.Message)
	}
	return true, "pushed"
}

type serverChanResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (s *Service) pushServerChan(ctx context.Context, sendKey string, title string, desp string, short string) (serverChanResponse, error) {
	endpoint := "https://sctapi.ftqq.com/" + sendKey + ".send"
	if strings.HasPrefix(sendKey, "sctp") {
		endpoint = "https://" + sendKey + ".push.ft07.com/send"
	}
	body, _ := json.Marshal(map[string]string{
		"title": title,
		"desp":  desp,
		"short": short,
	})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return serverChanResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json;charset=utf-8")
	response, err := s.client.Do(request)
	if err != nil {
		return serverChanResponse{}, err
	}
	defer response.Body.Close()
	var payload serverChanResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return serverChanResponse{}, err
	}
	return payload, nil
}

func computeStatus(item WatchItem, quote Quote) string {
	if item.Analysis == nil {
		return SignalDataMissing
	}
	if item.ValidUntil != "" && item.ValidUntil < time.Now().Format("2006-01-02") {
		return SignalExpired
	}
	if quote.Price <= 0 {
		return SignalDataMissing
	}
	rule := &item.Analysis.Rule
	switch {
	case quote.Price <= rule.StopLoss:
		return SignalStopTriggered
	case quote.Price >= rule.SellTrigger:
		return SignalSellTriggered
	case quote.Price >= rule.BuyTrigger:
		return SignalBuyTriggered
	case quote.Price >= rule.BuyReferenceLow*0.99 && quote.Price < rule.BuyTrigger:
		return SignalNearBuy
	default:
		return SignalListening
	}
}

func evaluateSignal(item WatchItem, features Features, quote Quote) (string, string, bool) {
	rule := &item.Analysis.Rule
	price := quote.Price
	switch {
	case price <= rule.StopLoss:
		return "stop", StrengthConfirmed, true
	case price >= rule.SellTrigger && features.VolumeRatio >= 1.1 && features.Latest5mChange >= 0.2:
		return "sell", StrengthConfirmed, true
	case price >= rule.SellTrigger*0.99 && price < rule.SellTrigger:
		return "sell", StrengthObservation, true
	case price >= rule.BuyTrigger && features.IntradayAboveAvg && features.VolumeRatio >= 1.1:
		return "buy", StrengthConfirmed, true
	case price >= rule.BuyReferenceLow && price < rule.BuyTrigger:
		return "buy", StrengthObservation, true
	default:
		return "", "", false
	}
}

func (s *Service) evaluateReminder(reminder Reminder, item WatchItem, features Features, quote Quote) (bool, []string) {
	switch reminder.RuleType {
	case ReminderPrice:
		if reminder.Direction == "up" && quote.Price >= reminder.Threshold {
			return true, []string{fmt.Sprintf("分时价达到 %.2f", reminder.Threshold)}
		}
		if reminder.Direction == "down" && quote.Price <= reminder.Threshold {
			return true, []string{fmt.Sprintf("分时价跌破 %.2f", reminder.Threshold)}
		}
	case ReminderChange:
		if reminder.Direction == "up" && features.ChangePct >= reminder.Threshold {
			return true, []string{fmt.Sprintf("涨跌幅达到 %.2f%%", reminder.Threshold)}
		}
		if reminder.Direction == "down" && features.ChangePct <= reminder.Threshold {
			return true, []string{fmt.Sprintf("涨跌幅跌破 %.2f%%", reminder.Threshold)}
		}
	case ReminderAvg:
		if reminder.Direction == "up" && features.IntradayAboveAvg {
			return true, []string{"分时价位于分时均价上方"}
		}
		if reminder.Direction == "down" && !features.IntradayAboveAvg {
			return true, []string{"分时价位于分时均价下方"}
		}
	case ReminderVolume:
		if reminder.Direction == "up" && features.VolumeRatio >= reminder.Threshold {
			return true, []string{fmt.Sprintf("量比达到 %.2f", reminder.Threshold)}
		}
		if reminder.Direction == "down" && features.VolumeRatio <= reminder.Threshold {
			return true, []string{fmt.Sprintf("量比跌破 %.2f", reminder.Threshold)}
		}
	case ReminderAI:
		if item.Analysis == nil {
			return false, nil
		}
		direction, strength, triggered := evaluateSignal(item, features, quote)
		if triggered && strength == StrengthConfirmed && direction == reminder.Direction {
			return true, signalConditions(item.Analysis.Rule, direction)
		}
	}
	return false, nil
}

func normalizeReminderInput(input ReminderInput) (Reminder, error) {
	input.RuleType = strings.TrimSpace(input.RuleType)
	input.Direction = strings.TrimSpace(input.Direction)
	input.TimeRange = strings.TrimSpace(input.TimeRange)
	allowedTypes := map[string]bool{
		ReminderPrice: true, ReminderChange: true, ReminderAvg: true,
		ReminderVolume: true, ReminderAI: true,
	}
	if !allowedTypes[input.RuleType] {
		return Reminder{}, fmt.Errorf("%w: invalid reminder type", ErrInvalidInput)
	}
	switch input.RuleType {
	case ReminderPrice, ReminderChange, ReminderAvg, ReminderVolume:
		if input.Direction != "up" && input.Direction != "down" {
			return Reminder{}, fmt.Errorf("%w: reminder direction must be up/down", ErrInvalidInput)
		}
	case ReminderAI:
		if input.Direction != "buy" && input.Direction != "sell" && input.Direction != "stop" {
			return Reminder{}, fmt.Errorf("%w: ai direction must be buy/sell/stop", ErrInvalidInput)
		}
	}
	if input.RuleType == ReminderPrice || input.RuleType == ReminderVolume {
		if input.Threshold <= 0 {
			return Reminder{}, fmt.Errorf("%w: threshold must be positive", ErrInvalidInput)
		}
	}
	if input.TimeRange == "" {
		input.TimeRange = "09:30-15:00"
	}
	if input.ValidDays <= 0 {
		input.ValidDays = 5
	}
	if input.ValidDays > 30 {
		return Reminder{}, fmt.Errorf("%w: valid days cannot exceed 30", ErrInvalidInput)
	}
	if len(input.Channels) == 0 {
		input.Channels = []string{ChannelApp, ChannelServerChan}
	}
	channels := make([]string, 0, len(input.Channels))
	for _, channel := range input.Channels {
		channel = strings.TrimSpace(channel)
		if channel == ChannelApp || channel == ChannelServerChan {
			channels = append(channels, channel)
		}
	}
	if len(channels) == 0 {
		return Reminder{}, fmt.Errorf("%w: reminder channel required", ErrInvalidInput)
	}
	if !containsString(channels, ChannelApp) {
		channels = append([]string{ChannelApp}, channels...)
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	return Reminder{
		RuleType:  input.RuleType,
		Direction: input.Direction,
		Threshold: input.Threshold,
		TimeRange: input.TimeRange,
		ValidDays: input.ValidDays,
		Channels:  channels,
		Enabled:   enabled,
	}, nil
}

func reminderLabel(reminder Reminder) string {
	typeLabels := map[string]string{
		ReminderPrice:  "价格",
		ReminderChange: "涨跌幅",
		ReminderAvg:    "分时均线",
		ReminderVolume: "量能",
		ReminderAI:     "AI信号",
	}
	if reminder.RuleType == ReminderAI {
		return fmt.Sprintf("%s · %s", typeLabels[reminder.RuleType], directionLabel(reminder.Direction))
	}
	action := "达到"
	if reminder.Direction == "up" {
		action = "向上突破"
	} else if reminder.Direction == "down" {
		action = "向下跌破"
	}
	if reminder.RuleType == ReminderAvg {
		return fmt.Sprintf("%s · %s", typeLabels[reminder.RuleType], action)
	}
	return fmt.Sprintf("%s · %s %.2f", typeLabels[reminder.RuleType], action, reminder.Threshold)
}

func (s *Service) pushReminder(ctx context.Context, sendKey string, item WatchItem, reminder Reminder, quote Quote, features Features) (bool, string) {
	title := fmt.Sprintf("FunBox提醒 | %s(%s) %s触发", item.Name, item.SymbolCode, reminderLabel(reminder))
	desp := fmt.Sprintf(
		"**%s %s**\n\n- 触发时刻：%s\n- 最新分时价：%.2f\n- 分时均价：%.2f\n- 条件：%s\n\n仅供信息参考，不构成投资建议。",
		item.Name, reminderLabel(reminder), s.now().Format("2006-01-02 15:04:05"),
		quote.Price, features.IntradayAvg, reminderLabel(reminder),
	)
	short := fmt.Sprintf("%s %s %.2f", item.Name, reminderLabel(reminder), quote.Price)
	response, err := s.pushServerChan(ctx, sendKey, title, desp, short)
	if err != nil {
		return false, err.Error()
	}
	if response.Code != 0 {
		return false, fmt.Sprintf("serverchan code=%d %s", response.Code, response.Message)
	}
	return true, "pushed"
}

func signalConditions(rule SignalRule, direction string) []string {
	if direction == "buy" {
		return rule.BuyConditions
	}
	if direction == "sell" {
		return rule.SellConditions
	}
	return []string{fmt.Sprintf("分时价跌破止损价 %.2f", rule.StopLoss)}
}

func triggerPriceForDirection(rule SignalRule, direction string) float64 {
	switch direction {
	case "buy":
		return rule.BuyTrigger
	case "sell":
		return rule.SellTrigger
	default:
		return rule.StopLoss
	}
}

func directionLabel(direction string) string {
	switch direction {
	case "buy":
		return "买入"
	case "sell":
		return "卖出"
	case "stop":
		return "止损"
	default:
		return direction
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func tradingDaysFrom(now time.Time, days int) string {
	if days <= 0 {
		days = 5
	}
	date := now
	added := 0
	for added < days {
		date = date.AddDate(0, 0, 1)
		if date.Weekday() != time.Saturday && date.Weekday() != time.Sunday {
			added++
		}
	}
	return date.Format("2006-01-02")
}

func (s *Service) isTradingTime(market string) bool {
	now := s.now()
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return false
	}
	locationName := "Asia/Shanghai"
	if market == "US" {
		locationName = "America/New_York"
	}
	location, err := time.LoadLocation(locationName)
	if err != nil {
		location = time.UTC
	}
	local := now.In(location)
	value := local.Hour()*100 + local.Minute()
	switch market {
	case "US":
		return value >= 930 && value < 1600
	case "HK":
		return (value >= 930 && value < 1200) || (value >= 1300 && value < 1600)
	default:
		return (value >= 930 && value < 1130) || (value >= 1300 && value < 1500)
	}
}

func shanghaiLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.UTC
	}
	return location
}
