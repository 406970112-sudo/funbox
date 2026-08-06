import { getAPIBaseUrl } from '@/lib/auth-api';
import type { BorrowLedgerState } from '@/types/borrow-ledger';

type ErrorPayload = { error?: string };

export class BorrowLedgerAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'BorrowLedgerAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchBorrowLedgerState(token: string) {
  return requestJSON<BorrowLedgerState>('/api/v1/borrow-ledger/state', token);
}

export function saveBorrowLedgerState(token: string, state: BorrowLedgerState) {
  return requestJSON<BorrowLedgerState>('/api/v1/borrow-ledger/state', token, {
    body: JSON.stringify(state),
    method: 'PUT',
  });
}

export function clearBorrowLedgerState(token: string) {
  return requestJSON<{ success: boolean; updatedAt: number }>(
    '/api/v1/borrow-ledger/state',
    token,
    { method: 'DELETE' },
  );
}

export function getBorrowLedgerErrorMessage(error: unknown) {
  if (!(error instanceof BorrowLedgerAPIError)) {
    return '暂时无法连接借还记录服务，已使用本机真实数据。';
  }
  const messages: Record<string, string> = {
    borrow_ledger_invalid_input: '记录内容不完整，请检查后重试。',
    borrow_ledger_not_found: '账号数据不存在，已使用本机数据。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '借还记录同步失败，请稍后重试。';
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
    throw new BorrowLedgerAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
