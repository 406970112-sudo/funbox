import { getAPIBaseUrl } from './auth-api';
import type {
  CookingAreasResponse,
  CookingContribution,
  CookingContributionInput,
  CookingDishDetail,
  CookingDishListResponse,
  CookingDishSummary,
  CookingFeedbackInput,
  CookingHistoryItem,
  CookingSession,
  CookingSessionInput,
  CookingShoppingListResponse,
} from '@/types/cooking-guide';

type ErrorPayload = {
  error?: string;
};

export class CookingGuideAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'CookingGuideAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchCookingAreas(signal?: AbortSignal) {
  return requestJSON<CookingAreasResponse>('/api/v1/cooking-guide/areas', { signal });
}

export async function fetchCookingDishes(
  params: { q?: string; area?: string; category?: string; tag?: string; limit?: number } = {},
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.area) search.set('area', params.area);
  if (params.category) search.set('category', params.category);
  if (params.tag) search.set('tag', params.tag);
  if (params.limit) search.set('limit', String(params.limit));
  const query = search.toString();
  return requestJSON<CookingDishListResponse>(
    `/api/v1/cooking-guide/dishes${query ? `?${query}` : ''}`,
    { signal },
  );
}

export async function fetchCookingDishDetail(dishId: string, token?: string | null) {
  return requestJSON<CookingDishDetail>(
    `/api/v1/cooking-guide/dishes/${encodeURIComponent(dishId)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export async function fetchCookingShoppingList(dishId: string) {
  return requestJSON<CookingShoppingListResponse>(
    `/api/v1/cooking-guide/dishes/${encodeURIComponent(dishId)}/shopping-list`,
  );
}

export async function saveCookingSession(payload: CookingSessionInput, token: string) {
  return requestJSON<CookingSession>('/api/v1/cooking-guide/sessions', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    method: 'POST',
  });
}

export async function fetchCookingHistory(token: string, limit = 30) {
  const response = await requestJSON<{ items: CookingHistoryItem[] }>(
    `/api/v1/cooking-guide/history?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.items;
}

export async function submitCookingFeedback(payload: CookingFeedbackInput, token?: string | null) {
  await requestJSON<{ success: boolean }>('/api/v1/cooking-guide/feedback', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
  });
}

export async function fetchCookingFavorites(token: string) {
  const response = await requestJSON<{ items: CookingDishSummary[] }>(
    '/api/v1/cooking-guide/favorites',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.items;
}

export async function addCookingFavorite(token: string, dishId: string) {
  await requestJSON<{ success: boolean }>('/api/v1/cooking-guide/favorites', {
    body: JSON.stringify({ dishId }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    method: 'POST',
  });
}

export async function removeCookingFavorite(token: string, dishId: string) {
  await requestJSON<{ success: boolean }>(
    `/api/v1/cooking-guide/favorites/${encodeURIComponent(dishId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      method: 'DELETE',
    },
  );
}

export async function createCookingContribution(payload: CookingContributionInput, token: string) {
  return requestJSON<CookingContribution>('/api/v1/cooking-guide/contributions', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    method: 'POST',
  });
}

export function getCookingGuideErrorMessage(error: unknown) {
  if (!(error instanceof CookingGuideAPIError)) {
    return '暂时无法连接跟做菜谱服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    cooking_guide_dish_not_found: '这道菜谱不存在，可能已被下架。',
    invalid_request_body: '请检查提交内容是否完整。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
    contribution_failed: '菜谱提交失败，请检查后重试。',
  };
  return messages[error.code] || '跟做菜谱请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const baseUrl = getAPIBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new CookingGuideAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}
