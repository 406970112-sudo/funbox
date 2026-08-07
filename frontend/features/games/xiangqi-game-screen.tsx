import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { startTransition, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import {
  createXiangqiBoardGeometry,
  getXiangqiBoardPoint,
  XIANGQI_COLUMN_INTERVALS,
  XIANGQI_GRID_LINES,
  XIANGQI_ROW_INTERVALS,
  type XiangqiBoardGeometry,
} from '@/features/games/xiangqi-board-geometry';
import {
  applyXiangqiMove,
  chooseXiangqiAiMove,
  createXiangqiState,
  generateXiangqiLegalMoves,
  getXiangqiGameResult,
  getXiangqiHint,
  getXiangqiPiece,
  isXiangqiInCheck,
  XIANGQI_COLS,
  XIANGQI_ROWS,
  type XiangqiColor,
  type XiangqiDifficulty,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiPosition,
  type XiangqiState,
} from '@/features/games/xiangqi-engine';
import { getGameSocialCapability } from '@/features/games/game-social-model';
import { useGameSocial } from '@/features/games/game-social-provider';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useSocial } from '@/features/social/social-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { GameMatch, GameMove } from '@/types/game-social';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type MatchStatus = 'playing' | 'red-won' | 'black-won' | 'draw';

const AI_DELAY_MS = 320;

const DIFFICULTIES: { description: string; id: XiangqiDifficulty; label: string }[] = [
  { id: 'easy', label: '新手', description: '更随性，适合熟悉规则' },
  { id: 'medium', label: '棋友', description: '重视子力，攻守均衡' },
  { id: 'hard', label: '高手', description: '多层搜索，制造连续威胁' },
];

export function XiangqiGameScreen() {
  const [mode, setMode] = useState<'ai' | 'friend'>('ai');

  if (mode === 'friend') {
    return <XiangqiFriendGameScreen onExit={() => setMode('ai')} />;
  }

  return <XiangqiAIGameScreen onOpenFriendMatch={() => setMode('friend')} />;
}

function XiangqiAIGameScreen({ onOpenFriendMatch }: { onOpenFriendMatch: () => void }) {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const [moves, setMoves] = useState<XiangqiMove[]>([]);
  const [state, setState] = useState<XiangqiState>(() => createXiangqiState());
  const [difficulty, setDifficulty] = useState<XiangqiDifficulty>('medium');
  const [hintedMove, setHintedMove] = useState<XiangqiMove | null>(null);
  const [selected, setSelected] = useState<XiangqiPosition | null>(null);
  const [scores, setScores] = useState({ ai: 0, human: 0 });
  const [round, setRound] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<MatchStatus>('playing');

  const result = useMemo(() => {
    if (status !== 'playing') return { draw: status === 'draw', winner: status === 'red-won' ? ('red' as const) : status === 'black-won' ? ('black' as const) : null };
    return getXiangqiGameResult(state);
  }, [state, status]);
  const isAiTurn = status === 'playing' && state.sideToMove === 'black';
  const humanInCheck = status === 'playing' && state.sideToMove === 'red' && isXiangqiInCheck(state.board, 'red');
  const selectedMoves = useMemo(() => {
    if (!selected) return [];
    return generateXiangqiLegalMoves(state.board, state.sideToMove).filter(
      (move) => move.from.col === selected.col && move.from.row === selected.row,
    );
  }, [selected, state]);

  useEffect(() => {
    if (!isAiTurn) return;
    const timer = setTimeout(() => {
      const move = chooseXiangqiAiMove(state.board, 'black', difficulty);
      if (!move) return;
      startTransition(() => {
        setState((current) => ({ ...current, board: applyXiangqiMove(current.board, move), lastMove: move, sideToMove: 'red' }));
        setMoves((current) => [...current, move]);
        setHintedMove(null);
        triggerMoveHaptic();
      });
    }, AI_DELAY_MS);
    return () => clearTimeout(timer);
  }, [difficulty, isAiTurn, state]);

  useEffect(() => {
    if (status !== 'playing' || result.winner || result.draw) {
      if (status === 'playing') {
        if (result.winner === 'red') {
          setStatus('red-won');
          setScores((current) => ({ ...current, human: current.human + 1 }));
          triggerResultHaptic(true);
        } else if (result.winner === 'black') {
          setStatus('black-won');
          setScores((current) => ({ ...current, ai: current.ai + 1 }));
          triggerResultHaptic(false);
        } else if (result.draw) {
          setStatus('draw');
        }
      }
    }
  }, [result, status]);

  function handleSquarePress(position: XiangqiPosition) {
    if (status !== 'playing' || isAiTurn) return;
    setHintedMove(null);
    const piece = getXiangqiPiece(state.board, position);
    if (selected) {
      const matching = selectedMoves.find(
        (move) => move.col === position.col && move.row === position.row,
      );
      if (matching) {
        startTransition(() => {
          setState((current) => ({ ...current, board: applyXiangqiMove(current.board, matching), lastMove: matching, sideToMove: 'black' }));
          setMoves((current) => [...current, matching]);
          setSelected(null);
        });
        triggerMoveHaptic();
        return;
      }
    }
    if (piece?.color === 'red') {
      setSelected(position);
    } else {
      setSelected(null);
    }
  }

  function handleUndo() {
    if (status !== 'playing' || !state.lastMove) return;
    const removeCount = isAiTurn ? 1 : 2;
    let board = createXiangqiState().board;
    startTransition(() => {
      const remaining = moves.slice(0, Math.max(0, moves.length - removeCount));
      for (const move of remaining) {
        board = applyXiangqiMove(board, move);
      }
      setMoves(remaining);
      setHintedMove(null);
      setState({
        board,
        draw: false,
        lastMove: remaining.at(-1) ?? null,
        sideToMove: remaining.length % 2 === 0 ? 'red' : 'black',
        winner: null,
      });
      setSelected(null);
    });
    triggerMoveHaptic();
  }

  function handleRestart() {
    startTransition(() => {
      setState(createXiangqiState());
      setMoves([]);
      setHintedMove(null);
      setSelected(null);
      setStatus('playing');
      setRound((current) => current + 1);
    });
  }

  function handleHint() {
    if (status !== 'playing' || isAiTurn) return;
    const hint = getXiangqiHint(state.board, 'red');
    if (hint) {
      setHintedMove(hint);
      setSelected(hint.from);
      triggerMoveHaptic();
    }
  }

  function handleResign() {
    if (status !== 'playing' || !state.lastMove) return;
    setStatus('black-won');
    setScores((current) => ({ ...current, ai: current.ai + 1 }));
    triggerResultHaptic(false);
  }

  const statusCopy = getStatusCopy(status, isAiTurn, difficulty, humanInCheck);
  const boardPalette =
    colorScheme === 'dark'
      ? { board: '#a97c45', boardLine: '#6b4c22', grid: 'rgba(40,24,15,0.62)', shell: '#241d16' }
      : { board: '#e7c58f', boardLine: '#8a6634', grid: 'rgba(125,92,47,0.85)', shell: '#f0e5d2' };

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
              style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.headerTitle}>
            <ThemedText style={styles.pageTitle}>象棋</ThemedText>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="好友对战"
              accessibilityRole="button"
              onPress={onOpenFriendMatch}
              style={[styles.headerActionButton, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="account-multiple" size={19} color={colors.primary} />
            </Pressable>
            <Pressable
              accessibilityLabel="对局设置"
              accessibilityRole="button"
              onPress={() => setShowSettings(true)}
              style={[styles.headerActionButton, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="tune-variant" size={19} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.gameHud}>
          <XiangqiPlayerStatus active={isAiTurn || status === 'black-won'} label="AI" meta={`${scores.ai} 胜`} color="black" align="left" />
          <View style={styles.turnSummary}>
            <View style={styles.turnStatus}>
              {isAiTurn ? <ActivityIndicator color={colors.primary} size="small" /> : <View style={[styles.turnDot, { backgroundColor: status === 'playing' ? (humanInCheck ? colors.accent : colors.success) : colors.mutedText }]} />}
              <ThemedText style={styles.turnLabel}>{statusCopy.title}</ThemedText>
            </View>
            <ThemedText style={[styles.turnMeta, { color: colors.mutedText }]}>
              第 {round} 局 · {moves.length} 手
            </ThemedText>
          </View>
          <XiangqiPlayerStatus active={!isAiTurn && status === 'playing'} label="你" meta={`${scores.human} 胜`} color="red" align="right" />
        </View>

        <View style={[styles.boardStage, { backgroundColor: boardPalette.shell, borderColor: colors.line }]}>
          <XiangqiBoardView
            board={state.board}
            boardLineColor={boardPalette.boardLine}
            boardColor={boardPalette.board}
            gridColor={boardPalette.grid}
            hintedMove={hintedMove}
            lastMove={state.lastMove}
            legalMoves={selectedMoves}
            onSquarePress={handleSquarePress}
            selected={selected}
          />
        </View>

        {status !== 'playing' ? (
          <View style={[styles.resultBanner, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons
              name={status === 'red-won' ? 'trophy-outline' : status === 'draw' ? 'handshake-outline' : 'flag-checkered'}
              size={22}
              color={status === 'red-won' ? colors.success : status === 'draw' ? colors.mutedText : colors.primary}
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
          <XiangqiActionButton disabled={status !== 'playing' || !state.lastMove} icon="undo-variant" label="悔棋" onPress={handleUndo} />
          <XiangqiActionButton accentColor={colors.primary} disabled={status !== 'playing' || isAiTurn} icon="lightbulb-outline" label="提示" onPress={handleHint} primary />
          <XiangqiActionButton disabled={status !== 'playing' || !state.lastMove} icon="flag-outline" label="认输" onPress={handleResign} />
        </View>
        <View style={styles.hintRow}>
          <XiangqiActionButton icon="refresh" label={status === 'playing' ? '重新开始' : '再来一局'} onPress={handleRestart} />
        </View>

        <Modal animationType="fade" onRequestClose={() => setShowSettings(false)} transparent visible={showSettings}>
          <View style={styles.modalRoot}>
            <Pressable accessibilityLabel="关闭对局设置" accessibilityRole="button" onPress={() => setShowSettings(false)} style={styles.modalScrim} />
            <View style={[styles.settingsSheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.sheetHeader}>
                <View>
                  <ThemedText style={styles.sheetTitle}>对局设置</ThemedText>
                  <ThemedText style={[styles.sheetSubtitle, { color: colors.mutedText }]}>切换难度不会重置棋局</ThemedText>
                </View>
                <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={() => setShowSettings(false)} style={styles.iconButton}>
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
                    <DifficultyButton key={item.id} active={difficulty === item.id} colors={colors} label={item.label} onPress={() => setDifficulty(item.id)} />
                  ))}
                </View>
                <ThemedText style={[styles.settingsDescription, { color: colors.mutedText }]}>
                  {DIFFICULTIES.find((item) => item.id === difficulty)?.description}
                </ThemedText>
              </View>
              <View style={[styles.ruleRow, { borderTopColor: colors.line }]}>
                <MaterialCommunityIcons name="information-outline" size={20} color={colors.mutedText} />
                <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>
                  红方先行，将死或困毙即分胜负；悔棋会同时撤回 AI 一手。
                </ThemedText>
              </View>
            </View>
          </View>
        </Modal>
      </MobileScreen>
    </>
  );
}

function XiangqiFriendGameScreen({ onExit }: { onExit: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const { friends } = useSocial();
  const { authenticated, createMatch, error, matches, refreshMatches, resignMatch, respondMatch, submitMove } = useGameSocial();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selected, setSelected] = useState<XiangqiPosition | null>(null);
  const gameMatches = matches.filter((match) => match.gameId === 'xiangqi');
  const selectedMatch = gameMatches.find((match) => match.id === selectedMatchId) ?? null;
  const loginRequired = Boolean(getGameSocialCapability('xiangqi')?.requiresAuthentication && !authenticated);
  const refreshRef = useRef(refreshMatches);
  refreshRef.current = refreshMatches;

  const board = useMemo(() => buildBoardFromFriendMoves(selectedMatch?.moves ?? []), [selectedMatch]);
  const isMyTurn = selectedMatch?.status === 'active' && selectedMatch.currentTurnUserId === user?.id;
  const friendSide: XiangqiColor = selectedMatch ? (selectedMatch.inviter.id === user?.id ? 'red' : 'black') : 'red';
  const peer = selectedMatch ? (selectedMatch.inviter.id === user?.id ? selectedMatch.opponent : selectedMatch.inviter) : null;
  const peerColor: XiangqiColor = friendSide === 'red' ? 'black' : 'red';
  const status = selectedMatch ? getFriendMatchStatus(selectedMatch, user?.id ?? '') : null;
  const myInCheck = isMyTurn && isXiangqiInCheck(board, friendSide);
  const selectedMoves = useMemo(() => {
    if (!selected || !isMyTurn || !selectedMatch) return [];
    return generateXiangqiLegalMoves(board, friendSide).filter(
      (move) => move.from.col === selected.col && move.from.row === selected.row,
    );
  }, [board, friendSide, isMyTurn, selected, selectedMatch]);

  useEffect(() => {
    if (!selectedMatchId) return;
    void refreshRef.current();
    const timer = setInterval(() => void refreshRef.current(), 5000);
    return () => clearInterval(timer);
  }, [selectedMatchId]);

  async function runAction(action: () => Promise<GameMatch>, selectResult = true) {
    setBusy(true);
    setLocalError('');
    try {
      const match = await action();
      if (selectResult) setSelectedMatchId(match.id);
      return match;
    } catch {
      setLocalError('操作没有完成，请稍后再试。');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function handleSquarePress(position: XiangqiPosition) {
    if (!isMyTurn || !selectedMatch) return;
    const piece = getXiangqiPiece(board, position);
    if (selected) {
      const matching = selectedMoves.find((move) => move.col === position.col && move.row === position.row);
      if (matching) {
        void runAction(() =>
          submitMove(selectedMatch.id, {
            clientMoveId: createGameMoveId(),
            col: matching.col,
            fromCol: matching.from.col,
            fromRow: matching.from.row,
            row: matching.row,
          }),
        );
        setSelected(null);
        return;
      }
    }
    if (piece?.color === friendSide) {
      setSelected(position);
    } else {
      setSelected(null);
    }
  }

  if (!selectedMatch) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <MobileScreen contentContainerStyle={styles.friendPageContent}>
          <View style={styles.topBar}>
            <View style={styles.headerSide}>
              <Pressable accessibilityLabel="返回 AI 对战" accessibilityRole="button" onPress={onExit} style={styles.iconButton}>
                <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.headerTitle}>
              <ThemedText style={styles.pageTitle}>象棋</ThemedText>
            </View>
            <View style={styles.headerSide} />
          </View>
          <View style={[styles.friendModeSwitch, { backgroundColor: colors.surfaceMuted }]}>
            <Pressable onPress={onExit} style={styles.friendModeButton}>
              <MaterialCommunityIcons name="robot-outline" size={18} color={colors.mutedText} />
              <ThemedText style={[styles.friendModeText, { color: colors.mutedText }]}>AI 练习</ThemedText>
            </Pressable>
            <View style={[styles.friendModeButton, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="account-multiple" size={18} color="#ffffff" />
              <ThemedText style={[styles.friendModeText, { color: '#ffffff' }]}>好友对战</ThemedText>
            </View>
          </View>
          {loginRequired ? (
            <SocialEmptyState
              action={
                <Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={[styles.loginButton, { backgroundColor: colors.primary }]}>
                  <ThemedText style={styles.loginButtonText}>登录 / 注册</ThemedText>
                  <MaterialCommunityIcons name="arrow-right" size={17} color="#ffffff" />
                </Pressable>
              }
              description="登录后即可邀请好友，并实时同步每一步棋。"
              icon="account-lock-outline"
              title="登录后和好友对战"
            />
          ) : (
            <>
              {error || localError ? (
                <View style={[styles.gameSocialError, { backgroundColor: colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.accent} />
                  <ThemedText style={[styles.gameSocialErrorText, { color: colors.mutedText }]}>{localError || error}</ThemedText>
                </View>
              ) : null}
              <View style={styles.lobbySection}>
                <View style={styles.sectionHeader}>
                  <View>
                    <ThemedText style={styles.sectionTitle}>进行中的对局</ThemedText>
                    <ThemedText style={[styles.sectionSubtitle, { color: colors.mutedText }]}>好友接受后自动开始</ThemedText>
                  </View>
                  <View style={[styles.friendCountChip, { backgroundColor: colors.surfaceMuted }]}>
                    <ThemedText style={[styles.friendCountText, { color: colors.primary }]}>{friends.length} 位好友</ThemedText>
                  </View>
                </View>
                {gameMatches.length === 0 ? (
                  <View style={[styles.emptyLobby, { borderColor: colors.line }]}>
                    <MaterialCommunityIcons name="chess-knight" size={30} color={colors.mutedText} />
                    <ThemedText style={styles.emptyLobbyTitle}>还没有象棋对局</ThemedText>
                    <ThemedText style={[styles.emptyLobbyText, { color: colors.mutedText }]}>从下方好友列表发起邀请</ThemedText>
                  </View>
                ) : (
                  gameMatches.map((match) => (
                    <View key={match.id} style={[styles.matchRow, { borderBottomColor: colors.line }]}>
                      <View style={styles.matchRowCopy}>
                        <ThemedText style={styles.matchRowTitle}>{getFriendMatchStatus(match, user?.id ?? '').title}</ThemedText>
                        <ThemedText style={[styles.matchRowMeta, { color: colors.mutedText }]}>
                          {getFriendMatchStatus(match, user?.id ?? '').description}
                        </ThemedText>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSelectedMatchId(match.id)}
                        style={[styles.matchOpenButton, { backgroundColor: colors.primarySoft }]}>
                        <ThemedText style={[styles.matchOpenText, { color: colors.primary }]}>进入</ThemedText>
                        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
                      </Pressable>
                    </View>
                  ))
                )}
              </View>
              <View style={styles.lobbySection}>
                <View style={styles.sectionHeader}>
                  <ThemedText style={styles.sectionTitle}>在线好友</ThemedText>
                  <ThemedText style={[styles.sectionSubtitle, { color: colors.mutedText }]}>点击邀请下一盘</ThemedText>
                </View>
                {friends
                  .filter((friend) => friend.user.online)
                  .map((friend) => (
                    <View key={friend.user.id} style={[styles.friendInviteRow, { borderBottomColor: colors.line }]}>
                      <SocialAvatar showOnline size={38} user={friend.user} />
                      <View style={styles.matchRowCopy}>
                        <ThemedText style={styles.matchRowTitle}>{friend.user.displayName}</ThemedText>
                        <ThemedText style={[styles.matchRowMeta, { color: colors.success }]}>在线</ThemedText>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void runAction(() => createMatch('xiangqi', friend.user.id))}
                        style={[styles.inviteButton, { backgroundColor: colors.primary }]}>
                        <MaterialCommunityIcons name="chess-knight" size={15} color="#ffffff" />
                        <ThemedText style={styles.inviteButtonText}>邀请</ThemedText>
                      </Pressable>
                    </View>
                  ))}
                {friends.filter((friend) => friend.user.online).length === 0 ? (
                  <View style={[styles.emptyLobby, { borderColor: colors.line }]}>
                    <ThemedText style={[styles.emptyLobbyText, { color: colors.mutedText }]}>当前没有在线好友</ThemedText>
                  </View>
                ) : null}
              </View>
            </>
          )}
        </MobileScreen>
      </>
    );
  }

  const boardPalette =
    colorScheme === 'dark'
      ? { board: '#a97c45', boardLine: '#6b4c22', grid: 'rgba(40,24,15,0.62)', shell: '#241d16' }
      : { board: '#e7c58f', boardLine: '#8a6634', grid: 'rgba(125,92,47,0.85)', shell: '#f0e5d2' };
  const pendingForMe = selectedMatch.status === 'pending' && selectedMatch.opponent.id === user?.id;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <View style={styles.topBar}>
          <View style={styles.headerSide}>
            <Pressable accessibilityLabel="返回大厅" accessibilityRole="button" onPress={() => setSelectedMatchId(null)} style={styles.iconButton}>
              <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.headerTitle}>
            <ThemedText style={styles.pageTitle}>好友对局</ThemedText>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="刷新"
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void runAction(() => refreshMatches().then(() => selectedMatch), false)}
              style={[styles.headerActionButton, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="refresh" size={19} color={colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.gameHud}>
          <XiangqiPlayerStatus active={!isMyTurn && selectedMatch.status === 'active'} align="left" color={peerColor} label={peer?.displayName ?? '好友'} meta={selectedMatch.status === 'active' ? (isMyTurn ? '思考中' : '轮到他') : (status?.title ?? '')} />
          <View style={styles.turnSummary}>
            <View style={styles.turnStatus}>
              {selectedMatch.status === 'active' ? <View style={[styles.turnDot, { backgroundColor: isMyTurn ? (myInCheck ? colors.accent : colors.success) : colors.primary }]} /> : <View style={[styles.turnDot, { backgroundColor: colors.mutedText }]} />}
              <ThemedText style={styles.turnLabel}>{status?.title}</ThemedText>
            </View>
            <ThemedText style={[styles.turnMeta, { color: colors.mutedText }]}>{status?.description}</ThemedText>
          </View>
          <XiangqiPlayerStatus active={isMyTurn && selectedMatch.status === 'active'} align="right" color={friendSide} label="我" meta={friendSide === 'red' ? '红方' : '黑方'} />
        </View>

        {selectedMatch.status === 'pending' ? (
          <View style={[styles.pendingBanner, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="email-fast-outline" size={18} color={colors.primary} />
            <ThemedText style={[styles.pendingBannerText, { color: colors.mutedText }]}>
              {pendingForMe ? '好友邀请你下象棋，接受后由红方先手。' : '等待好友接受邀请。'}
            </ThemedText>
            {pendingForMe ? (
              <View style={styles.pendingActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void runAction(() => respondMatch(selectedMatch.id, 'decline'), false).then(() => setSelectedMatchId(null))}
                  style={[styles.pendingAction, { backgroundColor: colors.surfaceMuted }]}>
                  <ThemedText style={[styles.pendingActionText, { color: colors.mutedText }]}>拒绝</ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void runAction(() => respondMatch(selectedMatch.id, 'accept'))}
                  style={[styles.pendingAction, { backgroundColor: colors.primary }]}>
                  <ThemedText style={[styles.pendingActionText, { color: '#ffffff' }]}>接受</ThemedText>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.boardStage, { backgroundColor: boardPalette.shell, borderColor: colors.line }]}>
          <XiangqiBoardView
            board={board}
            boardLineColor={boardPalette.boardLine}
            boardColor={boardPalette.board}
            gridColor={boardPalette.grid}
            lastMove={selectedMatch.moves.length > 0 ? toEngineMove(selectedMatch.moves[selectedMatch.moves.length - 1]) : null}
            legalMoves={selectedMoves}
            onSquarePress={handleSquarePress}
            perspective={friendSide}
            selected={selected}
          />
        </View>

        <View style={styles.friendStatusRow}>
          <MaterialCommunityIcons name="wifi" size={15} color={colors.success} />
          <ThemedText style={[styles.friendStatusText, { color: colors.mutedText }]}>实时同步中 · 断线后自动恢复局面</ThemedText>
        </View>
        <View style={styles.actionRow}>
          <XiangqiActionButton disabled={selectedMatch.status !== 'active'} icon="flag-outline" label="认输" onPress={() => void runAction(() => resignMatch(selectedMatch.id))} />
          <XiangqiActionButton accentColor={colors.primary} icon="refresh" label="刷新" onPress={() => void runAction(() => refreshMatches().then(() => selectedMatch), false)} primary />
        </View>
      </MobileScreen>
    </>
  );
}

function XiangqiBoardView({
  board,
  boardLineColor,
  boardColor,
  gridColor,
  hintedMove = null,
  lastMove,
  legalMoves,
  onSquarePress,
  perspective = 'red',
  selected,
}: {
  board: ReturnType<typeof createXiangqiState>['board'];
  boardLineColor: string;
  boardColor: string;
  gridColor: string;
  hintedMove?: XiangqiMove | null;
  lastMove: XiangqiMove | null;
  legalMoves: XiangqiMove[];
  onSquarePress: (position: XiangqiPosition) => void;
  perspective?: XiangqiColor;
  selected: XiangqiPosition | null;
}) {
  const { width } = useWindowDimensions();
  const geometry = createXiangqiBoardGeometry(width);
  const { boardHeight, boardPadding, boardWidth, cellSize } = geometry;
  const hitSize = cellSize * 0.92;
  const pieceSize = cellSize * 0.78;
  const pieces: { position: XiangqiPosition; piece: XiangqiPiece }[] = [];
  for (let row = 0; row < XIANGQI_ROWS; row += 1) {
    for (let col = 0; col < XIANGQI_COLS; col += 1) {
      const piece = board[row * XIANGQI_COLS + col];
      if (piece) pieces.push({ piece, position: { col, row } });
    }
  }
  const legalTargets = new Set(legalMoves.map((move) => `${move.col}:${move.row}`));

  return (
    <View
      accessibilityLabel="九乘十象棋棋盘"
      style={[styles.board, { backgroundColor: boardColor, borderColor: boardLineColor, height: boardHeight, width: boardWidth }]}>
      <XiangqiGrid geometry={geometry} gridColor={gridColor} />
      <View style={[styles.riverLabel, { height: cellSize, left: boardPadding, right: boardPadding, top: boardPadding + cellSize * 4 }]} pointerEvents="none">
        <ThemedText style={[styles.riverText, { color: gridColor }]}>楚河 · 汉界</ThemedText>
      </View>
      {pieces.map(({ piece, position }) => {
        const isSelected = selected?.col === position.col && selected?.row === position.row;
        const isLast = lastMove?.col === position.col && lastMove?.row === position.row;
        const point = getXiangqiBoardPoint(geometry, position, perspective);
        return (
          <Pressable
            key={`${position.col}:${position.row}`}
            accessibilityLabel={`${pieceChar(piece)} 位于 ${position.col + 1} 列 ${position.row + 1} 行`}
            accessibilityRole="button"
            onPress={() => onSquarePress(position)}
            style={[
              styles.squarePressable,
              { height: hitSize, left: point.x - hitSize / 2, top: point.y - hitSize / 2, width: hitSize },
            ]}>
            {isSelected ? <View style={[styles.selectedRing, { borderColor: '#4b6bff' }]} /> : null}
            {isLast ? <View style={[styles.lastMoveMark, { backgroundColor: '#c9f36a' }]} /> : null}
            <View
              style={[
                styles.piece,
                {
                  backgroundColor: piece.color === 'red' ? '#fff1e0' : '#f7f3ea',
                  borderColor: piece.color === 'red' ? '#c43a34' : '#3a3840',
                  height: pieceSize,
                  width: pieceSize,
                },
              ]}>
              <ThemedText style={[styles.pieceText, { color: piece.color === 'red' ? '#c43a34' : '#2d2b33', fontSize: cellSize * 0.42 }]}>
                {pieceChar(piece)}
              </ThemedText>
            </View>
          </Pressable>
        );
      })}
      {legalTargets.size > 0
        ? [...legalTargets].map((key) => {
            const [col, row] = key.split(':').map(Number);
            const captured = board[row * XIANGQI_COLS + col];
            const isHintTarget = hintedMove?.col === col && hintedMove?.row === row;
            const point = getXiangqiBoardPoint(geometry, { col, row }, perspective);
            return (
              <Pressable
                key={`target-${key}`}
                accessibilityLabel={isHintTarget ? '建议落子位置' : '落子位置'}
                accessibilityRole="button"
                onPress={() => onSquarePress({ col, row })}
                style={[styles.squarePressable, { height: hitSize, left: point.x - hitSize / 2, top: point.y - hitSize / 2, width: hitSize }]}>
                <View
                  style={[
                    captured ? styles.captureTarget : styles.moveDot,
                    captured
                      ? { borderColor: isHintTarget ? '#70971c' : '#4b6bff', height: pieceSize, width: pieceSize }
                      : { backgroundColor: isHintTarget ? '#70971c' : '#4b6bff', height: cellSize * (isHintTarget ? 0.26 : 0.2), width: cellSize * (isHintTarget ? 0.26 : 0.2) },
                  ]}
                />
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

function XiangqiGrid({ geometry, gridColor }: { geometry: XiangqiBoardGeometry; gridColor: string }) {
  return (
    <Svg
      height={geometry.playableHeight}
      pointerEvents="none"
      preserveAspectRatio="none"
      style={{ left: geometry.boardPadding, position: 'absolute', top: geometry.boardPadding }}
      viewBox={`0 0 ${XIANGQI_COLUMN_INTERVALS} ${XIANGQI_ROW_INTERVALS}`}
      width={geometry.playableWidth}>
      {XIANGQI_GRID_LINES.map((line) => (
        <Line
          key={line.id}
          stroke={gridColor}
          strokeWidth={line.emphasized ? 2 : 1.2}
          vectorEffect="non-scaling-stroke"
          x1={line.x1}
          x2={line.x2}
          y1={line.y1}
          y2={line.y2}
        />
      ))}
    </Svg>
  );
}

function XiangqiPlayerStatus({
  active,
  align = 'left',
  color,
  label,
  meta,
}: {
  active: boolean;
  align?: 'left' | 'right';
  color: XiangqiColor;
  label: string;
  meta: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.playerStatus, align === 'right' ? styles.playerStatusRight : undefined]}>
      <View style={[styles.playerStone, { backgroundColor: color === 'red' ? '#c43a34' : '#2d2b33', borderColor: active ? colors.primary : colors.line }]} />
      <View style={align === 'right' ? styles.playerCopyRight : undefined}>
        <ThemedText style={[styles.playerLabel, { color: active ? colors.text : colors.mutedText }]}>{label}</ThemedText>
        <ThemedText style={[styles.playerMeta, { color: colors.mutedText }]}>{meta}</ThemedText>
      </View>
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
      style={[styles.difficultyButton, { backgroundColor: active ? colors.primary : 'transparent' }]}>
      <ThemedText style={[styles.difficultyButtonText, { color: active ? '#ffffff' : colors.mutedText }]}>{label}</ThemedText>
    </Pressable>
  );
}

function XiangqiActionButton({
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
  const foregroundColor = disabled ? colors.tabInactive : primary ? '#ffffff' : colors.text;
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
      <ThemedText style={[styles.actionButtonText, { color: foregroundColor }]} numberOfLines={1}>{label}</ThemedText>
    </Pressable>
  );
}

function getStatusCopy(
  status: MatchStatus,
  isAiTurn: boolean,
  difficulty: XiangqiDifficulty,
  humanInCheck: boolean,
): { description: string; title: string } {
  if (status === 'red-won') return { title: '你赢了这局', description: '漂亮的将杀，再开一局继续挑战。' };
  if (status === 'black-won') return { title: 'AI 赢下这局', description: '留意对手的进攻线路，再试一次。' };
  if (status === 'draw') return { title: '本局和棋', description: '双方无子可动或同意和棋。' };
  if (isAiTurn) return { title: `AI 正在思考`, description: difficulty === 'hard' ? '高手模式会多预判几步。' : '黑方正在寻找合适的走法。' };
  if (humanInCheck) return { title: '轮到你 · 将军', description: '当前局面你正被将军，需要应将。' };
  return { title: '轮到你走子', description: '红方先行，将死对方帅将获胜。' };
}

function getFriendMatchStatus(match: GameMatch, userId: string): { description: string; title: string } {
  if (match.status === 'pending') {
    const incoming = match.opponent.id === userId;
    return incoming ? { title: '收到好友邀请', description: '接受后由红方先手。' } : { title: '等待好友接受', description: '好友接受后对局自动开始。' };
  }
  if (match.status === 'declined') return { title: '邀请已拒绝', description: '可以返回大厅选择其他好友。' };
  if (match.status === 'active') {
    const myTurn = match.currentTurnUserId === userId;
    return myTurn ? { title: '轮到你走子', description: '选择己方棋子开始走子。' } : { title: '等待好友走子', description: '好友落子后棋盘自动同步。' };
  }
  if (!match.winnerUserId) return { title: '本局和棋', description: '双方没有分出胜负。' };
  return match.winnerUserId === userId
    ? { title: '你赢了这局', description: '胜负结果已同步给好友。' }
    : { title: '好友赢下这局', description: '可以返回大厅再战一局。' };
}

function buildBoardFromFriendMoves(moves: GameMove[]): ReturnType<typeof createXiangqiState>['board'] {
  let board = createXiangqiState().board;
  for (const move of moves) {
    if (move.fromRow === undefined || move.fromCol === undefined) continue;
    board = applyXiangqiMove(board, toEngineMove(move));
  }
  return board;
}

function toEngineMove(move: GameMove): XiangqiMove {
  return {
    col: move.col,
    from: { col: move.fromCol ?? -1, row: move.fromRow ?? -1 },
    row: move.row,
  };
}

function pieceChar(piece: XiangqiPiece): string {
  if (piece.color === 'red') {
    return { R: '車', H: '馬', E: '相', A: '仕', K: '帥', C: '炮', P: '兵' }[piece.type];
  }
  return { R: '車', H: '馬', E: '象', A: '士', K: '將', C: '砲', P: '卒' }[piece.type];
}

function createGameMoveId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function triggerMoveHaptic() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function triggerResultHaptic(success: boolean) {
  if (Platform.OS !== 'web') {
    void Haptics.notificationAsync(success ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  }
}

const styles = StyleSheet.create({
  pageContent: { gap: 10, paddingHorizontal: 0, paddingTop: 6 },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 16, minHeight: 40 },
  headerSide: { width: 78 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'flex-end', width: 78 },
  headerActionButton: { alignItems: 'center', borderRadius: 12, height: 34, justifyContent: 'center', width: 34 },
  iconButton: { alignItems: 'center', borderRadius: 16, height: 38, justifyContent: 'center', width: 38 },
  headerTitle: { alignItems: 'center', flex: 1 },
  pageTitle: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  gameHud: { alignItems: 'center', flexDirection: 'row', marginHorizontal: 16, minHeight: 50 },
  playerStatus: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 7 },
  playerStatusRight: { flexDirection: 'row-reverse' },
  playerCopyRight: { alignItems: 'flex-end' },
  playerStone: { borderRadius: 999, borderWidth: 2, height: 26, width: 26 },
  playerLabel: { fontSize: 13, fontWeight: '800', lineHeight: 17 },
  playerMeta: { fontSize: 10, lineHeight: 13, marginTop: 1 },
  turnSummary: { alignItems: 'center', flex: 1.35, gap: 2 },
  turnStatus: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 20 },
  turnDot: { borderRadius: 999, height: 8, width: 8 },
  turnLabel: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  turnMeta: { fontSize: 10, fontWeight: '600', lineHeight: 14 },
  boardStage: { alignItems: 'center', alignSelf: 'center', borderRadius: 14, borderWidth: 1, padding: 4 },
  board: { borderWidth: 2, borderRadius: 9, overflow: 'hidden', position: 'relative' },
  riverLabel: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  riverText: { fontSize: 11, fontWeight: '800', letterSpacing: 4 },
  squarePressable: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  piece: { alignItems: 'center', borderRadius: 999, borderWidth: 1.5, justifyContent: 'center' },
  pieceText: { fontWeight: '900', lineHeight: undefined },
  selectedRing: { ...StyleSheet.absoluteFillObject, borderRadius: 999, borderWidth: 2.5 },
  lastMoveMark: { ...StyleSheet.absoluteFillObject, borderRadius: 999, opacity: 0.55 },
  moveDot: { borderRadius: 999 },
  captureTarget: { borderRadius: 999, borderWidth: 3 },
  resultBanner: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 10, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10 },
  resultCopy: { flex: 1 },
  resultTitle: { fontSize: 14, fontWeight: '800', lineHeight: 18 },
  resultText: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16 },
  hintRow: { marginHorizontal: 16 },
  actionButton: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 44, paddingHorizontal: 6 },
  actionButtonText: { fontSize: 12, fontWeight: '800', lineHeight: 16 },
  friendPageContent: { gap: 16, paddingHorizontal: 16, paddingTop: 6 },
  friendModeSwitch: { borderRadius: 14, flexDirection: 'row', gap: 4, padding: 4 },
  friendModeButton: { alignItems: 'center', borderRadius: 11, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 42 },
  friendModeText: { fontSize: 13, fontWeight: '800' },
  loginButton: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 7, marginTop: 8, minHeight: 40, paddingHorizontal: 16 },
  loginButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  gameSocialError: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  gameSocialErrorText: { flex: 1, fontSize: 12, lineHeight: 18 },
  lobbySection: { gap: 8 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '800', lineHeight: 23 },
  sectionSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  emptyLobby: { alignItems: 'center', borderRadius: 14, borderWidth: 1, gap: 6, justifyContent: 'center', minHeight: 138, padding: 20 },
  emptyLobbyTitle: { fontSize: 14, fontWeight: '800', marginTop: 3 },
  emptyLobbyText: { fontSize: 11, lineHeight: 17, textAlign: 'center' },
  matchRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 64, paddingVertical: 10 },
  friendInviteRow: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, minHeight: 66, paddingVertical: 10 },
  matchRowCopy: { flex: 1, minWidth: 0 },
  matchRowTitle: { fontSize: 14, fontWeight: '800', lineHeight: 19 },
  matchRowMeta: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  matchOpenButton: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', minHeight: 36, paddingLeft: 12, paddingRight: 7 },
  matchOpenText: { fontSize: 12, fontWeight: '800' },
  inviteButton: { alignItems: 'center', borderRadius: 11, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 36, minWidth: 62, paddingHorizontal: 12 },
  inviteButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  friendCountChip: { borderRadius: 11, paddingHorizontal: 10, paddingVertical: 6 },
  friendCountText: { fontSize: 11, fontWeight: '800' },
  friendStatusRow: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', marginHorizontal: 16 },
  friendStatusText: { fontSize: 11, lineHeight: 16 },
  pendingBanner: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 10 },
  pendingBannerText: { flex: 1, fontSize: 11, lineHeight: 16 },
  pendingActions: { flexDirection: 'row', gap: 7 },
  pendingAction: { alignItems: 'center', borderRadius: 9, justifyContent: 'center', minHeight: 32, paddingHorizontal: 13 },
  pendingActionText: { fontSize: 11, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5, 9, 15, 0.62)' },
  settingsSheet: { alignSelf: 'center', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, gap: 22, maxWidth: 430, paddingBottom: 30, paddingHorizontal: 20, paddingTop: 20, width: '100%' },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  sheetSubtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  settingsSection: { gap: 12 },
  settingsLabelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  settingsLabel: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  settingsDescription: { fontSize: 12, lineHeight: 17 },
  segmentedControl: { borderRadius: 14, flexDirection: 'row', padding: 4 },
  difficultyButton: { alignItems: 'center', borderRadius: 11, flex: 1, justifyContent: 'center', minHeight: 40, paddingHorizontal: 8 },
  difficultyButtonText: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  ruleRow: { alignItems: 'flex-start', borderTopWidth: 1, flexDirection: 'row', gap: 10, paddingTop: 16 },
  ruleText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
