import type {
  SSQLabAlgorithm,
  SSQLabBacktestOptions,
  SSQLabBacktestRecord,
  SSQLabBacktestSummary,
  SSQLabDraw,
  SSQLabPrediction,
  SSQLabPrizeLevel,
} from '../types/double-color-ball-lab.ts';

type FrequencyStat = {
  frequency: number;
  number: number;
};

const algorithmLabels: Record<SSQLabAlgorithm, string> = {
  probability: '概率预测法',
  'probability-weighted': '概率权重预测法',
  random: '随机预测法',
};

const prizeLevelLabels: Record<SSQLabPrizeLevel, string> = {
  fifth: '五等奖',
  first: '一等奖',
  fourth: '四等奖',
  none: '未中奖',
  second: '二等奖',
  sixth: '六等奖',
  third: '三等奖',
};

export function buildRandomPrediction(
  draws: readonly SSQLabDraw[],
  random: () => number = Math.random,
): SSQLabPrediction {
  return {
    blue: Math.floor(random() * 16) + 1,
    red: sampleUnique(33, 6, random),
  };
}

export function buildProbabilityPrediction(
  draws: readonly SSQLabDraw[],
): SSQLabPrediction {
  const redStats = sortByFrequencyDescending(buildFrequencyStats(draws, 33, (draw) => draw.red));
  const blueStats = sortByFrequencyDescending(buildFrequencyStats(draws, 16, (draw) => [draw.blue]));
  return {
    blue: blueStats[0].number,
    red: redStats.slice(0, 6).map((item) => item.number).sort((left, right) => left - right),
  };
}

export function buildProbabilityWeightedPrediction(
  draws: readonly SSQLabDraw[],
  weight: number,
): SSQLabPrediction {
  const redStats = sortByFrequencyDescending(buildWeightedStats(draws, 33, (draw) => draw.red, weight));
  const blueStats = sortByFrequencyDescending(buildWeightedStats(draws, 16, (draw) => [draw.blue], weight));
  return {
    blue: blueStats[0].number,
    red: redStats.slice(0, 6).map((item) => item.number).sort((left, right) => left - right),
  };
}

export function evaluatePrize(
  redHits: number,
  blueHit: boolean,
  firstPrize: number,
  secondPrize: number,
): { level: SSQLabPrizeLevel; prize: number } {
  if (redHits === 6 && blueHit) {
    return { level: 'first', prize: firstPrize };
  }
  if (redHits === 6) {
    return { level: 'second', prize: secondPrize };
  }
  if (redHits === 5 && blueHit) {
    return { level: 'third', prize: 3000 };
  }
  if (redHits === 5 || (redHits === 4 && blueHit)) {
    return { level: 'fourth', prize: 200 };
  }
  if (redHits === 4 || (redHits === 3 && blueHit)) {
    return { level: 'fifth', prize: 10 };
  }
  if (blueHit) {
    return { level: 'sixth', prize: 5 };
  }
  return { level: 'none', prize: 0 };
}

export function runLabBacktest(
  draws: readonly SSQLabDraw[],
  options: SSQLabBacktestOptions,
): SSQLabBacktestSummary {
  const chronological = [...draws].reverse();
  const eligibleTargets: number[] = [];
  for (let index = options.windowSize; index < chronological.length; index += 1) {
    eligibleTargets.push(index);
  }
  const targetIndexes = eligibleTargets.slice(-options.targetCount);

  const records: SSQLabBacktestRecord[] = targetIndexes.map((targetIndex) => {
    const target = chronological[targetIndex];
    const history = chronological
      .slice(targetIndex - options.windowSize, targetIndex)
      .reverse();
    options.onWindow?.(
      { ...target, red: [...target.red] },
      history.map((draw) => ({ ...draw, red: [...draw.red] })),
    );
    const prediction = buildPrediction(options.algorithm, history, options.weight);
    const redHits = intersectionSize(prediction.red, target.red);
    const blueHit = prediction.blue === target.blue;
    const firstPrize = target.firstPrize ?? 0;
    const secondPrize = target.secondPrize ?? 0;
    const { level, prize } = evaluatePrize(redHits, blueHit, firstPrize, secondPrize);
    return {
      actualBlue: target.blue,
      actualRed: [...target.red],
      blueHit,
      cost: 2,
      date: target.date,
      issue: target.issue,
      net: prize - 2,
      predictedBlue: prediction.blue,
      predictedRed: [...prediction.red],
      prize,
      prizeLevel: level,
      redHits,
    };
  });

  const totalCost = records.length * 2;
  const totalPrize = records.reduce((sum, record) => sum + record.prize, 0);
  const firstPrizeTotal = records
    .filter((record) => record.prizeLevel === 'first')
    .reduce((sum, record) => sum + record.prize, 0);
  const missingFloatingPrizeCount = records.filter((_record, index) => {
    const target = chronological[targetIndexes[index]];
    return (target.firstPrize ?? 0) <= 0 || (target.secondPrize ?? 0) <= 0;
  }).length;

  return {
    algorithm: options.algorithm,
    blueHitCount: records.filter((record) => record.blueHit).length,
    weight: options.weight,
    evPerTicket: records.length === 0 ? 0 : totalPrize / totalCost,
    firstPrizeCount: records.filter((record) => record.prizeLevel === 'first').length,
    missingFloatingPrizeCount,
    net: totalPrize - totalCost,
    netWithoutFirstPrize: totalPrize - firstPrizeTotal - totalCost,
    records,
    redHitBuckets: {
      fourPlus: records.filter((record) => record.redHits >= 4).length,
      twoToThree: records.filter((record) => record.redHits >= 2 && record.redHits <= 3).length,
      zeroToOne: records.filter((record) => record.redHits <= 1).length,
    },
    secondPrizeCount: records.filter((record) => record.prizeLevel === 'second').length,
    targetCount: records.length,
    totalCost,
    totalPrize,
    windowSize: options.windowSize,
  };
}

export function buildLabBacktestCsv(summary: SSQLabBacktestSummary): string {
  const lines: string[] = [
    '期号,日期,预测号码,开奖号码,红球命中,蓝球命中,奖级,奖金(元),成本(元),盈亏(元)',
    ...summary.records.map((record) => [
      record.issue,
      record.date,
      formatNumbers(record.predictedRed, record.predictedBlue),
      formatNumbers(record.actualRed, record.actualBlue),
      record.redHits,
      record.blueHit ? '是' : '否',
      prizeLevelLabels[record.prizeLevel],
      record.prize,
      record.cost,
      record.net,
    ].map(escapeCsv).join(',')),
    '',
    `算法,${algorithmLabels[summary.algorithm]}`,
    `统计窗口,${summary.windowSize} 期`,
    `概率权重,${summary.weight}`,
    `回测期数,${summary.records.length} 期`,
    `总成本(元),${summary.totalCost}`,
    `总奖金(元),${summary.totalPrize}`,
    `净收益(元),${summary.net}`,
    `每注期望(元),${summary.evPerTicket.toFixed(4)}`,
    `剔除头奖后净收益(元),${summary.netWithoutFirstPrize}`,
    `红球命中0-1,${summary.redHitBuckets.zeroToOne}`,
    `红球命中2-3,${summary.redHitBuckets.twoToThree}`,
    `红球命中4+,${summary.redHitBuckets.fourPlus}`,
    `蓝球命中,${summary.blueHitCount}`,
    `缺少浮动奖金期数,${summary.missingFloatingPrizeCount}`,
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function getLabAlgorithmLabel(algorithm: SSQLabAlgorithm): string {
  return algorithmLabels[algorithm];
}

export function getLabPrizeLevelLabel(level: SSQLabPrizeLevel): string {
  return prizeLevelLabels[level];
}

function buildPrediction(
  algorithm: SSQLabAlgorithm,
  draws: readonly SSQLabDraw[],
  weight: number,
): SSQLabPrediction {
  if (algorithm === 'random') {
    return buildRandomPrediction(draws);
  }
  if (algorithm === 'probability-weighted') {
    return buildProbabilityWeightedPrediction(draws, weight);
  }
  return buildProbabilityPrediction(draws);
}

function buildFrequencyStats(
  draws: readonly SSQLabDraw[],
  maximumNumber: number,
  selectNumbers: (draw: SSQLabDraw) => readonly number[],
): FrequencyStat[] {
  return Array.from({ length: maximumNumber }, (_value, index) => {
    const number = index + 1;
    return {
      frequency: draws.reduce(
        (count, draw) => count + (selectNumbers(draw).includes(number) ? 1 : 0),
        0,
      ),
      number,
    };
  });
}

function buildWeightedStats(
  draws: readonly SSQLabDraw[],
  maximumNumber: number,
  selectNumbers: (draw: SSQLabDraw) => readonly number[],
  weight: number,
): FrequencyStat[] {
  const clampedWeight = Math.min(100, Math.max(0, weight));
  const rawStats = buildFrequencyStats(draws, maximumNumber, selectNumbers);
  const maximumFrequency = Math.max(1, ...rawStats.map((item) => item.frequency));
  return rawStats.map((item) => {
    const number = item.number;
    const omissionIndex = draws.findIndex((draw) => selectNumbers(draw).includes(number));
    const omission = omissionIndex === -1 ? draws.length : omissionIndex;
    const normalizedFrequency = item.frequency / maximumFrequency;
    const normalizedRecency = 1 - omission / Math.max(1, draws.length);
    return {
      frequency: clampedWeight * normalizedFrequency + (100 - clampedWeight) * normalizedRecency,
      number,
    };
  });
}

function sortByFrequencyDescending(stats: readonly FrequencyStat[]): FrequencyStat[] {
  return [...stats].sort(
    (left, right) => right.frequency - left.frequency || left.number - right.number,
  );
}

function sampleUnique(maximum: number, count: number, random: () => number): number[] {
  const pool = Array.from({ length: maximum }, (_value, index) => index + 1);
  const picked: number[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked.sort((left, right) => left - right);
}

function intersectionSize(left: readonly number[], right: readonly number[]): number {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

function formatNumbers(red: readonly number[], blue: number): string {
  return `${red.map(padBall).join(' ')} ${padBall(blue)}`;
}

function padBall(number: number): string {
  return String(number).padStart(2, '0');
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
