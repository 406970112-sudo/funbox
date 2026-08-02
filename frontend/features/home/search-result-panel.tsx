import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { splitHighlight, type HomeSearchEntry } from '@/lib/home-search';

type SearchResultPanelProps = {
  entries: HomeSearchEntry[];
  gameCount: number;
  onClear: () => void;
  onOpen: (entry: HomeSearchEntry) => void;
  onSelect: (index: number) => void;
  onViewAll: () => void;
  query: string;
  quick?: boolean;
  selectedIndex: number;
  toolCount: number;
};

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function SearchResultPanel({
  entries,
  gameCount,
  onClear,
  onOpen,
  onSelect,
  onViewAll,
  query,
  quick = false,
  selectedIndex,
  toolCount,
}: SearchResultPanelProps) {
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          shadowColor: colors.shadow,
        },
      ]}>
      {entries.length > 0 ? (
        <>
          <View style={[styles.panelHead, { backgroundColor: colors.surfaceMuted }]}>
            <ThemedText style={[styles.panelHeadTitle, { color: colors.text }]}>
              {quick ? '快速直达' : '搜索结果'}
            </ThemedText>
            <ThemedText style={[styles.panelHeadMeta, { color: colors.mutedText }]}>
              {quick ? '最近使用记录' : `${toolCount} 个工具 · ${gameCount} 款游戏`}
            </ThemedText>
          </View>

          {entries.map((entry, index) => (
            <SearchResultRow
              entry={entry}
              key={`${entry.kind}:${entry.id}`}
              onOpen={() => onOpen(entry)}
              onSelect={() => onSelect(index)}
              query={quick ? '' : query}
              selected={selectedIndex === index}
            />
          ))}

          {!quick ? (
            <Pressable
              accessibilityLabel="在全部工具中查看"
              accessibilityRole="button"
              onPress={onViewAll}
              style={({ pressed }) => [
                styles.panelFoot,
                { backgroundColor: colors.surfaceMuted },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={[styles.panelFootCount, { color: colors.mutedText }]}>
                与下方过滤结果一致
              </ThemedText>
              <View style={styles.panelFootAction}>
                <ThemedText style={[styles.panelFootText, { color: colors.primary }]}>
                  在全部工具中查看
                </ThemedText>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={15}
                  color={colors.primary}
                />
              </View>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="magnify-close" size={22} color={colors.mutedText} />
          </View>
          <ThemedText style={styles.emptyTitle}>
            没有找到与「{query}」匹配的工具或游戏
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.mutedText }]}>
            换个关键词，或直接浏览全部工具
          </ThemedText>
          <View style={styles.emptyActions}>
            <Pressable
              accessibilityLabel="清空关键词"
              accessibilityRole="button"
              onPress={onClear}
              style={({ pressed }) => [
                styles.emptyButton,
                { borderColor: colors.line },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={[styles.emptyButtonText, { color: colors.text }]}>
                清空关键词
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityLabel="在全部工具中查看"
              accessibilityRole="button"
              onPress={onViewAll}
              style={({ pressed }) => [
                styles.emptyButton,
                styles.emptyButtonPrimary,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={[styles.emptyButtonText, { color: '#ffffff' }]}>
                在全部工具中查看
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function SearchResultRow({
  entry,
  onOpen,
  onSelect,
  query,
  selected,
}: {
  entry: HomeSearchEntry;
  onOpen: () => void;
  onSelect: () => void;
  query: string;
  selected: boolean;
}) {
  const { colors } = useAppTheme();
  const segments = splitHighlight(entry.name, query);

  return (
    <Pressable
      accessibilityLabel={`打开${entry.name}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onOpen}
      onPressIn={onSelect}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: colors.primarySoft },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.rowIcon, { backgroundColor: `${entry.accentColor}18` }]}>
        <MaterialCommunityIcons
          name={entry.icon as IconName}
          size={19}
          color={entry.accentColor}
        />
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowNameLine}>
          <Text numberOfLines={1} style={[styles.rowName, { color: colors.text }]}>
            {segments.map((segment, index) => (
              <Text
                key={`${index}:${segment.text}`}
                style={segment.match ? styles.highlighted : undefined}>
                {segment.text}
              </Text>
            ))}
          </Text>
          <View style={[styles.rowTag, { backgroundColor: colors.surfaceMuted }]}>
            <ThemedText numberOfLines={1} style={[styles.rowTagText, { color: colors.primary }]}>
              {entry.kind === 'tool' ? entry.category : '游戏'}
            </ThemedText>
          </View>
        </View>
        <ThemedText numberOfLines={1} style={[styles.rowSubtitle, { color: colors.mutedText }]}>
          {entry.tagline}
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 14,
    borderWidth: 1,
    elevation: 6,
    overflow: 'hidden',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  panelHead: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 34,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  panelHeadTitle: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 18,
  },
  panelHeadMeta: {
    fontSize: 10.5,
    fontWeight: '700',
    lineHeight: 16,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowNameLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minWidth: 0,
  },
  rowName: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  highlighted: {
    backgroundColor: '#ffe58a',
    borderRadius: 3,
  },
  rowTag: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rowTagText: {
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 12,
  },
  rowSubtitle: {
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 2,
  },
  panelFoot: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 40,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  panelFootCount: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  panelFootAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  panelFootText: {
    fontSize: 11,
    fontWeight: '900',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    marginBottom: 10,
    width: 42,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 19,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 4,
    textAlign: 'center',
  },
  emptyActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 13,
  },
  emptyButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  emptyButtonPrimary: {
    borderColor: 'transparent',
  },
  emptyButtonText: {
    fontSize: 11,
    fontWeight: '900',
  },
  pressed: {
    opacity: 0.72,
  },
});
