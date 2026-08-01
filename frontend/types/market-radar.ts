export type MarketCategoryId = 'global' | 'ai' | 'metals';
export type MarketPeriodId = '1d' | '5d' | '20d';
export type MarketRadarSource = 'eastmoney';

export type MarketCategory = {
  id: MarketCategoryId;
  label: string;
};

export type MarketPeriod = {
  id: MarketPeriodId;
  label: string;
};

export type MarketCoverage = {
  loaded: number;
  requested: number;
};

export type MarketConstituent = {
  change: number;
  code: string;
  name: string;
  weight: number;
};

export type MarketIndicator = {
  advancing: number;
  amount: number;
  close: number;
  coverage: number;
  declining: number;
  turnover: number;
};

export type MarketPulse = {
  advancing: number;
  declining: number;
  score: number;
  state: '强势' | '偏强' | '震荡' | '偏弱';
  strongestSectorId: string;
};

export type MarketSector = {
  anomaly?: string;
  categoryIds: readonly MarketCategoryId[];
  changes: Readonly<Record<MarketPeriodId, number>>;
  constituents: readonly MarketConstituent[];
  id: string;
  indicator: MarketIndicator;
  methodology: string;
  name: string;
  series: readonly number[];
};

export type MarketRadarSnapshot = {
  categories: readonly MarketCategory[];
  coverage: MarketCoverage;
  fetchedAt: string;
  periods: readonly MarketPeriod[];
  pulses: Readonly<Record<MarketCategoryId, Readonly<Record<MarketPeriodId, MarketPulse>>>>;
  sectors: readonly MarketSector[];
  source: MarketRadarSource;
  sourceUrl: string;
  stale: boolean;
};
