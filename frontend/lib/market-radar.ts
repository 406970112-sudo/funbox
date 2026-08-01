import type {
  MarketCategoryId,
  MarketPeriodId,
  MarketPulse,
  MarketRadarSnapshot,
} from '../types/market-radar.ts';

export type {
  MarketCategory,
  MarketCategoryId,
  MarketConstituent,
  MarketCoverage,
  MarketIndicator,
  MarketPeriod,
  MarketPeriodId,
  MarketPulse,
  MarketRadarSnapshot,
  MarketSector,
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
