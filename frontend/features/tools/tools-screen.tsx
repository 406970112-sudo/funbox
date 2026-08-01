import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { identityPresentation } from '@/lib/identity';
import { appTools, initialToolRoles } from '@/mocks/app-data';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SectionHeading } from '@/shared/ui/section-heading';
import { SurfaceCard } from '@/shared/ui/surface-card';
import { ToolCard } from '@/shared/ui/tool-card';
import type { AppTool } from '@/types/app';

export function ToolsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { status: authStatus, user } = useAuth();
  const { visibleTools } = useFeatureAccess();
  const categories = Array.from(new Set(visibleTools.map((tool) => tool.category)));
  const showLockedMembershipTools = authStatus !== 'authenticated' || user?.role === 'normal';
  const lockedTools = showLockedMembershipTools
    ? appTools.filter((tool) => {
        if (tool.hiddenFromList || tool.status !== 'available') return false;
        const roles = initialToolRoles.get(tool.id) ?? [];
        return !roles.includes('normal') && roles.some((role) => role === 'vip' || role === 'svip');
      })
    : [];

  return (
    <MobileScreen>
      <PageHeader
        eyebrow="Tools"
        title="热门工具"
        subtitle="把独立能力沉淀成统一入口，当前已优先接入文字转语音，其它工具保留扩展位。"
      />

      <SurfaceCard style={styles.summaryCard}>
        <View style={styles.summaryHeader}>
          <ThemedText style={styles.summaryTitle}>本周活跃工具</ThemedText>
          <ThemedText style={[styles.summaryMeta, { color: colors.accent }]}>
            {visibleTools.length} 个模块
          </ThemedText>
        </View>
        <ThemedText
          numberOfLines={2}
          style={[styles.summaryBody, { color: colors.mutedText }]}>
          工具页负责承接热门能力、沉淀详情路由，并让后续能力接入保持同一套视觉和交互结构。
        </ThemedText>
        <View style={styles.categoryRow}>
          {categories.map((category) => (
            <View
              key={category}
              style={[
                styles.categoryChip,
                {
                  backgroundColor: colors.surfaceMuted,
                },
              ]}>
              <ThemedText style={[styles.categoryText, { color: colors.primary }]}>
                {category}
              </ThemedText>
            </View>
          ))}
        </View>
      </SurfaceCard>

      {lockedTools.length > 0 ? (
        <View style={styles.section}>
          <SectionHeading title="会员专属" actionLabel={`${lockedTools.length} 项待解锁`} />
          <View style={styles.toolList}>
            {lockedTools.map((tool) => (
              <LockedToolCard
                key={tool.id}
                onPress={() => router.push('/profile/membership' as Href)}
                tool={tool}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeading title="全部工具" actionLabel="统一路由" />
        <View style={styles.toolList}>
          {visibleTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} onPress={() => router.push(tool.route)} />
          ))}
        </View>
      </View>
    </MobileScreen>
  );
}

function LockedToolCard({ onPress, tool }: { onPress: () => void; tool: AppTool }) {
  const { colors } = useAppTheme();
  const memberRoles = (initialToolRoles.get(tool.id) ?? []).filter(
    (role) => role === 'vip' || role === 'svip',
  );
  const roleLabel = memberRoles.map((role) => identityPresentation(role).label).join(' / ');

  return (
    <Pressable
      accessibilityLabel={`${tool.name}，会员专属`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.lockedCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <View style={[styles.lockedIcon, { backgroundColor: `${tool.accentColor}18` }]}>
        <MaterialCommunityIcons name={tool.icon} size={22} color={tool.accentColor} />
        <View style={[styles.lockBadge, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="lock" size={10} color="#c9f36a" />
        </View>
      </View>
      <View style={styles.lockedCopy}>
        <ThemedText numberOfLines={1} style={styles.lockedTitle}>
          {tool.name}
        </ThemedText>
        <ThemedText numberOfLines={1} style={[styles.lockedDesc, { color: colors.mutedText }]}>
          {tool.tagline}
        </ThemedText>
      </View>
      <View style={styles.lockedSide}>
        <ThemedText style={[styles.lockedRoleText, { color: '#d99a31' }]}>{roleLabel}</ThemedText>
        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: 20,
    gap: 10,
    padding: 14,
  },
  summaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  summaryMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryBody: {
    fontSize: 13,
    lineHeight: 20,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  categoryChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    gap: 12,
  },
  lockedCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    padding: 14,
  },
  lockedCopy: {
    flex: 1,
    minWidth: 0,
  },
  lockedDesc: {
    fontSize: 11,
    marginTop: 3,
  },
  lockedIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    position: 'relative',
    width: 44,
  },
  lockBadge: {
    alignItems: 'center',
    borderRadius: 9,
    bottom: -5,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -5,
    width: 18,
  },
  lockedRoleText: {
    fontSize: 10,
    fontWeight: '900',
  },
  lockedSide: {
    alignItems: 'flex-end',
    gap: 4,
  },
  lockedTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  toolList: {
    gap: 10,
  },
});
