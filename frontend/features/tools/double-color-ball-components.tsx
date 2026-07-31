import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import type {
  BacktestSummary,
  NumberStat,
  ReferenceCombination,
  ReferenceStrategy,
  RelaxedConstraint,
  SSQAnalysis,
} from '@/types/double-color-ball';

const CORAL = '#ff5d72';
const BLUE = '#3785ff';
const GREEN = '#20b486';
const INDIGO = '#151b3b';

type BallTone = 'blue' | 'cold' | 'hot' | 'neutral' | 'red';

const strategyLabels: Record<ReferenceStrategy, string> = {
  balanced: '均衡型',
  distributed: '分散型',
  trend: '趋势型',
  mixed: '冷热混合',
  'low-overlap': '低重合型',
};

const relaxationLabels: Record<RelaxedConstraint, string> = {
  'batch-overlap': '组间重合上限',
  'blue-uniqueness': '蓝球不重复',
  'consecutive-pairs': '连号数量',
  'sum-range': '和值区间',
};

export const NumberBall = memo(function NumberBall({
  number,
  size = 30,
  tone,
}: {
  number: number;
  size?: number;
  tone: BallTone;
}) {
  const { colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const palette = getBallPalette(tone, dark);
  const kind = tone === 'blue' ? '蓝球' : '红球';

  return (
    <View
      accessibilityLabel={`${kind} ${padBall(number)}`}
      style={[
        styles.ball,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          height: size,
          width: size,
        },
      ]}>
      <ThemedText style={[styles.ballText, { color: palette.text, fontSize: size <= 26 ? 9 : 11 }]}>
        {padBall(number)}
      </ThemedText>
    </View>
  );
});

export const HeatGrid = memo(function HeatGrid({ stats }: { stats: readonly NumberStat[] }) {
  const rows = [stats.slice(0, 11), stats.slice(11, 22), stats.slice(22, 33)];
  const cold = stats.filter((item) => item.temperature === 'cold').map((item) => padBall(item.number));
  const hot = stats.filter((item) => item.temperature === 'hot').map((item) => padBall(item.number));

  return (
    <View>
      <View style={styles.heatRows}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.heatRow}>
            {row.map((item) => (
              <NumberBall key={item.number} number={item.number} size={26} tone={item.temperature} />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.heatLegend}>
        <ThemedText style={styles.legendText}>冷号 {cold.join(' · ')}</ThemedText>
        <ThemedText style={[styles.legendText, { color: CORAL }]}>热号 {hot.join(' · ')}</ThemedText>
      </View>
    </View>
  );
});

export const StructureBars = memo(function StructureBars({ analysis }: { analysis: SSQAnalysis }) {
  const zone = analysis.commonZonePatterns[0] ?? [2, 2, 2];
  const odd = analysis.commonOddCounts[0] ?? 3;
  const spread = analysis.sumRange[1] - analysis.sumRange[0];
  const metrics = [
    { color: '#4b6bff', label: '三区比例', progress: 76, value: zone.join(' : ') },
    { color: CORAL, label: '常见奇偶', progress: 66, value: `${odd} : ${6 - odd}` },
    {
      color: GREEN,
      label: '和值区间',
      progress: Math.max(40, Math.min(92, spread)),
      value: `${analysis.sumRange[0]}–${analysis.sumRange[1]}`,
    },
  ];

  return (
    <View style={styles.structureList}>
      {metrics.map((metric) => (
        <View key={metric.label} style={styles.structureRow}>
          <ThemedText style={styles.structureLabel}>{metric.label}</ThemedText>
          <View style={styles.track}>
            <View style={[styles.trackFill, { backgroundColor: metric.color, width: `${metric.progress}%` }]} />
          </View>
          <ThemedText style={styles.structureValue}>{metric.value}</ThemedText>
        </View>
      ))}
    </View>
  );
});

export const CombinationCard = memo(function CombinationCard({
  combination,
  index,
  onPress,
  selected,
}: {
  combination: ReferenceCombination;
  index: number;
  onPress: () => void;
  selected: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`选择组合 ${String.fromCharCode(65 + index)} ${strategyLabels[combination.label]}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.combinationCard,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? '#4b6bff' : colors.line,
        },
        selected && styles.combinationSelected,
        pressed && styles.pressed,
      ]}>
      <View style={styles.combinationHeading}>
        <ThemedText style={styles.combinationTitle}>
          {String.fromCharCode(65 + index)} · {strategyLabels[combination.label]}
        </ThemedText>
        <ThemedText style={[styles.scoreText, { color: colors.mutedText }]}>结构匹配 {combination.structureScore}</ThemedText>
      </View>
      <View style={styles.ballLine}>
        {combination.red.map((number) => (
          <NumberBall key={number} number={number} tone="red" />
        ))}
        <View style={styles.blueSpacer} />
        <NumberBall number={combination.blue} tone="blue" />
      </View>
    </Pressable>
  );
});

export const EvidencePanel = memo(function EvidencePanel({
  combination,
  index,
}: {
  combination: ReferenceCombination;
  index: number;
}) {
  const { colors } = useAppTheme();
  const structure = combination.structure;
  const facts = [
    `三区 ${structure.zones.join(' : ')}`,
    `奇偶 ${structure.oddCount} : ${6 - structure.oddCount}`,
    `和值 ${structure.redSum}`,
    `热冷中 ${structure.hotCount} : ${structure.coldCount} : ${structure.neutralCount}`,
    `上期重号 ${structure.latestRepeatCount}`,
    `批内最大重合 ${structure.maximumBatchOverlap}`,
  ];

  return (
    <View style={[styles.evidencePanel, { backgroundColor: colors.primarySoft }]}>
      <View style={styles.evidenceHeader}>
        <ThemedText style={styles.evidenceTitle}>组合 {String.fromCharCode(65 + index)} · 生成依据</ThemedText>
        <ThemedText style={[styles.evidenceScore, { color: '#4b6bff' }]}>{combination.structureScore}/100</ThemedText>
      </View>
      <View style={styles.factGrid}>
        {facts.map((fact) => (
          <View key={fact} style={styles.factItem}>
            <MaterialCommunityIcons name="check-circle" size={16} color={GREEN} />
            <ThemedText style={styles.factText}>{fact}</ThemedText>
          </View>
        ))}
      </View>
      {combination.relaxedConstraints.length > 0 ? (
        <View style={styles.relaxationLine}>
          <MaterialCommunityIcons name="information-outline" size={16} color="#a76a00" />
          <ThemedText style={styles.relaxationText}>
            为凑满五组已放宽：{combination.relaxedConstraints.map((item) => relaxationLabels[item]).join('、')}
          </ThemedText>
        </View>
      ) : null}
      <ThemedText style={[styles.notProbability, { color: colors.mutedText }]}>结构匹配度不是中奖概率</ThemedText>
    </View>
  );
});

export const BacktestPanel = memo(function BacktestPanel({ summary }: { summary: BacktestSummary }) {
  const rows = [
    { color: '#4b6bff', label: '红球命中 0–1', value: summary.hitBuckets.zeroToOne },
    { color: CORAL, label: '红球命中 2–3', value: summary.hitBuckets.twoToThree },
    { color: GREEN, label: '红球命中 4+', value: summary.hitBuckets.fourPlus },
  ];

  return (
    <View style={styles.backtestPanel}>
      <View style={styles.backtestHeading}>
        <View>
          <ThemedText style={styles.sectionTitle}>历史回测分布</ThemedText>
          <ThemedText style={styles.backtestMeta}>{summary.sampleCount} 个目标期 · {summary.combinationCount} 组样本</ThemedText>
        </View>
        <ThemedText style={styles.behaviorOnly}>仅描述模型行为</ThemedText>
      </View>
      {rows.map((row) => {
        const percentage = summary.combinationCount === 0
          ? 0
          : Math.round((row.value / summary.combinationCount) * 100);
        return (
          <View key={row.label} style={styles.backtestRow}>
            <ThemedText style={styles.backtestLabel}>{row.label}</ThemedText>
            <View style={styles.track}>
              <View style={[styles.trackFill, { backgroundColor: row.color, width: `${percentage}%` }]} />
            </View>
            <ThemedText style={styles.backtestValue}>{percentage}%</ThemedText>
          </View>
        );
      })}
      <ThemedText style={styles.backtestFootnote}>蓝球命中 {summary.blueHits} 组；历史表现不代表未来结果。</ThemedText>
    </View>
  );
});

export function BlueFocus({ stats }: { stats: readonly NumberStat[] }) {
  const ranked = [...stats]
    .sort((left, right) => right.frequency - left.frequency || left.omission - right.omission || left.number - right.number)
    .slice(0, 5);
  return (
    <View style={styles.blueFocus}>
      <ThemedText style={styles.blueFocusLabel}>蓝球近期活跃</ThemedText>
      <View style={styles.blueFocusBalls}>
        {ranked.map((item) => <NumberBall key={item.number} number={item.number} size={27} tone="blue" />)}
      </View>
    </View>
  );
}

function padBall(number: number) {
  return String(number).padStart(2, '0');
}

function getBallPalette(tone: BallTone, dark: boolean) {
  if (tone === 'blue') return { background: BLUE, border: BLUE, text: '#ffffff' };
  if (tone === 'red') return { background: CORAL, border: CORAL, text: '#ffffff' };
  if (tone === 'hot') return { background: CORAL, border: CORAL, text: '#ffffff' };
  if (tone === 'cold') {
    return dark
      ? { background: '#20314a', border: '#304b6f', text: '#a9c9f2' }
      : { background: '#edf3fb', border: '#e1e9f4', text: '#7990ad' };
  }
  return dark
    ? { background: '#34242b', border: '#4b3039', text: '#ff9dad' }
    : { background: '#fff0f3', border: '#ffe1e7', text: '#d66d7d' };
}

const styles = StyleSheet.create({
  backtestFootnote: { color: '#7483a2', fontSize: 9, lineHeight: 14, marginTop: 9 },
  backtestHeading: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  backtestLabel: { fontSize: 10, fontWeight: '700', lineHeight: 15, width: 92 },
  backtestMeta: { color: '#7483a2', fontSize: 9, lineHeight: 14, marginTop: 2 },
  backtestPanel: { borderColor: '#dce4f5', borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 12 },
  backtestRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 9 },
  backtestValue: { fontSize: 10, fontWeight: '900', lineHeight: 15, textAlign: 'right', width: 34 },
  ball: { alignItems: 'center', borderRadius: 999, borderWidth: 1, justifyContent: 'center' },
  ballLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  ballText: { fontWeight: '900', lineHeight: 14 },
  behaviorOnly: { color: '#7483a2', fontSize: 8, fontWeight: '700', lineHeight: 12 },
  blueFocus: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  blueFocusBalls: { flexDirection: 'row', gap: 6 },
  blueFocusLabel: { fontSize: 10, fontWeight: '800', lineHeight: 15 },
  blueSpacer: { flex: 1, minWidth: 2 },
  combinationCard: { borderRadius: 8, borderWidth: 1, padding: 11 },
  combinationHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  combinationSelected: { borderWidth: 2, padding: 10 },
  combinationTitle: { fontSize: 12, fontWeight: '900', lineHeight: 18 },
  evidenceHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  evidencePanel: { borderLeftColor: '#4b6bff', borderLeftWidth: 3, borderRadius: 4, marginTop: 12, padding: 12 },
  evidenceScore: { fontSize: 11, fontWeight: '900', lineHeight: 16 },
  evidenceTitle: { fontSize: 12, fontWeight: '900', lineHeight: 18 },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, rowGap: 7 },
  factItem: { alignItems: 'center', flexDirection: 'row', gap: 5, width: '50%' },
  factText: { fontSize: 9, fontWeight: '700', lineHeight: 14 },
  heatLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  heatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  heatRows: { gap: 6 },
  legendText: { color: '#7483a2', fontSize: 8, lineHeight: 12 },
  notProbability: { fontSize: 8, lineHeight: 12, marginTop: 8 },
  pressed: { opacity: 0.76 },
  relaxationLine: { alignItems: 'flex-start', flexDirection: 'row', gap: 5, marginTop: 9 },
  relaxationText: { color: '#a76a00', flex: 1, fontSize: 8, lineHeight: 13 },
  scoreText: { fontSize: 8, fontWeight: '700', lineHeight: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '900', lineHeight: 19 },
  structureLabel: { fontSize: 10, fontWeight: '700', lineHeight: 15, width: 58 },
  structureList: { borderColor: '#dce4f5', borderRadius: 8, borderWidth: 1, gap: 13, padding: 12 },
  structureRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  structureValue: { fontSize: 10, fontWeight: '900', lineHeight: 15, textAlign: 'right', width: 56 },
  track: { backgroundColor: '#e8edf7', borderRadius: 999, flex: 1, height: 6, overflow: 'hidden' },
  trackFill: { borderRadius: 999, height: '100%' },
});

export { BLUE, CORAL, GREEN, INDIGO, strategyLabels };
