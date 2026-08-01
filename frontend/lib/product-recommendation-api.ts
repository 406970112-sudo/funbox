import { getAPIBaseUrl } from './auth-api';
import type {
  ProductCatalogItem,
  ProductRecommendationRequest,
  ProductRecommendationResponse,
  RecommendationHistoryItem,
} from '@/types/product-recommendation';

type ErrorPayload = {
  error?: string;
};

export class ProductRecommendationAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ProductRecommendationAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function queryProductRecommendation(
  payload: ProductRecommendationRequest,
  token?: string | null,
  signal?: AbortSignal,
) {
  return requestJSON<ProductRecommendationResponse>('/api/v1/product-recommendation/query', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
    signal,
  });
}

export async function fetchProductCatalog(signal?: AbortSignal) {
  const response = await requestJSON<{ products: ProductCatalogItem[] }>(
    '/api/v1/product-recommendation/catalog',
    { signal },
  );
  return response.products;
}

export async function submitProductRecommendationFeedback(
  payload: { queryId: string; productId: string; helpful: boolean; note?: string },
  token?: string | null,
) {
  await requestJSON<{ success: boolean }>('/api/v1/product-recommendation/feedback', {
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: 'POST',
  });
}

export async function fetchProductRecommendationHistory(token: string, limit = 20) {
  const response = await requestJSON<{ items: RecommendationHistoryItem[] }>(
    `/api/v1/product-recommendation/history?limit=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return response.items;
}

export async function fetchProductRecommendationQuery(queryId: string, token?: string | null) {
  return requestJSON<ProductRecommendationResponse>(
    `/api/v1/product-recommendation/queries/${encodeURIComponent(queryId)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
}

export function getProductRecommendationErrorMessage(error: unknown) {
  if (!(error instanceof ProductRecommendationAPIError)) {
    return '暂时无法连接推荐服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    invalid_request_body: '请检查购买需求，输入内容可能不完整。',
    rate_limited: '请求过于频繁，请稍后再试。',
    recommendation_failed: '推荐生成失败，请调整条件后重试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '推荐请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const baseUrl = getAPIBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new ProductRecommendationAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}
