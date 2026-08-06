import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  HomeConsumablesCategory,
  HomeConsumablesEvent,
  HomeConsumablesEventInput,
  HomeConsumablesItem,
  HomeConsumablesItemInput,
  HomeConsumablesReminder,
  HomeConsumablesStats,
  HomeConsumablesSummary,
} from '@/types/home-consumables';

type ErrorPayload = { error?: string };

export class HomeConsumablesAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'HomeConsumablesAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchHomeConsumablesSummary(token: string, date?: string) {
  return requestJSON<HomeConsumablesSummary>(
    `/api/v1/home-consumables/summary${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
}

export async function fetchHomeConsumablesItems(
  token: string,
  params: { category?: string; state?: string; q?: string; sort?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.state) query.set('state', params.state);
  if (params.q) query.set('q', params.q);
  if (params.sort) query.set('sort', params.sort);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await requestJSON<{ items: HomeConsumablesItem[] }>(
    `/api/v1/home-consumables/items${suffix}`,
    token,
  );
  return payload.items;
}

export function fetchHomeConsumablesItem(token: string, itemId: string) {
  return requestJSON<HomeConsumablesItem>(
    `/api/v1/home-consumables/items/${encodeURIComponent(itemId)}`,
    token,
  );
}

export function createHomeConsumablesItem(token: string, input: HomeConsumablesItemInput) {
  return requestJSON<HomeConsumablesItem>('/api/v1/home-consumables/items', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateHomeConsumablesItem(
  token: string,
  itemId: string,
  input: Partial<HomeConsumablesItemInput>,
) {
  return requestJSON<HomeConsumablesItem>(
    `/api/v1/home-consumables/items/${encodeURIComponent(itemId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteHomeConsumablesItem(token: string, itemId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/home-consumables/items/${encodeURIComponent(itemId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchHomeConsumablesItemEvents(token: string, itemId: string) {
  const payload = await requestJSON<{ events: HomeConsumablesEvent[] }>(
    `/api/v1/home-consumables/items/${encodeURIComponent(itemId)}/events`,
    token,
  );
  return payload.events;
}

export async function fetchHomeConsumablesEvents(token: string) {
  const payload = await requestJSON<{ events: HomeConsumablesEvent[] }>(
    '/api/v1/home-consumables/events',
    token,
  );
  return payload.events;
}

export function createHomeConsumablesEvent(
  token: string,
  itemId: string,
  input: HomeConsumablesEventInput,
) {
  return requestJSON<HomeConsumablesItem>(
    `/api/v1/home-consumables/items/${encodeURIComponent(itemId)}/events`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function undoHomeConsumablesEvent(token: string, eventId: string) {
  return requestJSON<HomeConsumablesItem>(
    `/api/v1/home-consumables/events/${encodeURIComponent(eventId)}/undo`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export async function fetchHomeConsumablesShoppingList(token: string, date?: string) {
  const payload = await requestJSON<{ date: string; items: HomeConsumablesItem[] }>(
    `/api/v1/home-consumables/shopping-list${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
  return payload.items;
}

export async function fetchHomeConsumablesCategories(token: string) {
  const payload = await requestJSON<{ categories: HomeConsumablesCategory[] }>(
    '/api/v1/home-consumables/categories',
    token,
  );
  return payload.categories;
}

export function createHomeConsumablesCategory(
  token: string,
  input: {
    name: string;
    icon?: string;
    color?: string;
    defaultUnit?: string;
    defaultRemindDays?: number;
  },
) {
  return requestJSON<HomeConsumablesCategory>('/api/v1/home-consumables/categories', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function fetchHomeConsumablesStats(token: string, range = '30d') {
  return requestJSON<HomeConsumablesStats>(
    `/api/v1/home-consumables/stats?range=${encodeURIComponent(range)}`,
    token,
  );
}

export async function fetchHomeConsumablesReminders(token: string, date?: string) {
  const payload = await requestJSON<{ reminders: HomeConsumablesReminder[] }>(
    `/api/v1/home-consumables/reminders${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
  return payload.reminders;
}

export function dismissHomeConsumablesReminder(token: string, itemId: string, remindAt: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/home-consumables/reminders/${encodeURIComponent(itemId)}/dismiss?date=${encodeURIComponent(remindAt)}`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export async function importHomeConsumablesData(
  token: string,
  payload: { items: Array<{ item: HomeConsumablesItemInput; categoryName?: string; events?: HomeConsumablesEventInput[] }> },
) {
  const result = await requestJSON<{ created: number }>('/api/v1/home-consumables/import', token, {
    body: JSON.stringify(payload),
    method: 'POST',
  });
  return result.created;
}

export function getHomeConsumablesExportUrl(format: 'csv' | 'json') {
  return `${getAPIBaseUrl()}/api/v1/home-consumables/export?format=${format}`;
}

export function getHomeConsumablesErrorMessage(error: unknown) {
  if (!(error instanceof HomeConsumablesAPIError)) {
    return '暂时无法连接家庭消耗品预测服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    home_consumables_invalid_input: '请检查名称、单位、数量和日期是否填写正确。',
    home_consumables_insufficient_stock: '当前余量不足，请先记录买了一份再换新。',
    home_consumables_not_found: '物品或事件不存在，可能已被删除。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '家庭消耗品预测操作失败，请稍后重试。';
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
    throw new HomeConsumablesAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
