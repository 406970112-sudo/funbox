import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputKeyPressEventData,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useFeatureAccess } from '@/features/access/feature-access-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  HOME_ALL_CATEGORY,
  HOME_RECENT_TOOL_LIMIT,
  HOME_TOOLS_VISIBLE_LIMIT,
  canExpandToolGrid,
  filterMergedTools,
  getMergedToolCategories,
  getRecentToolIds,
  getToolGridExpandLabel,
  getToolGridSlice,
} from '@/lib/home-tools-catalog';
import {
  getHomeSearchSlice,
  getQuickSearchEntries,
  searchHomeEntries,
  type HomeSearchEntry,
} from '@/lib/home-search';
import { prefetchFeatureRoutes } from '@/lib/route-prefetch';
import { getStoredRecentUsage } from '@/lib/recent-usage-storage';
import type { RecentUsageItem } from '@/lib/recent-usage';
import { getStoredToolUsage } from '@/lib/tool-usage-storage';
import type { ToolUsageStat } from '@/lib/tool-usage';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { AppTool, GameItem } from '@/types/app';

import { GameArtwork } from './game-artwork';
import { RecommendationCarousel } from './recommendation-carousel';
import { SearchResultPanel } from './search-result-panel';

const GAME_LIST_GAP = 10;
const GAME_CARD_WIDTH_RATIO = 0.29;
const BOTTOM_EXTRA_PADDING = 16;

type SectionHeaderProps = {
  actionLabel?: string;
  meta?: string;
  onActionPress?: () => void;
  title: string;
};

function SectionHeader({
  actionLabel,
  meta,
  onActionPress,
  title,
}: SectionHeaderProps) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeadingCopy}>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        {meta ? (
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>{meta}</ThemedText>
        ) : null}
      </View>
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          hitSlop={10}
          onPress={onActionPress}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}>
          <ThemedText style={[styles.sectionActionText, { color: colors.text }]}>
            {actionLabel}
          </ThemedText>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.text} />
        </Pressable>
      ) : actionLabel ? (
        <ThemedText style={[styles.sectionCount, { color: colors.mutedText }]}>
          {actionLabel}
        </ThemedText>
      ) : null}
    </View>
  );
}

function ToolTile({ tool, onPress }: { tool: AppTool; onPress: () => void }) {
  const { colors } = useAppTheme();
  const badge = tool.badges[0];

  return (
    <Pressable
      accessibilityLabel={`打开${tool.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolTile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.toolIcon, { backgroundColor: `${tool.accentColor}18` }]}>
        <MaterialCommunityIcons name={tool.icon} size={20} color={tool.accentColor} />
      </View>
      <ThemedText numberOfLines={1} style={styles.toolTitle}>
        {tool.name}
      </ThemedText>
      {badge ? (
        <View style={[styles.toolBadge, { backgroundColor: colors.surfaceMuted }]}>
          <ThemedText
            numberOfLines={1}
            style={[styles.toolBadgeText, { color: tool.accentColor }]}>
            {badge}
          </ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

function CategoryChip({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.categoryChip,
        {
          backgroundColor: selected ? colors.primary : colors.surface,
          borderColor: selected ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText
        style={[
          styles.categoryChipText,
          { color: selected ? '#ffffff' : colors.mutedText },
        ]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function RecentToolTile({
  timeLabel,
  tool,
  onPress,
}: {
  timeLabel: string;
  tool: AppTool;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`打开${tool.name}，${timeLabel}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.recentTile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.recentIcon, { backgroundColor: `${tool.accentColor}18` }]}>
        <MaterialCommunityIcons name={tool.icon} size={17} color={tool.accentColor} />
      </View>
      <ThemedText numberOfLines={1} style={styles.recentName}>
        {tool.name}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.recentTime, { color: colors.mutedText }]}>
        {timeLabel}
      </ThemedText>
    </Pressable>
  );
}

function GameTile({
  game,
  onPress,
  width,
}: {
  game: GameItem;
  onPress: () => void;
  width: number;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`打开${game.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.gameTile,
        { backgroundColor: colors.surface, borderColor: colors.line, width },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.gameVisual, { backgroundColor: `${game.accentColor}1c` }]}>
        <View style={styles.gameArtwork}>
          <GameArtwork
            accentColor={game.accentColor}
            contrastColor={colors.text}
            gameId={game.id}
            mutedColor={colors.mutedText}
          />
        </View>
      </View>
      <ThemedText numberOfLines={1} style={styles.gameTitle}>
        {game.name}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.gameGenre, { color: colors.mutedText }]}>
        {game.genre}
      </ThemedText>
    </Pressable>
  );
}

function MembershipPromo({ onPress }: { onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel="会员中心，查看权益"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.membershipCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.membershipIcon, { backgroundColor: `${colors.accent}1f` }]}>
        <MaterialCommunityIcons name="lock" size={16} color={colors.accent} />
      </View>
      <View style={styles.membershipCopy}>
        <ThemedText style={styles.membershipTitle}>会员中心</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.membershipDesc, { color: colors.mutedText }]}>
          解锁更多效率与 AI 能力
        </ThemedText>
      </View>
      <ThemedText style={[styles.membershipCta, { color: colors.accent }]}>查看权益</ThemedText>
    </Pressable>
  );
}

function formatRecentTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function HomeScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { visibleGames, visibleTools } = useFeatureAccess();
  const { status: authStatus, user } = useAuth();
  const [toolUsage, setToolUsage] = useState<ToolUsageStat[]>([]);
  const [activeCategory, setActiveCategory] = useState(HOME_ALL_CATEGORY);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(-1);
  const [recentUsage, setRecentUsage] = useState<RecentUsageItem[]>([]);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const searchInputRef = useRef<TextInput>(null);
  const toolsSectionYRef = useRef(0);

  const availableTools = useMemo(
    () => visibleTools.filter((tool) => tool.status === 'available'),
    [visibleTools],
  );
  const visibleFeatureIDs = useMemo(
    () =>
      new Set([
        ...visibleTools.map((tool) => tool.id),
        ...visibleGames.map((game) => game.id),
      ]),
    [visibleGames, visibleTools],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchMode = normalizedSearchQuery.length > 0;
  const categories = useMemo(() => getMergedToolCategories(availableTools), [availableTools]);
  const filteredTools = useMemo(
    () => filterMergedTools(availableTools, searchMode ? HOME_ALL_CATEGORY : activeCategory, searchQuery),
    [activeCategory, availableTools, searchMode, searchQuery],
  );
  const visibleToolsForGrid = useMemo(
    () => getToolGridSlice(filteredTools, toolsExpanded),
    [filteredTools, toolsExpanded],
  );
  const showToolExpand = useMemo(() => canExpandToolGrid(filteredTools), [filteredTools]);
  const toolExpandLabel = useMemo(
    () => getToolGridExpandLabel(filteredTools, toolsExpanded),
    [filteredTools, toolsExpanded],
  );
  const recentToolIds = useMemo(
    () =>
      getRecentToolIds(
        availableTools.map((tool) => tool.id),
        toolUsage,
        HOME_RECENT_TOOL_LIMIT,
      ),
    [availableTools, toolUsage],
  );
  const recentTools = useMemo(() => {
    const byId = new Map(availableTools.map((tool) => [tool.id, tool]));
    return recentToolIds.flatMap((toolId) => {
      const tool = byId.get(toolId);
      return tool ? [tool] : [];
    });
  }, [availableTools, recentToolIds]);
  const playableGames = visibleGames.slice(0, 5);
  const filteredGames = useMemo(() => {
    if (!normalizedSearchQuery) return playableGames;
    return playableGames.filter((game) =>
      `${game.name} ${game.genre}`.toLowerCase().includes(normalizedSearchQuery),
    );
  }, [normalizedSearchQuery, playableGames]);
  const searchEntries = useMemo(
    () => searchHomeEntries(availableTools, playableGames, searchQuery, toolUsage),
    [availableTools, playableGames, searchQuery, toolUsage],
  );
  const panelSearchEntries = useMemo(() => getHomeSearchSlice(searchEntries), [searchEntries]);
  const toolResultCount = searchEntries.filter((entry) => entry.kind === 'tool').length;
  const gameResultCount = searchEntries.length - toolResultCount;
  const quickSearchEntries = useMemo(
    () => getQuickSearchEntries(availableTools, playableGames, recentUsage),
    [availableTools, playableGames, recentUsage],
  );
  const searchPanelOpen = searchMode && (searchFocused || selectedSearchIndex >= 0);
  const showMembershipPromo = authStatus !== 'authenticated' || user?.role === 'normal';
  const availableToolCount = availableTools.length;
  const gameCount = playableGames.length;
  const gameSectionMeta = normalizedSearchQuery
    ? `${filteredGames.length} 款匹配游戏`
    : `${filteredGames.length} 款可玩小游戏，随时开一局`;
  const brandCount =
    gameCount > 0 ? `${availableToolCount} 个工具 · ${gameCount} 款游戏` : `${availableToolCount} 个工具`;
  const contentWidth = Math.min(windowWidth, appLayout.screenMaxWidth) - 32;
  const gameCardWidth = Math.round(contentWidth * GAME_CARD_WIDTH_RATIO);
  const bottomPadding = appLayout.tabBarHeight + insets.bottom + BOTTOM_EXTRA_PADDING;

  useFocusEffect(
    useCallback(() => {
      let active = true;

      prefetchFeatureRoutes(
        [
          ...visibleTools
            .filter((tool) => tool.status === 'available')
            .map((tool) => tool.route),
          ...visibleGames.map((game) => game.route),
        ],
      );

      void Promise.all([getStoredToolUsage(), getStoredRecentUsage()]).then(
        ([usageItems, recentItems]) => {
          if (active) {
            setToolUsage(usageItems);
            setRecentUsage(recentItems);
          }
        },
      );

      return () => {
        active = false;
      };
    }, [visibleGames, visibleTools]),
  );

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setToolsExpanded(false);
    setSelectedSearchIndex(-1);
    setSearchFocused(true);
  }

  function handleClearSearch() {
    setSearchQuery('');
    setToolsExpanded(false);
    setSelectedSearchIndex(-1);
    setSearchFocused(false);
    searchInputRef.current?.blur();
  }

  function handleOpenSearchEntry(entry: HomeSearchEntry) {
    setSearchFocused(false);
    setSelectedSearchIndex(-1);
    searchInputRef.current?.blur();
    router.push(entry.route as Href);
  }

  function handleViewAllResults() {
    setSearchFocused(false);
    setSelectedSearchIndex(-1);
    setToolsExpanded(true);
    searchInputRef.current?.blur();
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, toolsSectionYRef.current - 8),
      });
    });
  }

  function handleSearchKeyPress(event: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (!searchMode) return;
    const key = event.nativeEvent.key;

    if (key === 'ArrowDown') {
      setSelectedSearchIndex((index) => Math.min(index + 1, searchEntries.length - 1));
      return;
    }
    if (key === 'ArrowUp') {
      setSelectedSearchIndex((index) => Math.max(index - 1, -1));
      return;
    }
    if (key === 'Enter') {
      const target =
        selectedSearchIndex >= 0 ? searchEntries[selectedSearchIndex] : searchEntries[0];
      if (target) handleOpenSearchEntry(target);
      return;
    }
    if (key === 'Escape') {
      setSearchFocused(false);
      setSelectedSearchIndex(-1);
      searchInputRef.current?.blur();
    }
  }

  function handleCategoryPress(category: string) {
    setActiveCategory(category);
    setToolsExpanded(false);
  }

  return (
    <MobileScreen
      contentContainerStyle={styles.pageContent}
      scrollViewRef={scrollRef}
      scrollContentStyle={{ paddingBottom: bottomPadding }}>
      <View style={styles.topBar}>
        <View style={styles.brandLockup}>
          <View
            style={[
              styles.brandMark,
              { backgroundColor: colorScheme === 'dark' ? '#c9f36a' : '#18211f' },
            ]}>
            <MaterialCommunityIcons
              name="cube-outline"
              size={21}
              color={colorScheme === 'dark' ? '#173a35' : '#ffffff'}
            />
          </View>
          <View>
            <ThemedText style={styles.brandTitle}>FunBox</ThemedText>
            <ThemedText style={[styles.brandSubtitle, { color: colors.mutedText }]}>
              工具与游戏，随手即用
            </ThemedText>
          </View>
        </View>
        <ThemedText style={[styles.libraryCount, { color: colors.mutedText }]}>
          {brandCount}
        </ThemedText>
      </View>

      <View
        style={[
          styles.searchShell,
          searchPanelOpen && styles.searchShellFocused,
          {
            backgroundColor: colors.surface,
            borderColor: searchPanelOpen ? colors.primary : colors.line,
          },
        ]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="搜索工具和游戏"
          onBlur={() => {
            setTimeout(() => {
              setSearchFocused(false);
            }, 150);
          }}
          onChangeText={handleSearchChange}
          onFocus={() => setSearchFocused(true)}
          onKeyPress={handleSearchKeyPress}
          placeholder="搜索工具、游戏或场景"
          placeholderTextColor={colors.mutedText}
          ref={searchInputRef}
          style={[styles.searchInput, { color: colors.text }]}
          value={searchQuery}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityLabel="清除搜索"
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleClearSearch}
            style={styles.searchClear}>
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.mutedText} />
          </Pressable>
        ) : null}
      </View>

      {searchPanelOpen ? (
        searchMode ? (
          <SearchResultPanel
            entries={panelSearchEntries}
            gameCount={gameResultCount}
            onClear={handleClearSearch}
            onOpen={handleOpenSearchEntry}
            onSelect={setSelectedSearchIndex}
            onViewAll={handleViewAllResults}
            query={searchQuery}
            selectedIndex={selectedSearchIndex}
            toolCount={toolResultCount}
          />
        ) : quickSearchEntries.length > 0 ? (
          <SearchResultPanel
            entries={quickSearchEntries}
            gameCount={quickSearchEntries.filter((entry) => entry.kind === 'game').length}
            onClear={handleClearSearch}
            onOpen={handleOpenSearchEntry}
            onSelect={setSelectedSearchIndex}
            onViewAll={handleViewAllResults}
            query=""
            quick
            selectedIndex={selectedSearchIndex}
            toolCount={quickSearchEntries.filter((entry) => entry.kind === 'tool').length}
          />
        ) : null
      ) : null}

      {!searchMode ? (
        <View style={styles.section}>
          <RecommendationCarousel visibleFeatureIDs={visibleFeatureIDs} />
        </View>
      ) : null}

      {!searchMode && recentTools.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            actionLabel="查看全部"
            onActionPress={() => router.push('/tools')}
            title="最近使用"
          />
          <View style={styles.recentRow}>
            {recentTools.map((tool) => {
              const usage = toolUsage.find((item) => item.toolId === tool.id);
              return (
                <RecentToolTile
                  key={tool.id}
                  timeLabel={usage ? formatRecentTime(usage.lastClickedAt) : '最近'}
                  tool={tool}
                  onPress={() => router.push(tool.route)}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      <View
        onLayout={(event) => {
          toolsSectionYRef.current = event.nativeEvent.layout.y;
        }}
        pointerEvents={searchPanelOpen ? 'none' : 'auto'}
        style={searchPanelOpen ? styles.searchBodyDimmed : undefined}>
        <View style={styles.section}>
        <SectionHeader title="全部工具" actionLabel={`${filteredTools.length} 个工具`} />
        {!searchMode ? (
          <ScrollView
            contentContainerStyle={styles.categoryContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroller}>
            {[HOME_ALL_CATEGORY, ...categories].map((category) => (
              <CategoryChip
                key={category}
                label={category}
                selected={activeCategory === category}
                onPress={() => handleCategoryPress(category)}
              />
            ))}
          </ScrollView>
        ) : null}

        {filteredTools.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="magnify-close" size={22} color={colors.mutedText} />
            <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
              没有找到匹配工具
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.toolGrid}>
              {visibleToolsForGrid.map((tool) => (
                <ToolTile key={tool.id} tool={tool} onPress={() => router.push(tool.route)} />
              ))}
            </View>
            {showToolExpand ? (
              <Pressable
                accessibilityLabel={toolExpandLabel}
                accessibilityRole="button"
                accessibilityState={{ expanded: toolsExpanded }}
                onPress={() => setToolsExpanded((expanded) => !expanded)}
                style={({ pressed }) => [
                  styles.expandButton,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.line,
                  },
                  pressed && styles.pressed,
                ]}>
                <ThemedText style={[styles.expandButtonText, { color: colors.primary }]}>
                  {toolExpandLabel}
                </ThemedText>
                <MaterialCommunityIcons
                  name={toolsExpanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.primary}
                />
              </Pressable>
            ) : null}
          </>
        )}
        </View>

        {filteredGames.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader meta={gameSectionMeta} title="放松一下" />
            <FlatList
              contentContainerStyle={styles.gameListContent}
              data={filteredGames}
              horizontal
              ItemSeparatorComponent={() => <View style={styles.gameSeparator} />}
              keyExtractor={(game) => game.id}
              nestedScrollEnabled
              renderItem={({ item }) => (
                <GameTile
                  game={item}
                  width={gameCardWidth}
                  onPress={() => router.push(item.route)}
                />
              )}
              showsHorizontalScrollIndicator={false}
              style={styles.gameList}
            />
          </View>
        ) : null}

        {showMembershipPromo ? (
          <MembershipPromo onPress={() => router.push('/profile/membership')} />
        ) : null}
      </View>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 24,
    paddingTop: 16,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  brandTitle: {
    fontFamily: Platform.select({ android: 'serif', default: 'Georgia' }),
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 27,
  },
  brandSubtitle: {
    fontSize: 11,
    lineHeight: 16,
  },
  libraryCount: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  searchShell: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    height: 42,
    paddingHorizontal: 12,
  },
  searchShellFocused: {
    shadowColor: 'rgba(58, 86, 152, 0.16)',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 14,
  },
  searchBodyDimmed: {
    opacity: 0.38,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    minWidth: 0,
    paddingVertical: 10,
  },
  searchClear: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  section: {
    gap: 13,
  },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
  },
  sectionMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  sectionAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 44,
    paddingLeft: 12,
  },
  sectionActionText: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  recentRow: {
    flexDirection: 'row',
    gap: 10,
  },
  recentTile: {
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    minWidth: 0,
    padding: 10,
  },
  recentIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  recentName: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  recentTime: {
    fontSize: 10,
    lineHeight: 14,
  },
  categoryScroller: {
    flexGrow: 0,
  },
  categoryContent: {
    gap: 6,
    paddingRight: 8,
  },
  categoryChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  toolTile: {
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: '31%',
    gap: 7,
    minHeight: 104,
    minWidth: 0,
    padding: 10,
  },
  toolIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  toolTitle: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  toolBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    maxWidth: '100%',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  toolBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 12,
  },
  expandButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  expandButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 12,
    fontWeight: '700',
  },
  gameList: {
    flexGrow: 0,
  },
  gameListContent: {
    paddingRight: 8,
  },
  gameSeparator: {
    width: GAME_LIST_GAP,
  },
  gameTile: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  gameVisual: {
    alignItems: 'center',
    borderRadius: 12,
    height: 64,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 6,
  },
  gameArtwork: {
    height: 48,
    width: '100%',
  },
  gameTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  gameGenre: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  membershipCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    padding: 12,
  },
  membershipIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  membershipCopy: {
    flex: 1,
    minWidth: 0,
  },
  membershipTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  membershipDesc: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  membershipCta: {
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
