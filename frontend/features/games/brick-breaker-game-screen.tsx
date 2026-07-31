import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getStoredBrickBreakerBestScore,
  setStoredBrickBreakerBestScore,
} from '@/features/games/brick-breaker-best-score';
import { GameLeaderboardModal } from '@/features/games/game-leaderboard-modal';
import { useGameScoreSubmission } from '@/features/games/use-game-score-submission';
import {
  createBrickBreakerSession,
  disposeBrickBreakerSession,
  getBrickBreakerSnapshot,
  launchBrickBreakerBall,
  moveBrickBreakerPaddle,
  pauseBrickBreakerSession,
  restartBrickBreakerSession,
  resumeBrickBreakerSession,
  stepBrickBreakerSession,
  type BrickBreakerSession,
  type BrickBreakerSnapshot,
} from '@/features/games/brick-breaker-engine';
import type { BrickBreakerPowerUp } from '@/features/games/brick-breaker-rules';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const COLORS = {
  background: '#edf3ff',
  board: '#111a2d',
  boardBorder: '#273651',
  cyan: '#22c7d9',
  ink: '#17223a',
  line: '#dce4f2',
  mint: '#20c997',
  muted: '#75819a',
  primary: '#4b6bff',
  primarySoft: '#e9eeff',
  red: '#ff7466',
  screen: '#f9fbff',
  surface: '#ffffff',
  surfaceMuted: '#f0f4fc',
  yellow: '#f3c84b',
} as const;

const POWER_UP_META: Record<
  BrickBreakerPowerUp,
  { color: string; icon: IconName; label: string }
> = {
  expand: { color: COLORS.mint, icon: 'arrow-expand-horizontal', label: '加宽' },
  multiball: { color: COLORS.cyan, icon: 'circle-multiple', label: '多球' },
  piercing: { color: COLORS.yellow, icon: 'lightning-bolt', label: '穿透' },
};

const UI_FONT = Platform.select({
  android: 'sans-serif-condensed',
  ios: 'Avenir Next',
  web: 'Trebuchet MS',
});

function formatScore(score: number) {
  return new Intl.NumberFormat('zh-CN').format(score);
}

function triggerImpact(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== 'web') {
    void Haptics.impactAsync(style);
  }
}

function ScoreStrip({ snapshot }: { snapshot: BrickBreakerSnapshot }) {
  return (
    <View accessibilityLabel="本局数据" style={styles.scoreStrip}>
      <ScoreItem label="得分" value={formatScore(snapshot.score)} />
      <ScoreItem compact label="关卡" value={String(snapshot.level).padStart(2, '0')} />
      <View style={[styles.scoreItem, styles.scoreItemCompact, styles.scoreItemLast]}>
        <Text style={styles.scoreLabel}>生命</Text>
        <View accessibilityLabel={`剩余 ${snapshot.lives} 条生命`} style={styles.lifeRow}>
          {Array.from({ length: 3 }, (_, index) => (
            <MaterialCommunityIcons
              key={index}
              color={index < snapshot.lives ? COLORS.red : '#c9d2e1'}
              name={index < snapshot.lives ? 'heart' : 'heart-outline'}
              size={18}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function ScoreItem({
  compact = false,
  label,
  value,
}: {
  compact?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.scoreItem, compact && styles.scoreItemCompact]}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={[styles.scoreValue, compact && styles.scoreValueCompact]}>{value}</Text>
    </View>
  );
}

function StatusChip({
  color,
  icon,
  label,
  side,
}: {
  color: string;
  icon: IconName;
  label: string;
  side: 'left' | 'right';
}) {
  return (
    <View
      style={[
        styles.statusChip,
        side === 'left' ? styles.statusChipLeft : styles.statusChipRight,
        { borderColor: `${color}99` },
      ]}>
      <MaterialCommunityIcons color={color} name={icon} size={13} />
      <Text style={styles.statusChipText}>{label}</Text>
    </View>
  );
}

function GameField({ height, snapshot, width }: { height: number; snapshot: BrickBreakerSnapshot; width: number }) {
  return (
    <View
      accessibilityLabel="打砖块游戏场"
      accessibilityRole="image"
      testID="brick-breaker-field"
      style={[styles.gameField, { height, width }]}>
      <View style={styles.fieldGlow} />
      {snapshot.bricks.map((brick) => {
        const brickWidth = brick.width * width;
        const brickHeight = brick.height * height;
        return (
          <View
            key={brick.id}
            testID={`brick-${brick.id}`}
            style={[
              styles.brick,
              {
                backgroundColor: brick.color,
                height: brickHeight,
                left: brick.x * width - brickWidth / 2,
                top: brick.y * height - brickHeight / 2,
                width: brickWidth,
              },
              brick.hitPoints < brick.maxHitPoints && styles.brickDamaged,
            ]}>
            <View style={styles.brickHighlight} />
            {brick.maxHitPoints > 1 ? (
              <MaterialCommunityIcons
                color="#ffffffcc"
                name={brick.hitPoints > 1 ? 'shield-half-full' : 'shield-outline'}
                size={Math.max(10, brickHeight * 0.62)}
                style={styles.brickShield}
              />
            ) : null}
          </View>
        );
      })}

      {snapshot.powerUps.map((powerUp) => {
        const meta = POWER_UP_META[powerUp.type];
        const powerUpWidth = powerUp.width * width;
        const powerUpHeight = powerUp.height * height;
        return (
          <View
            key={powerUp.id}
            accessibilityLabel={`${meta.label}道具`}
            style={[
              styles.powerUp,
              {
                backgroundColor: meta.color,
                height: powerUpHeight,
                left: powerUp.x * width - powerUpWidth / 2,
                top: powerUp.y * height - powerUpHeight / 2,
                width: powerUpWidth,
              },
            ]}>
            <MaterialCommunityIcons color={COLORS.board} name={meta.icon} size={13} />
          </View>
        );
      })}

      {snapshot.balls.map((ball) => {
        const diameter = ball.radius * width * 2;
        return (
          <View
            key={ball.id}
            testID={`ball-${ball.id}`}
            style={[
              styles.ball,
              {
                height: diameter,
                left: ball.x * width - diameter / 2,
                top: ball.y * height - diameter / 2,
                width: diameter,
              },
            ]}
          />
        );
      })}

      <View
        testID="brick-breaker-paddle"
        style={[
          styles.paddle,
          {
            height: snapshot.paddle.height * height,
            left: snapshot.paddle.x * width - (snapshot.paddle.width * width) / 2,
            top: snapshot.paddle.y * height - (snapshot.paddle.height * height) / 2,
            width: snapshot.paddle.width * width,
          },
        ]}>
        <View style={styles.paddleCore} />
      </View>

      <StatusChip color={COLORS.red} icon="fire" label={`连击 ×${snapshot.combo}`} side="left" />
      {snapshot.activeEffects.piercingMs > 0 ? (
        <StatusChip color={COLORS.yellow} icon="lightning-bolt" label="穿透" side="right" />
      ) : snapshot.activeEffects.expandMs > 0 ? (
        <StatusChip color={COLORS.mint} icon="arrow-expand-horizontal" label="加宽" side="right" />
      ) : null}
    </View>
  );
}

function SessionSheet({
  bestScore,
  onContinue,
  onRestart,
  snapshot,
}: {
  bestScore: number;
  onContinue: () => void;
  onRestart: () => void;
  snapshot: BrickBreakerSnapshot;
}) {
  const isLost = snapshot.status === 'lost';
  return (
    <View style={styles.sheetLayer}>
      <Pressable accessibilityLabel={isLost ? '游戏结束遮罩' : '游戏暂停遮罩'} style={styles.sheetShade} />
      <View accessibilityLabel={isLost ? '本局结束' : '游戏暂停'} style={styles.sheet}>
        <View style={[styles.sheetIcon, isLost && styles.sheetIconLost]}>
          <MaterialCommunityIcons
            color={isLost ? COLORS.red : COLORS.primary}
            name={isLost ? 'flag-checkered' : 'pause'}
            size={26}
          />
        </View>
        <Text style={styles.sheetTitle}>{isLost ? '本局结束' : '游戏暂停'}</Text>
        <Text style={styles.sheetMeta}>
          {isLost
            ? `得分 ${formatScore(snapshot.score)} · 最佳 ${formatScore(bestScore)}`
            : `当前得分 ${formatScore(snapshot.score)} · 第 ${snapshot.level} 关`}
        </Text>
        {!isLost ? (
          <Pressable
            accessibilityLabel="继续游戏"
            accessibilityRole="button"
            onPress={onContinue}
            style={({ pressed }) => [styles.sheetPrimaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons color="#ffffff" name="play" size={20} />
            <Text style={styles.sheetPrimaryText}>继续游戏</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel="重新开始"
          accessibilityRole="button"
          onPress={onRestart}
          style={({ pressed }) => [styles.sheetSecondaryButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons color={COLORS.ink} name="refresh" size={19} />
          <Text style={styles.sheetSecondaryText}>重新开始</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function BrickBreakerGameScreen() {
  const router = useRouter();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const sessionRef = useRef<BrickBreakerSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createBrickBreakerSession();
  }
  const [snapshot, setSnapshot] = useState(() => getBrickBreakerSnapshot(sessionRef.current!));
  const [bestScore, setBestScore] = useState(0);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const bestScoreRef = useRef(0);
  const steeringWidthRef = useRef(1);
  const heldKeysRef = useRef({ left: false, right: false });
  const lastPowerUpRevisionRef = useRef(0);

  const screenWidth = Math.min(windowWidth, 430);
  const availableFieldHeight = Math.max(388, windowHeight - 250);
  const fieldWidth = Math.min(screenWidth - 28, (availableFieldHeight * 360) / 560, 360);
  const fieldHeight = (fieldWidth * 560) / 360;

  useGameScoreSubmission('brick-breaker', snapshot.score, snapshot.status === 'lost');

  const refreshSnapshot = useCallback(() => {
    if (sessionRef.current) {
      setSnapshot(getBrickBreakerSnapshot(sessionRef.current));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getStoredBrickBreakerBestScore().then((score) => {
      if (active) {
        bestScoreRef.current = score;
        setBestScore(score);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (snapshot.score <= bestScoreRef.current) {
      return;
    }
    bestScoreRef.current = snapshot.score;
    setBestScore(snapshot.score);
    void setStoredBrickBreakerBestScore(snapshot.score);
  }, [snapshot.score]);

  useEffect(() => {
    if (snapshot.powerUpRevision > lastPowerUpRevisionRef.current) {
      lastPowerUpRevisionRef.current = snapshot.powerUpRevision;
      triggerImpact(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [snapshot.powerUpRevision]);

  useEffect(() => {
    let frameId = 0;
    let lastFrame = 0;
    let lastPaint = 0;
    const frame = (timestamp: number) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }
      const delta = lastFrame === 0 ? 16 : timestamp - lastFrame;
      lastFrame = timestamp;
      const heldKeys = heldKeysRef.current;
      if (session.rules.status === 'playing' && heldKeys.left !== heldKeys.right) {
        const current = getBrickBreakerSnapshot(session).paddle.x;
        moveBrickBreakerPaddle(session, current + (heldKeys.left ? -0.022 : 0.022));
      }
      stepBrickBreakerSession(session, delta);
      if (timestamp - lastPaint >= 24) {
        lastPaint = timestamp;
        setSnapshot(getBrickBreakerSnapshot(session));
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      const session = sessionRef.current;
      if (session) {
        disposeBrickBreakerSession(session);
        sessionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault();
      }
      if (event.key === 'ArrowLeft') {
        heldKeysRef.current.left = true;
      } else if (event.key === 'ArrowRight') {
        heldKeysRef.current.right = true;
      } else if (event.key === ' ') {
        launchBrickBreakerBall(sessionRef.current!);
        refreshSnapshot();
      } else if (event.key === 'Escape') {
        const session = sessionRef.current!;
        if (session.rules.status === 'playing') {
          pauseBrickBreakerSession(session);
        } else if (session.rules.status === 'paused') {
          resumeBrickBreakerSession(session);
        }
        refreshSnapshot();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        heldKeysRef.current.left = false;
      } else if (event.key === 'ArrowRight') {
        heldKeysRef.current.right = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [refreshSnapshot]);

  const handleSteering = (event: GestureResponderEvent) => {
    moveBrickBreakerPaddle(
      sessionRef.current!,
      event.nativeEvent.locationX / steeringWidthRef.current,
    );
    refreshSnapshot();
  };

  const handleLaunch = () => {
    launchBrickBreakerBall(sessionRef.current!);
    triggerImpact(Haptics.ImpactFeedbackStyle.Light);
    refreshSnapshot();
  };

  const handlePause = () => {
    const session = sessionRef.current!;
    if (session.rules.status === 'playing') {
      pauseBrickBreakerSession(session);
      refreshSnapshot();
    }
  };

  const handleContinue = () => {
    resumeBrickBreakerSession(sessionRef.current!);
    refreshSnapshot();
  };

  const handleRestart = () => {
    restartBrickBreakerSession(sessionRef.current!);
    triggerImpact(Haptics.ImpactFeedbackStyle.Medium);
    refreshSnapshot();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={[styles.screen, { width: screenWidth }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons color={COLORS.ink} name="arrow-left" size={24} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>打砖块</Text>
            <Text style={styles.bestScore}>最佳 {formatScore(bestScore)}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="查看好友排行榜"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setLeaderboardVisible(true)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons color={COLORS.ink} name="podium" size={22} />
            </Pressable>
            <Pressable
              accessibilityLabel="暂停游戏"
              accessibilityRole="button"
              disabled={snapshot.status !== 'playing'}
              hitSlop={12}
              onPress={handlePause}
              style={({ pressed }) => [
                styles.iconButton,
                snapshot.status !== 'playing' && styles.iconButtonDisabled,
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons color={COLORS.ink} name="pause" size={24} />
            </Pressable>
          </View>
        </View>

        <ScoreStrip snapshot={snapshot} />
        <View style={styles.fieldWrap}>
          <GameField height={fieldHeight} snapshot={snapshot} width={fieldWidth} />
        </View>

        <View style={styles.controlsRow}>
          <View
            accessibilityLabel="拖动控制挡板"
            accessibilityRole="adjustable"
            onLayout={(event) => {
              steeringWidthRef.current = Math.max(1, event.nativeEvent.layout.width);
            }}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleSteering}
            onResponderMove={handleSteering}
            onStartShouldSetResponder={() => true}
            style={styles.steeringArea}>
            <View style={styles.steeringTrack}>
              <View
                style={[
                  styles.steeringThumb,
                  { left: `${Math.max(0, Math.min(1, snapshot.paddle.x)) * 100}%` },
                ]}>
                <MaterialCommunityIcons color={COLORS.primary} name="drag-horizontal" size={18} />
              </View>
            </View>
          </View>
          <Pressable
            accessibilityLabel="发球"
            accessibilityRole="button"
            disabled={snapshot.status !== 'ready'}
            onPress={handleLaunch}
            style={({ pressed }) => [
              styles.launchButton,
              snapshot.status !== 'ready' && styles.launchButtonDisabled,
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons color="#ffffff" name="rocket-launch" size={21} />
            <Text style={styles.launchButtonText}>
              {snapshot.status === 'ready' ? '发球' : '进行中'}
            </Text>
          </Pressable>
        </View>

        {snapshot.status === 'paused' || snapshot.status === 'lost' ? (
          <SessionSheet
            bestScore={bestScore}
            onContinue={handleContinue}
            onRestart={handleRestart}
            snapshot={snapshot}
          />
        ) : null}
      </View>
      <GameLeaderboardModal
        gameId="brick-breaker"
        onClose={() => setLeaderboardVisible(false)}
        title="打砖块"
        visible={leaderboardVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    flex: 1,
  },
  screen: {
    backgroundColor: COLORS.screen,
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 58,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  iconButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  iconButtonDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  titleWrap: {
    alignItems: 'center',
  },
  title: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 20,
    fontWeight: '900',
  },
  bestScore: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  scoreStrip: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    borderTopColor: COLORS.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 60,
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  scoreItem: {
    borderRightColor: COLORS.line,
    borderRightWidth: 1,
    flex: 1.25,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  scoreItemCompact: {
    flex: 0.85,
  },
  scoreItemLast: {
    borderRightWidth: 0,
  },
  scoreLabel: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 10,
    fontWeight: '800',
  },
  scoreValue: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 21,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    marginTop: 1,
  },
  scoreValueCompact: {
    fontSize: 18,
  },
  lifeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    marginTop: 5,
  },
  fieldWrap: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  gameField: {
    backgroundColor: COLORS.board,
    borderColor: COLORS.boardBorder,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  fieldGlow: {
    backgroundColor: '#17233b',
    height: '34%',
    left: 0,
    opacity: 0.4,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  brick: {
    borderColor: '#ffffff3d',
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'absolute',
  },
  brickDamaged: {
    opacity: 0.58,
  },
  brickHighlight: {
    backgroundColor: '#ffffff31',
    height: 3,
    left: 3,
    position: 'absolute',
    right: 3,
    top: 2,
  },
  brickShield: {
    alignSelf: 'center',
    marginTop: 3,
  },
  ball: {
    backgroundColor: '#ffffff',
    borderColor: '#b8eaff',
    borderRadius: 999,
    borderWidth: 1,
    position: 'absolute',
    ...Platform.select({
      default: {
        shadowColor: COLORS.cyan,
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 7,
      },
      web: { boxShadow: `0 0 7px ${COLORS.cyan}` },
    }),
  },
  paddle: {
    backgroundColor: '#eaf2ff',
    borderColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'absolute',
    ...Platform.select({
      default: {
        shadowColor: COLORS.primary,
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 8,
      },
      web: { boxShadow: `0 0 8px ${COLORS.primary}` },
    }),
  },
  paddleCore: {
    backgroundColor: COLORS.primary,
    borderRadius: 4,
    bottom: 2,
    left: 16,
    position: 'absolute',
    right: 16,
    top: 2,
  },
  powerUp: {
    alignItems: 'center',
    borderColor: '#ffffffa0',
    borderRadius: 5,
    borderWidth: 1,
    justifyContent: 'center',
    position: 'absolute',
  },
  statusChip: {
    alignItems: 'center',
    backgroundColor: '#0b1324e8',
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    position: 'absolute',
    top: '51%',
  },
  statusChipLeft: {
    left: 8,
  },
  statusChipRight: {
    right: 8,
  },
  statusChipText: {
    color: '#f7f9ff',
    fontFamily: UI_FONT,
    fontSize: 10,
    fontWeight: '900',
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 74,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  steeringArea: {
    flex: 1,
    height: 52,
    justifyContent: 'center',
  },
  steeringTrack: {
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.line,
    borderRadius: 7,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 17,
  },
  steeringThumb: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: '#cdd8ef',
    borderRadius: 7,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    marginLeft: -17,
    position: 'absolute',
    width: 34,
  },
  launchButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 7,
    flexDirection: 'row',
    gap: 7,
    height: 48,
    justifyContent: 'center',
    width: 112,
  },
  launchButtonDisabled: {
    backgroundColor: '#8a9ce5',
  },
  launchButtonText: {
    color: '#ffffff',
    fontFamily: UI_FONT,
    fontSize: 15,
    fontWeight: '900',
  },
  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  sheetShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0d152891',
  },
  sheet: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingBottom: 24,
    paddingHorizontal: 22,
    paddingTop: 19,
  },
  sheetIcon: {
    alignItems: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: 7,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  sheetIconLost: {
    backgroundColor: '#fff0ee',
  },
  sheetTitle: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 22,
    fontWeight: '900',
    marginTop: 10,
  },
  sheetMeta: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 15,
    marginTop: 4,
  },
  sheetPrimaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 7,
    flexDirection: 'row',
    gap: 7,
    height: 46,
    justifyContent: 'center',
    width: '100%',
  },
  sheetPrimaryText: {
    color: '#ffffff',
    fontFamily: UI_FONT,
    fontSize: 14,
    fontWeight: '900',
  },
  sheetSecondaryButton: {
    alignItems: 'center',
    borderColor: COLORS.line,
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    height: 43,
    justifyContent: 'center',
    marginTop: 9,
    width: '100%',
  },
  sheetSecondaryText: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 14,
    fontWeight: '900',
  },
});
