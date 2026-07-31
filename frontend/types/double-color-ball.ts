export type SSQWindowSize = 30 | 100 | 300;

export type SSQDraw = {
  blue: number;
  date: string;
  issue: string;
  red: number[];
};

export type NumberTemperature = 'cold' | 'hot' | 'neutral';

export type NumberStat = {
  frequency: number;
  number: number;
  omission: number;
  temperature: NumberTemperature;
};

export type DrawStructure = {
  consecutivePairs: number;
  oddCount: number;
  redSum: number;
  zones: [number, number, number];
};

export type SSQAnalysis = {
  blueStats: NumberStat[];
  commonOddCounts: number[];
  commonZonePatterns: [number, number, number][];
  latestDraw: SSQDraw;
  redStats: NumberStat[];
  sumRange: [number, number];
  windowSize: SSQWindowSize;
};

export type RelaxedConstraint =
  | 'batch-overlap'
  | 'blue-uniqueness'
  | 'consecutive-pairs'
  | 'sum-range';

export type ReferenceStrategy =
  | 'balanced'
  | 'distributed'
  | 'low-overlap'
  | 'mixed'
  | 'trend';

export type ReferenceStructure = DrawStructure & {
  coldCount: number;
  hotCount: number;
  latestRepeatCount: number;
  maximumBatchOverlap: number;
  neutralCount: number;
};

export type ReferenceCombination = {
  blue: number;
  label: ReferenceStrategy;
  red: number[];
  relaxedConstraints: RelaxedConstraint[];
  structure: ReferenceStructure;
  structureScore: number;
};

export type ReferenceBatch = {
  batchIndex: number;
  combinations: ReferenceCombination[];
  generatedForIssue: string;
  windowSize: SSQWindowSize;
};

export type BacktestSummary = {
  blueHits: number;
  combinationCount: number;
  hitBuckets: {
    fourPlus: number;
    twoToThree: number;
    zeroToOne: number;
  };
  sampleCount: number;
};
