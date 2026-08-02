import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

type SkeletonBlockProps = {
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  width?: DimensionValue;
};

function SkeletonBlock({ height = 10, radius = 6, style, width = '100%' }: SkeletonBlockProps) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius,
          height,
          width,
        },
        style,
      ]}
    />
  );
}

function SkeletonRow({
  showThumb,
  thumbWidth = 76,
  thumbHeight = 64,
}: {
  showThumb?: boolean;
  thumbHeight?: number;
  thumbWidth?: number;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.row, { borderBottomColor: colors.line }]}>
      {showThumb ? (
        <SkeletonBlock height={thumbHeight} radius={6} width={thumbWidth} />
      ) : null}
      <View style={styles.rowCopy}>
        <SkeletonBlock height={10} width="88%" />
        <SkeletonBlock height={9} width="64%" />
        <SkeletonBlock height={8} width="38%" />
      </View>
    </View>
  );
}

function SkeletonCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

function HeroSkeleton() {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.hero, { backgroundColor: colors.hero }]}>
      <SkeletonBlock height={30} radius={8} width={30} style={{ backgroundColor: 'rgba(201,243,106,0.18)' }} />
      <SkeletonBlock height={10} radius={5} width="30%" style={{ backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 13 }} />
      <SkeletonBlock height={14} radius={5} width="82%" style={{ backgroundColor: 'rgba(255,255,255,0.18)', marginTop: 8 }} />
      <SkeletonBlock height={9} radius={5} width="58%" style={{ backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 8 }} />
    </View>
  );
}

export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <View style={styles.list}>
      <HeroSkeleton />
      <View style={styles.sectionHeading}>
        <SkeletonBlock height={11} width={92} />
      </View>
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} showThumb />
      ))}
    </View>
  );
}

export type SkeletonVariant = 'list' | 'workbench' | 'panel' | 'immersive';

export function WorkbenchPageSkeleton() {
  const { colors } = useAppTheme();

  return (
    <View style={styles.list}>
      <SkeletonCard style={styles.workbenchIntro}>
        <SkeletonBlock height={12} width="82%" />
        <SkeletonBlock height={9} width="46%" />
      </SkeletonCard>
      <SkeletonCard style={styles.workbenchCard}>
        {[0, 1, 2].map((item) => (
          <View
            key={item}
            style={[
              styles.settingRow,
              item > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : null,
            ]}>
            <SkeletonBlock height={36} radius={10} width={36} />
            <View style={styles.settingCopy}>
              <SkeletonBlock height={10} width="82%" />
              <SkeletonBlock height={8} width="52%" />
            </View>
          </View>
        ))}
      </SkeletonCard>
      <SkeletonCard style={styles.workbenchCard}>
        <SkeletonBlock height={44} radius={12} width="100%" />
      </SkeletonCard>
      <SkeletonBlock height={46} radius={12} width="100%" />
    </View>
  );
}

export function PanelPageSkeleton() {
  const { colors } = useAppTheme();

  return (
    <View style={styles.list}>
      <SkeletonCard style={styles.panelSummary}>
        <SkeletonBlock height={12} width="86%" />
        <SkeletonBlock height={9} width="58%" />
        <SkeletonBlock height={8} width="36%" />
      </SkeletonCard>
      <View style={styles.indicatorGrid}>
        {[0, 1, 2].map((item) => (
          <SkeletonCard key={item} style={styles.indicator}>
            <SkeletonBlock height={8} width="88%" />
            <SkeletonBlock height={8} width="52%" />
          </SkeletonCard>
        ))}
      </View>
      <SkeletonCard style={styles.chartCard}>
        <SkeletonBlock height={10} width="72%" />
        <View style={styles.chartBars}>
          {[38, 56, 46, 78, 62, 88, 72, 96, 52].map((height, index) => (
            <View
              key={index}
              style={[
                styles.chartBar,
                {
                  backgroundColor: colors.surfaceMuted,
                  height: `${height}%`,
                },
              ]}
            />
          ))}
        </View>
      </SkeletonCard>
    </View>
  );
}

export function ImmersivePageSkeleton() {
  const { colors } = useAppTheme();

  return (
    <View style={styles.list}>
      <View style={[styles.immersiveStage, { backgroundColor: colors.hero }]}>
        <View style={styles.immersiveGrid} />
        <SkeletonBlock
          height={30}
          radius={999}
          width={150}
          style={{ backgroundColor: 'rgba(255,255,255,0.14)' }}
        />
      </View>
      <View style={styles.hudRow}>
        {[0, 1, 2].map((item) => (
          <SkeletonCard key={item} style={styles.hudCard}>
            <SkeletonBlock height={7} width="86%" />
            <SkeletonBlock height={7} width="46%" />
          </SkeletonCard>
        ))}
      </View>
      <View style={styles.controlRow}>
        <SkeletonBlock height={52} radius={12} style={styles.controlPrimary} />
        <SkeletonBlock height={52} radius={12} style={styles.controlSecondary} />
        <SkeletonBlock height={52} radius={12} style={styles.controlSecondary} />
      </View>
    </View>
  );
}

export function PageLoadingProgress({ color }: { color?: string }) {
  const { colors } = useAppTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      reduceMotion.current =
        typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false;
    }
  }, []);

  useEffect(() => {
    if (reduceMotion.current) return undefined;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(progress, {
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const barColor = color ?? colors.primary;
  const trackColor = Platform.OS === 'web' ? `${barColor}22` : colors.primarySoft;

  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.progressValue,
          {
            backgroundColor: barColor,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['-60%', '60%'],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
  },
  chartBar: {
    borderRadius: 5,
    flex: 1,
  },
  chartBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 9,
    height: 118,
    marginTop: 14,
  },
  chartCard: {
    marginTop: 12,
    paddingHorizontal: 14,
  },
  controlPrimary: {
    flex: 1.5,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  controlSecondary: {
    flex: 1,
  },
  hero: {
    borderRadius: 16,
    padding: 15,
  },
  hudCard: {
    flex: 1,
    padding: 10,
  },
  hudRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  immersiveStage: {
    alignItems: 'center',
    borderRadius: 16,
    height: 360,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  immersiveGrid: {
    borderColor: 'rgba(201,243,106,0.12)',
    borderRadius: 16,
    borderWidth: 1,
    bottom: 8,
    left: 8,
    position: 'absolute',
    right: 8,
    top: 8,
  },
  indicator: {
    minHeight: 64,
    padding: 10,
  },
  indicatorGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  list: {
    flex: 1,
    paddingBottom: 24,
  },
  panelSummary: {
    gap: 8,
  },
  progressTrack: {
    borderRadius: 2,
    height: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  progressValue: {
    borderRadius: 2,
    height: '100%',
    position: 'absolute',
    width: '40%',
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 11,
    paddingVertical: 14,
  },
  rowCopy: {
    flex: 1,
    gap: 8,
  },
  sectionHeading: {
    marginBottom: 4,
    marginTop: 16,
  },
  settingCopy: {
    flex: 1,
    gap: 7,
  },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 11,
  },
  workbenchCard: {
    marginTop: 12,
    padding: 12,
  },
  workbenchIntro: {
    gap: 8,
  },
});
