import { getAPIBaseUrl } from '@/lib/auth-api';
import type { ResourceSearchSourceId } from '@/lib/resource-search';
import type {
  ResolvedResourceResult,
  ResourceSearchSourceResponse,
} from '@/types/resource-search';

type ErrorPayload = {
  detail?: string;
  error?: string;
};

export class ResourceSearchAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ResourceSearchAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function searchResourceSource(
  query: string,
  sourceId: ResourceSearchSourceId,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ q: query, source: sourceId });
  return requestJSON<ResourceSearchSourceResponse>(
    `/api/v1/resource-search/search?${params.toString()}`,
    { signal },
  );
}

export async function resolveResourceResult(resultId: string, signal?: AbortSignal) {
  return requestJSON<ResolvedResourceResult>(
    `/api/v1/resource-search/results/${encodeURIComponent(resultId)}/resolve`,
    { method: 'POST', signal },
  );
}

export function getResourceSearchErrorMessage(error: unknown) {
  if (!(error instanceof ResourceSearchAPIError)) {
    return '暂时无法连接聚合搜索服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    rate_limited: '搜索过于频繁，请稍后再试。',
    resource_result_expired: '这条结果已过期，请重新搜索。',
    resource_result_resolve_failed: '暂时无法解析资源链接，可查看原站记录。',
    resource_search_invalid: '搜索关键词或来源无效。',
  };
  return messages[error.code] || '聚合搜索请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${getAPIBaseUrl()}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new ResourceSearchAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}
