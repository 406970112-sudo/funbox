export type SSQLabFetchCount = 100 | 200 | 500 | 1000;

export type SSQLabWindowSize = 20 | 30 | 50;

export type SSQLabTargetCount = 20 | 50 | 100;

export type SSQLabAlgorithm = 'probability' | 'probability-weighted' | 'random';

export type SSQLabDraw = {
  blue: number;
  date: string;
  issue: string;
  red: number[];
  firstPrize?: number;
  secondPrize?: number;
};

export type SSQLabHistorySnapshot = {
  count: number;
  draws: SSQLabDraw[];
  fetchedAt: string;
  source: 'cwl';
  sourceUrl: string;
  stale: boolean;
};

export type SSQLabPrizeLevel =
  | 'none'
  | 'sixth'
  | 'fifth'
  | 'fourth'
  | 'third'
  | 'second'
  | 'first';

export type SSQLabBacktestRecord = {
  actualBlue: number;
  actualRed: number[];
  blueHit: boolean;
  cost: number;
  date: string;
  issue: string;
  net: number;
  predictedBlue: number;
  predictedRed: number[];
  prize: number;
  prizeLevel: SSQLabPrizeLevel;
  redHits: number;
};

export type SSQLabBacktestSummary = {
  algorithm: SSQLabAlgorithm;
  blueHitCount: number;
  weight: number;
  firstPrizeCount: number;
  missingFloatingPrizeCount: number;
  net: number;
  netWithoutFirstPrize: number;
  records: SSQLabBacktestRecord[];
  redHitBuckets: {
    fourPlus: number;
    twoToThree: number;
    zeroToOne: number;
  };
  secondPrizeCount: number;
  targetCount: number;
  totalCost: number;
  totalPrize: number;
  evPerTicket: number;
  windowSize: SSQLabWindowSize;
};

export type SSQLabBacktestOptions = {
  algorithm: SSQLabAlgorithm;
  onWindow?: (target: SSQLabDraw, history: readonly SSQLabDraw[]) => void;
  targetCount: SSQLabTargetCount;
  weight: number;
  windowSize: SSQLabWindowSize;
};

export type SSQLabPrediction = {
  blue: number;
  red: number[];
};
