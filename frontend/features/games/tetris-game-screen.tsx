import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useReducer, useRef, useState, type ComponentProps } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as TetrisEngine from 'react-tetris/lib/models/Game';
import type { Matrix } from 'react-tetris/lib/models/Matrix';
import { getBlocks, type Piece, type Rotation } from 'react-tetris/lib/models/Piece';

import {
  getStoredTetrisBestScore,
  setStoredTetrisBestScore,
} from '@/features/games/tetris-best-score';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type SessionState = {
  clearRevision: number;
  combo: number;
  game: TetrisEngine.Game;
  maxCombo: number;
};
type SessionAction = {
  action: TetrisEngine.Action;
  type: 'ENGINE';
};
type ControlButtonProps = {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: IconName;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  tone?: 'default' | 'soft' | 'primary';
};

const COLORS = {
  background: '#edf3ff',
  board: '#111a2d',
  boardBorder: '#273651',
  boardLine: '#243149',
  cyan: '#22c7d9',
  ink: '#17223a',
  line: '#dce4f2',
  muted: '#75819a',
  primary: '#4b6bff',
  primarySoft: '#e9eeff',
  red: '#ee6b5d',
  screen: '#f9fbff',
  surface: '#ffffff',
  surfaceMuted: '#f0f4fc',
  yellow: '#f3c84b',
} as const;

const PIECE_COLORS: Record<Piece, string> = {
  I: COLORS.cyan,
  J: '#4b6bff',
  L: '#f79a42',
  O: COLORS.yellow,
  S: '#43c983',
  T: '#d668db',
  Z: COLORS.red,
};

const PREVIEW_ROTATIONS: Record<Piece, Rotation> = {
  I: 1,
  J: 1,
  L: 3,
  O: 0,
  S: 2,
  T: 2,
  Z: 0,
};

const UI_FONT = Platform.select({
  android: 'sans-serif-condensed',
  ios: 'Avenir Next',
  web: 'Trebuchet MS',
});
const BOARD_GAP = 10;
const SPEED_SEGMENTS = 5;

function createInitialSession(): SessionState {
  return {
    clearRevision: 0,
    combo: 0,
    game: TetrisEngine.init(),
    maxCombo: 0,
  };
}

function sessionReducer(state: SessionState, event: SessionAction): SessionState {
  const nextGame = TetrisEngine.update(state.game, event.action);

  if (event.action === 'RESTART') {
    return {
      clearRevision: 0,
      combo: 0,
      game: nextGame,
      maxCombo: 0,
    };
  }

  if (nextGame.matrix === state.game.matrix) {
    return nextGame === state.game ? state : { ...state, game: nextGame };
  }

  const linesCleared = nextGame.lines - state.game.lines;
  const combo = linesCleared > 0 ? state.combo + 1 : 0;

  return {
    clearRevision: linesCleared > 0 ? state.clearRevision + 1 : state.clearRevision,
    combo,
    game: nextGame,
    maxCombo: Math.max(state.maxCombo, combo),
  };
}

function formatScore(score: number) {
  return new Intl.NumberFormat('zh-CN').format(score);
}

function getTickMs(level: number) {
  return Math.max(105, 820 - (level - 1) * 68);
}

function triggerImpact(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== 'web') {
    void Haptics.impactAsync(style);
  }
}

function ScoreStrip({ game }: { game: TetrisEngine.Game }) {
  const level = TetrisEngine.getLevel(game);

  return (
    <View accessibilityLabel="本局数据" style={styles.scoreStrip}>
      <ScoreItem label="得分" value={formatScore(game.points)} />
      <ScoreItem label="等级" value={String(level).padStart(2, '0')} compact />
      <ScoreItem label="消行" value={String(game.lines).padStart(2, '0')} compact last />
    </View>
  );
}

function ScoreItem({
  compact = false,
  label,
  last = false,
  value,
}: {
  compact?: boolean;
  label: string;
  last?: boolean;
  value: string;
}) {
  return (
    <View style={[styles.scoreItem, compact && styles.scoreItemCompact, last && styles.scoreItemLast]}>
      <View>
        <Text style={styles.scoreLabel}>{label}</Text>
        <Text style={[styles.scoreValue, compact && styles.scoreValueCompact]}>{value}</Text>
      </View>
    </View>
  );
}

function TetrisBoard({
  activePiece,
  flash,
  matrix,
  size,
}: {
  activePiece: Piece;
  flash: Animated.Value;
  matrix: Matrix;
  size: number;
}) {
  return (
    <View
      accessibilityLabel="十列二十行俄罗斯方块棋盘"
      accessibilityRole="image"
      testID="tetris-board"
      style={[styles.board, { height: size * 2, width: size }]}>
      {matrix.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.boardRow}>
          {row.map((value, columnIndex) => {
            const piece = value === 'ghost' ? activePiece : value;
            const color = piece ? PIECE_COLORS[piece] : undefined;

            return (
              <View
                key={`${rowIndex}-${columnIndex}`}
                style={[
                  styles.boardCell,
                  value && value !== 'ghost' && { backgroundColor: color, borderColor: '#ffffff55' },
                  value === 'ghost' && { borderColor: `${color}b5`, borderWidth: 1.5 },
                ]}>
                {value && value !== 'ghost' ? (
                  <View
                    style={[
                      styles.blockBevel,
                      {
                        borderBottomColor: '#00000024',
                        borderLeftColor: '#ffffff42',
                        borderRightColor: '#00000024',
                        borderTopColor: '#ffffff42',
                      },
                    ]}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      <Animated.View
        style={[
          styles.clearFlash,
          {
            opacity: flash.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0.26, 0],
            }),
          },
        ]}
      />
    </View>
  );
}

function PiecePreview({ piece, small }: { piece?: Piece; small: boolean }) {
  const activeCells = piece ? getBlocks(piece)[PREVIEW_ROTATIONS[piece]] : undefined;
  const cellSize = small ? 10 : 12;

  return (
    <View style={[styles.previewGrid, { width: cellSize * 4 + 9 }]}>
      {Array.from({ length: 12 }, (_, index) => {
        const row = Math.floor(index / 4);
        const column = index % 4;
        const isFilled = Boolean(activeCells?.[row]?.[column]);

        return (
          <View
            key={index}
            style={[
              styles.previewCell,
              { height: cellSize, width: cellSize },
              isFilled && {
                backgroundColor: piece ? PIECE_COLORS[piece] : 'transparent',
                borderColor: '#ffffff66',
                borderWidth: 1,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function PreviewPanel({
  label,
  onPress,
  piece,
  small,
}: {
  label: string;
  onPress?: () => void;
  piece?: Piece;
  small: boolean;
}) {
  const content = (
    <>
      <Text style={styles.railLabel}>{label}</Text>
      <PiecePreview piece={piece} small={small} />
    </>
  );

  if (!onPress) {
    return <View style={styles.previewPanel}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityHint="点击暂存当前方块，或换回已暂存方块"
      accessibilityLabel="暂存方块"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.previewPanel, pressed && styles.previewPanelPressed]}>
      {content}
    </Pressable>
  );
}

function SideRail({
  combo,
  heldPiece,
  level,
  nextPiece,
  onHold,
  small,
  width,
}: {
  combo: number;
  heldPiece?: Piece;
  level: number;
  nextPiece?: Piece;
  onHold: () => void;
  small: boolean;
  width: number;
}) {
  const activeSpeedSegments = Math.min(SPEED_SEGMENTS, Math.max(1, Math.ceil(level / 2)));

  return (
    <View style={[styles.sideRail, { width }]}>
      <PreviewPanel label="下一个" piece={nextPiece} small={small} />
      <PreviewPanel label="暂存" onPress={onHold} piece={heldPiece} small={small} />
      <View style={styles.comboPanel}>
        <Text style={styles.comboLabel}>连续消行</Text>
        <Text style={styles.comboValue}>×{combo}</Text>
        <View accessibilityLabel={`速度 ${activeSpeedSegments} 档`} style={styles.speedMeter}>
          {Array.from({ length: SPEED_SEGMENTS }, (_, index) => (
            <View
              key={index}
              style={[styles.speedSegment, index < activeSpeedSegments && styles.speedSegmentActive]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function ControlButton({
  accessibilityLabel,
  disabled = false,
  icon,
  onPress,
  onPressIn,
  onPressOut,
  tone = 'default',
}: ControlButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        styles.controlButton,
        tone === 'soft' && styles.controlButtonSoft,
        tone === 'primary' && styles.controlButtonPrimary,
        pressed && styles.controlButtonPressed,
        disabled && styles.controlButtonDisabled,
      ]}>
      <MaterialCommunityIcons
        color={tone === 'primary' ? COLORS.surface : COLORS.primary}
        name={icon}
        size={24}
      />
    </Pressable>
  );
}

function ControlPad({
  disabled,
  onHardDrop,
  onMove,
  onMoveStart,
  onMoveStop,
  onRotate,
}: {
  disabled: boolean;
  onHardDrop: () => void;
  onMove: (action: TetrisEngine.Action) => void;
  onMoveStart: (action: TetrisEngine.Action) => void;
  onMoveStop: () => void;
  onRotate: () => void;
}) {
  return (
    <View accessibilityLabel="游戏控制" style={styles.controls}>
      <View style={styles.directionPad}>
        <ControlButton
          accessibilityLabel="向左"
          disabled={disabled}
          icon="chevron-left"
          onPress={() => onMove('MOVE_LEFT')}
          onPressIn={() => onMoveStart('MOVE_LEFT')}
          onPressOut={onMoveStop}
        />
        <ControlButton
          accessibilityLabel="加速下落"
          disabled={disabled}
          icon="chevron-down"
          onPress={() => onMove('MOVE_DOWN')}
          onPressIn={() => onMoveStart('MOVE_DOWN')}
          onPressOut={onMoveStop}
          tone="soft"
        />
        <ControlButton
          accessibilityLabel="向右"
          disabled={disabled}
          icon="chevron-right"
          onPress={() => onMove('MOVE_RIGHT')}
          onPressIn={() => onMoveStart('MOVE_RIGHT')}
          onPressOut={onMoveStop}
        />
      </View>
      <View style={styles.actionPad}>
        <ControlButton
          accessibilityLabel="顺时针旋转"
          disabled={disabled}
          icon="rotate-right"
          onPress={onRotate}
          tone="soft"
        />
        <ControlButton
          accessibilityLabel="硬降"
          disabled={disabled}
          icon="chevron-double-down"
          onPress={onHardDrop}
          tone="primary"
        />
      </View>
    </View>
  );
}

function SessionSheet({
  bestScore,
  combo,
  gameOver,
  onPrimaryAction,
  onRestart,
  score,
}: {
  bestScore: number;
  combo: number;
  gameOver: boolean;
  onPrimaryAction: () => void;
  onRestart: () => void;
  score: number;
}) {
  return (
    <View style={styles.modalLayer}>
      <View accessibilityLabel={gameOver ? '游戏结束菜单' : '暂停菜单'} style={styles.sessionSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeading}>
          <View>
            <Text style={styles.sheetTitle}>{gameOver ? '本局结束' : '游戏暂停'}</Text>
            <Text style={styles.sheetSubtitle}>
              {gameOver ? '棋盘已满，再来一局刷新纪录' : '进度已保留，准备好后继续'}
            </Text>
          </View>
          <View style={styles.sheetBadge}>
            <MaterialCommunityIcons
              color={COLORS.primary}
              name={gameOver ? 'flag-checkered' : 'pause'}
              size={20}
            />
          </View>
        </View>
        <View style={styles.sessionStats}>
          <SheetStat label="本局得分" value={formatScore(score)} />
          <SheetStat label="最高连消" value={`×${combo}`} />
          <SheetStat label="历史最佳" value={formatScore(bestScore)} last />
        </View>
        <View style={styles.sheetActions}>
          <Pressable
            accessibilityRole="button"
            onPress={onPrimaryAction}
            style={({ pressed }) => [styles.primarySheetButton, pressed && styles.sheetButtonPressed]}>
            <MaterialCommunityIcons
              color={COLORS.surface}
              name={gameOver ? 'restart' : 'play'}
              size={21}
            />
            <Text style={styles.primarySheetButtonText}>
              {gameOver ? '再来一局' : '继续游戏'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="重新开始"
            accessibilityRole="button"
            onPress={onRestart}
            style={({ pressed }) => [styles.restartButton, pressed && styles.sheetButtonPressed]}>
            <MaterialCommunityIcons color={COLORS.primary} name="restart" size={22} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SheetStat({
  label,
  last = false,
  value,
}: {
  label: string;
  last?: boolean;
  value: string;
}) {
  return (
    <View style={[styles.sessionStat, last && styles.sessionStatLast]}>
      <Text style={styles.sessionStatLabel}>{label}</Text>
      <Text style={styles.sessionStatValue}>{value}</Text>
    </View>
  );
}

export function TetrisGameScreen() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const [session, dispatchSession] = useReducer(sessionReducer, undefined, createInitialSession);
  const [bestScore, setBestScore] = useState(0);
  const repeatDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const entryProgress = useRef(new Animated.Value(0)).current;
  const clearFlash = useRef(new Animated.Value(0)).current;
  const game = session.game;
  const level = TetrisEngine.getLevel(game);
  const matrix = TetrisEngine.viewMatrix(game);
  const frameWidth = Math.min(width, 430);
  const smallLayout = frameWidth < 360;
  const railWidth = smallLayout ? 76 : 88;
  const horizontalSpace = smallLayout ? 20 : 28;
  const widthLimit = frameWidth - horizontalSpace - railWidth - BOARD_GAP;
  const heightLimit = Math.floor((height - (height < 720 ? 250 : 280)) / 2);
  const boardWidth = Math.max(150, Math.min(252, widthLimit, heightLimit));
  const bestScoreForDisplay = Math.max(bestScore, game.points);
  const isPlaying = game.state === 'PLAYING';
  const nextPiece = game.queue.queue[0];

  useEffect(() => {
    let active = true;

    void getStoredTetrisBestScore()
      .then((storedScore) => {
        if (active) {
          setBestScore(storedScore);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (game.points <= bestScore) {
      return;
    }

    setBestScore(game.points);
    void setStoredTetrisBestScore(game.points).catch(() => undefined);
  }, [bestScore, game.points]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = setInterval(() => {
      dispatchSession({ action: 'TICK', type: 'ENGINE' });
    }, getTickMs(level));

    return () => {
      clearInterval(timer);
    };
  }, [isPlaying, level]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      let action: TetrisEngine.Action | undefined;

      if (event.key === 'ArrowLeft') action = 'MOVE_LEFT';
      if (event.key === 'ArrowRight') action = 'MOVE_RIGHT';
      if (event.key === 'ArrowDown') action = 'MOVE_DOWN';
      if (event.key === 'ArrowUp') action = 'FLIP_CLOCKWISE';
      if (event.code === 'Space') action = 'HARD_DROP';
      if (key === 'c' || event.key === 'Shift') action = 'HOLD';
      if (key === 'p' || event.key === 'Escape') action = 'TOGGLE_PAUSE';

      if (!action || (event.repeat && ['HARD_DROP', 'HOLD', 'TOGGLE_PAUSE'].includes(action))) {
        return;
      }

      event.preventDefault();
      dispatchSession({ action, type: 'ENGINE' });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let mounted = true;
    let animation: Animated.CompositeAnimation | undefined;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!mounted) {
        return;
      }

      if (reduceMotion) {
        entryProgress.setValue(1);
        return;
      }

      animation = Animated.timing(entryProgress, {
        duration: 420,
        toValue: 1,
        useNativeDriver: Platform.OS !== 'web',
      });
      animation.start();
    });

    return () => {
      mounted = false;
      animation?.stop();
    };
  }, [entryProgress]);

  useEffect(() => {
    if (session.clearRevision === 0) {
      return;
    }

    clearFlash.setValue(0);
    Animated.timing(clearFlash, {
      duration: 420,
      toValue: 1,
      useNativeDriver: true,
    }).start();

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [clearFlash, session.clearRevision]);

  useEffect(() => {
    return () => {
      if (repeatDelayRef.current) {
        clearTimeout(repeatDelayRef.current);
      }

      if (repeatTimerRef.current) {
        clearInterval(repeatTimerRef.current);
      }
    };
  }, []);

  function stopRepeatedAction() {
    if (repeatDelayRef.current) {
      clearTimeout(repeatDelayRef.current);
      repeatDelayRef.current = null;
    }

    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }

  function startRepeatedAction(action: TetrisEngine.Action) {
    stopRepeatedAction();
    repeatDelayRef.current = setTimeout(() => {
      dispatchSession({ action, type: 'ENGINE' });
      repeatTimerRef.current = setInterval(() => {
        dispatchSession({ action, type: 'ENGINE' });
      }, 105);
    }, 260);
  }

  function dispatchWithImpact(
    action: TetrisEngine.Action,
    impactStyle: Haptics.ImpactFeedbackStyle,
  ) {
    dispatchSession({ action, type: 'ENGINE' });
    triggerImpact(impactStyle);
  }

  function restartGame() {
    stopRepeatedAction();
    dispatchSession({ action: 'RESTART', type: 'ENGINE' });
    triggerImpact(Haptics.ImpactFeedbackStyle.Medium);
  }

  return (
    <View style={styles.canvas}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
        <Animated.View
          style={[
            styles.screenBody,
            {
              opacity: entryProgress,
              transform: [
                {
                  translateY: entryProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            },
          ]}>
          <View style={styles.appBar}>
            <Pressable
              accessibilityLabel="返回"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.back()}
              style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonPressed]}>
              <MaterialCommunityIcons color={COLORS.ink} name="arrow-left" size={23} />
            </Pressable>
            <Text style={styles.appTitle}>俄罗斯方块</Text>
            <Pressable
              accessibilityLabel="暂停游戏"
              accessibilityRole="button"
              disabled={!isPlaying}
              onPress={() => dispatchWithImpact('PAUSE', Haptics.ImpactFeedbackStyle.Light)}
              style={({ pressed }) => [
                styles.headerButton,
                styles.pauseButton,
                pressed && styles.headerButtonPressed,
                !isPlaying && styles.controlButtonDisabled,
              ]}>
              <MaterialCommunityIcons color={COLORS.primary} name="pause" size={21} />
            </Pressable>
          </View>

          <View style={styles.playArea}>
            <ScoreStrip game={game} />
            <View
              style={[
                styles.gameRegion,
                { height: boardWidth * 2, width: boardWidth + railWidth + BOARD_GAP },
              ]}>
              <TetrisBoard
                activePiece={game.piece.piece}
                flash={clearFlash}
                matrix={matrix}
                size={boardWidth}
              />
              <SideRail
                combo={session.combo}
                heldPiece={game.heldPiece?.piece}
                level={level}
                nextPiece={nextPiece}
                onHold={() => dispatchWithImpact('HOLD', Haptics.ImpactFeedbackStyle.Light)}
                small={smallLayout}
                width={railWidth}
              />
            </View>
            <ControlPad
              disabled={!isPlaying}
              onHardDrop={() =>
                dispatchWithImpact('HARD_DROP', Haptics.ImpactFeedbackStyle.Medium)
              }
              onMove={(action) =>
                dispatchWithImpact(action, Haptics.ImpactFeedbackStyle.Light)
              }
              onMoveStart={startRepeatedAction}
              onMoveStop={stopRepeatedAction}
              onRotate={() =>
                dispatchWithImpact('FLIP_CLOCKWISE', Haptics.ImpactFeedbackStyle.Light)
              }
            />

            {game.state === 'PAUSED' ? (
              <SessionSheet
                bestScore={bestScoreForDisplay}
                combo={session.maxCombo}
                gameOver={false}
                onPrimaryAction={() =>
                  dispatchWithImpact('RESUME', Haptics.ImpactFeedbackStyle.Light)
                }
                onRestart={restartGame}
                score={game.points}
              />
            ) : null}

            {game.state === 'LOST' ? (
              <SessionSheet
                bestScore={bestScoreForDisplay}
                combo={session.maxCombo}
                gameOver
                onPrimaryAction={restartGame}
                onRestart={restartGame}
                score={game.points}
              />
            ) : null}
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  screen: {
    alignSelf: 'center',
    backgroundColor: COLORS.screen,
    flex: 1,
    maxWidth: 430,
    overflow: 'hidden',
    width: '100%',
    ...Platform.select({
      default: {
        shadowColor: COLORS.ink,
        shadowOffset: { height: 0, width: 0 },
        shadowOpacity: 0.13,
        shadowRadius: 24,
      },
      web: {
        boxShadow: '0 0 24px rgba(23, 34, 58, 0.13)',
      },
    }),
  },
  screenBody: {
    flex: 1,
  },
  appBar: {
    alignItems: 'center',
    borderBottomColor: '#e9eef7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 56,
    justifyContent: 'space-between',
    paddingHorizontal: 15,
  },
  appTitle: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pauseButton: {
    backgroundColor: COLORS.primarySoft,
  },
  headerButtonPressed: {
    opacity: 0.64,
    transform: [{ scale: 0.96 }],
  },
  playArea: {
    flex: 1,
    gap: 10,
    paddingBottom: 13,
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  scoreStrip: {
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    borderTopColor: COLORS.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 52,
  },
  scoreItem: {
    alignItems: 'center',
    borderRightColor: COLORS.line,
    borderRightWidth: 1,
    flex: 1.3,
    justifyContent: 'center',
  },
  scoreItemCompact: {
    flex: 0.8,
  },
  scoreItemLast: {
    borderRightWidth: 0,
  },
  scoreLabel: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 12,
  },
  scoreValue: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 17,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    lineHeight: 20,
  },
  scoreValueCompact: {
    fontSize: 15,
  },
  gameRegion: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: BOARD_GAP,
  },
  board: {
    backgroundColor: COLORS.board,
    borderColor: COLORS.boardBorder,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 8,
    gap: 1,
    overflow: 'hidden',
    padding: 5,
    position: 'relative',
    ...Platform.select({
      default: {
        shadowColor: COLORS.ink,
        shadowOffset: { height: 12, width: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 18,
      },
      web: {
        boxShadow: '0 14px 30px rgba(23, 34, 58, 0.2)',
      },
    }),
  },
  boardRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 1,
  },
  boardCell: {
    backgroundColor: '#ffffff05',
    borderColor: COLORS.boardLine,
    borderRadius: 3,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  blockBevel: {
    ...StyleSheet.absoluteFillObject,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderTopWidth: 2,
    pointerEvents: 'none',
  },
  clearFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    pointerEvents: 'none',
  },
  sideRail: {
    gap: 9,
  },
  previewPanel: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.line,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 92,
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  previewPanelPressed: {
    backgroundColor: COLORS.primarySoft,
    transform: [{ scale: 0.98 }],
  },
  railLabel: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 12,
    textAlign: 'center',
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginBottom: 2,
    marginTop: 9,
  },
  previewCell: {
    borderRadius: 3,
  },
  comboPanel: {
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 96,
    paddingHorizontal: 5,
  },
  comboLabel: {
    color: '#9eadc7',
    fontFamily: UI_FONT,
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 13,
  },
  comboValue: {
    color: COLORS.yellow,
    fontFamily: UI_FONT,
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 29,
    marginTop: 2,
  },
  speedMeter: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 12,
  },
  speedSegment: {
    backgroundColor: '#34415a',
    borderRadius: 2,
    flex: 1,
    height: 4,
    maxWidth: 10,
    minWidth: 6,
  },
  speedSegmentActive: {
    backgroundColor: COLORS.cyan,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  directionPad: {
    flex: 1.2,
    flexDirection: 'row',
    gap: 8,
  },
  actionPad: {
    flex: 0.9,
    flexDirection: 'row',
    gap: 8,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.line,
    borderRadius: 15,
    borderWidth: 1,
    elevation: 2,
    flex: 1,
    height: 54,
    justifyContent: 'center',
    ...Platform.select({
      default: {
        shadowColor: '#384a74',
        shadowOffset: { height: 6, width: 0 },
        shadowOpacity: 0.09,
        shadowRadius: 8,
      },
      web: {
        boxShadow: '0 6px 14px rgba(56, 74, 116, 0.09)',
      },
    }),
  },
  controlButtonSoft: {
    backgroundColor: COLORS.primarySoft,
  },
  controlButtonPrimary: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  controlButtonPressed: {
    opacity: 0.72,
    transform: [{ translateY: 1 }],
  },
  controlButtonDisabled: {
    opacity: 0.48,
  },
  modalLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13, 20, 35, 0.58)',
    justifyContent: 'flex-end',
    marginHorizontal: -14,
    marginTop: -4,
    zIndex: 20,
  },
  sessionSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 22,
    paddingHorizontal: 18,
    paddingTop: 9,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d8deea',
    borderRadius: 99,
    height: 4,
    marginBottom: 17,
    width: 42,
  },
  sheetHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 28,
  },
  sheetSubtitle: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  sheetBadge: {
    alignItems: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sessionStats: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 17,
    flexDirection: 'row',
    marginTop: 17,
    paddingVertical: 14,
  },
  sessionStat: {
    alignItems: 'center',
    borderRightColor: COLORS.line,
    borderRightWidth: 1,
    flex: 1,
  },
  sessionStatLast: {
    borderRightWidth: 0,
  },
  sessionStatLabel: {
    color: COLORS.muted,
    fontFamily: UI_FONT,
    fontSize: 9,
    lineHeight: 13,
  },
  sessionStatValue: {
    color: COLORS.ink,
    fontFamily: UI_FONT,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    lineHeight: 20,
    marginTop: 3,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 17,
  },
  primarySheetButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 15,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    justifyContent: 'center',
  },
  primarySheetButtonText: {
    color: COLORS.surface,
    fontFamily: UI_FONT,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  restartButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primarySoft,
    borderRadius: 15,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  sheetButtonPressed: {
    opacity: 0.74,
    transform: [{ scale: 0.98 }],
  },
});
