export type MarketCategoryId =
  | 'market'
  | 'ai'
  | 'new-energy'
  | 'health'
  | 'finance'
  | 'manufacturing'
  | 'themes';

export type MarketPeriodId = '1d' | '5d' | '20d';
export type MarketRadarSource = 'eastmoney';
export type MarketSortKey = 'change' | 'amount' | 'turnover' | 'advancingRatio' | 'strength';
export type MarketSignalType = 'leader' | 'laggard' | 'volume' | 'reversal' | 'breadth';
export type MarketView = 'overview' | 'sectors' | 'signals' | 'watch';

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
  amount?: number;
};

export type MarketIndicator = {
  advancing: number;
  amount: number;
  averageAmount: number;
  averageTurnover: number;
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

export type MarketIndex = {
  id: string;
  name: string;
  code: string;
  close: number;
  change: number;
  region: string;
};

export type MarketSignal = {
  id: string;
  type: MarketSignalType;
  title: string;
  description: string;
  sectorId: string;
  severity: number;
};

export type MarketSector = {
  categoryIds: readonly MarketCategoryId[];
  changes: Readonly<Record<MarketPeriodId, number>>;
  constituents: readonly MarketConstituent[];
  id: string;
  indicator: MarketIndicator;
  methodology: string;
  name: string;
  series: readonly number[];
  volumeRatio?: number;
};

export type MarketRelatedSector = {
  id: string;
  name: string;
  score: number;
};

export type MarketSectorNews = {
  id: string;
  title: string;
  publishedAt: string;
  summary: {
    oneSentence: string;
  };
  sources: {
    id: string;
    name: string;
    url: string;
    publishedAt: string;
  }[];
};

export type MarketSectorDetail = MarketSector & {
  related: readonly MarketRelatedSector[];
  news: readonly MarketSectorNews[];
};

export type MarketRadarSnapshot = {
  categories: readonly MarketCategory[];
  coverage: MarketCoverage;
  fetchedAt: string;
  indices: readonly MarketIndex[];
  periods: readonly MarketPeriod[];
  pulses: Readonly<Record<MarketCategoryId, Readonly<Record<MarketPeriodId, MarketPulse>>>>;
  sectors: readonly MarketSector[];
  signals: readonly MarketSignal[];
  source: MarketRadarSource;
  sourceUrl: string;
  stale: boolean;
};
