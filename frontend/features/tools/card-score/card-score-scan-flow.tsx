import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getCardScoreErrorMessage,
  previewScoreInvite,
} from '@/lib/card-score-api';
import { extractScoreInviteToken, formatCNY } from '@/lib/card-score';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  ScoreCredential,
  ScoreRoomSnapshot,
  ScoreRoomStatus,
} from '@/types/card-score';

import {
  FeedbackBanner,
  PrimaryAction,
  ScoreField,
  ScoreTopBar,
} from './card-score-components';
import { CardScoreScanner } from './card-score-scanner';

type ScanJoinProps = {
  accessToken: string | null;
  initialInvite?: string;
  onClose: () => void;
  onEnterRoom: (credential: ScoreCredential, roomId: string) => Promise<void>;
  onJoin: (input: { inviteToken: string; displayName: string }) => Promise<void>;
};

type Step = 'scan' | 'preview' | 'error';

export function ScoreScanJoinFlow({
  accessToken,
  initialInvite,
  onClose,
  onEnterRoom,
  onJoin,
}: ScanJoinProps) {
  const { colors } = useAppTheme();
  const [step, setStep] = useState<Step>('scan');
  const [inviteToken, setInviteToken] = useState(initialInvite ?? '');
  const [room, setRoom] = useState<ScoreRoomSnapshot | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone?: 'error' | 'info' | 'success' } | null>(null);

  const preview = useCallback(
    async (inviteValue: string) => {
      setBusy(true);
      setErrorMessage(null);
      setFeedback(null);
      try {
        const result = await previewScoreInvite(inviteValue, accessToken ?? undefined);
        if (result.selfParticipantId && accessToken) {
          await onEnterRoom({ kind: 'account', token: accessToken }, result.room.id);
          return;
        }
        setInviteToken(inviteValue);
        setRoom(result.room);
        setStep('preview');
      } catch (error) {
        setErrorMessage(getCardScoreErrorMessage(error));
        setStep('error');
      } finally {
        setBusy(false);
      }
    },
    [accessToken, onEnterRoom],
  );

  useEffect(() => {
    if (initialInvite) void preview(initialInvite);
    // Deep link preview only needs to run once when the flow opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDetected(value: string) {
    const inviteValue = extractScoreInviteToken(value);
    if (!inviteValue) {
      setErrorMessage('二维码不是有效的牌局邀请码，请让房主重新展示。');
      setStep('error');
      return;
    }
    void preview(inviteValue);
  }

  function resetScan() {
    setStep('scan');
    setInviteToken('');
    setRoom(null);
    setDisplayName('');
    setErrorMessage(null);
    setFeedback(null);
  }

  async function handleConfirm() {
    if (!room || !inviteToken || !displayName.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onJoin({ inviteToken, displayName: displayName.trim() });
    } catch (error) {
      setFeedback({ message: getCardScoreErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (step === 'scan') {
    if (initialInvite) {
      return (
        <MobileScreen contentContainerStyle={styles.centered}>
          <MaterialCommunityIcons name="qrcode-scan" color="#4b6bff" size={42} />
          <ThemedText style={styles.loadingTitle}>正在识别邀请</ThemedText>
        </MobileScreen>
      );
    }
    return (
      <CardScoreScanner
        onClose={onClose}
        onDetected={handleDetected}
        onManualEntry={onClose}
      />
    );
  }

  if (step === 'error') {
    return (
      <MobileScreen contentContainerStyle={styles.pageContent}>
        <ScoreTopBar onBack={onClose} title="加入牌局" />
        <SurfaceCard style={styles.errorCard}>
          <View style={[styles.errorIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="qrcode-scan" color={colors.primary} size={34} />
          </View>
          <ThemedText style={styles.errorTitle}>未能加入房间</ThemedText>
          <ThemedText style={[styles.errorText, { color: colors.mutedText }]}>
            {errorMessage ?? '暂时无法识别这个邀请码，请重试。'}
          </ThemedText>
        </SurfaceCard>
        <View style={styles.actionStack}>
          {!initialInvite ? (
            <PrimaryAction icon="qrcode-scan" label="重新扫码" onPress={resetScan} />
          ) : null}
          <PrimaryAction
            icon="keyboard-outline"
            label="手动输入房间码"
            onPress={onClose}
            tone="neutral"
          />
        </View>
      </MobileScreen>
    );
  }

  const activeCount = room?.participants.filter((participant) => participant.status === 'active').length ?? 0;
  const hostName = room?.participants.find((participant) => participant.role === 'host')?.displayName ?? '房主';
  const joinable = room?.status === 'waiting';

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <ScoreTopBar onBack={onClose} title="加入房间" />
      {joinable ? (
        <FeedbackBanner message="已识别房间，确认昵称后加入" tone="info" />
      ) : (
        <FeedbackBanner message={roomBlockMessage(room?.status)} />
      )}
      <SurfaceCard style={styles.roomCard}>
        <View style={styles.roomHead}>
          <ThemedText style={styles.roomName}>{room?.name}</ThemedText>
          <ThemedText style={styles.roomCode}>{room?.code}</ThemedText>
        </View>
        <ThemedText style={[styles.roomMeta, { color: colors.mutedText }]}>
          房主 {hostName} · 每分 {formatCNY(room?.centsPerPoint ?? 0)} · {activeCount}/{room?.maxPlayers} 人
        </ThemedText>
      </SurfaceCard>
      <ScoreField
        autoFocus={!initialInvite}
        icon="account-outline"
        label="你的昵称"
        maxLength={48}
        onChangeText={setDisplayName}
        placeholder="房内显示的名字"
        value={displayName}
      />
      {feedback ? <FeedbackBanner message={feedback.message} tone={feedback.tone} /> : null}
      <View style={styles.actionStack}>
        <PrimaryAction
          disabled={!displayName.trim() || !joinable}
          icon="login-variant"
          label="加入牌局"
          loading={busy}
          onPress={() => void handleConfirm()}
        />
        {!initialInvite ? (
          <PrimaryAction icon="qrcode-scan" label="重新扫码" onPress={resetScan} tone="neutral" />
        ) : null}
      </View>
    </MobileScreen>
  );
}

function roomBlockMessage(status?: ScoreRoomStatus) {
  if (status === 'active') return '牌局已开始，当前不能加入。';
  if (status === 'settled') return '牌局已结束，无法加入。';
  if (status === 'cancelled') return '房间已取消，无法加入。';
  return '房间人数已满，无法加入。';
}

const styles = StyleSheet.create({
  actionStack: {
    gap: 10,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 520,
  },
  errorCard: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
  },
  errorIcon: {
    alignItems: 'center',
    borderRadius: 24,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 19,
    fontWeight: '900',
  },
  loadingTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
  },
  pageContent: {
    paddingBottom: 48,
  },
  roomCard: {
    gap: 10,
    padding: 18,
  },
  roomCode: {
    color: '#4b6bff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  roomHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roomMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  roomName: {
    fontSize: 18,
    fontWeight: '900',
  },
});
