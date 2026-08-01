import type {
  MarketCategoryId,
  MarketPeriodId,
  MarketPulse,
  MarketRadarSnapshot,
  MarketSector,
  MarketSignal,
  MarketSortKey,
} from '../types/market-radar.ts';

export type {
  MarketCategory,
  MarketCategoryId,
  MarketConstituent,
  MarketCoverage,
  MarketIndex,
  MarketIndicator,
  MarketPeriod,
  MarketPeriodId,
  MarketPulse,
  MarketRadarSnapshot,
  MarketSector,
  MarketSectorDetail,
  MarketSectorNews,
  MarketSignal,
  MarketSignalType,
  MarketSortKey,
  MarketView,
} from '../types/market-radar.ts';

export type MarketChartPoint = {
  x: number;
  y: number;
};

export function getRankedMarketSectors(
  snapshot: MarketRadarSnapshot,
  categoryId: MarketCategoryId,
  periodId: MarketPeriodId,
) {
  return snapshot.sectors
    .filter((sector) => sector.categoryIds.includes(categoryId))
    .slice()
    .sort((left, right) => right.changes[periodId] - left.changes[periodId] || left.id.localeCompare(right.id));
}

export function getMarketPulse(
  snapshot: MarketRadarSnapshot,
  categoryId: MarketCategoryId,
  periodId: MarketPeriodId,
): MarketPulse {
  return snapshot.pulses[categoryId][periodId];
}

export function getMarketSector(snapshot: MarketRadarSnapshot, sectorId: string) {
  return snapshot.sectors.find((sector) => sector.id === sectorId);
}

export function searchMarketSectors(snapshot: MarketRadarSnapshot, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return snapshot.sectors;
  return snapshot.sectors.filter((sector) => {
    return sector.name.toLocaleLowerCase().includes(normalized)
      || sector.id.toLocaleLowerCase().includes(normalized);
  });
}

export function sortMarketSectors(
  sectors: readonly MarketSector[],
  periodId: MarketPeriodId,
  sortKey: MarketSortKey,
) {
  const averageChange = sectors.length === 0
    ? 0
    : sectors.reduce((total, sector) => total + sector.changes[periodId], 0) / sectors.length;

  return sectors.slice().sort((left, right) => {
    const leftValue = marketSortValue(left, periodId, sortKey, averageChange);
    const rightValue = marketSortValue(right, periodId, sortKey, averageChange);
    if (leftValue === rightValue) return left.id.localeCompare(right.id);
    return rightValue - leftValue;
  });
}

export function getSectorAdvancingRatio(sector: MarketSector) {
  const total = sector.indicator.advancing + sector.indicator.declining;
  if (total === 0) return 0;
  return sector.indicator.advancing / total;
}

export function getWatchSectorSummaries(snapshot: MarketRadarSnapshot, watchedIds: readonly string[]) {
  const byId = new Map(snapshot.sectors.map((sector) => [sector.id, sector]));
  return watchedIds
    .map((id) => byId.get(id))
    .filter((sector): sector is MarketSector => Boolean(sector));
}

export function getSignalSectors(snapshot: MarketRadarSnapshot) {
  const byId = new Map(snapshot.sectors.map((sector) => [sector.id, sector]));
  return snapshot.signals
    .map((signal) => ({ signal, sector: byId.get(signal.sectorId) }))
    .filter((entry): entry is { signal: MarketSignal; sector: MarketSector } => Boolean(entry.sector));
}

export function getSignalTypeLabel(type: MarketSignal['type']) {
  const labels: Record<MarketSignal['type'], string> = {
    leader: '领涨',
    laggard: '领跌',
    volume: '放量',
    reversal: '反转',
    breadth: '扩散',
  };
  return labels[type];
}

export function buildMarketChartPoints(
  values: readonly number[],
  width: number,
  height: number,
): MarketChartPoint[] {
  if (values.length === 0) return [];

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const horizontalStep = values.length === 1 ? 0 : width / (values.length - 1);

  return values.map((value, index) => ({
    x: horizontalStep * index,
    y: range === 0 ? height / 2 : height - ((value - minimum) / range) * height,
  }));
}

function marketSortValue(
  sector: MarketSector,
  periodId: MarketPeriodId,
  sortKey: MarketSortKey,
  averageChange: number,
) {
  switch (sortKey) {
    case 'amount':
      return sector.indicator.amount;
    case 'turnover':
      return sector.indicator.turnover;
    case 'advancingRatio':
      return getSectorAdvancingRatio(sector);
    case 'strength':
      return sector.changes[periodId] - averageChange;
    case 'change':
    default:
      return sector.changes[periodId];
  }
}
