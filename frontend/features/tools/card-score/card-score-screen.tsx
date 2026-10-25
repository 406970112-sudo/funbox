import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  cancelScoreRoom,
  cancelScoreRound,
  cancelZhaJinHuaHand,
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
  reverseScoreGiftBatch,
  settleScoreRoom,
  startScoreRoom,
  startScoreRound,
  startZhaJinHuaHand,
  submitScoreGifts,
  submitScoreEntry,
  submitZhaJinHuaAction,
  updateZhaJinHuaSettings,
} from '@/lib/card-score-api';
import {
  buildScoreGiftAllocations,
  canForceOpenZhaJinHua,
  formatCNY,
  formatRateInput,
  formatScore,
  parseYuanToCents,
  roundProgress,
  scoreDifference,
  sortedParticipants,
  zhaJinHuaActivePlayerCount,
} from '@/lib/card-score';
import {
  getStoredScoreSession,
  removeStoredScoreSession,
  setStoredScoreSession,
} from '@/lib/card-score-session-storage';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  CreateScoreRoomInput,
  ScoreCredential,
  ScoreParticipant,
  ScoreRealtimeStatus,
  ScoreRoomSnapshot,
  ScoreScene,
  ZhaJinHuaHand,
  ZhaJinHuaSettings,
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
import { ScoreScanJoinFlow } from './card-score-scan-flow';

type LandingMode = 'create' | 'join';
type Feedback = { message: string; tone?: 'error' | 'info' | 'success' };

const PLAYER_LIMITS = [2, 3, 4, 5, 6, 7, 8];
const SETTLEMENT_RATE_PRESETS = [50, 100, 200];

export function CardScoreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invite?: string }>();
  const { accessToken, status: authStatus } = useAuth();
  const [mode, setMode] = useState<LandingMode>(params.invite ? 'join' : 'create');
  const [scanOpen, setScanOpen] = useState(Boolean(params.invite));
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
    const normalized = {
      ...next,
      scene: next.scene ?? 'generic',
      giftBatches: next.giftBatches ?? [],
      zhaJinHuaSettings: next.zhaJinHuaSettings ?? { forceOpenThreshold: 0 },
      zhaJinHuaHands: next.zhaJinHuaHands ?? [],
    };
    roomVersionRef.current = normalized.version;
    setRoom((current) => ({
      ...normalized,
      inviteToken: normalized.inviteToken ?? (current?.id === normalized.id ? current.inviteToken : undefined),
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
          setScanOpen(false);
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

  const roomId = room?.id;
  useEffect(() => {
    if (!roomId || !credential) return;
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
  }, [credential, refreshRoom, roomId]);

  async function runMutation(action: () => Promise<ScoreRoomSnapshot>, success?: string) {
    if (busy) return false;
    setBusy(true);
    setFeedback(null);
    try {
      applyRoom(await action());
      if (success) setFeedback({ message: success, tone: 'success' });
      return true;
    } catch (error) {
      if (error instanceof CardScoreAPIError && error.snapshot) applyRoom(error.snapshot);
      setFeedback({ message: getCardScoreErrorMessage(error) });
      return false;
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

  async function enterScanRoom(credential: ScoreCredential, roomId: string) {
    setGuestToken(null);
    let next = await getScoreRoom(credential, roomId);
    if (next.status === 'waiting') {
      const inviteToken = await issueScoreInviteToken(credential, next.id);
      next = { ...next, inviteToken };
    }
    applyRoom(next);
    setScanOpen(false);
  }

  async function joinFromScan(input: { inviteToken: string; displayName: string }) {
    const result = await joinScoreRoom({
      inviteToken: input.inviteToken,
      displayName: input.displayName,
    });
    setGuestToken(result.guestToken);
    await setStoredScoreSession({
      roomId: result.room.id,
      guestToken: result.guestToken,
      participantId: result.actor.participantId,
      savedAt: new Date().toISOString(),
    });
    applyRoom(result.room);
    setScanOpen(false);
  }

  if (loading || authStatus === 'loading') {
    return (
      <MobileScreen contentContainerStyle={styles.centered}>
        <MaterialCommunityIcons name="cards-playing-outline" size={42} color="#4b6bff" />
        <ThemedText style={styles.loadingTitle}>正在恢复牌局</ThemedText>
      </MobileScreen>
    );
  }

  const scanModal = scanOpen ? (
    <Modal
      animationType="slide"
      onRequestClose={() => setScanOpen(false)}
      presentationStyle="fullScreen"
      visible>
      <ScoreScanJoinFlow
        accessToken={accessToken}
        initialInvite={params.invite}
        onClose={() => setScanOpen(false)}
        onEnterRoom={(credential, roomId) => enterScanRoom(credential, roomId)}
        onJoin={(input) => joinFromScan(input)}
      />
    </Modal>
  ) : null;

  if (!room) {
    return (
      <>
        {scanModal}
        <LandingView
          accessToken={accessToken}
          busy={busy}
          feedback={feedback}
          history={history}
          initialInvite={params.invite}
          mode={mode}
          onBack={() => router.back()}
          onCreate={async (input) => {
            if (!accessToken) {
              router.push({ pathname: '/auth', params: { returnTo: '/tools/card-score' } });
              return;
            }
            setBusy(true);
            setFeedback(null);
            try {
              const result = await createScoreRoom(accessToken, input);
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
          onOpenScanner={() => setScanOpen(true)}
        />
      </>
    );
  }

  if (!credential) return null;
  const self = room.participants.find((participant) => participant.id === room.selfParticipantId);
  return (
    <>
      {scanModal}
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
    </>
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
  onOpenScanner,
}: {
  accessToken: string | null;
  busy: boolean;
  feedback: Feedback | null;
  history: ScoreRoomSnapshot[];
  initialInvite?: string;
  mode: LandingMode;
  onBack: () => void;
  onCreate: (input: CreateScoreRoomInput) => Promise<void>;
  onJoin: (code: string, displayName: string, inviteToken?: string) => Promise<void>;
  onModeChange: (mode: LandingMode) => void;
  onOpenHistory: (room: ScoreRoomSnapshot) => void;
  onOpenScanner: () => void;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('今晚牌局');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [scene, setScene] = useState<ScoreScene>('generic');
  const [forceOpenThreshold, setForceOpenThreshold] = useState(2);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (forceOpenThreshold > maxPlayers) setForceOpenThreshold(maxPlayers);
  }, [forceOpenThreshold, maxPlayers]);

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <ScoreTopBar onBack={onBack} title="打牌记分" />
      <View style={styles.heroCopy}>
        <ThemedText style={styles.pageTitle}>先记清每一分，散场再结算</ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.mutedText }]}>赢家不用填分，谁输分就给别人多少；散场时房主再定每分金额。</ThemedText>
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
              <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>记分场景</ThemedText>
              <SegmentedControl
                onChange={(value) => setScene(value as ScoreScene)}
                options={[{ label: '通用记分', value: 'generic' }, { label: '炸金花', value: 'zhajinhua' }]}
                value={scene}
              />
            </View>
            <View style={styles.settingBlock}>
              <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>玩家人数上限</ThemedText>
              <View style={styles.optionRow}>
                {PLAYER_LIMITS.map((limit) => (
                  <OptionButton key={limit} label={String(limit)} selected={maxPlayers === limit} onPress={() => setMaxPlayers(limit)} />
                ))}
              </View>
            </View>
            {scene === 'zhajinhua' ? (
              <>
                <View style={styles.settingBlock}>
                  <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>剩多少人可强开</ThemedText>
                  <View style={styles.optionRow}>
                    {Array.from({ length: Math.max(0, maxPlayers - 1) }, (_, index) => index + 2).map((limit) => (
                      <OptionButton key={limit} label={`${limit} 人`} selected={forceOpenThreshold === limit} onPress={() => setForceOpenThreshold(limit)} />
                    ))}
                  </View>
                </View>
                <FeedbackBanner message="开牌费不单独设置，始终等于当时最近一次加注额；桌上强开后由发起人选择本手结果，App 只记录牌费、奖池和积分。" tone="info" />
              </>
            ) : (
              <FeedbackBanner message="默认 1 分 = 1 元；打完后由房主在结算时调整比例。" tone="info" />
            )}
            <PrimaryAction
              icon={accessToken ? 'plus-circle-outline' : 'login'}
              label={accessToken ? '创建记分房间' : '登录后创建'}
              loading={busy}
              onPress={() => void onCreate({
                name: name.trim(),
                maxPlayers,
                scene,
                forceOpenThreshold: scene === 'zhajinhua' ? forceOpenThreshold : undefined,
              })}
            />
          </>
        ) : (
          <>
            {initialInvite ? <FeedbackBanner message="邀请已识别，填写昵称即可加入。" tone="info" /> : null}
            {!initialInvite ? (
              <>
                <PrimaryAction icon="qrcode-scan" label="扫一扫加入房间" onPress={onOpenScanner} />
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, { backgroundColor: colors.line }]} />
                  <ThemedText style={[styles.dividerText, { color: colors.mutedText }]}>或输入房间码</ThemedText>
                  <View style={[styles.dividerLine, { backgroundColor: colors.line }]} />
                </View>
              </>
            ) : null}
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
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
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
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
  room: ScoreRoomSnapshot;
}) {
  const { colors } = useAppTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inviteURL = room.inviteToken ? Linking.createURL('/tools/card-score', { queryParams: { invite: room.inviteToken } }) : '';
  return (
    <>
      <SurfaceCard style={styles.invitePanel}>
        <View style={styles.inviteHeader}>
          <View>
            <ThemedText style={[styles.kicker, { color: colors.accent }]}>等待玩家加入</ThemedText>
            <ThemedText style={styles.roomCode}>{room.code}</ThemedText>
          </View>
          {inviteURL ? <View style={styles.qrShell}><QRCode backgroundColor="#ffffff" color="#18233d" quietZone={4} size={148} value={inviteURL} /></View> : null}
        </View>
        <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>暂按每分 {formatCNY(room.centsPerPoint)} · 结算时可调整 · {activeCount}/{room.maxPlayers} 人</ThemedText>
        {room.scene === 'zhajinhua' ? (
          <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>
            炸金花规则：剩 {room.zhaJinHuaSettings.forceOpenThreshold} 人可强开 · 开牌费跟随当前加注额
          </ThemedText>
        ) : null}
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
          {room.scene === 'zhajinhua' ? (
            <PrimaryAction icon="tune-variant" label="修改强开规则" onPress={() => setSettingsOpen(true)} tone="neutral" />
          ) : null}
          <PrimaryAction disabled={activeCount < 2} icon="play-circle-outline" label={activeCount < 2 ? '至少 2 人才能开始' : '开始牌局'} loading={busy} onPress={() => void onMutation(() => startScoreRoom(credential, room))} />
          <PrimaryAction icon="close-circle-outline" label="取消房间" onPress={() => void onMutation(() => cancelScoreRoom(credential, room))} tone="neutral" />
        </View>
      ) : <FeedbackBanner message="已加入，等待房主开始牌局。" tone="info" />}
      <ZhaJinHuaSettingsModal
        busy={busy}
        onClose={() => setSettingsOpen(false)}
        onSave={async (settings) => {
          const success = await onMutation(() => updateZhaJinHuaSettings(credential, room, settings), '强开规则已更新。');
          if (success) setSettingsOpen(false);
          return success;
        }}
        room={room}
        visible={settingsOpen}
      />
    </>
  );
}

function ActiveRoom({ busy, credential, host, onMutation, room, self }: {
  busy: boolean;
  credential: ScoreCredential;
  host: boolean;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
  room: ScoreRoomSnapshot;
  self?: ScoreParticipant;
}) {
  const [settleOpen, setSettleOpen] = useState(false);
  const ranking = sortedParticipants(room.participants);
  const hasRecords = room.rounds.length > 0 || room.giftBatches.length > 0 || room.zhaJinHuaHands.length > 0;
  const hasActiveHand = Boolean(room.currentRound || room.currentZhaJinHuaHand);
  return (
    <>
      <View style={styles.section}>
        <SectionTitle action={`暂按每分 ${formatCNY(room.centsPerPoint)}`} title="当前总分" />
        <SurfaceCard style={styles.listCard}>
          {ranking.map((participant, index) => <ParticipantScoreRow key={participant.id} participant={participant} rank={index + 1} />)}
        </SurfaceCard>
      </View>
      {room.scene === 'zhajinhua' ? (
        <ZhaJinHuaRoom busy={busy} credential={credential} host={host} onMutation={onMutation} room={room} self={self} />
      ) : room.currentRound ? (
        <CurrentRound busy={busy} credential={credential} host={host} onMutation={onMutation} room={room} self={self} />
      ) : (
        <GivePointsPanel busy={busy} credential={credential} onMutation={onMutation} room={room} self={self} />
      )}
      {!hasActiveHand && host && hasRecords ? (
        <PrimaryAction icon="flag-checkered" label="结束并结算" onPress={() => setSettleOpen(true)} tone="neutral" />
      ) : null}
      {room.scene === 'generic' && room.giftBatches.length ? <GiftHistory credential={credential} host={host} onMutation={onMutation} room={room} /> : null}
      {room.scene === 'generic' && room.rounds.length ? <RoundHistory credential={credential} host={host} onMutation={onMutation} room={room} /> : null}
      <SettlementRateModal
        busy={busy}
        onClose={() => setSettleOpen(false)}
        onSettle={async (centsPerPoint) => {
          const success = await onMutation(() => settleScoreRoom(credential, room, centsPerPoint), '牌局已结算。');
          if (success) setSettleOpen(false);
          return success;
        }}
        room={room}
        visible={settleOpen}
      />
    </>
  );
}

function ZhaJinHuaRoom({ busy, credential, host, onMutation, room, self }: {
  busy: boolean;
  credential: ScoreCredential;
  host: boolean;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
  room: ScoreRoomSnapshot;
  self?: ScoreParticipant;
}) {
  const { colors } = useAppTheme();
  const hand = room.currentZhaJinHuaHand;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [raiseDraft, setRaiseDraft] = useState('');
  const [targetId, setTargetId] = useState('');
  const [winnerId, setWinnerId] = useState('');
  const selfPlayer = hand?.players.find((player) => player.participantId === self?.id);
  const activeOpponents = hand?.players.filter((player) => player.status === 'active' && player.participantId !== self?.id) ?? [];
  const activeOpponentIds = activeOpponents.map((player) => player.participantId).join('|');
  const activeCount = hand ? zhaJinHuaActivePlayerCount(hand) : 0;
  const isMyTurn = Boolean(hand && self && hand.currentTurnParticipantId === self.id);
  const forceOpenAvailable = Boolean(hand && canForceOpenZhaJinHua(hand));
  const raisePoints = Number.parseInt(raiseDraft, 10);
  const validRaise = Number.isSafeInteger(raisePoints) && raisePoints > 0 && raisePoints <= 2_147_483_647;

  useEffect(() => {
    setRaiseDraft('');
    const available = activeOpponentIds ? activeOpponentIds.split('|') : [];
    setTargetId(available[0] ?? '');
    setWinnerId('');
  }, [activeOpponentIds, hand?.currentTurnParticipantId, hand?.id]);

  useEffect(() => {
    if (winnerId && winnerId !== self?.id && winnerId !== targetId) setWinnerId('');
  }, [self?.id, targetId, winnerId]);

  async function startHand() {
    await onMutation(() => startZhaJinHuaHand(credential, room), '新一手已开始。');
  }

  async function raise() {
    if (!hand || !validRaise) return;
    const success = await onMutation(
      () => submitZhaJinHuaAction(credential, room, hand.id, { actionType: 'raise', points: raisePoints }),
      `已加注 ${raisePoints} 分，积分进入公共池。`,
    );
    if (success) setRaiseDraft('');
  }

  async function fold() {
    if (!hand) return;
    await onMutation(() => submitZhaJinHuaAction(credential, room, hand.id, { actionType: 'fold' }), '你已弃牌。');
  }

  async function forceOpen() {
    if (!hand || !targetId || !winnerId) return;
    await onMutation(
      () => submitZhaJinHuaAction(credential, room, hand.id, {
        actionType: 'force_open',
        targetParticipantId: targetId,
        winnerParticipantId: winnerId,
      }),
      `已支付 ${hand.currentBetPoints} 分牌费并记录强开结果。`,
    );
  }

  const settingsModal = (
    <ZhaJinHuaSettingsModal
      busy={busy}
      onClose={() => setSettingsOpen(false)}
      onSave={async (settings) => {
        const success = await onMutation(() => updateZhaJinHuaSettings(credential, room, settings), '强开规则已更新，将于下一手生效。');
        if (success) setSettingsOpen(false);
        return success;
      }}
      room={room}
      visible={settingsOpen}
    />
  );

  if (!hand) {
    return (
      <>
        <View style={styles.section}>
          <SectionTitle action="下一手生效" title="炸金花规则" />
          <SurfaceCard style={styles.roundPanel}>
            <View style={[styles.zjhRuleRow, { borderBottomColor: colors.line }]}>
              <View>
                <ThemedText style={styles.entryName}>强开人数</ThemedText>
                <ThemedText style={[styles.entryState, { color: colors.mutedText }]}>本手未弃牌人数不超过该值时可强开</ThemedText>
              </View>
              <ThemedText style={[styles.entryScore, { color: colors.primary }]}>{room.zhaJinHuaSettings.forceOpenThreshold} 人</ThemedText>
            </View>
            <View style={[styles.zjhRuleRow, { borderBottomColor: colors.line }]}>
              <View>
                <ThemedText style={styles.entryName}>开牌费</ThemedText>
                <ThemedText style={[styles.entryState, { color: colors.mutedText }]}>自动等于本手最近一次加注额</ThemedText>
              </View>
              <ThemedText style={[styles.entryScore, { color: colors.primary }]}>跟随跟注</ThemedText>
            </View>
            {host ? <PrimaryAction icon="tune-variant" label="修改强开规则" onPress={() => setSettingsOpen(true)} tone="neutral" /> : null}
            {host ? <PrimaryAction icon="cards-playing-outline" label="开始新一手" loading={busy} onPress={() => void startHand()} /> : <FeedbackBanner message="等待房主开始新一手。" tone="info" />}
          </SurfaceCard>
        </View>
        <ZhaJinHuaHistory room={room} />
        {settingsModal}
      </>
    );
  }

  const participants = new Map(room.participants.map((participant) => [participant.id, participant]));
  const currentTurnName = participants.get(hand.currentTurnParticipantId ?? '')?.displayName ?? '玩家';
  return (
    <>
      <View style={styles.section}>
        <SectionTitle action={`第 ${hand.number} 手`} title="公共积分池" />
        <SurfaceCard style={styles.zjhPotCard}>
          <ThemedText style={[styles.zjhPotLabel, { color: colors.mutedText }]}>当前池内</ThemedText>
          <ThemedText style={[styles.zjhPotValue, { color: colors.accent }]}>{hand.potPoints} 分</ThemedText>
          <ThemedText style={[styles.zjhPotAmount, { color: colors.text }]}>{formatCNY(hand.potPoints * room.centsPerPoint)}</ThemedText>
          <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>
            {activeCount} 人在局 · 剩 {hand.forceOpenThreshold} 人可强开
          </ThemedText>
          <ThemedText style={[styles.ruleText, { color: colors.mutedText }]}>当前跟注/开牌费：{hand.currentBetPoints} 分</ThemedText>
        </SurfaceCard>
      </View>
      <View style={styles.section}>
        <SectionTitle action={`轮到 ${currentTurnName}`} title="本手玩家" />
        <SurfaceCard style={styles.listCard}>
          {hand.players.map((player) => {
            const participant = participants.get(player.participantId);
            if (!participant) return null;
            const isTurn = player.participantId === hand.currentTurnParticipantId;
            return (
              <View key={player.participantId} style={[styles.entryRow, { borderBottomColor: colors.line }]}>
                <View style={styles.entryNameBlock}>
                  <ThemedText style={[styles.entryName, { color: isTurn ? colors.primary : colors.text }]}>{participant.displayName}</ThemedText>
                  <ThemedText style={[styles.entryState, { color: player.status === 'folded' ? colors.mutedText : isTurn ? colors.primary : colors.mutedText }]}>
                    {player.status === 'folded' ? '已弃牌' : isTurn ? '当前行动' : '在局'} · 已投入 {player.contributionPoints} 分
                  </ThemedText>
                </View>
                <ThemedText style={[styles.entryScore, { color: player.status === 'folded' ? colors.mutedText : colors.text }]}>{player.contributionPoints}</ThemedText>
              </View>
            );
          })}
        </SurfaceCard>
      </View>
      <View style={styles.section}>
        <SectionTitle action={isMyTurn ? '你的回合' : '等待中'} title="本手行动" />
        <SurfaceCard style={styles.roundPanel}>
          {isMyTurn ? (
            <>
              <ScoreField
                icon="plus-circle-outline"
                keyboardType="number-pad"
                label="本次加注积分"
                maxLength={10}
                onChangeText={(value) => setRaiseDraft(value.replace(/\D/g, ''))}
                placeholder="输入正整数"
                value={raiseDraft}
              />
              <View style={styles.actionStack}>
                <PrimaryAction disabled={!validRaise} icon="trending-up" label={validRaise ? `加注 ${raisePoints} 分` : '输入加注积分'} loading={busy} onPress={() => void raise()} />
                <PrimaryAction icon="card-remove-outline" label="弃牌" onPress={() => void fold()} tone="neutral" />
              </View>
              {forceOpenAvailable ? (
                <View style={[styles.zjhForceOpen, { borderColor: colors.line }]}>
                  <View>
                    <ThemedText style={styles.entryName}>强开对手</ThemedText>
                    <ThemedText style={[styles.entryState, { color: colors.mutedText }]}>支付当前跟注额 {hand.currentBetPoints} 分后，现场看牌并选择结果。</ThemedText>
                  </View>
                  {activeOpponents.length > 1 ? (
                    <View style={styles.optionRow}>
                      {activeOpponents.map((player) => (
                        <OptionButton
                          key={player.participantId}
                          label={participants.get(player.participantId)?.displayName ?? '玩家'}
                          onPress={() => setTargetId(player.participantId)}
                          selected={targetId === player.participantId}
                        />
                      ))}
                    </View>
                  ) : null}
                  <View style={styles.optionRow}>
                    {self ? <OptionButton label="我赢" onPress={() => setWinnerId(self.id)} selected={winnerId === self.id} /> : null}
                    {targetId ? <OptionButton label="对方赢" onPress={() => setWinnerId(targetId)} selected={winnerId === targetId} /> : null}
                  </View>
                  <PrimaryAction disabled={!targetId || !winnerId} icon="cards-outline" label={`支付 ${hand.currentBetPoints} 分并强开`} loading={busy} onPress={() => void forceOpen()} tone="primary" />
                </View>
              ) : (
                <FeedbackBanner
                  message={hand.currentBetPoints <= 0
                    ? '完成一次加注后即可强开，开牌费等于当前跟注额。'
                    : `还剩 ${activeCount} 人，强开将在不超过 ${hand.forceOpenThreshold} 人时开放。`}
                  tone="info"
                />
              )}
            </>
          ) : (
            <FeedbackBanner message={`等待 ${currentTurnName} 行动。`} tone="info" />
          )}
          {host ? (
            <PrimaryAction icon="close-circle-outline" label="取消本手" onPress={() => void onMutation(() => cancelZhaJinHuaHand(credential, room, hand.id), '本手已取消，未记入积分。')} tone="neutral" />
          ) : null}
        </SurfaceCard>
      </View>
      <ZhaJinHuaHistory room={room} />
      {settingsModal}
    </>
  );
}

function ZhaJinHuaHistory({ room }: { room: ScoreRoomSnapshot }) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const hands = expanded ? room.zhaJinHuaHands : room.zhaJinHuaHands.slice(0, 3);
  const participants = new Map(room.participants.map((participant) => [participant.id, participant]));
  if (!room.zhaJinHuaHands.length) return null;
  return (
    <View style={styles.section}>
      <SectionTitle action={`${room.zhaJinHuaHands.length} 手`} title="炸金花记录" />
      <SurfaceCard style={styles.listCard}>
        {hands.map((hand) => (
          <View key={hand.id} style={[styles.roundHistoryRow, { borderBottomColor: colors.line }]}>
            <View style={[styles.roundNumber, { backgroundColor: colors.surfaceMuted }]}><ThemedText style={[styles.roundNumberText, { color: colors.primary }]}>{hand.number}</ThemedText></View>
            <View style={styles.roundHistoryCopy}>
              <ThemedText style={styles.roundHistoryTitle}>第 {hand.number} 手 · {participants.get(hand.winnerParticipantId ?? '')?.displayName ?? '玩家'}获胜</ThemedText>
              <ThemedText style={[styles.roundHistoryMeta, { color: colors.mutedText }]}>
                奖池 {hand.potPoints} 分 · {formatCNY(hand.potPoints * room.centsPerPoint)} · {hand.actions.length} 次操作
              </ThemedText>
            </View>
          </View>
        ))}
        {room.zhaJinHuaHands.length > 3 ? (
          <Pressable onPress={() => setExpanded((value) => !value)} style={styles.expandButton}><ThemedText style={[styles.expandText, { color: colors.primary }]}>{expanded ? '收起记录' : '查看全部记录'}</ThemedText><MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} color={colors.primary} size={19} /></Pressable>
        ) : null}
      </SurfaceCard>
    </View>
  );
}

function ZhaJinHuaSettingsModal({ busy, onClose, onSave, room, visible }: {
  busy: boolean;
  onClose: () => void;
  onSave: (settings: ZhaJinHuaSettings) => Promise<boolean>;
  room: ScoreRoomSnapshot;
  visible: boolean;
}) {
  const { colors } = useAppTheme();
  const [threshold, setThreshold] = useState(room.zhaJinHuaSettings.forceOpenThreshold || 2);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setThreshold(room.zhaJinHuaSettings.forceOpenThreshold || 2);
  }, [room.zhaJinHuaSettings.forceOpenThreshold, visible]);
  const valid = threshold >= 2 && threshold <= room.maxPlayers;

  async function save() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSave({ forceOpenThreshold: threshold });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <SurfaceCard style={styles.settlementModal}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <ThemedText style={styles.settlementTitle}>强开规则</ThemedText>
              <ThemedText style={[styles.settlementMeta, { color: colors.mutedText }]}>修改后从下一手开始使用。</ThemedText>
            </View>
            <Pressable accessibilityLabel="关闭强开规则设置" onPress={onClose} style={styles.rowIconButton}><MaterialCommunityIcons name="close" color={colors.mutedText} size={21} /></Pressable>
          </View>
          <View style={styles.settingBlock}>
            <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>剩多少人可强开</ThemedText>
            <View style={styles.optionRow}>
              {Array.from({ length: Math.max(0, room.maxPlayers - 1) }, (_, index) => index + 2).map((limit) => (
                <OptionButton key={limit} label={`${limit} 人`} selected={threshold === limit} onPress={() => setThreshold(limit)} />
              ))}
            </View>
          </View>
          <FeedbackBanner message="开牌费不用填写，强开时自动按当前最近一次加注额收取。" tone="info" />
          {!valid ? <FeedbackBanner message="请选择有效的强开人数。" /> : null}
          <View style={styles.modalActions}>
            <PrimaryAction disabled={!valid} icon="content-save-outline" label="保存规则" loading={busy || submitting} onPress={() => void save()} />
            <PrimaryAction icon="close" label="取消" onPress={onClose} tone="neutral" />
          </View>
        </SurfaceCard>
      </View>
    </Modal>
  );
}

function GivePointsPanel({ busy, credential, onMutation, room, self }: {
  busy: boolean;
  credential: ScoreCredential;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
  room: ScoreRoomSnapshot;
  self?: ScoreParticipant;
}) {
  const { colors } = useAppTheme();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const recipients = room.participants.filter((participant) => participant.status === 'active' && participant.id !== self?.id);
  const giftDraft = useMemo(
    () => buildScoreGiftAllocations(recipients.map((participant) => participant.id), drafts),
    [drafts, recipients],
  );
  const { allocations, hasEnteredPoints, invalid, totalPoints } = giftDraft;
  const canSubmit = Boolean(self) && hasEnteredPoints && !invalid && allocations.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    const success = await onMutation(() => submitScoreGifts(credential, room, allocations), '给分已入账。');
    if (success) setDrafts({});
  }

  if (!self) return null;
  return (
    <View style={styles.section}>
      <SectionTitle action="赢家无需填写" title="我给分" />
      <SurfaceCard style={styles.roundPanel}>
        <ThemedText style={[styles.giveHint, { color: colors.mutedText }]}>选择一位或多位玩家，填写你要给每个人的分数。提交后双方分数会立即更新。</ThemedText>
        <View style={styles.entryList}>
          {recipients.map((participant) => (
            <View key={participant.id} style={[styles.giveRow, { borderBottomColor: colors.line }]}>
              <View style={styles.entryNameBlock}>
                <ThemedText style={styles.entryName}>{participant.displayName}</ThemedText>
                <ThemedText style={[styles.entryState, { color: colors.mutedText }]}>当前 {formatScore(participant.totalPoints)} 分</ThemedText>
              </View>
              <TextInput
                accessibilityLabel={`给 ${participant.displayName} 的分数`}
                keyboardType="number-pad"
                maxLength={10}
                onChangeText={(value) => setDrafts((current) => ({ ...current, [participant.id]: value.replace(/\D/g, '') }))}
                placeholder="0"
                placeholderTextColor={colors.mutedText}
                selectionColor={colors.primary}
                style={[styles.giveInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                value={drafts[participant.id] ?? ''}
              />
              <ThemedText style={[styles.giveUnit, { color: colors.mutedText }]}>分</ThemedText>
            </View>
          ))}
        </View>
        <View style={styles.giveSummary}>
          <ThemedText style={[styles.giveSummaryLabel, { color: colors.mutedText }]}>本次给出</ThemedText>
          <ThemedText style={[styles.giveSummaryValue, { color: totalPoints > 0 ? colors.accent : colors.mutedText }]}>{totalPoints > 0 ? formatScore(-totalPoints) : '0'} 分</ThemedText>
        </View>
        {invalid ? <FeedbackBanner message="每人只能填写大于 0 的整数分数，且合计不能超出计分上限。" /> : null}
        <PrimaryAction disabled={!canSubmit} icon="gift-outline" label="确认给分" loading={busy} onPress={() => void handleSubmit()} />
      </SurfaceCard>
    </View>
  );
}

function GiftHistory({ credential, host = false, onMutation, room }: {
  credential?: ScoreCredential;
  host?: boolean;
  onMutation?: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
  room: ScoreRoomSnapshot;
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const batches = expanded ? room.giftBatches : room.giftBatches.slice(0, 3);
  const participants = new Map(room.participants.map((participant) => [participant.id, participant]));
  const batchByID = new Map(room.giftBatches.map((batch) => [batch.id, batch]));
  const reversedBatchIDs = new Set(room.giftBatches.map((batch) => batch.reversesBatchId).filter(Boolean));
  return (
    <View style={styles.section}>
      <SectionTitle action={`${room.giftBatches.length} 笔`} title="给分记录" />
      <SurfaceCard style={styles.listCard}>
        {batches.map((batch) => {
          const sourceBatch = batch.reversesBatchId ? batchByID.get(batch.reversesBatchId) : undefined;
          const detail = batch.gifts.map((gift) => {
            const from = participants.get(gift.fromParticipantId)?.displayName ?? '玩家';
            const to = participants.get(gift.toParticipantId)?.displayName ?? '玩家';
            return `${from} 给 ${to} ${formatScore(gift.points)} 分`;
          }).join(' · ');
          const canReverse = Boolean(host && credential && onMutation) && batch.kind === 'normal' && !reversedBatchIDs.has(batch.id);
          return (
            <View key={batch.id} style={[styles.roundHistoryRow, { borderBottomColor: colors.line }]}>
              <View style={[styles.roundNumber, { backgroundColor: colors.surfaceMuted }]}><ThemedText style={[styles.roundNumberText, { color: colors.primary }]}>{batch.number}</ThemedText></View>
              <View style={styles.roundHistoryCopy}>
                <ThemedText style={styles.roundHistoryTitle}>{batch.kind === 'reversal' ? `反向记录，更正第 ${sourceBatch?.number ?? '—'} 笔` : `第 ${batch.number} 笔给分`}</ThemedText>
                <ThemedText numberOfLines={3} style={[styles.roundHistoryMeta, { color: colors.mutedText }]}>{detail}</ThemedText>
              </View>
              {canReverse ? (
                <Pressable accessibilityLabel={`更正第 ${batch.number} 笔给分`} onPress={() => void onMutation?.(() => reverseScoreGiftBatch(credential!, room, batch.id), '已生成反向给分记录。')} style={styles.rowIconButton}>
                  <MaterialCommunityIcons name="undo-variant" color={colors.primary} size={20} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {room.giftBatches.length > 3 ? (
          <Pressable onPress={() => setExpanded((value) => !value)} style={styles.expandButton}><ThemedText style={[styles.expandText, { color: colors.primary }]}>{expanded ? '收起记录' : '查看全部记录'}</ThemedText><MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} color={colors.primary} size={19} /></Pressable>
        ) : null}
      </SurfaceCard>
    </View>
  );
}

function SettlementRateModal({ busy, onClose, onSettle, room, visible }: {
  busy: boolean;
  onClose: () => void;
  onSettle: (centsPerPoint: number) => Promise<boolean>;
  room: ScoreRoomSnapshot;
  visible: boolean;
}) {
  const { colors } = useAppTheme();
  const [rateDraft, setRateDraft] = useState(formatRateInput(room.centsPerPoint));
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (visible) setRateDraft(formatRateInput(room.centsPerPoint));
  }, [room.centsPerPoint, visible]);
  const centsPerPoint = parseYuanToCents(rateDraft);
  const ranking = sortedParticipants(room.participants);

  async function handleSettle() {
    if (!centsPerPoint || submitting) return;
    setSubmitting(true);
    try {
      await onSettle(centsPerPoint);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <SurfaceCard style={styles.settlementModal}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <ThemedText style={styles.settlementTitle}>结算比例</ThemedText>
              <ThemedText style={[styles.settlementMeta, { color: colors.mutedText }]}>只改变金额，不改变玩家分数。</ThemedText>
            </View>
            <Pressable accessibilityLabel="关闭结算设置" onPress={onClose} style={styles.rowIconButton}><MaterialCommunityIcons name="close" color={colors.mutedText} size={21} /></Pressable>
          </View>
          <View style={styles.optionRow}>
            {SETTLEMENT_RATE_PRESETS.map((cents) => (
              <OptionButton key={cents} label={`${formatCNY(cents)}/分`} selected={centsPerPoint === cents} onPress={() => setRateDraft(formatRateInput(cents))} />
            ))}
          </View>
          <View style={styles.rateInputRow}>
            <ThemedText style={[styles.fieldCaption, { color: colors.mutedText }]}>自定义</ThemedText>
            <View style={[styles.rateInputShell, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
              <ThemedText style={[styles.ratePrefix, { color: colors.mutedText }]}>¥</ThemedText>
              <TextInput
                accessibilityLabel="每分金额"
                keyboardType="decimal-pad"
                onChangeText={(value) => setRateDraft(value.replace(/[^0-9.]/g, ''))}
                placeholder="1"
                placeholderTextColor={colors.mutedText}
                selectionColor={colors.primary}
                style={[styles.rateInput, { color: colors.text }]}
                value={rateDraft}
              />
              <ThemedText style={[styles.ratePrefix, { color: colors.mutedText }]}>元/分</ThemedText>
            </View>
          </View>
          {!centsPerPoint ? <FeedbackBanner message="请输入大于 0、最多两位小数的每分金额。" /> : null}
          <View style={styles.entryList}>
            {ranking.map((participant) => (
              <View key={participant.id} style={[styles.entryRow, { borderBottomColor: colors.line }]}>
                <View style={styles.entryNameBlock}>
                  <ThemedText style={styles.entryName}>{participant.displayName}</ThemedText>
                  <ThemedText style={[styles.entryState, { color: colors.mutedText }]}>{formatScore(participant.totalPoints)} 分</ThemedText>
                </View>
                <ThemedText style={styles.entryScore}>{centsPerPoint ? formatCNY(participant.totalPoints * centsPerPoint) : '—'}</ThemedText>
              </View>
            ))}
          </View>
          <View style={styles.modalActions}>
            <PrimaryAction icon="flag-checkered" label="确认并结算" loading={busy || submitting} onPress={() => void handleSettle()} disabled={!centsPerPoint} />
            <PrimaryAction icon="close" label="取消" onPress={onClose} tone="neutral" />
          </View>
        </SurfaceCard>
      </View>
    </Modal>
  );
}

function CurrentRound({ busy, credential, host, onMutation, room, self }: {
  busy: boolean;
  credential: ScoreCredential;
  host: boolean;
  onMutation: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
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
  onMutation?: (action: () => Promise<ScoreRoomSnapshot>, success?: string) => Promise<boolean>;
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
  const recordCount = room.giftBatches.length + room.rounds.length + room.zhaJinHuaHands.length;
  return (
    <>
      <SurfaceCard style={styles.settlementHero}>
        <View style={[styles.settlementIcon, { backgroundColor: colors.primarySoft }]}><MaterialCommunityIcons name="check-decagram-outline" color={colors.success} size={34} /></View>
        <ThemedText style={styles.settlementTitle}>牌局已结算</ThemedText>
        <ThemedText style={[styles.settlementMeta, { color: colors.mutedText }]}>{recordCount} 条记录 · 每分 {formatCNY(room.centsPerPoint)}</ThemedText>
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
      {room.giftBatches.length ? <GiftHistory room={room} /> : null}
      {room.rounds.length ? <RoundHistory room={room} /> : null}
      {room.zhaJinHuaHands.length ? <ZhaJinHuaHistory room={room} /> : null}
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
  dividerLine: { flex: 1, height: 1 },
  dividerRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  dividerText: { fontSize: 11, fontWeight: '700' },
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
  giveHint: { fontSize: 12, fontWeight: '700', lineHeight: 18 },
  giveInput: { borderRadius: 12, borderWidth: 1, fontSize: 17, fontWeight: '900', height: 44, paddingHorizontal: 10, paddingVertical: 0, textAlign: 'center', width: 68 },
  giveRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 60, paddingVertical: 8 },
  giveSummary: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  giveSummaryLabel: { fontSize: 12, fontWeight: '700' },
  giveSummaryValue: { fontSize: 16, fontWeight: '900' },
  giveUnit: { fontSize: 12, fontWeight: '800' },
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
  modalActions: { gap: 9 },
  modalBackdrop: { backgroundColor: 'rgba(9, 15, 30, 0.52)', flex: 1, justifyContent: 'flex-end', padding: 16 },
  modalHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  modalTitleBlock: { flex: 1, gap: 4 },
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
  rateInput: { flex: 1, fontSize: 18, fontWeight: '900', height: 48, paddingHorizontal: 6, paddingVertical: 0 },
  rateInputRow: { gap: 7 },
  rateInputShell: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: 14 },
  ratePrefix: { fontSize: 13, fontWeight: '800' },
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
  settlementModal: { gap: 16, maxHeight: '92%', padding: 18 },
  settlementTitle: { fontSize: 22, fontWeight: '900' },
  zjhForceOpen: { borderTopWidth: 1, gap: 12, paddingTop: 14 },
  zjhPotAmount: { fontSize: 16, fontWeight: '800' },
  zjhPotCard: { alignItems: 'center', gap: 7, padding: 22 },
  zjhPotLabel: { fontSize: 12, fontWeight: '800' },
  zjhPotValue: { fontSize: 36, fontWeight: '900' },
  zjhRuleRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingVertical: 8 },
});
