import { getAPIBaseUrl } from '@/lib/auth-api';
import type { ParkingLocationState } from '@/types/parking-location';

type ErrorPayload = { error?: string };

export class ParkingLocationAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ParkingLocationAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchParkingLocationState(token: string) {
  return requestJSON<ParkingLocationState>('/api/v1/parking-location/state', token);
}

export function saveParkingLocationState(token: string, state: ParkingLocationState) {
  return requestJSON<ParkingLocationState>('/api/v1/parking-location/state', token, {
    body: JSON.stringify(state),
    method: 'PUT',
  });
}

export function clearParkingLocationState(token: string) {
  return requestJSON<{ success: boolean; updatedAt: number }>(
    '/api/v1/parking-location/state',
    token,
    { method: 'DELETE' },
  );
}

export function getParkingLocationErrorMessage(error: unknown) {
  if (!(error instanceof ParkingLocationAPIError)) {
    return '停车位置记录服务暂时不可用，已使用本机真实数据。';
  }
  const messages: Record<string, string> = {
    parking_location_invalid_input: '请检查停车场、地下位置或收费规则是否填写完整。',
    parking_location_not_found: '账号停车记录不存在，已使用本机数据。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '停车位置记录同步失败，请稍后重试。';
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
    throw new ParkingLocationAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
