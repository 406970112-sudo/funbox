import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { type Href, useRouter } from 'expo-router';
import { type ComponentProps, useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getGameById, getToolById, popularGames } from '@/mocks/app-data';
import { getStoredRecentUsage } from '@/lib/recent-usage-storage';
import type { RecentUsageItem } from '@/lib/recent-usage';
import { MobileScreen } from '@/shared/ui/mobile-screen';

const playableGameCount = popularGames.filter((game) => game.status === 'playable').length;

type RecentUsageDisplayItem = {
  accentColor: string;
  actionLabel: string;
  description: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  id: string;
  route: Href;
  title: string;
};

export function ProfileScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { signOut, status, user } = useAuth();
  const { visibleTools } = useFeatureAccess();
  const [recentUsage, setRecentUsage] = useState<RecentUsageItem[]>([]);
  const isAuthenticated = status === 'authenticated' && user !== null;
  const visibleToolIDs = new Set(visibleTools.map((tool) => tool.id));
  const availableToolCount = visibleTools.filter((tool) => tool.status === 'available').length;

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void getStoredRecentUsage().then((items) => {
        if (active) setRecentUsage(items);
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const recentItems = recentUsage.flatMap<RecentUsageDisplayItem>((item) => {
    if (item.kind === 'tool') {
      if (!visibleToolIDs.has(item.itemId)) return [];

      const tool = getToolById(item.itemId);
      if (!tool || tool.status !== 'available') return [];

      return [{
        accentColor: tool.accentColor,
        actionLabel: '再次使用',
        description: tool.tagline,
        icon: tool.icon,
        id: `tool:${tool.id}`,
        route: tool.route,
        title: tool.name,
      }];
    }

    const game = getGameById(item.itemId);
    if (!game || game.status !== 'playable') return [];

    return [{
      accentColor: game.accentColor,
      actionLabel: '继续游戏',
      description: game.genre,
      icon: 'gamepad-variant-outline',
      id: `game:${game.id}`,
      route: game.route,
      title: game.name,
    }];
  });

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.pageTitle}>我的</ThemedText>
          <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>个人工作台</ThemedText>
        </View>
        <View style={[styles.brandMark, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="cube-outline" size={18} color={colors.primary} />
          <ThemedText style={[styles.brandMarkText, { color: colors.primary }]}>FunBox</ThemedText>
        </View>
      </View>

      <View style={[styles.profileHero, { backgroundColor: colors.hero }]}>
        <View pointerEvents="none" style={styles.heroAccentBack} />
        <View pointerEvents="none" style={styles.heroAccentFront} />
        {status === 'loading' ? (
          <View style={styles.profileLoading}>
            <ActivityIndicator color="#ffffff" />
            <ThemedText style={styles.profileLoadingText}>正在读取账户</ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.profileHeaderRow}>
              <View style={styles.avatarWrap}>
                {isAuthenticated && user.avatarUrl ? (
                  <Image
                    contentFit="cover"
                    source={{ uri: user.avatarUrl }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <MaterialCommunityIcons name="account" size={28} color="#ffffff" />
                )}
              </View>
              <View style={styles.profileCopy}>
                <ThemedText style={styles.profileName}>
                  {isAuthenticated ? user.displayName : '登录 FunBox'}
                </ThemedText>
                <ThemedText style={styles.profileMeta}>
                  {isAuthenticated ? `@${user.username}` : '建立你的个人空间'}
                </ThemedText>
              </View>
              {isAuthenticated ? (
                <Pressable
                  accessibilityLabel="编辑个人资料"
                  accessibilityRole="button"
                  onPress={() => router.push('/profile/edit')}
                  style={styles.heroEditButton}>
                  <MaterialCommunityIcons name="pencil-outline" size={19} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>

            <ThemedText style={styles.profileSignature}>
              {isAuthenticated
                ? '欢迎回来，继续使用你的轻量工具箱。'
                : '登录后即可修改昵称、头像和账户密码。'}
            </ThemedText>

            {!isAuthenticated ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/auth')}
                style={({ pressed }) => [styles.heroLoginButton, { opacity: pressed ? 0.75 : 1 }]}>
                <ThemedText style={styles.heroLoginText}>登录 / 注册</ThemedText>
                <MaterialCommunityIcons name="arrow-right" size={18} color="#151b3b" />
              </Pressable>
            ) : null}

            <AvailabilitySummary availableToolCount={availableToolCount} />
          </>
        )}
      </View>

      {isAuthenticated ? (
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>账户</ThemedText>
          <View style={styles.accountActions}>
            <AccountAction
              icon="account-edit-outline"
              label="编辑资料"
              onPress={() => router.push('/profile/edit')}
            />
            <AccountAction
              icon="shield-key-outline"
              label="修改密码"
              onPress={() => router.push('/profile/security')}
            />
            {user.role === 'admin' ? (
              <AccountAction
                icon="shield-crown-outline"
                label="管理后台"
                onPress={() => router.push('/admin/permissions' as Href)}
              />
            ) : null}
            <AccountAction
              destructive
              icon="logout"
              label="退出登录"
              onPress={() => void signOut()}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>最近使用</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
            {recentItems.length} 项记录
          </ThemedText>
        </View>
        <View style={styles.activityList}>
          {recentItems.length > 0 ? recentItems.map((item) => (
            <Pressable
              accessibilityLabel={`${item.title}，${item.actionLabel}`}
              accessibilityRole="button"
              key={item.id}
              onPress={() => router.push(item.route)}
              style={({ pressed }) => [
                styles.activityRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.line,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}>
              <View style={[styles.activityIcon, { backgroundColor: `${item.accentColor}18` }]}>
                <MaterialCommunityIcons name={item.icon} size={24} color={item.accentColor} />
              </View>
              <View style={styles.activityCopy}>
                <ThemedText numberOfLines={1} style={styles.activityTitle}>
                  {item.title}
                </ThemedText>
                <ThemedText
                  numberOfLines={1}
                  style={[styles.activityDescription, { color: colors.mutedText }]}>
                  {item.description}
                </ThemedText>
              </View>
              <View style={styles.activityAction}>
                <ThemedText style={[styles.activityActionText, { color: item.accentColor }]}>
                  {item.actionLabel}
                </ThemedText>
                <MaterialCommunityIcons name="arrow-right" size={18} color={item.accentColor} />
              </View>
            </Pressable>
          )) : (
            <View style={[styles.emptyActivity, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={[styles.emptyActivityIcon, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="history" size={24} color={colors.mutedText} />
              </View>
              <View style={styles.activityCopy}>
                <ThemedText style={styles.activityTitle}>还没有使用记录</ThemedText>
                <ThemedText style={[styles.activityDescription, { color: colors.mutedText }]}>
                  打开一个工具或游戏后会显示在这里
                </ThemedText>
              </View>
            </View>
          )}
        </View>
      </View>
    </MobileScreen>
  );
}

function AvailabilitySummary({ availableToolCount }: { availableToolCount: number }) {
  return (
    <View style={styles.availabilityRow}>
      <View style={styles.availabilityItem}>
        <ThemedText style={styles.availabilityValue}>{availableToolCount}</ThemedText>
        <ThemedText style={styles.availabilityLabel}>可用工具</ThemedText>
      </View>
      <View style={styles.availabilityDivider} />
      <View style={styles.availabilityItem}>
        <ThemedText style={styles.availabilityValue}>{playableGameCount}</ThemedText>
        <ThemedText style={styles.availabilityLabel}>可玩游戏</ThemedText>
      </View>
    </View>
  );
}

type AccountActionProps = {
  destructive?: boolean;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
};

function AccountAction({ destructive = false, icon, label, onPress }: AccountActionProps) {
  const { colors } = useAppTheme();
  const accentColor = destructive ? '#d86f5b' : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.accountAction,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          opacity: pressed ? 0.72 : 1,
        },
      ]}>
      <View style={[styles.accountActionIcon, { backgroundColor: `${accentColor}18` }]}>
        <MaterialCommunityIcons name={icon} size={20} color={accentColor} />
      </View>
      <ThemedText style={[styles.accountActionLabel, destructive ? { color: accentColor } : null]}>
        {label}
      </ThemedText>
      <MaterialCommunityIcons name="chevron-right" size={21} color={colors.mutedText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 20,
    paddingTop: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 4,
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  brandMarkText: {
    fontSize: 12,
    fontWeight: '800',
  },
  profileHero: {
    borderRadius: 28,
    overflow: 'hidden',
    padding: 22,
    position: 'relative',
  },
  heroAccentBack: {
    backgroundColor: 'rgba(75,107,255,0.32)',
    borderRadius: 24,
    height: 180,
    position: 'absolute',
    right: -44,
    top: -58,
    transform: [{ rotate: '18deg' }],
    width: 112,
  },
  heroAccentFront: {
    backgroundColor: 'rgba(255,107,143,0.28)',
    borderRadius: 18,
    height: 108,
    position: 'absolute',
    right: 18,
    top: -40,
    transform: [{ rotate: '-18deg' }],
    width: 58,
  },
  profileHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  avatarWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    height: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 60,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  profileCopy: {
    flex: 1,
    gap: 4,
  },
  profileName: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  profileMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
  },
  profileSignature: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 18,
    maxWidth: 278,
  },
  profileLoading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 126,
  },
  profileLoadingText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
  },
  heroEditButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 15,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  heroLoginButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 7,
    marginTop: 16,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  heroLoginText: {
    color: '#151b3b',
    fontSize: 13,
    fontWeight: '800',
  },
  availabilityRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 18,
    flexDirection: 'row',
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  availabilityItem: {
    alignItems: 'baseline',
    flex: 1,
    flexDirection: 'row',
    gap: 7,
  },
  availabilityValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  availabilityLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
  },
  availabilityDivider: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    height: 22,
    marginHorizontal: 14,
    width: 1,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  sectionMeta: {
    fontSize: 12,
  },
  accountActions: {
    gap: 8,
  },
  accountAction: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 62,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  accountActionIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  accountActionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  activityList: {
    gap: 10,
  },
  emptyActivity: {
    alignItems: 'center',
    borderRadius: 20,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 82,
    padding: 14,
  },
  emptyActivityIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  activityRow: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 82,
    padding: 14,
  },
  activityIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  activityCopy: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  activityDescription: {
    fontSize: 12,
    marginTop: 5,
  },
  activityAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  activityActionText: {
    fontSize: 12,
    fontWeight: '800',
  },
});
