import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  QuietHomeContact,
  QuietHomeCreateTripInput,
  QuietHomeHistoryRecord,
  QuietHomeSettings,
  QuietHomeState,
  QuietHomeTrip,
  QuietHomeUpdateTripInput,
} from '@/types/quiet-home';

type ErrorPayload = { error?: string };

export class QuietHomeAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'QuietHomeAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchQuietHomeState(token: string) {
  return requestJSON<QuietHomeState>('/api/v1/quiet-home/state', token);
}

export function createQuietHomeTrip(token: string, input: QuietHomeCreateTripInput) {
  return requestJSON<QuietHomeTrip>('/api/v1/quiet-home/trips', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateQuietHomeTrip(token: string, id: string, input: QuietHomeUpdateTripInput) {
  return requestJSON<QuietHomeTrip>(
    `/api/v1/quiet-home/trips/${encodeURIComponent(id)}`,
    token,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function checkInQuietHomeTrip(token: string, id: string) {
  return requestJSON<QuietHomeTrip>(
    `/api/v1/quiet-home/trips/${encodeURIComponent(id)}/check-in`,
    token,
    { method: 'POST' },
  );
}

export function cancelQuietHomeTrip(token: string, id: string) {
  return requestJSON<QuietHomeTrip>(
    `/api/v1/quiet-home/trips/${encodeURIComponent(id)}/cancel`,
    token,
    { method: 'POST' },
  );
}

export function fetchQuietHomeHistory(token: string) {
  return requestJSON<{ records: QuietHomeHistoryRecord[] }>(
    '/api/v1/quiet-home/history',
    token,
  );
}

export function clearQuietHomeHistory(token: string) {
  return requestJSON<{ success: boolean }>('/api/v1/quiet-home/history', token, {
    method: 'DELETE',
  });
}

export function fetchQuietHomeSettings(token: string) {
  return requestJSON<QuietHomeSettings>('/api/v1/quiet-home/settings', token);
}

export function saveQuietHomeSettings(token: string, settings: QuietHomeSettings) {
  return requestJSON<QuietHomeSettings>('/api/v1/quiet-home/settings', token, {
    body: JSON.stringify(settings),
    method: 'PUT',
  });
}

export function addQuietHomeContact(token: string, contactUserId: string) {
  return requestJSON<QuietHomeContact>(
    `/api/v1/quiet-home/contacts/${encodeURIComponent(contactUserId)}`,
    token,
    { method: 'POST' },
  );
}

export function respondQuietHomeContact(
  token: string,
  contactUserId: string,
  status: 'agreed' | 'declined',
) {
  return requestJSON<QuietHomeContact>(
    `/api/v1/quiet-home/contacts/${encodeURIComponent(contactUserId)}/consent`,
    token,
    { body: JSON.stringify({ status }), method: 'POST' },
  );
}

export function removeQuietHomeContact(token: string, contactUserId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/quiet-home/contacts/${encodeURIComponent(contactUserId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function markQuietHomeNotificationDelivered(token: string, id: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/quiet-home/notifications/${encodeURIComponent(id)}/delivered`,
    token,
    { method: 'POST' },
  );
}

export function markQuietHomeNotificationFailed(token: string, id: string, reason: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/quiet-home/notifications/${encodeURIComponent(id)}/failed`,
    token,
    { body: JSON.stringify({ reason }), method: 'POST' },
  );
}

export function getQuietHomeErrorMessage(error: unknown) {
  if (!(error instanceof QuietHomeAPIError)) {
    return '暂时无法连接安静到家服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    quiet_home_invalid_input: '行程信息不完整，请检查后重试。',
    quiet_home_not_found: '行程或通知不存在，可能已被结束。',
    quiet_home_not_friend: '对方不是你的真实好友，无法设为联系人。',
    quiet_home_contact_not_agreed: '联系人还没有同意接收提醒。',
    quiet_home_active_trip_exists: '已有一个进行中的到家行程。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '安静到家暂时不可用，请稍后重试。';
}

async function requestJSON<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new QuietHomeAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
