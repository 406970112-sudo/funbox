import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { IconBadge } from '@/shared/ui/icon-badge';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type { AppTool } from '@/types/app';

type ToolCardProps = {
  tool: AppTool;
  compact?: boolean;
  onPress?: () => void;
};

export function ToolCard({ tool, compact = false, onPress }: ToolCardProps) {
  const { colors } = useAppTheme();
  const content = compact ? (
    <View style={styles.compactContent}>
      <IconBadge icon={tool.icon} color={tool.accentColor} />
      <ThemedText numberOfLines={1} style={styles.compactTitle}>
        {tool.name}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.compactSubtitle, { color: colors.mutedText }]}>
        {tool.tagline}
      </ThemedText>
    </View>
  ) : (
    <View style={styles.featureContent}>
      <View style={styles.featureHeader}>
        <IconBadge icon={tool.icon} color={tool.accentColor} />
        <View style={styles.featureHeading}>
          <ThemedText numberOfLines={1} style={styles.featureTitle}>
            {tool.name}
          </ThemedText>
          <ThemedText
            numberOfLines={1}
            style={[styles.featureTagline, { color: colors.mutedText }]}>
            {tool.tagline}
          </ThemedText>
        </View>
        <View style={styles.badgeRow}>
          {tool.badges.map((badge) => (
            <View
              key={badge}
              style={[
                styles.badge,
                {
                  backgroundColor: colors.surfaceMuted,
                },
              ]}>
              <ThemedText style={[styles.badgeText, { color: tool.accentColor }]}>{badge}</ThemedText>
            </View>
          ))}
        </View>
      </View>
      <ThemedText
        numberOfLines={2}
        style={[styles.featureDescription, { color: colors.mutedText }]}>
        {tool.description}
      </ThemedText>
      <ThemedText style={[styles.featureAction, { color: tool.accentColor }]}>
        {tool.usageLabel}
      </ThemedText>
    </View>
  );

  return (
    <Pressable onPress={onPress}>
      <SurfaceCard style={compact ? styles.compactCard : styles.featureCard}>{content}</SurfaceCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    padding: 12,
  },
  compactContent: {
    gap: 8,
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  compactSubtitle: {
    fontSize: 11,
    lineHeight: 16,
  },
  featureCard: {
    borderRadius: 20,
    padding: 14,
  },
  featureContent: {
    gap: 10,
  },
  featureHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  featureHeading: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'flex-end',
    maxWidth: '43%',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  featureTagline: {
    fontSize: 12,
    fontWeight: '600',
  },
  featureDescription: {
    fontSize: 13,
    lineHeight: 19,
  },
  featureAction: {
    fontSize: 13,
    fontWeight: '700',
  },
});
