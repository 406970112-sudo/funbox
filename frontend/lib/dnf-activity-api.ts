import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  DnfActivity,
  DnfActivityList,
  DnfActivityOverview,
  DnfActivitySortKey,
  DnfCalendarMonth,
  DnfShareInfo,
} from '@/types/dnf-activity';

type ErrorPayload = {
  error?: string;
};

export class DnfActivityAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'DnfActivityAPIError';
    this.code = code;
    this.status = status;
  }
}

function requestJSON<T>(
  path: string,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return fetch(`${getAPIBaseUrl()}${path}`, {
    headers: { Accept: 'application/json' },
    signal: options.signal,
  }).then(async (response) => {
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const code =
        isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'dnf_activity_request_failed';
      throw new DnfActivityAPIError(code, response.status);
    }
    return payload as T;
  });
}

export function fetchDnfActivityOverview(signal?: AbortSignal) {
  return requestJSON<DnfActivityOverview>('/api/v1/dnf-activity/overview', { signal });
}

export function fetchDnfActivities(options: {
  status?: DnfActivity['status'] | '';
  query?: string;
  sort?: DnfActivitySortKey;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.query) params.set('q', options.query);
  if (options.sort) params.set('sort', options.sort);
  if (options.page) params.set('page', String(options.page));
  if (options.pageSize) params.set('pageSize', String(options.pageSize));
  const query = params.toString();
  return requestJSON<DnfActivityList>(
    `/api/v1/dnf-activity/activities${query ? `?${query}` : ''}`,
    { signal: options.signal },
  );
}

export function fetchDnfActivity(id: string, signal?: AbortSignal) {
  return requestJSON<DnfActivity>(
    `/api/v1/dnf-activity/activities/${encodeURIComponent(id)}`,
    { signal },
  );
}

export function fetchDnfActivityCalendar(
  year: number,
  month: number,
  signal?: AbortSignal,
) {
  return requestJSON<DnfCalendarMonth>(
    `/api/v1/dnf-activity/calendar?month=${year}-${String(month).padStart(2, '0')}`,
    { signal },
  );
}

export function fetchDnfActivityShare(id: string, signal?: AbortSignal) {
  return requestJSON<DnfShareInfo>(
    `/api/v1/dnf-activity/share/${encodeURIComponent(id)}`,
    { signal },
  );
}

export function getDnfActivityErrorMessage(error: unknown) {
  if (error instanceof DnfActivityAPIError) {
    if (error.code === 'dnf_activity_source_unavailable') {
      return '官网活动数据暂不可用，请稍后重试。';
    }
    if (error.code === 'dnf_activity_not_found') {
      return '活动不存在或已下架。';
    }
    return '活动加载失败，请稍后重试。';
  }
  return '网络异常，请检查连接后重试。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
