export type SSQLabClassicFetchCount = 100 | 200 | 400 | 1000;

export type SSQLabClassicWindowSize = 30 | 100 | 300;

export type SSQLabClassicTargetCount = 20 | 50 | 100;

export type SSQLabClassicAlgorithm = 'low-frequency' | 'normal-fit' | 'time-weighted';

export type SSQLabClassicDraw = {
  blue: number;
  date: string;
  issue: string;
  red: number[];
  firstPrize?: number;
  secondPrize?: number;
};

export type SSQLabClassicHistorySnapshot = {
  count: number;
  draws: SSQLabClassicDraw[];
  fetchedAt: string;
  source: 'cwl';
  sourceUrl: string;
  stale: boolean;
};

export type SSQLabClassicPrizeLevel =
  | 'none'
  | 'sixth'
  | 'fifth'
  | 'fourth'
  | 'third'
  | 'second'
  | 'first';

export type SSQLabClassicBacktestRecord = {
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
  prizeLevel: SSQLabClassicPrizeLevel;
  redHits: number;
};

export type SSQLabClassicBacktestSummary = {
  algorithm: SSQLabClassicAlgorithm;
  blueHitCount: number;
  decay: number;
  firstPrizeCount: number;
  missingFloatingPrizeCount: number;
  net: number;
  netWithoutFirstPrize: number;
  records: SSQLabClassicBacktestRecord[];
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
  windowSize: SSQLabClassicWindowSize;
};

export type SSQLabClassicBacktestOptions = {
  algorithm: SSQLabClassicAlgorithm;
  decay: number;
  onWindow?: (target: SSQLabClassicDraw, history: readonly SSQLabClassicDraw[]) => void;
  targetCount: SSQLabClassicTargetCount;
  windowSize: SSQLabClassicWindowSize;
};

export type SSQLabClassicPrediction = {
  blue: number;
  red: number[];
};
