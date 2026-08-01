import type { MarketPeriodId, MarketRadarSnapshot, MarketSectorDetail } from '../types/market-radar.ts';

type ErrorPayload = {
  error?: string;
};

export class MarketRadarAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'MarketRadarAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchMarketRadarSnapshot(
  signal?: AbortSignal,
  refresh = false,
  apiBaseUrl?: string,
): Promise<MarketRadarSnapshot> {
  const baseUrl = apiBaseUrl ?? (await resolveAPIBaseURL());
  const suffix = refresh ? '?refresh=1' : '';
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/api/v1/market-radar/snapshot${suffix}`,
    { signal },
  );
  const payload = (await response.json().catch(() => ({}))) as Partial<MarketRadarSnapshot> & ErrorPayload;
  if (!response.ok) {
    throw new MarketRadarAPIError(payload.error || 'request_failed', response.status);
  }
  if (!isValidMarketRadarSnapshot(payload)) {
    throw new MarketRadarAPIError('market_radar_source_invalid', response.status);
  }
  return payload as MarketRadarSnapshot;
}

export async function fetchMarketRadarSectorDetail(
  sectorId: string,
  signal?: AbortSignal,
  apiBaseUrl?: string,
): Promise<MarketSectorDetail> {
  const baseUrl = apiBaseUrl ?? (await resolveAPIBaseURL());
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/api/v1/market-radar/sectors/${encodeURIComponent(sectorId)}`,
    { signal },
  );
  const payload = (await response.json().catch(() => ({}))) as Partial<MarketSectorDetail> & ErrorPayload;
  if (!response.ok) {
    throw new MarketRadarAPIError(payload.error || 'request_failed', response.status);
  }
  if (!isValidMarketRadarSectorDetail(payload)) {
    throw new MarketRadarAPIError('market_radar_source_invalid', response.status);
  }
  return payload as MarketSectorDetail;
}

export function getMarketRadarErrorMessage(error: unknown) {
  if (!(error instanceof MarketRadarAPIError)) {
    return '暂时无法连接行情服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    market_radar_insufficient_coverage: '板块数据覆盖不足，请稍后重试。',
    market_radar_source_invalid: '行情数据格式异常，暂无法生成市场雷达。',
    market_radar_source_unavailable: '东方财富行情暂时不可用，请稍后重试。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] || '市场雷达请求失败，请稍后重试。';
}

function isValidMarketRadarSnapshot(value: unknown): value is MarketRadarSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<MarketRadarSnapshot>;
  return (
    snapshot.source === 'eastmoney'
    && typeof snapshot.fetchedAt === 'string'
    && Number.isFinite(Date.parse(snapshot.fetchedAt))
    && Array.isArray(snapshot.categories)
    && snapshot.categories.some((category) => category?.id === 'market')
    && Array.isArray(snapshot.periods)
    && snapshot.periods.some((period) => period?.id === '1d')
    && Array.isArray(snapshot.sectors)
    && snapshot.sectors.length > 0
    && Array.isArray(snapshot.indices)
    && Array.isArray(snapshot.signals)
    && typeof snapshot.coverage === 'object'
    && snapshot.coverage !== null
    && Number.isInteger(snapshot.coverage.loaded)
    && Number.isInteger(snapshot.coverage.requested)
    && typeof snapshot.pulses === 'object'
    && snapshot.pulses !== null
    && snapshot.sectors.every(isValidSector)
  );
}

function isValidMarketRadarSectorDetail(value: unknown): value is MarketSectorDetail {
  if (!isValidSector(value)) return false;
  const detail = value as Partial<MarketSectorDetail>;
  return Array.isArray(detail.related) && Array.isArray(detail.news);
}

function isValidSector(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const sector = value as {
    categoryIds?: unknown;
    changes?: unknown;
    constituents?: unknown;
    id?: unknown;
    indicator?: unknown;
    name?: unknown;
    series?: unknown;
  };
  if (typeof sector.id !== 'string' || typeof sector.name !== 'string') return false;
  if (!Array.isArray(sector.categoryIds) || sector.categoryIds.length === 0) return false;
  if (!sector.changes || typeof sector.changes !== 'object') return false;
  if (!Array.isArray(sector.series)) return false;
  if (!Array.isArray(sector.constituents)) return false;
  if (!sector.indicator || typeof sector.indicator !== 'object') return false;

  const changes = sector.changes as Record<string, unknown>;
  const periods: MarketPeriodId[] = ['1d', '5d', '20d'];
  if (!periods.every((period) => Number.isFinite(changes[period]))) return false;
  if (!sector.series.every(Number.isFinite)) return false;
  if (!sector.constituents.every(isValidConstituent)) return false;

  const indicator = sector.indicator as Record<string, unknown>;
  return (
    Number.isFinite(indicator.amount)
    && Number.isFinite(indicator.averageAmount)
    && Number.isFinite(indicator.averageTurnover)
    && Number.isFinite(indicator.close)
    && Number.isFinite(indicator.turnover)
    && Number.isInteger(indicator.advancing)
    && Number.isInteger(indicator.declining)
    && Number.isInteger(indicator.coverage)
  );
}

function isValidConstituent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const constituent = value as Record<string, unknown>;
  return (
    typeof constituent.code === 'string'
    && typeof constituent.name === 'string'
    && Number.isFinite(constituent.change)
    && Number.isFinite(constituent.weight)
  );
}

async function resolveAPIBaseURL() {
  const { getAPIBaseUrl } = await import('../lib/auth-api.ts');
  return getAPIBaseUrl();
}
