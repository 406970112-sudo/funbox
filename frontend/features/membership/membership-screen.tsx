import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { Redirect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { identityPresentation } from '@/lib/identity';
import { appTools, initialToolRoles, popularGames } from '@/mocks/app-data';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { UserRole } from '@/types/access';

const playableGameCount = popularGames.filter((game) => game.status === 'playable').length;
const comparisonTools = appTools.filter((tool) => !tool.hiddenFromList).slice(0, 5);

export function MembershipScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const { refreshUser, status, user } = useAuth();
  const { visibleTools } = useFeatureAccess();

  useFocusEffect(
    useCallback(() => {
      void refreshUser();
    }, [refreshUser]),
  );

  if (status === 'loading') {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || !user) {
    return <Redirect href="/auth" />;
  }

  const role = user.role;
  const item = identityPresentation(role, colorScheme);
  const palette = membershipPalette(role, colorScheme === 'dark');
  const availableTools = visibleTools.filter((tool) => tool.status === 'available');
  const upgradeTools = appTools.filter((tool) => {
    if (tool.hiddenFromList) return false;
    const roles = initialToolRoles.get(tool.id) ?? [];
    return (
      !roles.includes('normal') &&
      roles.some((candidate) => candidate === 'vip' || candidate === 'svip')
    );
  }).slice(0, 6);

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.topBarCopy}>
          <ThemedText style={styles.pageTitle}>会员中心</ThemedText>
          <ThemedText style={[styles.pageSubtitle, { color: colors.mutedText }]}>
            我的身份与全部权益
          </ThemedText>
        </View>
        <View style={[styles.brandMark, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="cube-outline" size={18} color={colors.primary} />
          <ThemedText style={[styles.brandMarkText, { color: colors.primary }]}>FunBox</ThemedText>
        </View>
      </View>

      <View style={[styles.hero, { backgroundColor: palette.background }]}>
        <View style={[styles.heroIcon, { backgroundColor: palette.iconBackground }]}>
          <MaterialCommunityIcons name={item.icon} size={24} color={palette.iconColor} />
        </View>
        <ThemedText style={[styles.heroTitle, { color: palette.title }]}>{item.cardTitle}</ThemedText>
        <ThemedText style={[styles.heroSubtitle, { color: palette.subtitle }]}>
          {item.description}
        </ThemedText>
        <View style={styles.heroChips}>
          <HeroChip label="可用工具" value={`${availableTools.length} 个`} />
          <HeroChip label="可玩游戏" value={`${playableGameCount} 个`} />
          <HeroChip label="到期时间" value="暂无" />
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.panelHead}>
          <ThemedText style={styles.panelTitle}>我的权益</ThemedText>
          <ThemedText style={[styles.panelMeta, { color: colors.mutedText }]}>
            {availableTools.length} 项
          </ThemedText>
        </View>
        {availableTools.length > 0 ? (
          <View>
            {availableTools.slice(0, 6).map((tool) => (
              <View key={tool.id} style={[styles.benefitRow, { borderTopColor: colors.line }]}>
                <View style={[styles.benefitIcon, { backgroundColor: `${tool.accentColor}18` }]}>
                  <MaterialCommunityIcons name={tool.icon} size={16} color={tool.accentColor} />
                </View>
                <View style={styles.benefitCopy}>
                  <ThemedText style={styles.benefitName}>{tool.name}</ThemedText>
                  <ThemedText style={[styles.benefitDesc, { color: colors.mutedText }]}>
                    {tool.tagline}
                  </ThemedText>
                </View>
                <MaterialCommunityIcons name="check-circle" size={17} color={colors.success} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="shield-check-outline" size={24} color={colors.mutedText} />
            <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
              当前身份暂无额外权益
            </ThemedText>
          </View>
        )}
      </View>

      {role === 'normal' && upgradeTools.length > 0 ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <ThemedText style={styles.panelTitle}>升级后可解锁</ThemedText>
            <ThemedText style={[styles.panelMeta, { color: colors.mutedText }]}>
              VIP / SVIP
            </ThemedText>
          </View>
          <View>
            {upgradeTools.map((tool) => {
              const memberRoles = (initialToolRoles.get(tool.id) ?? []).filter(
                (candidate) => candidate === 'vip' || candidate === 'svip',
              );
              return (
                <View key={tool.id} style={[styles.benefitRow, { borderTopColor: colors.line }]}>
                  <View style={[styles.benefitIcon, { backgroundColor: `${tool.accentColor}18` }]}>
                    <MaterialCommunityIcons name={tool.icon} size={16} color={tool.accentColor} />
                  </View>
                  <View style={styles.benefitCopy}>
                    <ThemedText style={styles.benefitName}>{tool.name}</ThemedText>
                    <ThemedText style={[styles.benefitDesc, { color: colors.mutedText }]}>
                      {tool.tagline}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.memberTag}>
                    {memberRoles.map((memberRole) => identityPresentation(memberRole).label).join(' / ')}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.panelHead}>
          <ThemedText style={styles.panelTitle}>权益对比</ThemedText>
          <ThemedText style={[styles.panelMeta, { color: colors.mutedText }]}>
            按入口权限配置展示
          </ThemedText>
        </View>
        <View style={[styles.compareHead, { borderTopColor: colors.line }]}>
          <ThemedText style={styles.compareHeadText}>功能</ThemedText>
          <ThemedText style={styles.compareHeadText}>普通</ThemedText>
          <ThemedText style={styles.compareHeadText}>VIP</ThemedText>
          <ThemedText style={styles.compareHeadText}>SVIP</ThemedText>
        </View>
        {comparisonTools.map((tool) => (
          <CompareRow
            key={tool.id}
            name={tool.name}
            roles={(initialToolRoles.get(tool.id) ?? []) as UserRole[]}
          />
        ))}
      </View>
    </MobileScreen>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroChip}>
      <ThemedText style={styles.heroChipLabel}>{label}</ThemedText>
      <ThemedText style={styles.heroChipValue}>{value}</ThemedText>
    </View>
  );
}

function CompareRow({ name, roles }: { name: string; roles: UserRole[] }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.compareRow, { borderTopColor: colors.line }]}>
      <ThemedText numberOfLines={1} style={styles.compareName}>
        {name}
      </ThemedText>
      <View style={styles.compareMarkCell}>
        <AccessMark available={roles.includes('normal')} />
      </View>
      <View style={styles.compareMarkCell}>
        <AccessMark available={roles.includes('vip')} />
      </View>
      <View style={styles.compareMarkCell}>
        <AccessMark available={roles.includes('svip')} />
      </View>
    </View>
  );
}

function AccessMark({ available }: { available: boolean }) {
  const { colors } = useAppTheme();
  return (
    <MaterialCommunityIcons
      name={available ? 'check-circle' : 'minus-circle-outline'}
      size={16}
      color={available ? colors.success : colors.mutedText}
    />
  );
}

function membershipPalette(role: UserRole, dark: boolean) {
  if (role === 'admin') {
    return {
      background: '#151b3b',
      iconBackground: 'rgba(201,243,106,0.16)',
      iconColor: '#c9f36a',
      subtitle: 'rgba(255,255,255,0.68)',
      title: '#ffffff',
    };
  }
  if (role === 'vip') {
    return {
      background: dark ? '#3a2b10' : '#b97c1d',
      iconBackground: 'rgba(255,255,255,0.2)',
      iconColor: dark ? '#f2c14e' : '#ffffff',
      subtitle: dark ? '#d9bd8a' : 'rgba(255,255,255,0.82)',
      title: dark ? '#f2c14e' : '#ffffff',
    };
  }
  if (role === 'svip') {
    return {
      background: dark ? '#3a1b24' : '#c25467',
      iconBackground: 'rgba(255,255,255,0.2)',
      iconColor: dark ? '#ff8ba3' : '#ffffff',
      subtitle: dark ? '#dda6b0' : 'rgba(255,255,255,0.82)',
      title: dark ? '#ff8ba3' : '#ffffff',
    };
  }
  return {
    background: dark ? '#1d2730' : '#4a5568',
    iconBackground: 'rgba(255,255,255,0.16)',
    iconColor: '#cbd5e1',
    subtitle: dark ? '#aebccb' : 'rgba(255,255,255,0.78)',
    title: '#ffffff',
  };
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
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  topBarCopy: {
    flex: 1,
    marginLeft: 10,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 3,
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
  hero: {
    borderRadius: 24,
    padding: 20,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  heroTitle: {
    fontSize: 21,
    fontWeight: '900',
    marginTop: 14,
  },
  heroSubtitle: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  heroChips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  heroChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 11,
    flex: 1,
    minHeight: 48,
    padding: 10,
  },
  heroChipLabel: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 9,
    fontWeight: '700',
  },
  heroChipValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 5,
  },
  panel: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  panelHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 30,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  panelMeta: {
    fontSize: 10,
    fontWeight: '700',
  },
  benefitRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 58,
    paddingVertical: 9,
  },
  benefitIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  benefitCopy: {
    flex: 1,
    minWidth: 0,
  },
  benefitName: {
    fontSize: 12,
    fontWeight: '800',
  },
  benefitDesc: {
    fontSize: 10,
    marginTop: 3,
  },
  memberTag: {
    color: '#d99a31',
    fontSize: 10,
    fontWeight: '900',
  },
  emptyState: {
    alignItems: 'center',
    gap: 7,
    paddingVertical: 20,
  },
  emptyText: {
    fontSize: 11,
  },
  compareHead: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: 6,
    minHeight: 34,
  },
  compareHeadText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
  },
  compareRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 42,
  },
  compareName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    paddingRight: 8,
  },
  compareMarkCell: {
    alignItems: 'center',
    flex: 1,
  },
});
