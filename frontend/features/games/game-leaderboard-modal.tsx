import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { getGameSocialCapability } from '@/features/games/game-social-model';
import { useGameSocial } from '@/features/games/game-social-provider';
import { SocialAvatar } from '@/features/social/social-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { GameLeaderboardEntry, GameLeaderboardPeriod } from '@/types/game-social';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function GameLeaderboardModal({
  gameId,
  onClose,
  title,
  visible,
}: {
  gameId: string;
  onClose: () => void;
  title: string;
  visible: boolean;
}) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { authenticated, getLeaderboard } = useGameSocial();
  const [entries, setEntries] = useState<GameLeaderboardEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<GameLeaderboardPeriod>('weekly');
  const loginRequired = Boolean(
    getGameSocialCapability(gameId)?.requiresAuthentication && !authenticated,
  );

  useEffect(() => {
    if (!visible || loginRequired) return;
    let active = true;
    setLoading(true);
    setError('');
    void getLeaderboard(gameId, period)
      .then((nextEntries) => {
        if (active) setEntries(nextEntries);
      })
      .catch(() => {
        if (active) setError('好友榜暂时无法加载，请稍后再试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gameId, getLeaderboard, loginRequired, period, visible]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="关闭好友榜" onPress={onClose} style={styles.scrim} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.header}>
            <View>
              <ThemedText style={styles.title}>{title}好友榜</ThemedText>
              <ThemedText style={[styles.subtitle, { color: colors.mutedText }]}>
                仅展示你和已添加的好友
              </ThemedText>
            </View>
            <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {!loginRequired ? <View style={[styles.periodSwitch, { backgroundColor: colors.surfaceMuted }]}>
            {([
              ['weekly', '本周'],
              ['all-time', '总榜'],
            ] as const).map(([value, label]) => {
              const active = value === period;
              return (
                <Pressable
                  key={value}
                  accessibilityState={{ selected: active }}
                  onPress={() => setPeriod(value)}
                  style={[styles.periodButton, active && { backgroundColor: colors.primary }]}>
                  <ThemedText
                    style={[styles.periodText, { color: active ? '#ffffff' : colors.mutedText }]}>
                    {label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View> : null}

          <ScrollView
            contentContainerStyle={styles.listContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.list}>
            {loginRequired ? (
              <View style={styles.stateView}>
                <MaterialCommunityIcons name="account-lock-outline" size={28} color={colors.primary} />
                <ThemedText style={styles.emptyTitle}>登录后查看好友榜</ThemedText>
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                  登录后即可查看你和好友的本周及历史排名
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    router.push('/auth');
                  }}
                  style={[styles.loginButton, { backgroundColor: colors.primary }]}>
                  <ThemedText style={styles.loginButtonText}>登录 / 注册</ThemedText>
                  <MaterialCommunityIcons name="arrow-right" size={17} color="#ffffff" />
                </Pressable>
              </View>
            ) : loading ? (
              <View style={styles.stateView}>
                <ActivityIndicator color={colors.primary} />
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>正在同步排名</ThemedText>
              </View>
            ) : error ? (
              <View style={styles.stateView}>
                <MaterialCommunityIcons name="alert-circle-outline" size={25} color={colors.accent} />
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>{error}</ThemedText>
              </View>
            ) : entries.length === 0 ? (
              <View style={styles.stateView}>
                <MaterialCommunityIcons name="podium" size={28} color={colors.primary} />
                <ThemedText style={styles.emptyTitle}>还没有上榜成绩</ThemedText>
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                  完成一局后，成绩会自动加入排行榜
                </ThemedText>
              </View>
            ) : (
              entries.map((entry) => (
                <View
                  key={entry.user.id}
                  style={[
                    styles.entry,
                    { borderBottomColor: colors.line },
                    entry.isCurrentUser && { backgroundColor: colors.primarySoft },
                  ]}>
                  <View style={styles.rankSlot}>
                    {entry.rank <= 3 ? (
                      <MaterialCommunityIcons
                        name={getRankIcon(entry.rank)}
                        size={22}
                        color={getRankColor(entry.rank)}
                      />
                    ) : (
                      <ThemedText style={[styles.rankText, { color: colors.mutedText }]}>
                        {entry.rank}
                      </ThemedText>
                    )}
                  </View>
                  <SocialAvatar size={38} user={entry.user} />
                  <View style={styles.userCopy}>
                    <View style={styles.nameRow}>
                      <ThemedText numberOfLines={1} style={styles.userName}>
                        {entry.user.displayName}
                      </ThemedText>
                      {entry.isCurrentUser ? (
                        <View style={[styles.meChip, { backgroundColor: colors.primary }]}>
                          <ThemedText style={styles.meText}>我</ThemedText>
                        </View>
                      ) : null}
                    </View>
                    <ThemedText style={[styles.userMeta, { color: colors.mutedText }]}>
                      @{entry.user.username}
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.score, { color: colors.text }]}>
                    {new Intl.NumberFormat('zh-CN').format(entry.score)}
                  </ThemedText>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function getRankIcon(rank: number): IconName {
  return rank === 1 ? 'trophy' : 'medal-outline';
}

function getRankColor(rank: number) {
  if (rank === 1) return '#e0aa25';
  if (rank === 2) return '#8d9aab';
  return '#c88452';
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5, 9, 15, 0.62)' },
  sheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '82%',
    maxWidth: 430,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 18,
    width: '100%',
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '800', lineHeight: 26 },
  subtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  closeButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  periodSwitch: { borderRadius: 12, flexDirection: 'row', marginTop: 16, padding: 4 },
  periodButton: { alignItems: 'center', borderRadius: 9, flex: 1, minHeight: 38, justifyContent: 'center' },
  periodText: { fontSize: 13, fontWeight: '800' },
  list: { flexShrink: 1, marginTop: 12, minHeight: 250 },
  listContent: { flexGrow: 1 },
  stateView: { alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 250, padding: 24 },
  stateText: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '800', marginTop: 2 },
  loginButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 16,
  },
  loginButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  entry: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    flexDirection: 'row',
    minHeight: 60,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  rankSlot: { alignItems: 'center', justifyContent: 'center', width: 34 },
  rankText: { fontSize: 13, fontWeight: '800' },
  userCopy: { flex: 1, marginLeft: 9, minWidth: 0 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  userName: { flexShrink: 1, fontSize: 13, fontWeight: '800' },
  userMeta: { fontSize: 10, lineHeight: 14, marginTop: 1 },
  meChip: { borderRadius: 7, paddingHorizontal: 5, paddingVertical: 2 },
  meText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  score: { fontSize: 16, fontVariant: ['tabular-nums'], fontWeight: '900', marginLeft: 8 },
});
