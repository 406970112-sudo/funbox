import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatCNY, formatScore } from '@/lib/card-score';
import type { ScoreParticipant, ScoreRealtimeStatus } from '@/types/card-score';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function ScoreTopBar({
  onBack,
  rightSlot,
  status,
  title,
}: {
  onBack: () => void;
  rightSlot?: ReactNode;
  status?: ScoreRealtimeStatus;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          styles.iconButton,
          { backgroundColor: colors.surface, borderColor: colors.line },
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons name="arrow-left" color={colors.text} size={21} />
      </Pressable>
      <View style={styles.topBarTitleRow}>
        <ThemedText numberOfLines={1} style={styles.topBarTitle}>{title}</ThemedText>
        {status ? (
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: status === 'online' ? colors.success : status === 'connecting' ? colors.accent : colors.mutedText }]} />
            <ThemedText style={[styles.statusText, { color: colors.mutedText }]}>
              {status === 'online' ? '已同步' : status === 'connecting' ? '连接中' : '离线'}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {rightSlot ?? <View style={styles.iconButtonPlaceholder} />}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: T) => void;
  options: { label: string; value: T }[];
  value: T;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: colors.hero },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={[styles.segmentText, { color: selected ? '#ffffff' : colors.mutedText }]}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ScoreField({ icon, label, ...inputProps }: TextInputProps & { icon: IconName; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.fieldBlock}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <View style={[styles.fieldShell, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        <MaterialCommunityIcons name={icon} color={colors.primary} size={20} />
        <TextInput
          {...inputProps}
          placeholderTextColor={colors.mutedText}
          selectionColor={colors.primary}
          style={[styles.fieldInput, { color: colors.text }, inputProps.style]}
        />
      </View>
    </View>
  );
}

export function ParticipantScoreRow({
  participant,
  rank,
  rightSlot,
}: {
  participant: ScoreParticipant;
  rank?: number;
  rightSlot?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const initials = participant.displayName.trim().slice(0, 1).toUpperCase();
  return (
    <View style={[styles.participantRow, { borderBottomColor: colors.line }]}>
      {rank ? <ThemedText style={[styles.rank, { color: rank <= 3 ? colors.accent : colors.mutedText }]}>{rank}</ThemedText> : null}
      <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
        <ThemedText style={[styles.avatarText, { color: colors.primary }]}>{initials}</ThemedText>
      </View>
      <View style={styles.participantCopy}>
        <View style={styles.nameRow}>
          <ThemedText numberOfLines={1} style={styles.participantName}>{participant.displayName}</ThemedText>
          {participant.role === 'host' ? (
            <MaterialCommunityIcons name="crown-outline" color={colors.accent} size={15} />
          ) : null}
        </View>
        <ThemedText style={[styles.participantAmount, { color: colors.mutedText }]}>{formatCNY(participant.amountCents)}</ThemedText>
      </View>
      {rightSlot ?? (
        <ThemedText style={[styles.participantScore, { color: participant.totalPoints >= 0 ? colors.success : colors.accent }]}>
          {formatScore(participant.totalPoints)}
        </ThemedText>
      )}
    </View>
  );
}

export function RoomProgress({ confirmed, submitted, total }: { confirmed: number; submitted: number; total: number }) {
  const { colors } = useAppTheme();
  const submittedWidth = total ? `${Math.round((submitted / total) * 100)}%` : '0%';
  const confirmedWidth = total ? `${Math.round((confirmed / total) * 100)}%` : '0%';
  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressLabels}>
        <ThemedText style={[styles.progressText, { color: colors.mutedText }]}>已报分 {submitted}/{total}</ThemedText>
        <ThemedText style={[styles.progressText, { color: colors.mutedText }]}>已确认 {confirmed}/{total}</ThemedText>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
        <View style={[styles.progressSubmitted, { backgroundColor: colors.primary, width: submittedWidth as `${number}%` }]} />
        <View style={[styles.progressConfirmed, { backgroundColor: colors.success, width: confirmedWidth as `${number}%` }]} />
      </View>
    </View>
  );
}

export function TransferRow({ amountCents, from, to }: { amountCents: number; from: string; to: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.transferRow, { borderBottomColor: colors.line }]}>
      <View style={[styles.transferIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="bank-transfer" color={colors.primary} size={21} />
      </View>
      <View style={styles.transferCopy}>
        <ThemedText style={styles.transferTitle}>{from} 向 {to}</ThemedText>
        <ThemedText style={[styles.transferMeta, { color: colors.mutedText }]}>线下结算</ThemedText>
      </View>
      <ThemedText style={[styles.transferAmount, { color: colors.success }]}>{formatCNY(amountCents)}</ThemedText>
    </View>
  );
}

export function PrimaryAction({
  disabled,
  icon,
  label,
  loading,
  onPress,
  tone = 'primary',
}: {
  disabled?: boolean;
  icon: IconName;
  label: string;
  loading?: boolean;
  onPress: () => void;
  tone?: 'primary' | 'danger' | 'neutral';
}) {
  const { colors } = useAppTheme();
  const backgroundColor = tone === 'danger' ? colors.accent : tone === 'neutral' ? colors.surfaceMuted : colors.hero;
  const foreground = tone === 'neutral' ? colors.text : '#ffffff';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryAction,
        { backgroundColor, opacity: disabled ? 0.45 : 1 },
        pressed && styles.pressed,
      ]}>
      {loading ? <ActivityIndicator color={foreground} /> : <MaterialCommunityIcons name={icon} color={foreground} size={20} />}
      <ThemedText style={[styles.primaryActionText, { color: foreground }]}>{label}</ThemedText>
    </Pressable>
  );
}

export function FeedbackBanner({ message, tone = 'error' }: { message: string; tone?: 'error' | 'info' | 'success' }) {
  const { colors } = useAppTheme();
  const color = tone === 'success' ? colors.success : tone === 'info' ? colors.primary : colors.accent;
  const icon: IconName = tone === 'success' ? 'check-circle-outline' : tone === 'info' ? 'information-outline' : 'alert-circle-outline';
  return (
    <View style={[styles.feedback, { backgroundColor: `${color}18`, borderColor: `${color}55` }]}>
      <MaterialCommunityIcons name={icon} color={color} size={19} />
      <ThemedText style={[styles.feedbackText, { color }]}>{message}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', borderRadius: 18, height: 38, justifyContent: 'center', width: 38 },
  avatarText: { fontSize: 15, fontWeight: '900' },
  feedback: { alignItems: 'flex-start', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 12 },
  feedbackText: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  fieldBlock: { gap: 7 },
  fieldInput: { flex: 1, fontSize: 16, minHeight: 48, paddingVertical: 0 },
  fieldLabel: { fontSize: 12, fontWeight: '700' },
  fieldShell: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 52, paddingHorizontal: 14 },
  iconButton: { alignItems: 'center', borderRadius: 16, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 },
  iconButtonPlaceholder: { height: 44, width: 44 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  participantAmount: { fontSize: 11, marginTop: 3 },
  participantCopy: { flex: 1, minWidth: 0 },
  participantName: { fontSize: 14, fontWeight: '800', maxWidth: '88%' },
  participantRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 64, paddingVertical: 10 },
  participantScore: { fontSize: 20, fontWeight: '900' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  primaryAction: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 9, justifyContent: 'center', minHeight: 52, paddingHorizontal: 16 },
  primaryActionText: { fontSize: 14, fontWeight: '900' },
  progressBlock: { gap: 8 },
  progressConfirmed: { borderRadius: 4, height: 7, left: 0, position: 'absolute', top: 0 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  progressSubmitted: { borderRadius: 4, height: 7 },
  progressText: { fontSize: 11, fontWeight: '700' },
  progressTrack: { borderRadius: 4, height: 7, overflow: 'hidden' },
  rank: { fontSize: 14, fontWeight: '900', textAlign: 'center', width: 20 },
  segment: { alignItems: 'center', borderRadius: 14, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 10 },
  segmentText: { fontSize: 13, fontWeight: '800' },
  segmented: { borderRadius: 18, flexDirection: 'row', gap: 4, padding: 4 },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  statusText: { fontSize: 10, fontWeight: '700' },
  topBar: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  topBarTitle: { fontSize: 17, fontWeight: '900', maxWidth: 180 },
  topBarTitleRow: { alignItems: 'center', flex: 1, gap: 5 },
  transferAmount: { fontSize: 15, fontWeight: '900' },
  transferCopy: { flex: 1 },
  transferIcon: { alignItems: 'center', borderRadius: 16, height: 38, justifyContent: 'center', width: 38 },
  transferMeta: { fontSize: 10, marginTop: 3 },
  transferRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 64, paddingVertical: 10 },
  transferTitle: { fontSize: 13, fontWeight: '800' },
});
