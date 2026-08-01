import type { SSQLabHistorySnapshot } from '../types/double-color-ball-lab.ts';

type ErrorPayload = {
  error?: string;
};

export class SSQLabAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'SSQLabAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchSSQLabHistory(
  count: number,
  signal?: AbortSignal,
  apiBaseUrl?: string,
): Promise<SSQLabHistorySnapshot> {
  const baseUrl = apiBaseUrl ?? await resolveAPIBaseURL();
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/api/v1/lottery/ssq-lab/history?count=${count}`,
    { signal },
  );
  const payload = (await response.json().catch(() => ({}))) as Partial<SSQLabHistorySnapshot> & ErrorPayload;
  if (!response.ok) {
    throw new SSQLabAPIError(payload.error || 'request_failed', response.status);
  }
  if (
    payload.source !== 'cwl'
    || !Array.isArray(payload.draws)
    || typeof payload.count !== 'number'
  ) {
    throw new SSQLabAPIError('lottery_source_invalid', response.status);
  }
  return payload as SSQLabHistorySnapshot;
}

export function getSSQLabErrorMessage(error: unknown) {
  if (!(error instanceof SSQLabAPIError)) {
    return '暂时无法连接开奖数据服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    invalid_count: '数据期数范围无效，请选择 100 到 1000 期。',
    lottery_source_invalid: '官方开奖数据格式异常，暂时无法生成回测结果。',
    lottery_source_unavailable: '官方开奖数据暂时不可用，请稍后重试。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] || '开奖数据请求失败，请稍后重试。';
}

async function resolveAPIBaseURL() {
  const { getAPIBaseUrl } = await import('@/lib/auth-api');
  return getAPIBaseUrl();
}
