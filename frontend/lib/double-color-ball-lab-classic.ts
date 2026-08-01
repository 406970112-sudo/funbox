import type {
  SSQLabClassicAlgorithm,
  SSQLabClassicBacktestOptions,
  SSQLabClassicBacktestRecord,
  SSQLabClassicBacktestSummary,
  SSQLabClassicDraw,
  SSQLabClassicPrediction,
  SSQLabClassicPrizeLevel,
} from '../types/double-color-ball-lab-classic.ts';

type FrequencyStat = {
  frequency: number;
  number: number;
};

const algorithmLabels: Record<SSQLabClassicAlgorithm, string> = {
  'low-frequency': '低频优先',
  'normal-fit': '正态拟合',
  'time-weighted': '时间加权',
};

const prizeLevelLabels: Record<SSQLabClassicPrizeLevel, string> = {
  fifth: '五等奖',
  first: '一等奖',
  fourth: '四等奖',
  none: '未中奖',
  second: '二等奖',
  sixth: '六等奖',
  third: '三等奖',
};

export function buildLowFrequencyPrediction(
  draws: readonly SSQLabClassicDraw[],
): SSQLabClassicPrediction {
  const redStats = sortByFrequencyAscending(buildFrequencyStats(draws, 33, (draw) => draw.red));
  const blueStats = sortByFrequencyAscending(buildFrequencyStats(draws, 16, (draw) => [draw.blue]));
  return {
    blue: blueStats[0].number,
    red: redStats.slice(0, 6).map((item) => item.number),
  };
}

export function buildTimeWeightedPrediction(
  draws: readonly SSQLabClassicDraw[],
  decay: number,
): SSQLabClassicPrediction {
  const redStats = sortByFrequencyAscending(buildWeightedStats(draws, 33, (draw) => draw.red, decay));
  const blueStats = sortByFrequencyAscending(buildWeightedStats(draws, 16, (draw) => [draw.blue], decay));
  return {
    blue: blueStats[0].number,
    red: redStats.slice(0, 6).map((item) => item.number),
  };
}

export function buildNormalFitPrediction(
  draws: readonly SSQLabClassicDraw[],
): SSQLabClassicPrediction {
  const positions = Array.from({ length: 6 }, () => [] as number[]);
  draws.forEach((draw) => {
    const sorted = [...draw.red].sort((left, right) => left - right);
    sorted.forEach((value, index) => positions[index].push(value));
  });

  const chosen = new Set<number>();
  const picks: number[] = [];
  positions.forEach((values) => {
    const mean = average(values);
    for (let offset = 0; offset <= 20; offset += 1) {
      const candidates = [Math.round(mean + offset), Math.round(mean - offset)];
      const picked = candidates
        .map((candidate) => Math.min(33, Math.max(1, candidate)))
        .find((candidate) => !chosen.has(candidate));
      if (picked !== undefined) {
        picks.push(picked);
        chosen.add(picked);
        break;
      }
    }
  });
  for (let number = 1; number <= 33 && picks.length < 6; number += 1) {
    if (!chosen.has(number)) {
      picks.push(number);
      chosen.add(number);
    }
  }

  const blueStats = sortByFrequencyAscending(buildFrequencyStats(draws, 16, (draw) => [draw.blue]));
  return {
    blue: blueStats[0].number,
    red: picks.sort((left, right) => left - right),
  };
}

export function evaluatePrize(
  redHits: number,
  blueHit: boolean,
  firstPrize: number,
  secondPrize: number,
): { level: SSQLabClassicPrizeLevel; prize: number } {
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
  draws: readonly SSQLabClassicDraw[],
  options: SSQLabClassicBacktestOptions,
): SSQLabClassicBacktestSummary {
  const chronological = [...draws].reverse();
  const eligibleTargets: number[] = [];
  for (let index = options.windowSize; index < chronological.length; index += 1) {
    eligibleTargets.push(index);
  }
  const targetIndexes = eligibleTargets.slice(-options.targetCount);

  const records: SSQLabClassicBacktestRecord[] = targetIndexes.map((targetIndex) => {
    const target = chronological[targetIndex];
    const history = chronological
      .slice(targetIndex - options.windowSize, targetIndex)
      .reverse();
    options.onWindow?.(
      { ...target, red: [...target.red] },
      history.map((draw) => ({ ...draw, red: [...draw.red] })),
    );
    const prediction = buildPrediction(options.algorithm, history, options.decay);
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
    decay: options.decay,
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

export function buildLabBacktestCsv(summary: SSQLabClassicBacktestSummary): string {
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
    `时间衰减,${summary.decay}`,
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

export function getLabAlgorithmLabel(algorithm: SSQLabClassicAlgorithm): string {
  return algorithmLabels[algorithm];
}

export function getLabPrizeLevelLabel(level: SSQLabClassicPrizeLevel): string {
  return prizeLevelLabels[level];
}

function buildPrediction(
  algorithm: SSQLabClassicAlgorithm,
  draws: readonly SSQLabClassicDraw[],
  decay: number,
): SSQLabClassicPrediction {
  if (algorithm === 'time-weighted') {
    return buildTimeWeightedPrediction(draws, decay);
  }
  if (algorithm === 'normal-fit') {
    return buildNormalFitPrediction(draws);
  }
  return buildLowFrequencyPrediction(draws);
}

function buildFrequencyStats(
  draws: readonly SSQLabClassicDraw[],
  maximumNumber: number,
  selectNumbers: (draw: SSQLabClassicDraw) => readonly number[],
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
  draws: readonly SSQLabClassicDraw[],
  maximumNumber: number,
  selectNumbers: (draw: SSQLabClassicDraw) => readonly number[],
  decay: number,
): FrequencyStat[] {
  const clampedDecay = Math.min(1, Math.max(0, decay));
  return Array.from({ length: maximumNumber }, (_value, index) => {
    const number = index + 1;
    const frequency = draws.reduce((score, draw, age) => {
      return score + (selectNumbers(draw).includes(number) ? Math.pow(clampedDecay, age) : 0);
    }, 0);
    return { frequency, number };
  });
}

function sortByFrequencyAscending(stats: readonly FrequencyStat[]): FrequencyStat[] {
  return [...stats].sort(
    (left, right) => left.frequency - right.frequency || left.number - right.number,
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
