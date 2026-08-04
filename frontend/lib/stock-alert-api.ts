import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  IntradaySnapshot,
  StockAlertEvent,
  StockAlertSettings,
  StockReminder,
  StockReminderInput,
  StockSymbol,
  StockWatchItem,
} from '@/types/stock-alert';

type ErrorPayload = {
  error?: string;
};

type SearchResponse = { symbols: StockSymbol[] };
type WatchListResponse = { items: StockWatchItem[] };
type EventsResponse = { events: StockAlertEvent[]; unread: number };
type RemindersResponse = { items: StockReminder[] };

export class StockAlertAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'StockAlertAPIError';
    this.code = code;
    this.status = status;
  }
}

export function searchStockSymbols(token: string, query: string) {
  return requestJSON<SearchResponse>(
    `/api/v1/stock-alert/search?q=${encodeURIComponent(query)}`,
    token,
  ).then((payload) => payload.symbols);
}

export function addStockWatch(token: string, query: string) {
  return requestJSON<StockWatchItem>('/api/v1/stock-alert/watch', token, {
    body: JSON.stringify({ query }),
    method: 'POST',
  });
}

export function addStockWatchBySymbol(token: string, symbol: StockSymbol) {
  return requestJSON<StockWatchItem>('/api/v1/stock-alert/watch', token, {
    body: JSON.stringify({ symbol }),
    method: 'POST',
  });
}

export function fetchStockWatchList(token: string) {
  return requestJSON<WatchListResponse>('/api/v1/stock-alert/watch', token).then(
    (payload) => payload.items,
  );
}

export function fetchStockWatch(token: string, symbol: string) {
  return requestJSON<StockWatchItem>(
    `/api/v1/stock-alert/watch/${encodeURIComponent(symbol)}`,
    token,
  );
}

export function updateStockWatch(
  token: string,
  symbol: string,
  input: { enabled?: boolean; reminderTypes?: string[] },
) {
  return requestJSON<StockWatchItem>(
    `/api/v1/stock-alert/watch/${encodeURIComponent(symbol)}`,
    token,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function deleteStockWatch(token: string, symbol: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/stock-alert/watch/${encodeURIComponent(symbol)}`,
    token,
    { method: 'DELETE' },
  );
}

export function reanalyzeStockWatch(token: string, symbol: string) {
  return requestJSON<StockWatchItem>(
    `/api/v1/stock-alert/watch/${encodeURIComponent(symbol)}/reanalyze`,
    token,
    { method: 'POST' },
  );
}

export function fetchStockIntraday(token: string, symbol: string) {
  return requestJSON<IntradaySnapshot>(
    `/api/v1/stock-alert/watch/${encodeURIComponent(symbol)}/intraday`,
    token,
  );
}

export function fetchStockReminders(token: string, symbol?: string) {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return requestJSON<RemindersResponse>(
    `/api/v1/stock-alert/reminders${query}`,
    token,
  ).then((payload) => payload.items);
}

export function createStockReminder(
  token: string,
  symbolCode: string,
  input: StockReminderInput,
) {
  return requestJSON<StockReminder>('/api/v1/stock-alert/reminders', token, {
    body: JSON.stringify({ symbolCode, reminder: input }),
    method: 'POST',
  });
}

export function updateStockReminder(
  token: string,
  reminderId: string,
  input: StockReminderInput,
) {
  return requestJSON<StockReminder>(
    `/api/v1/stock-alert/reminders/${encodeURIComponent(reminderId)}`,
    token,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function deleteStockReminder(token: string, reminderId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/stock-alert/reminders/${encodeURIComponent(reminderId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function fetchStockAlertEvents(token: string, limit = 50) {
  return requestJSON<EventsResponse>(`/api/v1/stock-alert/events?limit=${limit}`, token);
}

export function markStockAlertEventsRead(token: string, eventIds: string[] = []) {
  return requestJSON<{ success: boolean }>('/api/v1/stock-alert/events/read', token, {
    body: JSON.stringify({ eventIds }),
    method: 'POST',
  });
}

export function fetchStockAlertSettings(token: string) {
  return requestJSON<StockAlertSettings>('/api/v1/stock-alert/settings', token);
}

export function saveStockAlertSettings(
  token: string,
  input: { sendKey?: string; reminderEnabled?: boolean },
) {
  return requestJSON<StockAlertSettings>('/api/v1/stock-alert/settings', token, {
    body: JSON.stringify(input),
    method: 'PUT',
  });
}

export function testStockPush(token: string) {
  return requestJSON<{ code: number; message: string }>(
    '/api/v1/stock-alert/settings/test-push',
    token,
    { method: 'POST' },
  );
}

export function getStockAlertErrorMessage(error: unknown) {
  if (!(error instanceof StockAlertAPIError)) {
    return '暂时无法连接行情服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    stock_alert_not_found: '自选标的不存在或已删除。',
    stock_alert_invalid_input: '输入有误，请检查股票代码或名称。',
    stock_alert_source_unavailable: '行情数据源暂时不可用，请稍后重试。',
    stock_alert_source_invalid: '行情数据格式异常，暂时无法分析。',
    stock_alert_insufficient_data: '历史或分时数据不足，无法生成买卖点。',
    stock_alert_analysis_unavailable: 'AI 分析服务暂不可用，请稍后重试。',
    stock_alert_watch_limit_reached: '自选数量已达上限，请先移除一个标的。',
    stock_alert_analysis_limit_reached: '今日分析次数已达上限，请明天再试。',
    stock_alert_sendkey_not_configured: '请先配置 Server酱 SendKey。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '股票交易提醒请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new StockAlertAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
