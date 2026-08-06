import { getAPIBaseUrl } from '@/lib/auth-api';
import type { SizeLibraryState } from '@/types/size-library';

type ErrorPayload = { error?: string };

export class SizeLibraryAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'SizeLibraryAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchSizeLibraryState(token: string) {
  return requestJSON<SizeLibraryState>('/api/v1/size-library/state', token);
}

export function saveSizeLibraryState(token: string, state: SizeLibraryState) {
  return requestJSON<SizeLibraryState>('/api/v1/size-library/state', token, {
    body: JSON.stringify(state),
    method: 'PUT',
  });
}

export function clearSizeLibraryState(token: string) {
  return requestJSON<{ success: boolean; updatedAt: number }>(
    '/api/v1/size-library/state',
    token,
    { method: 'DELETE' },
  );
}

export function getSizeLibraryErrorMessage(error: unknown) {
  if (!(error instanceof SizeLibraryAPIError)) {
    return '暂时无法连接尺寸库服务，已使用本机真实数据。';
  }
  const messages: Record<string, string> = {
    size_library_invalid_input: '档案或尺寸内容不完整，请检查后重试。',
    size_library_not_found: '账号尺寸库不存在，已使用本机数据。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '尺寸库同步失败，请稍后重试。';
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
    throw new SizeLibraryAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
