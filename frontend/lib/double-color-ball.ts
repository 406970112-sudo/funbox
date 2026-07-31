import type {
  BacktestSummary,
  DrawStructure,
  NumberStat,
  NumberTemperature,
  ReferenceBatch,
  ReferenceCombination,
  ReferenceStructure,
  ReferenceStrategy,
  RelaxedConstraint,
  SavedSSQBatch,
  SSQAnalysis,
  SSQDraw,
  SSQWindowSize,
} from '../types/double-color-ball.ts';

const referenceStrategies: readonly ReferenceStrategy[] = [
  'balanced',
  'distributed',
  'trend',
  'mixed',
  'low-overlap',
];

type Candidate = {
  blue: number;
  red: number[];
};

type BacktestHooks = {
  onWindow?: (target: SSQDraw, history: readonly SSQDraw[]) => void;
};

export function getDrawStructure(draw: Pick<SSQDraw, 'red'>): DrawStructure {
  const sorted = [...draw.red].sort((left, right) => left - right);
  return {
    consecutivePairs: sorted
      .slice(1)
      .filter((value, index) => value - sorted[index] === 1).length,
    oddCount: sorted.filter((value) => value % 2 === 1).length,
    redSum: sorted.reduce((sum, value) => sum + value, 0),
    zones: [
      sorted.filter((value) => value <= 11).length,
      sorted.filter((value) => value >= 12 && value <= 22).length,
      sorted.filter((value) => value >= 23).length,
    ],
  };
}

export function analyzeDraws(
  draws: readonly SSQDraw[],
  windowSize: SSQWindowSize,
): SSQAnalysis {
  if (draws.length < windowSize) {
    throw new Error(`至少需要 ${windowSize} 期开奖数据`);
  }

  const window = draws.slice(0, windowSize);
  const structures = window.map(getDrawStructure);
  const redStats = buildStats(window, 33, (draw) => draw.red);
  const blueStats = buildStats(window, 16, (draw) => [draw.blue]);

  return {
    blueStats: classifyNumbers(blueStats),
    commonOddCounts: rankValues(structures.map((item) => item.oddCount), 3),
    commonZonePatterns: rankZonePatterns(structures.map((item) => item.zones), 3),
    latestDraw: cloneDraw(window[0]),
    redStats: classifyNumbers(redStats),
    sumRange: percentileRange(structures.map((item) => item.redSum)),
    windowSize,
  };
}

export function classifyNumbers(stats: readonly NumberStat[]): NumberStat[] {
  const groupSize = Math.floor(stats.length / 4);
  const ranked = [...stats].sort((left, right) => {
    const scoreDifference = activityScore(right, stats) - activityScore(left, stats);
    return scoreDifference || left.number - right.number;
  });
  const temperatures = new Map<number, NumberTemperature>();
  ranked.forEach((item, index) => {
    const temperature: NumberTemperature = index < groupSize
      ? 'hot'
      : index >= ranked.length - groupSize
        ? 'cold'
        : 'neutral';
    temperatures.set(item.number, temperature);
  });
  return stats.map((item) => ({
    ...item,
    temperature: temperatures.get(item.number) ?? 'neutral',
  }));
}

export function generateReferenceBatch(
  analysis: SSQAnalysis,
  batchIndex: number,
): ReferenceBatch {
  const random = createSeededRandom(
    `${analysis.windowSize}:${analysis.latestDraw.issue}:${batchIndex}`,
  );
  const accepted: ReferenceCombination[] = [];
  const attemptsPerLevel = 1000;

  for (let relaxationLevel = 0; relaxationLevel <= 4 && accepted.length < 5; relaxationLevel += 1) {
    const relaxedConstraints = relaxedConstraintsForLevel(relaxationLevel);
    for (let attempt = 0; attempt < attemptsPerLevel && accepted.length < 5; attempt += 1) {
      const candidate = buildWeightedCandidate(analysis, random);
      if (!acceptCandidate(candidate, accepted, analysis, relaxedConstraints)) {
        continue;
      }
      accepted.push({
        blue: candidate.blue,
        label: referenceStrategies[accepted.length],
        red: candidate.red,
        relaxedConstraints: [...relaxedConstraints],
        structure: buildReferenceStructure(candidate.red, accepted, analysis),
        structureScore: 0,
      });
    }
  }

  if (accepted.length !== 5) {
    throw new Error('无法在 5,000 次尝试内生成五组合法参考号码');
  }

  const combinations = accepted.map((item, index) => {
    const peers = accepted.filter((_peer, peerIndex) => peerIndex !== index);
    const structure = buildReferenceStructure(item.red, peers, analysis);
    return {
      ...item,
      structure,
      structureScore: scoreReferenceStructure(structure, analysis),
    };
  });

  return {
    batchIndex,
    combinations,
    generatedForIssue: analysis.latestDraw.issue,
    windowSize: analysis.windowSize,
  };
}

export function runWalkForwardBacktest(
  draws: readonly SSQDraw[],
  windowSize: SSQWindowSize,
  hooks: BacktestHooks = {},
): BacktestSummary {
  const chronological = [...draws].reverse();
  const eligibleTargetIndexes = Array.from(
    { length: Math.max(0, chronological.length - windowSize) },
    (_value, index) => index + windowSize,
  );
  const targetCount = windowSize === 30 ? 30 : 60;
  const targetIndexes = eligibleTargetIndexes.slice(-targetCount);
  const summary: BacktestSummary = {
    blueHits: 0,
    combinationCount: 0,
    hitBuckets: { fourPlus: 0, twoToThree: 0, zeroToOne: 0 },
    sampleCount: targetIndexes.length,
  };

  for (const targetIndex of targetIndexes) {
    const target = chronological[targetIndex];
    const history = chronological
      .slice(targetIndex - windowSize, targetIndex)
      .reverse()
      .map(cloneDraw);
    hooks.onWindow?.(cloneDraw(target), history.map(cloneDraw));
    const batch = generateReferenceBatch(analyzeDraws(history, windowSize), 0);

    for (const combination of batch.combinations) {
      const redHits = intersectionSize(combination.red, target.red);
      summary.combinationCount += 1;
      if (redHits <= 1) summary.hitBuckets.zeroToOne += 1;
      else if (redHits <= 3) summary.hitBuckets.twoToThree += 1;
      else summary.hitBuckets.fourPlus += 1;
      if (combination.blue === target.blue) summary.blueHits += 1;
    }
  }

  return summary;
}

export function resolveReferenceBatch(
  analysis: SSQAnalysis,
  saved: SavedSSQBatch | null,
) {
  const matches = Boolean(
    saved
    && saved.issue === analysis.latestDraw.issue
    && saved.windowSize === analysis.windowSize
    && saved.batch.generatedForIssue === analysis.latestDraw.issue
    && saved.batch.windowSize === analysis.windowSize
    && saved.batch.batchIndex === saved.batchIndex,
  );
  if (matches && saved) {
    return { batch: saved.batch, batchIndex: saved.batchIndex, restored: true };
  }
  return {
    batch: generateReferenceBatch(analysis, 0),
    batchIndex: 0,
    restored: false,
  };
}

function buildStats(
  draws: readonly SSQDraw[],
  maximumNumber: number,
  selectNumbers: (draw: SSQDraw) => readonly number[],
): NumberStat[] {
  return Array.from({ length: maximumNumber }, (_value, index) => {
    const number = index + 1;
    const frequency = draws.reduce(
      (count, draw) => count + (selectNumbers(draw).includes(number) ? 1 : 0),
      0,
    );
    const omissionIndex = draws.findIndex((draw) => selectNumbers(draw).includes(number));
    return {
      frequency,
      number,
      omission: omissionIndex === -1 ? draws.length : omissionIndex,
      temperature: 'neutral' as const,
    };
  });
}

function activityScore(item: NumberStat, stats: readonly NumberStat[]) {
  const maximumFrequency = Math.max(1, ...stats.map((stat) => stat.frequency));
  const maximumOmission = Math.max(1, ...stats.map((stat) => stat.omission));
  const normalizedFrequency = item.frequency / maximumFrequency;
  const normalizedRecency = 1 - item.omission / maximumOmission;
  return normalizedFrequency * 0.65 + normalizedRecency * 0.35;
}

function rankValues(values: readonly number[], limit: number): number[] {
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, limit)
    .map(([value]) => value);
}

function rankZonePatterns(
  patterns: readonly [number, number, number][],
  limit: number,
): [number, number, number][] {
  const counts = new Map<string, number>();
  patterns.forEach((pattern) => {
    const key = pattern.join('-');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key]) => key.split('-').map(Number) as [number, number, number]);
}

function percentileRange(values: readonly number[]): [number, number] {
  const sorted = [...values].sort((left, right) => left - right);
  const lastIndex = sorted.length - 1;
  return [sorted[Math.floor(lastIndex * 0.2)], sorted[Math.ceil(lastIndex * 0.8)]];
}

function cloneDraw(draw: SSQDraw): SSQDraw {
  return { ...draw, red: [...draw.red] };
}

function buildWeightedCandidate(
  analysis: SSQAnalysis,
  random: () => number,
): Candidate {
  const zonePattern = analysis.commonZonePatterns[
    Math.floor(random() * analysis.commonZonePatterns.length)
  ];
  const zoneStats = [
    analysis.redStats.filter((item) => item.number <= 11),
    analysis.redStats.filter((item) => item.number >= 12 && item.number <= 22),
    analysis.redStats.filter((item) => item.number >= 23),
  ];
  const red = zoneStats
    .flatMap((stats, index) => weightedSampleWithoutReplacement(stats, zonePattern[index], random))
    .sort((left, right) => left - right);
  const blue = weightedSampleWithoutReplacement(analysis.blueStats, 1, random)[0];
  return { blue, red };
}

function weightedSampleWithoutReplacement(
  stats: readonly NumberStat[],
  count: number,
  random: () => number,
): number[] {
  const pool = stats.map((item) => ({ item, weight: candidateWeight(item, stats) }));
  const selected: number[] = [];
  while (selected.length < count && pool.length > 0) {
    const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = random() * totalWeight;
    let selectedIndex = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      cursor -= pool[index].weight;
      if (cursor <= 0) {
        selectedIndex = index;
        break;
      }
    }
    selected.push(pool[selectedIndex].item.number);
    pool.splice(selectedIndex, 1);
  }
  return selected;
}

function candidateWeight(item: NumberStat, stats: readonly NumberStat[]) {
  const maximumFrequency = Math.max(1, ...stats.map((stat) => stat.frequency));
  const maximumOmission = Math.max(1, ...stats.map((stat) => stat.omission));
  return 0.5
    + (item.frequency / maximumFrequency) * 0.3
    + (1 - item.omission / maximumOmission) * 0.2;
}

function acceptCandidate(
  candidate: Candidate,
  accepted: readonly ReferenceCombination[],
  analysis: SSQAnalysis,
  relaxed: readonly RelaxedConstraint[],
) {
  const structure = getDrawStructure({ red: candidate.red });
  if (!analysis.commonZonePatterns.some((pattern) => sameZonePattern(pattern, structure.zones))) {
    return false;
  }
  if (structure.oddCount < 2 || structure.oddCount > 4) return false;
  if (intersectionSize(candidate.red, analysis.latestDraw.red) > 2) return false;
  if (!relaxed.includes('sum-range')) {
    if (structure.redSum < analysis.sumRange[0] || structure.redSum > analysis.sumRange[1]) {
      return false;
    }
  }
  const maximumConsecutivePairs = relaxed.includes('consecutive-pairs') ? 2 : 1;
  if (structure.consecutivePairs > maximumConsecutivePairs) return false;

  const maximumOverlap = relaxed.includes('batch-overlap') ? 3 : 2;
  if (accepted.some((item) => intersectionSize(item.red, candidate.red) > maximumOverlap)) {
    return false;
  }
  if (
    !relaxed.includes('blue-uniqueness')
    && accepted.some((item) => item.blue === candidate.blue)
  ) {
    return false;
  }
  return true;
}

function relaxedConstraintsForLevel(level: number): RelaxedConstraint[] {
  const order: readonly RelaxedConstraint[] = [
    'blue-uniqueness',
    'batch-overlap',
    'consecutive-pairs',
    'sum-range',
  ];
  return order.slice(0, level);
}

function buildReferenceStructure(
  red: readonly number[],
  peers: readonly ReferenceCombination[],
  analysis: SSQAnalysis,
): ReferenceStructure {
  const structure = getDrawStructure({ red: [...red] });
  const temperatures = new Map(
    analysis.redStats.map((item) => [item.number, item.temperature] as const),
  );
  const hotCount = red.filter((number) => temperatures.get(number) === 'hot').length;
  const coldCount = red.filter((number) => temperatures.get(number) === 'cold').length;
  return {
    ...structure,
    coldCount,
    hotCount,
    latestRepeatCount: intersectionSize(red, analysis.latestDraw.red),
    maximumBatchOverlap: peers.reduce(
      (maximum, peer) => Math.max(maximum, intersectionSize(red, peer.red)),
      0,
    ),
    neutralCount: red.length - hotCount - coldCount,
  };
}

function scoreReferenceStructure(
  structure: ReferenceStructure,
  analysis: SSQAnalysis,
) {
  let score = 0;
  if (analysis.commonZonePatterns.some((pattern) => sameZonePattern(pattern, structure.zones))) {
    score += 30;
  }
  if (analysis.commonOddCounts.includes(structure.oddCount)) score += 20;
  else if (structure.oddCount >= 2 && structure.oddCount <= 4) score += 12;
  if (structure.redSum >= analysis.sumRange[0] && structure.redSum <= analysis.sumRange[1]) {
    score += 20;
  }
  if (structure.hotCount > 0 && structure.coldCount > 0) score += 15;
  else if (structure.hotCount > 0 || structure.coldCount > 0) score += 8;
  if (structure.maximumBatchOverlap <= 2) score += 15;
  else if (structure.maximumBatchOverlap === 3) score += 8;
  return Math.max(0, Math.min(100, score));
}

function intersectionSize(left: readonly number[], right: readonly number[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function sameZonePattern(
  left: readonly number[],
  right: readonly number[],
) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createSeededRandom(seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
