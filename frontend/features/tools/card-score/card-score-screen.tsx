import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  cancelScoreRoom,
  cancelScoreRound,
  CardScoreAPIError,
  confirmScoreRound,
  connectScoreRealtime,
  createScoreRoom,
  getCardScoreErrorMessage,
  getScoreRoom,
  issueScoreInviteToken,
  joinScoreRoom,
  listScoreRoomHistory,
  removeScoreParticipant,
  settleScoreRoom,
  startScoreRoom,
  startScoreRound,
  submitScoreEntry,
} from '@/lib/card-score-api';
import { formatCNY, formatScore, roundProgress, scoreDifference, sortedParticipants } from '@/lib/card-score';
import {
  getStoredScoreSession,
  removeStoredScoreSession,
  setStoredScoreSession,
} from '@/lib/card-score-session-storage';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  ScoreCredential,
  ScoreParticipant,
  ScoreRealtimeStatus,
  ScoreRoomSnapshot,
  ScoreRound,
} from '@/types/card-score';

import {
  FeedbackBanner,
  ParticipantScoreRow,
  PrimaryAction,
  RoomProgress,
  ScoreField,
  ScoreTopBar,
  SegmentedControl,
  TransferRow,
} from './card-score-components';

type LandingMode = 'create' | 'join';
type Feedback = { message: string; tone?: 'error' | 'info' | 'success' };

const PLAYER_LIMITS = [2, 3, 4, 5, 6, 7, 8];
const CENT_PRESETS = [10, 50, 100, 200];

export function CardScoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invite?: string }>();
  const { accessToken, status: authStatus } = useAuth();
  const [mode, setMode] = useState<LandingMode>(params.invite ? 'join' : 'create');
  const [room, setRoom] = useState<ScoreRoomSnapshot | null>(null);
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [history, setHistory] = useState<ScoreRoomSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<ScoreRealtimeStatus>('connecting');
  const roomVersionRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const credential = useMemo<ScoreCredential | null>(() => {
    if (guestToken) return { kind: 'guest', token: guestToken };
    if (accessToken) return { kind: 'account', token: accessToken };
    return null;
  }, [accessToken, guestToken]);

  const applyRoom = useCallback((next: ScoreRoomSnapshot) => {
    roomVersionRef.current = next.version;
    setRoom((current) => ({
      ...next,
      inviteToken: next.inviteToken ?? (current?.id === next.id ? current.inviteToken : undefined),
    }));
  }, []);

  const refreshRoom = useCallback(async (roomId: string, activeCredential: ScoreCredential) => {
    try {
      applyRoom(await getScoreRoom(activeCredential, roomId));
    } catch (error) {
      setFeedback({ message: getCardScoreErrorMessage(error) });
      if (activeCredential.kind === 'guest' && error instanceof CardScoreAPIError && error.status === 401) {
        await removeStoredScoreSession();
        setGuestToken(null);
        setRoom(null);
      }
    }
  }, [applyRoom]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await getStoredScoreSession();
      if (stored) {
        const storedCredential: ScoreCredential = { kind: 'guest', token: stored.guestToken };
        try {
          const storedRoom = await getScoreRoom(storedCredential, stored.roomId);
          if (!active) return;
          setGuestToken(stored.guestToken);
          applyRoom(storedRoom);
        } catch {
          await removeStoredScoreSession();
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [applyRoom]);

  useEffect(() => {
    if (!accessToken) {
      setHistory([]);
      return;
    }
    let active = true;
    void listScoreRoomHistory(accessToken)
      .then((rooms) => {
        if (active) setHistory(rooms);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accessToken, room?.version]);

  useEffect(() => {
    if (!room || !credential) return;
    const roomId = room.id;
    const disconnect = connectScoreRealtime(
      credential,
      roomId,
      (version) => {
        if (version <= roomVersionRef.current) return;
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => void refreshRoom(roomId, credential), 120);
      },
      setRealtimeStatus,
    );
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshRoom(roomId, credential);
    });
    return () => {
      disconnect();
      subscription.remove();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [credential, refreshRoom, room?.id]);

  async function runMutation(action: () => Promise<ScoreRoomSnapshot>, success?: string) {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      applyRoom(await action());
      if (success) setFeedback({ message: success, tone: 'success' });
    } catch (error) {
      if (error instanceof CardScoreAPIError && error.snapshot) applyRoom(error.snapshot);
      setFeedback({ message: getCardScoreErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openHistoryRoom(item: ScoreRoomSnapshot) {
    if (!accessToken) return;
    const accountCredential: ScoreCredential = { kind: 'account', token: accessToken };
    setBusy(true);
    setFeedback(null);
    try {
      let next = await getScoreRoom(accountCredential, item.id);
      if (next.status === 'waiting') {
        const inviteToken = await issueScoreInviteToken(accountCredential, next.id);
        next = { ...next, inviteToken };
      }
      setGuestToken(null);
      applyRoom(next);
    } catch (error) {
      setFeedback({ message: getCardScoreErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function leaveRoom() {
    if (guestToken) {
      await removeStoredScoreSession();
      setGuestToken(null);
    }
    setRoom(null);
    setFeedback(null);
    setRealtimeStatus('connecting');
  }

  if (loading || authStatus === 'loading') {
    return (
      <MobileScreen contentContainerStyle={styles.centered}>
        <MaterialCommunityIcons name="cards-playing-outline" size={42} color="#4b6bff" />
        <ThemedText style={styles.loadingTitle}>正在恢复牌局</ThemedText>
      </MobileScreen>
    );
  }

  if (!room) {
    return (
      <LandingView
        accessToken={accessToken}
        busy={busy}
        feedback={feedback}
        history={history}
        initialInvite={params.invite}
        mode={mode}
        onBack={() => router.back()}
        onCreate={async (name, maxPlayers, centsPerPoint) => {
          if (!accessToken) {
            router.push({ pathname: '/auth', params: { returnTo: '/tools/card-score' } });
            return;
          }
          setBusy(true);
          setFeedback(null);
          try {
            const result = await createScoreRoom(accessToken, { name, maxPlayers, centsPerPoint });
            setGuestToken(null);
            applyRoom({ ...result.room, inviteToken: result.inviteToken });
          } catch (error) {
            setFeedback({ message: getCardScoreErrorMessage(error) });
          } finally {
            setBusy(false);
          }
        }}
        onJoin={async (code, displayName, inviteToken) => {
          setBusy(true);
          setFeedback(null);
          try {
            const result = await joinScoreRoom({ code, displayName, inviteToken });
            setGuestToken(result.guestToken);
            await setStoredScoreSession({
              roomId: result.room.id,
              guestToken: result.guestToken,
              participantId: result.actor.participantId,
              savedAt: new Date().toISOString(),
            });
            applyRoom(result.room);
          } catch (error) {
            setFeedback({ message: getCardScoreErrorMessage(error) });
          } finally {
            setBusy(false);
          }
        }}
        onModeChange={setMode}
        onOpenHistory={(item) => void openHistoryRoom(item)}
      />
    );
  }

  if (!credential) return null;
  const self = room.participants.find((participant) => participant.id === room.selfParticipantId);
  return (
    <RoomView
      busy={busy}
      credential={credential}
      feedback={feedback}
      onExit={() => void leaveRoom()}
      onMutation={runMutation}
      realtimeStatus={realtimeStatus}
      room={room}
      self={self}
    />
  );
}

function LandingView({
  accessToken,
  busy,
  feedback,
  history,
  initialInvite,
  mode,
  onBack,
  onCreate,
  onJoin,
  onModeChange,
  onOpenHistory,
}: {
  accessToken: string | null;
  busy: boolean;
  feedback: Feedback | null;
  history: ScoreRoomSnapshot[];
  initialInvite?: string;
  mode: LandingMode;
  onBack: () => void;
  onCreate: (name: string, maxPlayers: number, centsPerPoint: number) => Promise<void>;
  onJoin: (code: string, displayName: string, inviteToken?: string) => Promise<void>;
  onModeChange: (mode: LandingMode) => void;
  onOpenHistory: (room: ScoreRoomSnapshot) => void;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('今晚牌局');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [centsPerPoint, setCentsPerPoint] = useState(50);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <ScoreTopBar onBack={onBack} title="打牌记分" />
      <View style={styles.heroCopy}>
        <ThemedText style={styles.pageTitle}>先记清每一分，散场再结算</ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.mutedText }]}>多人各自报分，全员确认后才计入总账。</ThemedText>
      </View>

      <SurfaceCard style={styles.formPanel}>
        <SegmentedControl
          onChange={onModeChange}
          options={[{ label: '创建房间', value: 'create' }, { label: '加入房间', value: 'join' }]}
          value={mode}
        />
        {mode === 'create' ? (
          <>
            <ScoreField icon="cards-playing-outline" label="牌局名称" maxLength={40} onChangeText={setName} placeholder="例如：周五牌局" value={name} />
            <View style={styles.settingBlock}>
              <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>玩家人数上限</ThemedText>
              <View style={styles.optionRow}>
                {PLAYER_LIMITS.map((limit) => (
                  <OptionButton key={limit} label={String(limit)} selected={maxPlayers === limit} onPress={() => setMaxPlayers(limit)} />
                ))}
              </View>
            </View>
            <View style={styles.settingBlock}>
              <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>每分金额</ThemedText>
              <View style={styles.optionRow}>
                {CENT_PRESETS.map((cents) => (
                  <OptionButton key={cents} label={formatCNY(cents)} selected={centsPerPoint === cents} onPress={() => setCentsPerPoint(cents)} />
                ))}
              </View>
            </View>
            <PrimaryAction
              icon={accessToken ? 'plus-circle-outline' : 'login'}
              label={accessToken ? '创建记分房间' : '登录后创建'}
              loading={busy}
              onPress={() => void onCreate(name.trim(), maxPlayers, centsPerPoint)}
            />
          </>
        ) : (
          <>
            {initialInvite ? <FeedbackBanner message="邀请已识别，填写昵称即可加入。" tone="info" /> : null}
            {!initialInvite ? (
              <ScoreField icon="numeric" keyboardType="number-pad" label="6 位房间码" maxLength={6} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" value={code} />
            ) : null}
            <ScoreField icon="account-outline" label="你的昵称" maxLength={48} onChangeText={setDisplayName} placeholder="房间内显示的名字" value={displayName} />
            <PrimaryAction disabled={(!initialInvite && code.length !== 6) || !displayName.trim()} icon="login-variant" label="加入牌局" loading={busy} onPress={() => void onJoin(code, displayName.trim(), initialInvite)} />
          </>
        )}
      </SurfaceCard>

      {feedback ? <FeedbackBanner message={feedback.message} tone={feedback.tone} /> : null}
      {accessToken && history.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle action={`${history.length} 场`} title="最近牌局" />
          <SurfaceCard style={styles.listCard}>
            {history.slice(0, 5).map((item) => (
              <Pressable key={item.id} onPress={() => onOpenHistory(item)} style={({ pressed }) => [styles.historyRoomRow, { borderBottomColor: colors.line }, pressed && styles.pressed]}>
                <View style={[styles.roomIcon, { backgroundColor: colors.primarySoft }]}><MaterialCommunityIcons name="cards-outline" color={colors.primary} size={20} /></View>
                <View style={styles.historyRoomCopy}>
                  <ThemedText style={styles.historyRoomName}>{item.name}</ThemedText>
                  <ThemedText style={[styles.historyRoomMeta, { color: colors.mutedText }]}>{roomStatusLabel(item.status)} · {item.rounds.length} 局</ThemedText>
                </View>
                <MaterialCommunityIcons name="chevron-right" color={colors.mutedText} size={22} />
              </Pressable>
            ))}
          </SurfaceCard>
        </View>
      ) : null}
    </MobileScreen>
  );
}

function RoomView({
  busy,
  credential,
  feedback,
  onExit,
  onMutation,
  realtimeStatus,
  room,
  self,
}: {
  busy: boolean;
  credential: ScoreCredential;
  feedback: Feedback | null;
  onExit: () => void;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<void>;
  realtimeStatus: ScoreRealtimeStatus;
  room: ScoreRoomSnapshot;
  self?: ScoreParticipant;
}) {
  const { colors } = useAppTheme();
  const host = self?.role === 'host';
  const activeCount = room.participants.filter((participant) => participant.status === 'active').length;
  const credentialRoom = credential;

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <ScoreTopBar onBack={onExit} status={realtimeStatus} title={room.name} />
      {feedback ? <FeedbackBanner message={feedback.message} tone={feedback.tone} /> : null}
      {room.status === 'waiting' ? (
        <WaitingRoom
          activeCount={activeCount}
          busy={busy}
          credential={credentialRoom}
          host={host}
          onMutation={onMutation}
          room={room}
        />
      ) : null}
      {room.status === 'active' ? (
        <ActiveRoom busy={busy} credential={credentialRoom} host={host} onMutation={onMutation} room={room} self={self} />
      ) : null}
      {room.status === 'settled' ? <SettledRoom room={room} /> : null}
      {room.status === 'cancelled' ? (
        <SurfaceCard style={styles.emptyPanel}>
          <MaterialCommunityIcons name="close-circle-outline" color={colors.accent} size={38} />
          <ThemedText style={styles.emptyTitle}>牌局已取消</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>没有产生需要结算的账目。</ThemedText>
        </SurfaceCard>
      ) : null}
    </MobileScreen>
  );
}

function WaitingRoom({ activeCount, busy, credential, host, onMutation, room }: {
  activeCount: number;
  busy: boolean;
  credential: ScoreCredential;
  host: boolean;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<void>;
  room: ScoreRoomSnapshot;
}) {
  const { colors } = useAppTheme();
  const inviteURL = room.inviteToken ? Linking.createURL('/tools/card-score', { queryParams: { invite: room.inviteToken } }) : '';
  return (
    <>
      <SurfaceCard style={styles.invitePanel}>
        <View style={styles.inviteHeader}>
          <View>
            <ThemedText style={[styles.kicker, { color: colors.accent }]}>等待玩家加入</ThemedText>
            <ThemedText style={styles.roomCode}>{room.code}</ThemedText>
          </View>
          {inviteURL ? <View style={styles.qrShell}><QRCode backgroundColor="#ffffff" color="#18233d" quietZone={4} size={92} value={inviteURL} /></View> : null}
        </View>
        <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>每分 {formatCNY(room.centsPerPoint)} · {activeCount}/{room.maxPlayers} 人</ThemedText>
        <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(room.code)} style={({ pressed }) => [styles.copyButton, { backgroundColor: colors.surfaceMuted }, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="content-copy" color={colors.primary} size={18} />
          <ThemedText style={[styles.copyText, { color: colors.primary }]}>复制房间码</ThemedText>
        </Pressable>
      </SurfaceCard>
      <View style={styles.section}>
        <SectionTitle action={`${activeCount}/${room.maxPlayers}`} title="已加入玩家" />
        <SurfaceCard style={styles.listCard}>
          {room.participants.map((participant) => (
            <ParticipantScoreRow
              key={participant.id}
              participant={participant}
              rightSlot={host && participant.role === 'guest' && participant.status === 'active' ? (
                <Pressable accessibilityLabel={`移除 ${participant.displayName}`} onPress={() => void onMutation(() => removeScoreParticipant(credential, room, participant.id))} style={styles.rowIconButton}>
                  <MaterialCommunityIcons name="account-remove-outline" color={colors.mutedText} size={20} />
                </Pressable>
              ) : undefined}
            />
          ))}
        </SurfaceCard>
      </View>
      {host ? (
        <View style={styles.actionStack}>
          <PrimaryAction disabled={activeCount < 2} icon="play-circle-outline" label={activeCount < 2 ? '至少 2 人才能开始' : '开始牌局'} loading={busy} onPress={() => void onMutation(() => startScoreRoom(credential, room))} />
          <PrimaryAction icon="close-circle-outline" label="取消房间" onPress={() => void onMutation(() => cancelScoreRoom(credential, room))} tone="neutral" />
        </View>
      ) : <FeedbackBanner message="房主开始后即可报分。" tone="info" />}
    </>
  );
}

function ActiveRoom({ busy, credential, host, onMutation, room, self }: {
  busy: boolean;
  credential: ScoreCredential;
  host: boolean;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<void>;
  room: ScoreRoomSnapshot;
  self?: ScoreParticipant;
}) {
  const { colors } = useAppTheme();
  const ranking = sortedParticipants(room.participants);
  return (
    <>
      <View style={styles.section}>
        <SectionTitle action={`每分 ${formatCNY(room.centsPerPoint)}`} title="当前总分" />
        <SurfaceCard style={styles.listCard}>
          {ranking.map((participant, index) => <ParticipantScoreRow key={participant.id} participant={participant} rank={index + 1} />)}
        </SurfaceCard>
      </View>
      {room.currentRound ? (
        <CurrentRound busy={busy} credential={credential} host={host} onMutation={onMutation} room={room} self={self} />
      ) : host ? (
        <View style={styles.actionStack}>
          <PrimaryAction icon="plus-circle-outline" label={room.rounds.length ? '开始下一局' : '开始第一局'} loading={busy} onPress={() => void onMutation(() => startScoreRound(credential, room))} />
          {room.rounds.length ? <PrimaryAction icon="flag-checkered" label="结束并结算" onPress={() => void onMutation(() => settleScoreRoom(credential, room))} tone="neutral" /> : null}
        </View>
      ) : <FeedbackBanner message="等待房主开始下一局。" tone="info" />}
      {room.rounds.length ? <RoundHistory credential={credential} host={host} onMutation={onMutation} room={room} /> : null}
    </>
  );
}

function CurrentRound({ busy, credential, host, onMutation, room, self }: {
  busy: boolean;
  credential: ScoreCredential;
  host: boolean;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<void>;
  room: ScoreRoomSnapshot;
  self?: ScoreParticipant;
}) {
  const { colors } = useAppTheme();
  const round = room.currentRound!;
  const selfEntry = round.entries.find((entry) => entry.participantId === self?.id);
  const [draft, setDraft] = useState(selfEntry?.submitted ? String(selfEntry.deltaPoints) : '');
  useEffect(() => {
    setDraft(selfEntry?.submitted ? String(selfEntry.deltaPoints) : '');
  }, [round.id, selfEntry?.deltaPoints, selfEntry?.submitted]);
  const progress = roundProgress(round.entries);
  const difference = scoreDifference(round.entries);
  const canConfirm = round.status === 'review' && selfEntry?.submitted && !selfEntry.confirmed;

  function adjust(amount: number) {
    const current = Number.parseInt(draft, 10);
    setDraft(String((Number.isFinite(current) ? current : 0) + amount));
  }

  return (
    <View style={styles.section}>
      <SectionTitle action={round.kind === 'reversal' ? '更正局' : `第 ${round.number} 局`} title="本局记分" />
      <SurfaceCard style={styles.roundPanel}>
        <RoomProgress {...progress} />
        <View style={styles.entryList}>
          {round.entries.map((entry) => {
            const participant = room.participants.find((item) => item.id === entry.participantId);
            if (!participant) return null;
            return (
              <View key={entry.participantId} style={[styles.entryRow, { borderBottomColor: colors.line }]}>
                <View style={styles.entryNameBlock}>
                  <ThemedText style={styles.entryName}>{participant.displayName}</ThemedText>
                  <ThemedText style={[styles.entryState, { color: entry.confirmed ? colors.success : colors.mutedText }]}>{entry.confirmed ? '已确认' : entry.submitted ? '已报分' : '待报分'}</ThemedText>
                </View>
                <ThemedText style={[styles.entryScore, { color: entry.submitted ? (entry.deltaPoints >= 0 ? colors.success : colors.accent) : colors.mutedText }]}>{entry.submitted ? formatScore(entry.deltaPoints) : '—'}</ThemedText>
              </View>
            );
          })}
        </View>
        {round.kind === 'normal' && self ? (
          <View style={styles.selfEntryBlock}>
            <ScoreField icon="plus-minus-variant" keyboardType="numbers-and-punctuation" label="我的本局分数" onChangeText={(value) => setDraft(value.replace(/[^0-9-]/g, ''))} placeholder="输入整数，输分写负数" value={draft} />
            <View style={styles.adjustRow}>
              {[-5, -1, 1, 5].map((amount) => <OptionButton key={amount} label={formatScore(amount)} onPress={() => adjust(amount)} />)}
            </View>
            <PrimaryAction disabled={!/^-?\d+$/.test(draft)} icon="check" label={selfEntry?.submitted ? '更新我的分数' : '提交我的分数'} loading={busy} onPress={() => void onMutation(() => submitScoreEntry(credential, room, round.id, Number.parseInt(draft, 10)), '分数已提交，等待其他玩家。')} />
          </View>
        ) : <FeedbackBanner message="更正局已按原局自动生成反向分数，请逐一确认。" tone="info" />}
        {progress.submitted === progress.total && difference !== 0 ? <FeedbackBanner message={`当前合计未归零，还差 ${formatScore(difference)} 分。`} /> : null}
        {round.status === 'review' ? (
          <PrimaryAction disabled={!canConfirm} icon={selfEntry?.confirmed ? 'check-decagram' : 'shield-check-outline'} label={selfEntry?.confirmed ? '我已确认' : '确认本局分数'} loading={busy} onPress={() => void onMutation(() => confirmScoreRound(credential, room, round.id), '已确认，等待全员完成。')} />
        ) : null}
        {host ? <PrimaryAction icon="close-circle-outline" label="取消本局" onPress={() => void onMutation(() => cancelScoreRound(credential, room, round.id))} tone="neutral" /> : null}
      </SurfaceCard>
    </View>
  );
}

function RoundHistory({ credential, host = false, onMutation, room }: {
  credential?: ScoreCredential;
  host?: boolean;
  onMutation?: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<void>;
  room: ScoreRoomSnapshot;
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const rounds = expanded ? room.rounds : room.rounds.slice(0, 3);
  const participants = new Map(room.participants.map((participant) => [participant.id, participant]));
  return (
    <View style={styles.section}>
      <SectionTitle action={`${room.rounds.length} 局`} title="记分历史" />
      <SurfaceCard style={styles.listCard}>
        {rounds.map((round) => (
          <View key={round.id} style={[styles.roundHistoryRow, { borderBottomColor: colors.line }]}>
            <View style={[styles.roundNumber, { backgroundColor: colors.surfaceMuted }]}><ThemedText style={[styles.roundNumberText, { color: colors.primary }]}>{round.number}</ThemedText></View>
            <View style={styles.roundHistoryCopy}>
              <ThemedText style={styles.roundHistoryTitle}>{round.kind === 'reversal' ? `更正第 ${round.number} 局` : `第 ${round.number} 局`}</ThemedText>
              <ThemedText numberOfLines={1} style={[styles.roundHistoryMeta, { color: colors.mutedText }]}>{round.entries.map((entry) => `${participants.get(entry.participantId)?.displayName ?? '玩家'} ${formatScore(entry.deltaPoints)}`).join(' · ')}</ThemedText>
            </View>
            {host && credential && onMutation && round.kind === 'normal' && !room.currentRound ? (
              <Pressable accessibilityLabel={`更正第 ${round.number} 局`} onPress={() => void onMutation(() => startScoreRound(credential, room, round.id))} style={styles.rowIconButton}><MaterialCommunityIcons name="undo-variant" color={colors.primary} size={20} /></Pressable>
            ) : null}
          </View>
        ))}
        {room.rounds.length > 3 ? (
          <Pressable onPress={() => setExpanded((value) => !value)} style={styles.expandButton}><ThemedText style={[styles.expandText, { color: colors.primary }]}>{expanded ? '收起记录' : '查看全部记录'}</ThemedText><MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} color={colors.primary} size={19} /></Pressable>
        ) : null}
      </SurfaceCard>
    </View>
  );
}

function SettledRoom({ room }: { room: ScoreRoomSnapshot }) {
  const { colors } = useAppTheme();
  const ranking = sortedParticipants(room.participants);
  const participants = new Map(room.participants.map((participant) => [participant.id, participant]));
  return (
    <>
      <SurfaceCard style={styles.settlementHero}>
        <View style={[styles.settlementIcon, { backgroundColor: colors.primarySoft }]}><MaterialCommunityIcons name="check-decagram-outline" color={colors.success} size={34} /></View>
        <ThemedText style={styles.settlementTitle}>牌局已结算</ThemedText>
        <ThemedText style={[styles.settlementMeta, { color: colors.mutedText }]}>{room.rounds.length} 局 · 每分 {formatCNY(room.centsPerPoint)}</ThemedText>
      </SurfaceCard>
      <View style={styles.section}>
        <SectionTitle action="最终" title="排名与账目" />
        <SurfaceCard style={styles.listCard}>{ranking.map((participant, index) => <ParticipantScoreRow key={participant.id} participant={participant} rank={index + 1} />)}</SurfaceCard>
      </View>
      <View style={styles.section}>
        <SectionTitle action={`${room.settlement?.transfers.length ?? 0} 笔`} title="建议转账" />
        <SurfaceCard style={styles.listCard}>
          {room.settlement?.transfers.length ? room.settlement.transfers.map((transfer, index) => (
            <TransferRow amountCents={transfer.amountCents} from={participants.get(transfer.fromParticipantId)?.displayName ?? '玩家'} key={`${transfer.fromParticipantId}-${transfer.toParticipantId}-${index}`} to={participants.get(transfer.toParticipantId)?.displayName ?? '玩家'} />
          )) : <View style={styles.noTransfer}><MaterialCommunityIcons name="hand-okay" color={colors.success} size={26} /><ThemedText style={styles.noTransferText}>账目已自然抵消，无需转账</ThemedText></View>}
        </SurfaceCard>
      </View>
      <RoundHistory room={room} />
    </>
  );
}

function OptionButton({ label, onPress, selected = false }: { label: string; onPress: () => void; selected?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.optionButton, { backgroundColor: selected ? colors.primarySoft : colors.surfaceMuted, borderColor: selected ? colors.primary : colors.line }, pressed && styles.pressed]}>
      <ThemedText style={[styles.optionText, { color: selected ? colors.primary : colors.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

function SectionTitle({ action, title }: { action: string; title: string }) {
  const { colors } = useAppTheme();
  return <View style={styles.sectionTitleRow}><ThemedText style={styles.sectionTitle}>{title}</ThemedText><ThemedText style={[styles.sectionAction, { color: colors.mutedText }]}>{action}</ThemedText></View>;
}

function roomStatusLabel(status: ScoreRoomSnapshot['status']) {
  return { waiting: '等待开始', active: '进行中', settled: '已结算', cancelled: '已取消' }[status];
}

const styles = StyleSheet.create({
  actionStack: { gap: 10 },
  adjustRow: { flexDirection: 'row', gap: 8 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 500 },
  copyButton: { alignItems: 'center', alignSelf: 'flex-start', borderRadius: 16, flexDirection: 'row', gap: 7, minHeight: 42, paddingHorizontal: 13 },
  copyText: { fontSize: 12, fontWeight: '800' },
  emptyPanel: { alignItems: 'center', gap: 9, padding: 28 },
  emptyText: { fontSize: 13 },
  emptyTitle: { fontSize: 19, fontWeight: '900' },
  entryList: { gap: 0 },
  entryName: { fontSize: 13, fontWeight: '800' },
  entryNameBlock: { flex: 1 },
  entryRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 54, paddingVertical: 8 },
  entryScore: { fontSize: 17, fontWeight: '900' },
  entryState: { fontSize: 10, marginTop: 3 },
  expandButton: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'center', minHeight: 46 },
  expandText: { fontSize: 12, fontWeight: '800' },
  fieldCaption: { fontSize: 12, fontWeight: '700' },
  formPanel: { gap: 16, padding: 16 },
  heroCopy: { gap: 6, marginBottom: 2 },
  historyRoomCopy: { flex: 1 },
  historyRoomMeta: { fontSize: 11, marginTop: 4 },
  historyRoomName: { fontSize: 14, fontWeight: '800' },
  historyRoomRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 67, paddingHorizontal: 15 },
  inviteHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  invitePanel: { gap: 14, padding: 18 },
  kicker: { fontSize: 11, fontWeight: '800' },
  listCard: { overflow: 'hidden', paddingHorizontal: 15 },
  loadingTitle: { fontSize: 16, fontWeight: '800', marginTop: 8 },
  noTransfer: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 72 },
  noTransferText: { fontSize: 13, fontWeight: '800' },
  optionButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 42, minWidth: 40, paddingHorizontal: 8 },
  optionRow: { flexDirection: 'row', gap: 7 },
  optionText: { fontSize: 12, fontWeight: '800' },
  pageContent: { paddingBottom: 48 },
  pageDescription: { fontSize: 14, lineHeight: 21 },
  pageTitle: { fontSize: 27, fontWeight: '900', lineHeight: 34 },
  pressed: { opacity: 0.76 },
  qrShell: { backgroundColor: '#ffffff', borderRadius: 16, padding: 6 },
  roomCode: { fontSize: 34, fontWeight: '900', letterSpacing: 0, marginTop: 5 },
  roomIcon: { alignItems: 'center', borderRadius: 16, height: 38, justifyContent: 'center', width: 38 },
  roundHistoryCopy: { flex: 1, minWidth: 0 },
  roundHistoryMeta: { fontSize: 10, marginTop: 4 },
  roundHistoryRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 64, paddingVertical: 9 },
  roundHistoryTitle: { fontSize: 13, fontWeight: '800' },
  roundNumber: { alignItems: 'center', borderRadius: 13, height: 34, justifyContent: 'center', width: 34 },
  roundNumberText: { fontSize: 13, fontWeight: '900' },
  roundPanel: { gap: 15, padding: 16 },
  rowIconButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  ruleText: { fontSize: 12, fontWeight: '700' },
  section: { gap: 10 },
  sectionAction: { fontSize: 11, fontWeight: '700' },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  selfEntryBlock: { gap: 10 },
  settingBlock: { gap: 8 },
  settlementHero: { alignItems: 'center', gap: 8, padding: 24 },
  settlementIcon: { alignItems: 'center', borderRadius: 24, height: 52, justifyContent: 'center', width: 52 },
  settlementMeta: { fontSize: 12 },
  settlementTitle: { fontSize: 22, fontWeight: '900' },
});
