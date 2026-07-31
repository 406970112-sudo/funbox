import type { SSQHistorySnapshot } from '../types/double-color-ball.ts';

type ErrorPayload = {
  error?: string;
};

export class SSQAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'SSQAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchSSQHistory(
  signal?: AbortSignal,
  apiBaseUrl?: string,
): Promise<SSQHistorySnapshot> {
  const baseUrl = apiBaseUrl ?? await resolveAPIBaseURL();
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/api/v1/lottery/ssq/history`,
    { signal },
  );
  const payload = (await response.json().catch(() => ({}))) as Partial<SSQHistorySnapshot> & ErrorPayload;
  if (!response.ok) {
    throw new SSQAPIError(payload.error || 'request_failed', response.status);
  }
  if (
    payload.analysisWindowMax !== 300
    || payload.source !== 'cwl'
    || !Array.isArray(payload.draws)
  ) {
    throw new SSQAPIError('lottery_source_invalid', response.status);
  }
  return payload as SSQHistorySnapshot;
}

export function getSSQErrorMessage(error: unknown) {
  if (!(error instanceof SSQAPIError)) {
    return '暂时无法连接开奖数据服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    lottery_source_invalid: '官方开奖数据格式异常，暂时无法生成参考组合。',
    lottery_source_unavailable: '官方开奖数据暂时不可用，请稍后重试。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] || '开奖数据请求失败，请稍后重试。';
}

async function resolveAPIBaseURL() {
  const { getAPIBaseUrl } = await import('@/lib/auth-api');
  return getAPIBaseUrl();
}
