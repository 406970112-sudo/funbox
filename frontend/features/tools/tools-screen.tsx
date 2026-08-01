import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SectionHeading } from '@/shared/ui/section-heading';
import { SurfaceCard } from '@/shared/ui/surface-card';
import { ToolCard } from '@/shared/ui/tool-card';

export function ToolsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { visibleTools } = useFeatureAccess();
  const categories = Array.from(new Set(visibleTools.map((tool) => tool.category)));

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
  toolList: {
    gap: 10,
  },
});
