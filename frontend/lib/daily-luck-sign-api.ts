import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  DailyLuckSignCity,
  DailyLuckSignCompletion,
  DailyLuckSignFetchParams,
  DailyLuckSignHealth,
  DailyLuckSignResponse,
  DailyLuckSignSettings,
} from '@/types/daily-luck-sign';

type ErrorPayload = { error?: string };

export class DailyLuckSignAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'DailyLuckSignAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchDailyLuckSign(params: DailyLuckSignFetchParams) {
  const query = [
    `date=${encodeURIComponent(params.date)}`,
    `lat=${encodeURIComponent(String(params.location.lat))}`,
    `lon=${encodeURIComponent(String(params.location.lon))}`,
    `city=${encodeURIComponent(params.location.name)}`,
    `source=${encodeURIComponent(params.location.source)}`,
  ].join('&');
  return requestJSON<DailyLuckSignResponse>(
    `/api/v1/daily-luck-sign?${query}`,
    params.token,
  );
}

export function searchDailyLuckSignCities(query: string) {
  return requestJSON<{ results: DailyLuckSignCity[] }>(
    `/api/v1/daily-luck-sign/cities?q=${encodeURIComponent(query)}`,
  );
}

export function fetchDailyLuckSignHealth() {
  return requestJSON<DailyLuckSignHealth>('/api/v1/daily-luck-sign/health');
}

export function fetchDailyLuckSignSettings(token: string) {
  return requestJSON<DailyLuckSignSettings>('/api/v1/daily-luck-sign/settings', token);
}

export function saveDailyLuckSignSettings(token: string, settings: DailyLuckSignSettings) {
  return requestJSON<DailyLuckSignSettings>('/api/v1/daily-luck-sign/settings', token, {
    body: JSON.stringify(settings),
    method: 'PUT',
  });
}

export function fetchDailyLuckSignHistory(token: string) {
  return requestJSON<{ records: DailyLuckSignCompletion[] }>(
    '/api/v1/daily-luck-sign/history',
    token,
  );
}

export function addDailyLuckSignCompletion(
  token: string,
  item: Pick<DailyLuckSignCompletion, 'date' | 'ruleId' | 'title'>,
) {
  return requestJSON<DailyLuckSignCompletion>('/api/v1/daily-luck-sign/completions', token, {
    body: JSON.stringify(item),
    method: 'POST',
  });
}

export function deleteDailyLuckSignCompletion(token: string, id: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/daily-luck-sign/completions/${encodeURIComponent(id)}`,
    token,
    { method: 'DELETE' },
  );
}

export function getDailyLuckSignErrorMessage(error: unknown) {
  if (!(error instanceof DailyLuckSignAPIError)) {
    return '暂时无法连接今日运气签服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    daily_luck_sign_location_required: '请先选择城市或开启定位。',
    daily_luck_sign_city_query_required: '请输入城市关键词。',
    daily_luck_sign_invalid_input: '位置或记录内容不完整，请检查后重试。',
    daily_luck_sign_not_found: '记录不存在，可能已被删除。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '今日运气签暂时不可用，请稍后重试。';
}

async function requestJSON<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new DailyLuckSignAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
