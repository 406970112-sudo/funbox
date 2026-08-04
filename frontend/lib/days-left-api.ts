import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  DaysLeftCalendar,
  DaysLeftCategory,
  DaysLeftCategoryInput,
  DaysLeftEvidence,
  DaysLeftEvent,
  DaysLeftRecord,
  DaysLeftRecordInput,
  DaysLeftReminder,
  DaysLeftRenewInput,
  DaysLeftStats,
  DaysLeftSummary,
  DaysLeftVerifyResult,
} from '@/types/days-left';

type ErrorPayload = { error?: string };

export class DaysLeftAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'DaysLeftAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchDaysLeftSummary(token: string, date?: string) {
  return requestJSON<DaysLeftSummary>(
    `/api/v1/days-left/summary${date ? `?date=${encodeURIComponent(date)}` : ''}`,
    token,
  );
}

export async function fetchDaysLeftRecords(
  token: string,
  params: { category?: string; status?: string; q?: string; sort?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.status) query.set('status', params.status);
  if (params.q) query.set('q', params.q);
  if (params.sort) query.set('sort', params.sort);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await requestJSON<{ records: DaysLeftRecord[] }>(
    `/api/v1/days-left/records${suffix}`,
    token,
  );
  return payload.records;
}

export function fetchDaysLeftRecord(token: string, recordId: string) {
  return requestJSON<DaysLeftRecord>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}`,
    token,
  );
}

export function createDaysLeftRecord(token: string, input: DaysLeftRecordInput) {
  return requestJSON<DaysLeftRecord>('/api/v1/days-left/records', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateDaysLeftRecord(
  token: string,
  recordId: string,
  input: Partial<DaysLeftRecordInput>,
) {
  return requestJSON<DaysLeftRecord>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteDaysLeftRecord(token: string, recordId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function renewDaysLeftRecord(token: string, recordId: string, input: DaysLeftRenewInput) {
  return requestJSON<DaysLeftRecord>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}/renew`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function completeDaysLeftRecord(token: string, recordId: string, note?: string) {
  return requestJSON<DaysLeftRecord>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}/complete`,
    token,
    {
      body: JSON.stringify({ note: note ?? '' }),
      method: 'POST',
    },
  );
}

export function undoDaysLeftRecord(token: string, recordId: string) {
  return requestJSON<DaysLeftRecord>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}/undo`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export async function fetchDaysLeftEvents(token: string, recordId: string) {
  const payload = await requestJSON<{ events: DaysLeftEvent[] }>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}/events`,
    token,
  );
  return payload.events;
}

export async function fetchDaysLeftEvidence(token: string, recordId: string) {
  const payload = await requestJSON<{ evidence: DaysLeftEvidence[] }>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}/evidence`,
    token,
  );
  return payload.evidence;
}

export async function uploadDaysLeftEvidence(
  token: string,
  recordId: string,
  file: { uri: string; name?: string; type?: string },
) {
  const form = new FormData();
  form.append('kind', 'photo');
  form.append(
    'file',
    {
      uri: file.uri,
      name: file.name ?? 'evidence.jpg',
      type: file.type ?? 'image/jpeg',
    } as unknown as Blob,
  );
  return requestJSON<DaysLeftEvidence>(
    `/api/v1/days-left/records/${encodeURIComponent(recordId)}/evidence`,
    token,
    {
      body: form,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
}

export async function fetchDaysLeftCategories(token: string) {
  const payload = await requestJSON<{ categories: DaysLeftCategory[] }>(
    '/api/v1/days-left/categories',
    token,
  );
  return payload.categories;
}

export function createDaysLeftCategory(token: string, input: DaysLeftCategoryInput) {
  return requestJSON<DaysLeftCategory>('/api/v1/days-left/categories', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateDaysLeftCategory(
  token: string,
  categoryId: string,
  input: Partial<DaysLeftCategoryInput>,
) {
  return requestJSON<DaysLeftCategory>(
    `/api/v1/days-left/categories/${encodeURIComponent(categoryId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteDaysLeftCategory(token: string, categoryId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/days-left/categories/${encodeURIComponent(categoryId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function fetchDaysLeftCalendar(token: string, month: string) {
  return requestJSON<DaysLeftCalendar>(
    `/api/v1/days-left/calendar?month=${encodeURIComponent(month)}`,
    token,
  );
}

export function fetchDaysLeftStats(token: string, range = 'month') {
  return requestJSON<DaysLeftStats>(
    `/api/v1/days-left/stats?range=${encodeURIComponent(range)}`,
    token,
  );
}

export async function fetchDaysLeftReminders(token: string) {
  const payload = await requestJSON<{ reminders: DaysLeftReminder[] }>(
    '/api/v1/days-left/reminders',
    token,
  );
  return payload.reminders;
}

export function dismissDaysLeftReminder(token: string, reminderId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/days-left/reminders/${encodeURIComponent(reminderId)}/dismiss`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export function verifyDaysLeftSSL(token: string, host: string) {
  return requestJSON<DaysLeftVerifyResult>(
    `/api/v1/days-left/verify/ssl?host=${encodeURIComponent(host)}`,
    token,
  );
}

export async function importDaysLeftRecords(token: string, records: DaysLeftRecordInput[]) {
  const payload = await requestJSON<{ created: number }>('/api/v1/days-left/import', token, {
    body: JSON.stringify(records),
    method: 'POST',
  });
  return payload.created;
}

export function getDaysLeftExportUrl(format: 'csv' | 'json') {
  return `${getAPIBaseUrl()}/api/v1/days-left/export?format=${format}`;
}

export function getDaysLeftErrorMessage(error: unknown) {
  if (!(error instanceof DaysLeftAPIError)) {
    return '暂时无法连接还有几天服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    days_left_invalid_input: '请检查填写内容是否完整，日期格式为 YYYY-MM-DD。',
    days_left_not_found: '记录不存在或已被删除。',
    invalid_host: '请输入有效的域名，不要包含 https:// 前缀。',
    ssl_verify_failed: '证书校验失败，请确认域名可以正常访问。',
    invalid_import_count: '导入数量需在 1-500 条之间。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] ?? '还有几天操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new DaysLeftAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
