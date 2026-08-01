import { getAPIBaseUrl } from './auth-api';
import type {
  FoodCatalogItem,
  FoodHistoryItem,
  FoodRequest,
  FoodResponse,
} from '@/types/food-recommendation';

type ErrorPayload = {
  error?: string;
};

export class FoodRecommendationAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'FoodRecommendationAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function queryFoodRecommendation(
  payload: FoodRequest,
  token?: string | null,
  signal?: AbortSignal,
) {
  return requestJSON<FoodResponse>('/api/v1/food-recommendation/query', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
    signal,
  });
}

export async function fetchFoodCatalog(signal?: AbortSignal) {
  const response = await requestJSON<{ dishes: FoodCatalogItem[] }>(
    '/api/v1/food-recommendation/catalog',
    { signal },
  );
  return response.dishes;
}

export async function submitFoodRecommendationFeedback(
  payload: { queryId: string; dishId: string; helpful: boolean; note?: string },
  token?: string | null,
) {
  await requestJSON<{ success: boolean }>('/api/v1/food-recommendation/feedback', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
  });
}

export async function fetchFoodRecommendationHistory(token: string, limit = 20) {
  const response = await requestJSON<{ items: FoodHistoryItem[] }>(
    `/api/v1/food-recommendation/history?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.items;
}

export async function fetchFoodRecommendationQuery(queryId: string, token?: string | null) {
  return requestJSON<FoodResponse>(
    `/api/v1/food-recommendation/queries/${encodeURIComponent(queryId)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export function getFoodRecommendationErrorMessage(error: unknown) {
  if (!(error instanceof FoodRecommendationAPIError)) {
    return '暂时无法连接美食推荐服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    invalid_request_body: '请检查地址或美食条件，输入内容可能不完整。',
    rate_limited: '请求过于频繁，请稍后再试。',
    food_recommendation_failed: '美食推荐生成失败，请调整条件后重试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '美食推荐请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const baseUrl = getAPIBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new FoodRecommendationAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}
