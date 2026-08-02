import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  ResolvedResourceResult,
  ResourceSearchAdminStats,
  ResourceSearchAuditPage,
  ResourceSearchHealthResult,
  ResourceSearchSource,
  ResourceSearchSourceInput,
  ResourceSearchSourceResponse,
  ResourceSearchTestResult,
} from '@/types/resource-search';

type ErrorPayload = {
  detail?: string;
  error?: string;
};

export class ResourceSearchAPIError extends Error {
  code: string;
  status: number;
  detail: string;

  constructor(code: string, status: number, detail = '') {
    super(detail || code);
    this.name = 'ResourceSearchAPIError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export async function listResourceSearchSources(signal?: AbortSignal) {
  return requestJSON<{ sources: ResourceSearchSource[] }>('/api/v1/resource-search/sources', { signal })
    .then((value) => value.sources);
}

export async function searchResourceSource(query: string, sourceId: string, signal?: AbortSignal) {
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

export async function listAdminResourceSearchSources(
  token: string,
  options: { category?: string; q?: string; status?: string } = {},
) {
  const search = new URLSearchParams();
  if (options.q) search.set('q', options.q);
  if (options.category && options.category !== '全部') search.set('category', options.category);
  if (options.status) search.set('status', options.status);
  const query = search.toString();
  return requestJSON<{ sources: ResourceSearchSource[] }>(
    `/api/v1/admin/resource-search/sources${query ? `?${query}` : ''}`,
    { token },
  ).then((value) => value.sources);
}

export async function createAdminResourceSearchSource(token: string, input: ResourceSearchSourceInput) {
  return requestJSON<{ source: ResourceSearchSource }>(
    '/api/v1/admin/resource-search/sources',
    jsonRequest('POST', input, token),
  ).then((value) => value.source);
}

export async function updateAdminResourceSearchSource(
  token: string,
  sourceId: string,
  input: ResourceSearchSourceInput,
) {
  return requestJSON<{ source: ResourceSearchSource }>(
    `/api/v1/admin/resource-search/sources/${encodeURIComponent(sourceId)}`,
    jsonRequest('PATCH', input, token),
  ).then((value) => value.source);
}

export async function deleteAdminResourceSearchSource(token: string, sourceId: string) {
  return requestJSON<{ deleted: boolean }>(
    `/api/v1/admin/resource-search/sources/${encodeURIComponent(sourceId)}`,
    { method: 'DELETE', token },
  );
}

export async function runAdminResourceSearchHealthCheck(token: string, sourceId: string) {
  return requestJSON<ResourceSearchHealthResult>(
    `/api/v1/admin/resource-search/sources/${encodeURIComponent(sourceId)}/health-check`,
    { method: 'POST', token },
  );
}

export async function runAdminResourceSearchHealthChecks(token: string) {
  return requestJSON<{ checks: ResourceSearchHealthResult[] }>(
    '/api/v1/admin/resource-search/health-checks',
    { method: 'POST', token },
  ).then((value) => value.checks);
}

export async function runAdminResourceSearchTest(
  token: string,
  sourceId: string,
  query: string,
) {
  return requestJSON<ResourceSearchTestResult>(
    `/api/v1/admin/resource-search/sources/${encodeURIComponent(sourceId)}/test-search`,
    jsonRequest('POST', { query }, token),
  );
}

export async function listAdminResourceSearchAuditLogs(
  token: string,
  options: { action?: string; limit?: number; offset?: number; operator?: string } = {},
) {
  const search = new URLSearchParams();
  if (options.action) search.set('action', options.action);
  if (options.operator) search.set('operator', options.operator);
  search.set('limit', String(options.limit ?? 30));
  search.set('offset', String(options.offset ?? 0));
  return requestJSON<ResourceSearchAuditPage>(`/api/v1/admin/resource-search/audit-logs?${search}`, { token });
}

export async function getAdminResourceSearchStats(token: string, days = 7) {
  return requestJSON<ResourceSearchAdminStats>(`/api/v1/admin/resource-search/stats?days=${days}`, { token });
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
    resource_source_in_use: '该站点已有真实使用记录，只能停用，不能删除。',
    resource_source_verification_failed: '真实检测或试搜未通过，请检查站点配置。',
  };
  return messages[error.code] || error.detail || error.message || '聚合搜索请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, options: RequestInit & { token?: string | null } = {}) {
  const { token, ...init } = options;
  const response = await fetch(`${getAPIBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new ResourceSearchAPIError(
      payload.error || 'request_failed',
      response.status,
      payload.detail,
    );
  }
  return payload;
}

function jsonRequest(method: string, value: unknown, token: string): RequestInit & { token: string } {
  return {
    body: JSON.stringify(value),
    headers: { 'Content-Type': 'application/json' },
    method,
    token,
  };
}
