import { getAPIBaseUrl } from '@/lib/auth-api';
import type { WhoDoesItRecord, WhoDoesItState } from '@/types/who-does-it';

type ErrorPayload = { error?: string };

export class WhoDoesItAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'WhoDoesItAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchWhoDoesItState(token: string) {
  return requestJSON<WhoDoesItState>('/api/v1/who-does-it/state', token);
}

export function saveWhoDoesItState(token: string, state: WhoDoesItState) {
  return requestJSON<WhoDoesItState>('/api/v1/who-does-it/state', token, {
    body: JSON.stringify(state),
    method: 'PUT',
  });
}

export async function fetchWhoDoesItRecords(token: string) {
  const payload = await requestJSON<{ records: WhoDoesItRecord[] }>(
    '/api/v1/who-does-it/records',
    token,
  );
  return payload.records;
}

export function clearWhoDoesItRecords(token: string) {
  return requestJSON<{ success: boolean; updatedAt: number }>(
    '/api/v1/who-does-it/records',
    token,
    { method: 'DELETE' },
  );
}

export function getWhoDoesItErrorMessage(error: unknown) {
  if (!(error instanceof WhoDoesItAPIError)) {
    return '暂时无法连接谁来干服务，已使用本机真实数据。';
  }
  const messages: Record<string, string> = {
    who_does_it_invalid_input: '名单或记录内容不完整，请检查后重试。',
    who_does_it_not_found: '账号数据不存在，已使用本机数据。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '谁来干同步失败，请稍后重试。';
}

async function requestJSON<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new WhoDoesItAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
