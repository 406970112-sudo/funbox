import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { startTransition, useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import {
  GOMOKU_BOARD_SIZE,
  buildBoardFromMoves,
  chooseAiMove,
  createEmptyGomokuBoard,
  getBoardCell,
  getWinningLine,
  isBoardFull,
  placeStone,
  type GomokuBoard,
  type GomokuDifficulty,
  type GomokuMove,
  type GomokuPosition,
  type Stone,
} from '@/features/games/gomoku-engine';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';

type MatchStatus = 'playing' | 'human-won' | 'ai-won' | 'draw';
type ScoreBoard = {
  ai: number;
  human: number;
};
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const HUMAN_STONE: Stone = 'black';
const AI_STONE: Stone = 'white';
const AI_DELAY_MS = 360;
const STAR_POINTS = new Set(['3:3', '3:11', '7:7', '11:3', '11:11']);

const DIFFICULTIES: {
  description: string;
  id: GomokuDifficulty;
  label: string;
}[] = [
  {
    id: 'easy',
    label: '轻松',
    description: '落子更随性，适合熟悉规则',
  },
  {
    id: 'medium',
    label: '进阶',
    description: '兼顾进攻和防守，节奏均衡',
  },
  {
    id: 'hard',
    label: '高手',
    description: '预判多步，优先制造连续威胁',
  },
];

export function GomokuGameScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const [board, setBoard] = useState<GomokuBoard>(() => createEmptyGomokuBoard());
  const [moves, setMoves] = useState<GomokuMove[]>([]);
  const [difficulty, setDifficulty] = useState<GomokuDifficulty>('medium');
  const [status, setStatus] = useState<MatchStatus>('playing');
  const [scores, setScores] = useState<ScoreBoard>({ ai: 0, human: 0 });
  const [round, setRound] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  const isAiTurn = status === 'playing' && moves.length % 2 === 1;
  const lastMove = moves.at(-1) ?? null;
  const winningLine = lastMove ? getWinningLine(board, lastMove) : [];
  const winningIndexes = new Set(winningLine.map((position) => positionKey(position)));
  const activeDifficulty = DIFFICULTIES.find((item) => item.id === difficulty)!;
  const boardOuterSize = Math.min(width - 12, 405);
  const cellSize = Math.max(17, Math.floor(boardOuterSize / GOMOKU_BOARD_SIZE));
  const boardSize = cellSize * GOMOKU_BOARD_SIZE;
  const boardPalette =
    colorScheme === 'dark'
      ? {
          board: '#9a6a3d',
          grid: 'rgba(40, 24, 15, 0.62)',
          shell: '#201a17',
        }
      : {
          board: '#ddb778',
          grid: 'rgba(67, 42, 22, 0.58)',
          shell: '#f4e6ce',
        };
  const statusCopy = getStatusCopy(status, isAiTurn, difficulty);

  useEffect(() => {
    if (!isAiTurn) {
      return;
    }

    const timer = setTimeout(() => {
      const aiPosition = chooseAiMove(board, difficulty, { aiStone: AI_STONE });

      if (!aiPosition) {
        setStatus('draw');
        return;
      }

      const nextBoard = placeStone(board, aiPosition, AI_STONE);

      if (!nextBoard) {
        return;
      }

      const nextMove: GomokuMove = { ...aiPosition, stone: AI_STONE };
      const aiWon = getWinningLine(nextBoard, aiPosition).length >= 5;

      startTransition(() => {
        setBoard(nextBoard);
        setMoves((previousMoves) => [...previousMoves, nextMove]);

        if (aiWon) {
          setStatus('ai-won');
          setScores((previousScores) => ({ ...previousScores, ai: previousScores.ai + 1 }));
          triggerResultHaptic(false);
          return;
        }

        if (isBoardFull(nextBoard)) {
          setStatus('draw');
        }
      });
    }, AI_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [board, difficulty, isAiTurn]);

  function handleCellPress(position: GomokuPosition) {
    if (status !== 'playing' || isAiTurn) {
      return;
    }

    const nextBoard = placeStone(board, position, HUMAN_STONE);

    if (!nextBoard) {
      return;
    }

    const nextMove: GomokuMove = { ...position, stone: HUMAN_STONE };
    const humanWon = getWinningLine(nextBoard, position).length >= 5;

    setBoard(nextBoard);
    setMoves((previousMoves) => [...previousMoves, nextMove]);
    triggerMoveHaptic();

    if (humanWon) {
      setStatus('human-won');
      setScores((previousScores) => ({
        ...previousScores,
        human: previousScores.human + 1,
      }));
      triggerResultHaptic(true);
      return;
    }

    if (isBoardFull(nextBoard)) {
      setStatus('draw');
    }
  }

  function handleDifficultyChange(nextDifficulty: GomokuDifficulty) {
    startTransition(() => {
      setDifficulty(nextDifficulty);
    });
  }

  function handleUndo() {
    if (status !== 'playing' || moves.length === 0) {
      return;
    }

    const removeCount = isAiTurn ? 1 : Math.min(2, moves.length);
    const remainingMoves = moves.slice(0, moves.length - removeCount);

    startTransition(() => {
      setMoves(remainingMoves);
      setBoard(buildBoardFromMoves(remainingMoves));
    });
    triggerMoveHaptic();
  }

  function handleRestart() {
    startTransition(() => {
      setBoard(createEmptyGomokuBoard());
      setMoves([]);
      setStatus('playing');
      setRound((previousRound) => previousRound + 1);
    });
  }

  function handleResign() {
    if (status !== 'playing' || moves.length === 0) {
      return;
    }

    setStatus('ai-won');
    setScores((previousScores) => ({ ...previousScores, ai: previousScores.ai + 1 }));
    triggerResultHaptic(false);
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <View style={styles.topBar}>
          <View style={styles.headerSide}>
            <Pressable
              accessibilityLabel="返回"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
              ]}>
              <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.headerTitle}>
            <ThemedText style={styles.pageTitle}>五子棋</ThemedText>
          </View>
          <Pressable
            accessibilityLabel={`对局设置，当前难度${activeDifficulty.label}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: showSettings }}
            onPress={() => setShowSettings(true)}
            style={[
              styles.settingsTrigger,
              { backgroundColor: colors.surfaceMuted },
            ]}>
            <ThemedText style={[styles.settingsTriggerText, { color: colors.text }]}>
              {activeDifficulty.label}
            </ThemedText>
            <MaterialCommunityIcons name="chevron-down" size={17} color={colors.mutedText} />
          </Pressable>
        </View>

        <View style={styles.gameHud}>
          <PlayerStatus
            active={status === 'human-won' || (status === 'playing' && !isAiTurn)}
            label="你"
            meta={`${scores.human} 胜`}
            stone="black"
          />
          <View style={styles.turnSummary}>
            <View style={styles.turnStatus}>
              {isAiTurn ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <View
                  style={[
                    styles.turnDot,
                    {
                      backgroundColor:
                        status === 'playing'
                          ? '#222a33'
                          : status === 'human-won'
                            ? colors.success
                            : colors.accent,
                    },
                  ]}
                />
              )}
              <ThemedText style={styles.turnLabel}>{statusCopy.title}</ThemedText>
            </View>
            <ThemedText style={[styles.turnMeta, { color: colors.mutedText }]}>
              第 {round} 局 · {moves.length} 手
            </ThemedText>
          </View>
          <PlayerStatus
            active={status === 'ai-won' || isAiTurn}
            align="right"
            label="AI"
            meta={`${scores.ai} 胜`}
            stone="white"
          />
        </View>

        <View
          style={[
            styles.boardStage,
            {
              backgroundColor: boardPalette.shell,
              borderColor: colors.line,
            },
          ]}>
          <GomokuBoardView
            board={board}
            boardColor={boardPalette.board}
            boardSize={boardSize}
            cellSize={cellSize}
            disabled={status !== 'playing' || isAiTurn}
            gridColor={boardPalette.grid}
            lastMove={lastMove}
            onCellPress={handleCellPress}
            winningIndexes={winningIndexes}
          />
        </View>

        {status !== 'playing' ? (
          <View style={[styles.resultBanner, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons
              name={status === 'human-won' ? 'trophy-outline' : 'flag-checkered'}
              size={22}
              color={status === 'human-won' ? colors.success : colors.primary}
            />
            <View style={styles.resultCopy}>
              <ThemedText style={styles.resultTitle}>{statusCopy.title}</ThemedText>
              <ThemedText style={[styles.resultText, { color: colors.mutedText }]}>
                {statusCopy.description}
              </ThemedText>
            </View>
          </View>
        ) : null}

        <View style={styles.actionRow}>
          <GameActionButton
            disabled={status !== 'playing' || moves.length === 0}
            icon="undo-variant"
            label="悔棋"
            onPress={handleUndo}
          />
          <GameActionButton
            accentColor={colors.primary}
            icon="refresh"
            label={status === 'playing' ? '重新开始' : '再来一局'}
            onPress={handleRestart}
            primary
          />
          <GameActionButton
            disabled={status !== 'playing' || moves.length === 0}
            icon="flag-outline"
            label="认输"
            onPress={handleResign}
          />
        </View>

        <Modal
          animationType="fade"
          onRequestClose={() => setShowSettings(false)}
          transparent
          visible={showSettings}>
          <View style={styles.modalRoot}>
            <Pressable
              accessibilityLabel="关闭对局设置"
              accessibilityRole="button"
              onPress={() => setShowSettings(false)}
              style={styles.modalScrim}
            />
            <View
              style={[
                styles.settingsSheet,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.line,
                },
              ]}>
              <View style={styles.sheetHeader}>
                <View>
                  <ThemedText style={styles.sheetTitle}>对局设置</ThemedText>
                  <ThemedText style={[styles.sheetSubtitle, { color: colors.mutedText }]}>
                    切换难度不会重置棋局
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityLabel="关闭"
                  accessibilityRole="button"
                  onPress={() => setShowSettings(false)}
                  style={styles.iconButton}>
                  <MaterialCommunityIcons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.settingsSection}>
                <View style={styles.settingsLabelRow}>
                  <ThemedText style={styles.settingsLabel}>AI 难度</ThemedText>
                  <MaterialCommunityIcons name="brain" size={20} color={colors.primary} />
                </View>
                <View style={[styles.segmentedControl, { backgroundColor: colors.surfaceMuted }]}>
                  {DIFFICULTIES.map((item) => (
                    <DifficultyButton
                      key={item.id}
                      active={difficulty === item.id}
                      colors={colors}
                      label={item.label}
                      onPress={() => handleDifficultyChange(item.id)}
                    />
                  ))}
                </View>
                <ThemedText style={[styles.settingsDescription, { color: colors.mutedText }]}>
                  {activeDifficulty.description}
                </ThemedText>
              </View>

              <View style={[styles.ruleRow, { borderTopColor: colors.line }]}>
                <MaterialCommunityIcons
                  name="information-outline"
                  size={20}
                  color={colors.mutedText}
                />
                <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>
                  你执黑先行，横、竖或斜线率先连成五子即可获胜。
                </ThemedText>
              </View>
            </View>
          </View>
        </Modal>
      </MobileScreen>
    </>
  );
}

function GomokuBoardView({
  board,
  boardColor,
  boardSize,
  cellSize,
  disabled,
  gridColor,
  lastMove,
  onCellPress,
  winningIndexes,
}: {
  board: GomokuBoard;
  boardColor: string;
  boardSize: number;
  cellSize: number;
  disabled: boolean;
  gridColor: string;
  lastMove: GomokuMove | null;
  onCellPress: (position: GomokuPosition) => void;
  winningIndexes: Set<string>;
}) {
  const stoneSize = Math.max(14, Math.floor(cellSize * 0.78));

  return (
    <View
      accessibilityLabel="十五乘十五五子棋棋盘"
      style={[styles.board, { backgroundColor: boardColor, height: boardSize, width: boardSize }]}>
      {Array.from({ length: GOMOKU_BOARD_SIZE }, (_, row) => (
        <View key={row} style={styles.boardRow}>
          {Array.from({ length: GOMOKU_BOARD_SIZE }, (_, col) => {
            const cell = getBoardCell(board, row, col);
            const key = `${row}:${col}`;
            const isLastMove = lastMove?.row === row && lastMove.col === col;
            const isWinningStone = winningIndexes.has(key);
            const cellDisabled = disabled || cell !== null;

            return (
              <Pressable
                key={key}
                accessibilityLabel={`${String.fromCharCode(65 + col)}${row + 1}${cell ? `，${cell === 'black' ? '黑子' : '白子'}` : ''}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: cellDisabled }}
                disabled={cellDisabled}
                onPress={() => onCellPress({ col, row })}
                style={[styles.boardCell, { height: cellSize, width: cellSize }]}>
                <View
                  style={[
                    styles.horizontalGridLine,
                    {
                      backgroundColor: gridColor,
                      left: col === 0 ? '50%' : 0,
                      right: col === GOMOKU_BOARD_SIZE - 1 ? '50%' : 0,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.verticalGridLine,
                    {
                      backgroundColor: gridColor,
                      bottom: row === GOMOKU_BOARD_SIZE - 1 ? '50%' : 0,
                      top: row === 0 ? '50%' : 0,
                    },
                  ]}
                />
                {STAR_POINTS.has(key) ? (
                  <View style={[styles.starPoint, { backgroundColor: gridColor }]} />
                ) : null}
                {cell ? (
                  <View
                    style={[
                      styles.stone,
                      {
                        backgroundColor: cell === 'black' ? '#20272f' : '#fffaf1',
                        borderColor: isWinningStone
                          ? '#ef476f'
                          : cell === 'black'
                            ? '#0f1419'
                            : '#d4cabd',
                        borderWidth: isWinningStone ? 2 : 1,
                        height: stoneSize,
                        width: stoneSize,
                      },
                    ]}>
                    {isLastMove ? (
                      <View
                        style={[
                          styles.lastMoveDot,
                          { backgroundColor: cell === 'black' ? '#ffffff' : '#4b6bff' },
                        ]}
                      />
                    ) : null}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function DifficultyButton({
  active,
  colors,
  label,
  onPress,
}: {
  active: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.difficultyButton,
        {
          backgroundColor: active ? colors.primary : 'transparent',
        },
      ]}>
      <ThemedText
        style={[
          styles.difficultyButtonText,
          { color: active ? '#ffffff' : colors.mutedText },
        ]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function PlayerStatus({
  active,
  align = 'left',
  label,
  meta,
  stone,
}: {
  active: boolean;
  align?: 'left' | 'right';
  label: string;
  meta: string;
  stone: Stone;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.playerStatus, align === 'right' ? styles.playerStatusRight : undefined]}>
      <View
        style={[
          styles.playerStone,
          {
            backgroundColor: stone === 'black' ? '#20272f' : '#fffaf1',
            borderColor: active ? colors.primary : colors.line,
          },
        ]}
      />
      <View style={align === 'right' ? styles.playerCopyRight : undefined}>
        <ThemedText style={[styles.playerLabel, { color: active ? colors.text : colors.mutedText }]}>
          {label}
        </ThemedText>
        <ThemedText style={[styles.playerMeta, { color: colors.mutedText }]}>{meta}</ThemedText>
      </View>
    </View>
  );
}

function GameActionButton({
  accentColor,
  disabled = false,
  icon,
  label,
  onPress,
  primary = false,
}: {
  accentColor?: string;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const { colors } = useAppTheme();
  const foregroundColor = disabled
    ? colors.tabInactive
    : primary
      ? '#ffffff'
      : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: primary ? accentColor : pressed ? colors.surfaceMuted : 'transparent',
          borderColor: primary ? accentColor : colors.line,
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      <MaterialCommunityIcons name={icon} size={19} color={foregroundColor} />
      <ThemedText style={[styles.actionButtonText, { color: foregroundColor }]} numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function getStatusCopy(
  status: MatchStatus,
  isAiTurn: boolean,
  difficulty: GomokuDifficulty,
): { description: string; shortLabel: string; title: string } {
  if (status === 'human-won') {
    return {
      title: '你赢了这局',
      shortLabel: '黑方获胜',
      description: '漂亮的五连，再开一局继续挑战。',
    };
  }

  if (status === 'ai-won') {
    return {
      title: 'AI 赢下这局',
      shortLabel: '白方获胜',
      description: '留意对手的活三和冲四，再试一次。',
    };
  }

  if (status === 'draw') {
    return {
      title: '本局和棋',
      shortLabel: '棋盘已满',
      description: '双方没有连成五子，可以重新开局。',
    };
  }

  if (isAiTurn) {
    return {
      title: 'AI 正在思考',
      shortLabel: 'AI 思考中',
      description:
        difficulty === 'hard'
          ? '高手模式会多预判几步，请稍候。'
          : '白方正在寻找合适的落子位置。',
    };
  }

  return {
    title: '轮到你落子',
    shortLabel: '黑方行动',
    description: '你执黑先行，率先连成五子获胜。',
  };
}

function positionKey(position: GomokuPosition): string {
  return `${position.row}:${position.col}`;
}

function triggerMoveHaptic() {
  if (Platform.OS !== 'web') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

function triggerResultHaptic(success: boolean) {
  if (Platform.OS !== 'web') {
    void Haptics.notificationAsync(
      success
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );
  }
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 10,
    paddingHorizontal: 0,
    paddingTop: 6,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    minHeight: 40,
  },
  headerSide: {
    width: 78,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  headerTitle: {
    alignItems: 'center',
    flex: 1,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  settingsTrigger: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 2,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
    width: 78,
  },
  settingsTriggerText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  gameHud: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: 16,
    minHeight: 50,
  },
  segmentedControl: {
    borderRadius: 14,
    flexDirection: 'row',
    padding: 4,
  },
  difficultyButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  difficultyButtonText: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  playerStatus: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 7,
  },
  playerStatusRight: {
    flexDirection: 'row-reverse',
  },
  playerCopyRight: {
    alignItems: 'flex-end',
  },
  playerStone: {
    borderRadius: 999,
    borderWidth: 2,
    height: 26,
    width: 26,
  },
  playerLabel: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
  playerMeta: {
    fontSize: 10,
    lineHeight: 13,
    marginTop: 1,
  },
  turnSummary: {
    alignItems: 'center',
    flex: 1.35,
    gap: 2,
  },
  turnStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 20,
  },
  turnDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  turnLabel: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  turnMeta: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 14,
  },
  boardStage: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 4,
  },
  board: {
    borderRadius: 9,
    overflow: 'hidden',
  },
  boardRow: {
    flexDirection: 'row',
  },
  boardCell: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  horizontalGridLine: {
    height: StyleSheet.hairlineWidth,
    position: 'absolute',
    top: '50%',
  },
  verticalGridLine: {
    left: '50%',
    position: 'absolute',
    width: StyleSheet.hairlineWidth,
  },
  starPoint: {
    borderRadius: 999,
    height: 5,
    position: 'absolute',
    width: 5,
  },
  stone: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    position: 'absolute',
  },
  lastMoveDot: {
    borderRadius: 999,
    height: 5,
    width: 5,
  },
  resultBanner: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resultCopy: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  resultText: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 6,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 9, 15, 0.62)',
  },
  settingsSheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: 22,
    maxWidth: 430,
    paddingBottom: 30,
    paddingHorizontal: 20,
    paddingTop: 20,
    width: '100%',
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  sheetSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  settingsSection: {
    gap: 12,
  },
  settingsLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  settingsLabel: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  settingsDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  ruleRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 16,
  },
  ruleText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
