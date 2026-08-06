import { getAPIBaseUrl } from '@/lib/auth-api';
import type { HomeManualState, HomeManualUnlockResponse } from '@/types/home-manual';

type ErrorPayload = { error?: string };

export class HomeManualAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'HomeManualAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchHomeManualState(token: string, unlockToken?: string) {
  const query = unlockToken ? '?view=full' : '';
  return requestJSON<HomeManualState>(
    `/api/v1/home-manual/state${query}`,
    token,
    { method: 'GET' },
    unlockToken,
  );
}

export function saveHomeManualState(token: string, state: HomeManualState, unlockToken?: string) {
  return requestJSON<HomeManualState>('/api/v1/home-manual/state', token, {
    body: JSON.stringify(state),
    method: 'PUT',
  }, unlockToken);
}

export function clearHomeManualState(token: string, unlockToken?: string) {
  return requestJSON<{ success: boolean; updatedAt: number }>(
    '/api/v1/home-manual/state',
    token,
    { method: 'DELETE' },
    unlockToken,
  );
}

export function setHomeManualPassword(
  token: string,
  action: 'set' | 'change' | 'remove',
  currentPassword: string,
  newPassword: string,
) {
  return requestJSON<{ success: boolean }>('/api/v1/home-manual/security/password', token, {
    body: JSON.stringify({ action, currentPassword, newPassword }),
    method: 'POST',
  });
}

export function unlockHomeManual(token: string, password: string) {
  return requestJSON<HomeManualUnlockResponse>('/api/v1/home-manual/security/unlock', token, {
    body: JSON.stringify({ password }),
    method: 'POST',
  });
}

export function lockHomeManual(token: string, unlockToken: string) {
  return requestJSON<{ success: boolean }>('/api/v1/home-manual/security/lock', token, {
    method: 'POST',
  }, unlockToken);
}

export function exportHomeManual(token: string, unlockToken: string) {
  return requestJSON<HomeManualState>('/api/v1/home-manual/export', token, { method: 'GET' }, unlockToken);
}

export function importHomeManual(token: string, state: HomeManualState, unlockToken: string) {
  return requestJSON<HomeManualState>('/api/v1/home-manual/import', token, {
    body: JSON.stringify(state),
    method: 'POST',
  }, unlockToken);
}

export function getHomeManualErrorMessage(error: unknown) {
  if (!(error instanceof HomeManualAPIError)) {
    return '暂时无法连接家庭说明书服务，已使用本机真实数据。';
  }
  const messages: Record<string, string> = {
    home_manual_invalid_input: '内容不完整或格式不正确，请检查后重试。',
    home_manual_password_required: '请先设置家庭说明书密码，再保存敏感字段。',
    home_manual_password_mismatch: '家庭说明书密码不正确。',
    home_manual_locked: '家庭说明书已锁定，请先解锁。',
    home_manual_locked_out: '尝试次数过多，请 5 分钟后再试。',
    home_manual_not_found: '家庭说明书不存在，已使用本机数据。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '家庭说明书同步失败，请稍后重试。';
}

async function requestJSON<T>(
  path: string,
  token: string,
  options: RequestInit = {},
  unlockToken?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(unlockToken ? { 'X-Home-Manual-Unlock-Token': unlockToken } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new HomeManualAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
