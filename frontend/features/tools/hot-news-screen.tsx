import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ImageStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { fetchNewsFeed } from '@/lib/news-api';
import { loadNewsPreferences, saveNewsPreferences } from '@/lib/news-preferences-storage';
import {
  DEFAULT_NEWS_PREFERENCES,
  NEWS_CATEGORIES,
  filterNewsEvents,
  getNewsCategoryHeading,
  getNewsCategoryLabel,
  rankNewsEvents,
  recordNewsOpen,
  toggleNewsInterest,
  toggleSavedNews,
} from '@/lib/news';
import type { NewsCategory, NewsEvent, NewsFeedSnapshot, NewsPreferences } from '@/types/news';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type NewsView = 'home' | 'hot' | 'saved' | 'profile';

const LIME = '#c9f36a';
const CORAL = '#ff6b8f';
const WHITE = '#ffffff';
const CATEGORY_ICONS: Record<NewsCategory, IconName> = {
  ai: 'creation-outline',
  technology: 'chip',
  finance: 'chart-line',
  society: 'account-group-outline',
  world: 'earth',
};
const CATEGORY_COLORS: Record<NewsCategory, string> = {
  ai: '#4b6bff',
  technology: '#1f9d8b',
  finance: '#d9773f',
  society: '#d45579',
  world: '#4776a8',
};

export function HotNewsScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const [activeView, setActiveView] = useState<NewsView>('home');
  const [selectedEvent, setSelectedEvent] = useState<NewsEvent | null>(null);
  const [snapshot, setSnapshot] = useState<NewsFeedSnapshot | null>(null);
  const [preferences, setPreferences] = useState<NewsPreferences>(DEFAULT_NEWS_PREFERENCES);
  const [selectedCategory, setSelectedCategory] = useState<NewsCategory | undefined>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadNewsPreferences().then((stored) => {
      if (!cancelled) setPreferences(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchNewsFeed({ signal: controller.signal })
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setError('');
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : '新闻加载失败，请稍后重试。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setFeedback('');
    try {
      const nextSnapshot = await fetchNewsFeed();
      setSnapshot(nextSnapshot);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '刷新失败，请稍后重试。');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  const visibleEvents = useMemo(() => {
    if (!snapshot) return [];
    let events = activeView === 'hot'
      ? [...snapshot.events].sort((left, right) => right.hotScore - left.hotScore)
      : rankNewsEvents(snapshot.events, preferences);
    events = filterNewsEvents(events, {
      category: selectedCategory,
      query,
      savedEventIds: activeView === 'saved' ? preferences.savedEventIds : undefined,
    });
    return events;
  }, [activeView, preferences, query, selectedCategory, snapshot]);

  function commitPreferences(next: NewsPreferences, message?: string) {
    setPreferences(next);
    if (message) setFeedback(message);
    void saveNewsPreferences(next).catch(() => {
      setFeedback('偏好已更新，但暂时无法保存到本机。');
    });
  }

  function openEvent(event: NewsEvent) {
    commitPreferences(recordNewsOpen(preferences, event.category));
    setSelectedEvent(event);
    setFeedback('');
  }

  function toggleSaved(event: NewsEvent) {
    const saved = preferences.savedEventIds.includes(event.id);
    commitPreferences(
      toggleSavedNews(preferences, event.id),
      saved ? '已取消收藏。' : '已加入收藏。',
    );
  }

  async function openSource(sourceId: string, url: string) {
    if (openingSourceId) return;
    setOpeningSourceId(sourceId);
    setFeedback('');
    try {
      await Linking.openURL(url);
    } catch {
      setFeedback('无法打开原文，请稍后重试。');
    } finally {
      setOpeningSourceId(null);
    }
  }

  function changeView(view: NewsView) {
    setActiveView(view);
    setSelectedEvent(null);
    setSelectedCategory(undefined);
    setQuery('');
    setFeedback('');
  }

  const title = selectedEvent
    ? '热点详情'
    : activeView === 'home'
      ? '热点速览'
      : activeView === 'hot'
        ? '全网热点'
        : activeView === 'saved'
          ? '我的收藏'
          : '我的兴趣';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => selectedEvent ? setSelectedEvent(null) : router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
          </Pressable>
          <ThemedText numberOfLines={1} style={styles.topBarTitle}>{title}</ThemedText>
          {selectedEvent ? (
            <Pressable
              accessibilityLabel={preferences.savedEventIds.includes(selectedEvent.id) ? '取消收藏' : '收藏新闻'}
              accessibilityRole="button"
              onPress={() => toggleSaved(selectedEvent)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons
                name={preferences.savedEventIds.includes(selectedEvent.id) ? 'bookmark' : 'bookmark-outline'}
                size={21}
                color={preferences.savedEventIds.includes(selectedEvent.id) ? colors.primary : colors.text}
              />
            </Pressable>
          ) : activeView !== 'profile' ? (
            <Pressable
              accessibilityLabel="刷新新闻"
              accessibilityRole="button"
              disabled={refreshing}
              onPress={() => void refresh()}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              {refreshing ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <MaterialCommunityIcons name="refresh" size={21} color={colors.text} />
              )}
            </Pressable>
          ) : <View style={styles.iconButton} />}
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={selectedEvent || activeView === 'profile' ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />
          )}
          showsVerticalScrollIndicator={false}>
          {selectedEvent ? (
            <NewsDetail
              event={selectedEvent}
              feedback={feedback}
              openingSourceId={openingSourceId}
              onOpenSource={(sourceId, url) => void openSource(sourceId, url)}
            />
          ) : activeView === 'profile' ? (
            <InterestPreferences
              preferences={preferences}
              onToggle={(category) => commitPreferences(toggleNewsInterest(preferences, category), '兴趣偏好已保存。')}
            />
          ) : loading ? (
            <NewsLoadingState />
          ) : !snapshot ? (
            <NewsErrorState message={error} onRetry={() => void refresh()} />
          ) : (
            <>
              {activeView === 'home' ? <DailyBrief snapshot={snapshot} /> : null}
              {snapshot.stale ? <StatusNotice message="数据更新稍有延迟，当前显示上一次成功快照。" /> : null}
              {error ? <StatusNotice message={error} /> : null}
              <NewsFilters
                query={query}
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
                onQueryChange={setQuery}
              />
              <View style={styles.sectionHeading}>
                <View>
                  <ThemedText style={styles.sectionTitle}>{getSectionTitle(activeView, selectedCategory)}</ThemedText>
                  <ThemedText style={[styles.sectionDescription, { color: colors.mutedText }]}>
                    {getSectionDescription(activeView, visibleEvents.length)}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.resultCount, { color: colors.mutedText }]}>
                  {visibleEvents.length} 条
                </ThemedText>
              </View>
              {feedback ? <StatusNotice message={feedback} /> : null}
              {visibleEvents.length > 0 ? (
                <View style={[styles.newsList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  {visibleEvents.map((event, index) => (
                    <NewsEventRow
                      event={event}
                      key={event.id}
                      onOpen={() => openEvent(event)}
                      onToggleSaved={() => toggleSaved(event)}
                      saved={preferences.savedEventIds.includes(event.id)}
                      separated={index > 0}
                    />
                  ))}
                </View>
              ) : (
                <NewsEmptyState activeView={activeView} hasFilters={Boolean(query || selectedCategory)} />
              )}
            </>
          )}
        </ScrollView>

        {!selectedEvent ? <NewsBottomNavigation activeView={activeView} onChange={changeView} /> : null}
      </View>
    </SafeAreaView>
  );
}

function DailyBrief({ snapshot }: { snapshot: NewsFeedSnapshot }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.brief, { backgroundColor: colors.hero }]} testID="hot-news-daily-brief">
      <View style={styles.briefHeader}>
        <View style={styles.briefTitleRow}>
          <MaterialCommunityIcons name="weather-sunset-up" size={17} color={LIME} />
          <ThemedText style={styles.briefLabel}>每日简报</ThemedText>
        </View>
        <ThemedText style={styles.briefTime}>{formatSnapshotTime(snapshot.generatedAt)}</ThemedText>
      </View>
      <ThemedText style={styles.briefTitle}>{snapshot.dailyBrief.title}</ThemedText>
      <View style={styles.briefPoints}>
        {snapshot.dailyBrief.keyPoints.slice(0, 3).map((point, index) => (
          <View key={`${index}-${point}`} style={styles.briefPoint}>
            <View style={styles.briefNumber}>
              <ThemedText style={styles.briefNumberText}>{index + 1}</ThemedText>
            </View>
            <ThemedText style={styles.briefPointText}>{point}</ThemedText>
          </View>
        ))}
      </View>
      <View style={styles.briefFooter}>
        <ThemedText style={styles.briefFooterText}>已整理 {snapshot.dailyBrief.eventCount} 个新闻事件</ThemedText>
        <MaterialCommunityIcons name="shield-check-outline" size={15} color={LIME} />
        <ThemedText style={styles.briefFooterText}>事实来自原始来源</ThemedText>
      </View>
    </View>
  );
}

function NewsFilters({
  onCategoryChange,
  onQueryChange,
  query,
  selectedCategory,
}: {
  onCategoryChange: (category: NewsCategory | undefined) => void;
  onQueryChange: (query: string) => void;
  query: string;
  selectedCategory?: NewsCategory;
}) {
  const { colors } = useAppTheme();
  return (
    <>
      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={19} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="搜索新闻"
          onChangeText={onQueryChange}
          placeholder="搜索标题、摘要或来源"
          placeholderTextColor={colors.mutedText}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
        />
        {query ? (
          <Pressable accessibilityLabel="清空搜索" onPress={() => onQueryChange('')} style={styles.clearButton}>
            <MaterialCommunityIcons name="close-circle" size={18} color={colors.mutedText} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={styles.categoryTabs}
        horizontal
        showsHorizontalScrollIndicator={false}>
        <CategoryTab
          label="为你推荐"
          selected={!selectedCategory}
          onPress={() => onCategoryChange(undefined)}
        />
        {NEWS_CATEGORIES.map((category) => (
          <CategoryTab
            key={category.id}
            label={category.label}
            selected={selectedCategory === category.id}
            onPress={() => onCategoryChange(category.id)}
          />
        ))}
      </ScrollView>
    </>
  );
}

function CategoryTab({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.categoryTab, pressed && styles.pressed]}>
      <ThemedText style={[styles.categoryTabText, { color: selected ? colors.primary : colors.mutedText }]}>
        {label}
      </ThemedText>
      {selected ? <View style={[styles.categoryUnderline, { backgroundColor: colors.primary }]} /> : null}
    </Pressable>
  );
}

function NewsEventRow({
  event,
  onOpen,
  onToggleSaved,
  saved,
  separated,
}: {
  event: NewsEvent;
  onOpen: () => void;
  onToggleSaved: () => void;
  saved: boolean;
  separated: boolean;
}) {
  const { colors } = useAppTheme();
  const categoryColor = CATEGORY_COLORS[event.category];
  return (
    <View style={[styles.newsRow, separated && { borderTopColor: colors.line, borderTopWidth: 1 }]}>
      <Pressable
        accessibilityLabel={`${event.title}，查看详情`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.newsMain, pressed && styles.pressed]}>
        {event.imageUrl ? (
          <Image contentFit="cover" source={{ uri: event.imageUrl }} style={styles.newsImage as ImageStyle} transition={160} />
        ) : (
          <View style={[styles.newsImageFallback, { backgroundColor: `${categoryColor}1a` }]}>
            <MaterialCommunityIcons name={CATEGORY_ICONS[event.category]} size={25} color={categoryColor} />
          </View>
        )}
        <View style={styles.newsCopy}>
          <View style={styles.newsMetaLine}>
            <ThemedText style={[styles.newsCategory, { color: categoryColor }]}>
              {getNewsCategoryLabel(event.category)}
            </ThemedText>
            <ThemedText style={[styles.newsMeta, { color: colors.mutedText }]}>
              {formatRelativeTime(event.publishedAt)} · {event.sourceCount} 个来源
            </ThemedText>
          </View>
          <ThemedText numberOfLines={2} style={styles.newsTitle}>{event.title}</ThemedText>
          <ThemedText numberOfLines={2} style={[styles.newsSummary, { color: colors.mutedText }]}>
            {event.summary.oneSentence}
          </ThemedText>
          <View style={styles.hotLine}>
            <MaterialCommunityIcons name="fire" size={14} color={CORAL} />
            <ThemedText style={[styles.hotText, { color: colors.mutedText }]}>热度 {event.hotScore}</ThemedText>
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={saved ? '取消收藏' : '收藏新闻'}
        accessibilityRole="button"
        accessibilityState={{ selected: saved }}
        hitSlop={6}
        onPress={onToggleSaved}
        style={({ pressed }) => [styles.bookmarkButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons
          name={saved ? 'bookmark' : 'bookmark-outline'}
          size={19}
          color={saved ? colors.primary : colors.mutedText}
        />
      </Pressable>
    </View>
  );
}

function NewsDetail({
  event,
  feedback,
  onOpenSource,
  openingSourceId,
}: {
  event: NewsEvent;
  feedback: string;
  onOpenSource: (sourceId: string, url: string) => void;
  openingSourceId: string | null;
}) {
  const { colors } = useAppTheme();
  const sourceMap = new Map(event.sources.map((source) => [source.id, source.name]));
  return (
    <View testID="hot-news-detail">
      {event.imageUrl ? (
        <Image contentFit="cover" source={{ uri: event.imageUrl }} style={styles.detailImage as ImageStyle} transition={180} />
      ) : (
        <View style={[styles.detailImageFallback, { backgroundColor: `${CATEGORY_COLORS[event.category]}1a` }]}>
          <MaterialCommunityIcons name={CATEGORY_ICONS[event.category]} size={40} color={CATEGORY_COLORS[event.category]} />
        </View>
      )}
      <View style={styles.detailHeader}>
        <ThemedText style={[styles.detailCategory, { color: CATEGORY_COLORS[event.category] }]}>
          {getNewsCategoryLabel(event.category)} · 热度 {event.hotScore}
        </ThemedText>
        <ThemedText style={styles.detailTitle}>{event.title}</ThemedText>
        <ThemedText style={[styles.detailMeta, { color: colors.mutedText }]}>
          {formatDateTime(event.publishedAt)} · {event.sourceCount} 个独立来源
        </ThemedText>
      </View>
      <View style={[styles.summarySection, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.detailSectionHeader}>
          <View style={styles.detailSectionTitleRow}>
            <MaterialCommunityIcons name="text-box-check-outline" size={19} color={colors.primary} />
            <ThemedText style={styles.detailSectionTitle}>摘要与关键事实</ThemedText>
          </View>
          <ThemedText style={[styles.summaryStatus, { color: colors.mutedText }]}>
            {event.summary.status === 'generated' ? 'DeepSeek 生成' : '来源提取'}
          </ThemedText>
        </View>
        <ThemedText style={styles.detailLead}>{event.summary.oneSentence}</ThemedText>
        <View style={styles.keyPointList}>
          {event.summary.keyPoints.map((point, index) => (
            <View key={`${index}-${point.text}`} style={styles.keyPoint}>
              <View style={[styles.keyPointDot, { backgroundColor: colors.primary }]} />
              <View style={styles.keyPointCopy}>
                <ThemedText style={styles.keyPointText}>{point.text}</ThemedText>
                <ThemedText style={[styles.citationText, { color: colors.primary }]}>
                  {point.sourceIds.map((sourceId) => `${sourceId} ${sourceMap.get(sourceId) ?? ''}`.trim()).join(' · ')}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
        {event.summary.uncertainty ? (
          <View style={[styles.uncertainty, { backgroundColor: colors.surfaceMuted, borderLeftColor: CORAL }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
            <ThemedText style={[styles.uncertaintyText, { color: colors.mutedText }]}>
              {event.summary.uncertainty}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {event.timeline.length > 0 ? (
        <View style={styles.detailOpenSection}>
          <ThemedText style={styles.detailOpenTitle}>事件脉络</ThemedText>
          {event.timeline.map((item, index) => (
            <View key={`${item.sourceId}-${item.publishedAt}`} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
                {index < event.timeline.length - 1 ? <View style={[styles.timelineLine, { backgroundColor: colors.line }]} /> : null}
              </View>
              <View style={styles.timelineCopy}>
                <ThemedText style={[styles.timelineTime, { color: colors.mutedText }]}>{formatDateTime(item.publishedAt)}</ThemedText>
                <ThemedText style={styles.timelineLabel}>{item.label}</ThemedText>
                <ThemedText style={[styles.timelineSource, { color: colors.primary }]}>
                  {item.sourceId} · {sourceMap.get(item.sourceId)}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.detailOpenSection}>
        <ThemedText style={styles.detailOpenTitle}>原始来源</ThemedText>
        <View style={[styles.sourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {event.sources.map((source, index) => (
            <Pressable
              accessibilityLabel={`打开${source.name}原文`}
              accessibilityRole="link"
              disabled={openingSourceId !== null}
              key={source.id}
              onPress={() => onOpenSource(source.id, source.url)}
              style={({ pressed }) => [
                styles.sourceRow,
                index > 0 && { borderTopColor: colors.line, borderTopWidth: 1 },
                pressed && styles.pressed,
              ]}>
              <View style={[styles.sourceID, { backgroundColor: colors.primarySoft }]}>
                <ThemedText style={[styles.sourceIDText, { color: colors.primary }]}>{source.id}</ThemedText>
              </View>
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                <ThemedText numberOfLines={1} style={[styles.sourceTime, { color: colors.mutedText }]}>
                  {formatDateTime(source.publishedAt)}
                </ThemedText>
              </View>
              {openingSourceId === source.id ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <MaterialCommunityIcons name="arrow-top-right" size={18} color={colors.mutedText} />
              )}
            </Pressable>
          ))}
        </View>
      </View>
      {feedback ? <StatusNotice message={feedback} /> : null}
      <ThemedText style={[styles.sourceDisclaimer, { color: colors.mutedText }]}>
        FunBox 仅展示标题、短摘要与来源链接。完整内容请前往原始网站阅读。
      </ThemedText>
    </View>
  );
}

function InterestPreferences({
  onToggle,
  preferences,
}: {
  onToggle: (category: NewsCategory) => void;
  preferences: NewsPreferences;
}) {
  const { colors } = useAppTheme();
  return (
    <View>
      <View style={[styles.preferenceIntro, { backgroundColor: colors.hero }]}>
        <MaterialCommunityIcons name="tune-variant" size={24} color={LIME} />
        <ThemedText style={styles.preferenceIntroTitle}>让简报更贴近你的关注</ThemedText>
        <ThemedText style={styles.preferenceIntroText}>
          兴趣只改变事件排序，不会改写公共摘要和事实。打开新闻会轻量调整对应分类权重。
        </ThemedText>
      </View>
      <View style={styles.preferenceHeader}>
        <ThemedText style={styles.sectionTitle}>主动兴趣</ThemedText>
        <ThemedText style={[styles.sectionDescription, { color: colors.mutedText }]}>
          已选择 {preferences.interests.length} 项
        </ThemedText>
      </View>
      <View style={[styles.preferenceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {NEWS_CATEGORIES.map((category, index) => {
          const selected = preferences.interests.includes(category.id);
          const behavior = preferences.behaviorWeights[category.id] ?? 0;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              key={category.id}
              onPress={() => onToggle(category.id)}
              style={({ pressed }) => [
                styles.preferenceRow,
                index > 0 && { borderTopColor: colors.line, borderTopWidth: 1 },
                pressed && styles.pressed,
              ]}>
              <View style={[styles.preferenceIcon, { backgroundColor: `${CATEGORY_COLORS[category.id]}1a` }]}>
                <MaterialCommunityIcons name={CATEGORY_ICONS[category.id]} size={21} color={CATEGORY_COLORS[category.id]} />
              </View>
              <View style={styles.preferenceCopy}>
                <ThemedText style={styles.preferenceName}>{category.label}</ThemedText>
                <ThemedText style={[styles.preferenceMeta, { color: colors.mutedText }]}>
                  {behavior > 0 ? `阅读偏好 +${behavior.toFixed(2)}` : '尚无阅读行为权重'}
                </ThemedText>
              </View>
              <MaterialCommunityIcons
                name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={23}
                color={selected ? colors.primary : colors.mutedText}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.privacyNote, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="cellphone-lock" size={18} color={colors.success} />
        <ThemedText style={[styles.privacyText, { color: colors.mutedText }]}>
          兴趣、阅读权重和收藏仅保存在当前设备，不上传账号。
        </ThemedText>
      </View>
    </View>
  );
}

function NewsLoadingState() {
  const { colors } = useAppTheme();
  return (
    <View>
      <View style={[styles.loadingBrief, { backgroundColor: colors.hero }]}>
        <ActivityIndicator color={LIME} />
        <ThemedText style={styles.loadingBriefTitle}>正在整理今日热点</ThemedText>
        <ThemedText style={styles.loadingBriefText}>正在合并来源、计算热度并准备摘要…</ThemedText>
      </View>
      {[0, 1, 2].map((item) => (
        <View key={item} style={[styles.skeletonRow, { borderBottomColor: colors.line }]}>
          <View style={[styles.skeletonImage, { backgroundColor: colors.surfaceMuted }]} />
          <View style={styles.skeletonCopy}>
            <View style={[styles.skeletonLineLong, { backgroundColor: colors.surfaceMuted }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.surfaceMuted }]} />
            <View style={[styles.skeletonLineShort, { backgroundColor: colors.surfaceMuted }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function NewsErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.centerState}>
      <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="newspaper-remove" size={30} color={colors.primary} />
      </View>
      <ThemedText style={styles.stateTitle}>暂时无法获取新闻</ThemedText>
      <ThemedText style={[styles.stateDescription, { color: colors.mutedText }]}>
        {message || '新闻来源暂时不可用，请稍后重试。'}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.retryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="refresh" size={18} color={WHITE} />
        <ThemedText style={styles.retryButtonText}>重新加载</ThemedText>
      </Pressable>
    </View>
  );
}

function NewsEmptyState({ activeView, hasFilters }: { activeView: NewsView; hasFilters: boolean }) {
  const { colors } = useAppTheme();
  const saved = activeView === 'saved';
  return (
    <View style={styles.centerState}>
      <MaterialCommunityIcons name={saved ? 'bookmark-outline' : 'magnify'} size={30} color={colors.mutedText} />
      <ThemedText style={styles.stateTitle}>
        {saved && !hasFilters ? '还没有收藏' : '没有匹配的新闻'}
      </ThemedText>
      <ThemedText style={[styles.stateDescription, { color: colors.mutedText }]}>
        {saved && !hasFilters ? '在新闻右侧点按收藏图标，稍后可以从这里继续阅读。' : '换一个关键词或分类再试试。'}
      </ThemedText>
    </View>
  );
}

function StatusNotice({ message }: { message: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.statusNotice, { backgroundColor: colors.surfaceMuted, borderLeftColor: colors.primary }]}>
      <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
      <ThemedText style={[styles.statusNoticeText, { color: colors.mutedText }]}>{message}</ThemedText>
    </View>
  );
}

function NewsBottomNavigation({ activeView, onChange }: { activeView: NewsView; onChange: (view: NewsView) => void }) {
  const { colors } = useAppTheme();
  const items: Array<{ id: NewsView; icon: IconName; selectedIcon: IconName; label: string }> = [
    { id: 'home', icon: 'home-outline', selectedIcon: 'home', label: '首页' },
    { id: 'hot', icon: 'fire', selectedIcon: 'fire', label: '热点' },
    { id: 'saved', icon: 'bookmark-outline', selectedIcon: 'bookmark', label: '收藏' },
    { id: 'profile', icon: 'account-outline', selectedIcon: 'account', label: '我的' },
  ];
  return (
    <View style={[styles.bottomNav, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
      {items.map((item) => {
        const selected = activeView === item.id;
        const color = selected ? colors.primary : colors.tabInactive;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item.id}
            onPress={() => onChange(item.id)}
            style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressed]}>
            <MaterialCommunityIcons name={selected ? item.selectedIcon : item.icon} size={21} color={color} />
            <ThemedText style={[styles.bottomNavLabel, { color }]}>{item.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function getSectionTitle(view: NewsView, category?: NewsCategory) {
  if (view === 'hot') return '按热度排序';
  if (view === 'saved') return '稍后阅读';
  return getNewsCategoryHeading(category);
}

function getSectionDescription(view: NewsView, count: number) {
  if (view === 'hot') return '公共热度，不受个人偏好影响';
  if (view === 'saved') return count > 0 ? '保存在这台设备上的新闻' : '收藏后可在此快速找到';
  return '结合兴趣与阅读行为排序';
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间未知';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatSnapshotTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} 更新`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenShell: { alignSelf: 'center', flex: 1, maxWidth: appLayout.screenMaxWidth, overflow: 'hidden', width: '100%' },
  topBar: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', height: 58, justifyContent: 'space-between', paddingHorizontal: 12 },
  iconButton: { alignItems: 'center', borderRadius: 8, height: 40, justifyContent: 'center', width: 40 },
  topBarTitle: { flex: 1, fontSize: 17, fontWeight: '900', lineHeight: 23, textAlign: 'center' },
  scrollContent: { paddingBottom: 30, paddingHorizontal: 14, paddingTop: 14 },
  brief: { borderRadius: 8, overflow: 'hidden', padding: 18 },
  briefHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  briefTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  briefLabel: { color: LIME, fontSize: 12, fontWeight: '900', lineHeight: 17 },
  briefTime: { color: '#aebbd0', fontSize: 10, fontWeight: '700', lineHeight: 14 },
  briefTitle: { color: WHITE, fontSize: 22, fontWeight: '900', lineHeight: 30, marginTop: 13 },
  briefPoints: { gap: 10, marginTop: 16 },
  briefPoint: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  briefNumber: { alignItems: 'center', backgroundColor: 'rgba(201,243,106,0.16)', borderRadius: 8, height: 23, justifyContent: 'center', width: 23 },
  briefNumberText: { color: LIME, fontSize: 10, fontWeight: '900', lineHeight: 14 },
  briefPointText: { color: '#eef2ff', flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 20 },
  briefFooter: { alignItems: 'center', borderTopColor: 'rgba(255,255,255,0.12)', borderTopWidth: 1, flexDirection: 'row', gap: 6, marginTop: 16, paddingTop: 12 },
  briefFooterText: { color: '#aebbd0', fontSize: 9, fontWeight: '600', lineHeight: 13 },
  searchBar: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 9, height: 48, marginTop: 14, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 13, height: 46, minWidth: 0, padding: 0 },
  clearButton: { alignItems: 'center', height: 32, justifyContent: 'center', width: 28 },
  categoryTabs: { gap: 18, paddingHorizontal: 2, paddingTop: 14 },
  categoryTab: { minHeight: 35, paddingBottom: 9, position: 'relative' },
  categoryTabText: { fontSize: 11, fontWeight: '800', lineHeight: 16 },
  categoryUnderline: { bottom: 0, height: 3, left: 0, position: 'absolute', right: 0 },
  sectionHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginTop: 18, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '900', lineHeight: 24 },
  sectionDescription: { fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: 2 },
  resultCount: { fontSize: 10, fontWeight: '700', lineHeight: 15 },
  newsList: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  newsRow: { alignItems: 'center', flexDirection: 'row', minHeight: 118 },
  newsMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 11, minWidth: 0, paddingBottom: 12, paddingLeft: 11, paddingTop: 12 },
  newsImage: { borderRadius: 6, height: 78, width: 88 },
  newsImageFallback: { alignItems: 'center', borderRadius: 6, height: 78, justifyContent: 'center', width: 88 },
  newsCopy: { flex: 1, minWidth: 0 },
  newsMetaLine: { alignItems: 'center', flexDirection: 'row', gap: 6, minWidth: 0 },
  newsCategory: { fontSize: 9, fontWeight: '900', lineHeight: 13 },
  newsMeta: { flex: 1, fontSize: 9, fontWeight: '600', lineHeight: 13 },
  newsTitle: { fontSize: 13, fontWeight: '900', lineHeight: 18, marginTop: 4 },
  newsSummary: { fontSize: 10, lineHeight: 15, marginTop: 3 },
  hotLine: { alignItems: 'center', flexDirection: 'row', gap: 3, marginTop: 4 },
  hotText: { fontSize: 9, fontWeight: '700', lineHeight: 13 },
  bookmarkButton: { alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center', width: 39 },
  detailImage: { borderRadius: 8, height: 210, width: '100%' },
  detailImageFallback: { alignItems: 'center', borderRadius: 8, height: 176, justifyContent: 'center', width: '100%' },
  detailHeader: { paddingHorizontal: 2, paddingVertical: 16 },
  detailCategory: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  detailTitle: { fontSize: 24, fontWeight: '900', lineHeight: 33, marginTop: 8 },
  detailMeta: { fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: 8 },
  summarySection: { borderRadius: 8, borderWidth: 1, padding: 15 },
  detailSectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  detailSectionTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  detailSectionTitle: { fontSize: 15, fontWeight: '900', lineHeight: 20 },
  summaryStatus: { fontSize: 9, fontWeight: '700', lineHeight: 13 },
  detailLead: { fontSize: 15, fontWeight: '700', lineHeight: 23, marginTop: 14 },
  keyPointList: { gap: 12, marginTop: 14 },
  keyPoint: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  keyPointDot: { borderRadius: 4, height: 7, marginTop: 7, width: 7 },
  keyPointCopy: { flex: 1 },
  keyPointText: { fontSize: 13, lineHeight: 21 },
  citationText: { fontSize: 9, fontWeight: '700', lineHeight: 14, marginTop: 3 },
  uncertainty: { alignItems: 'flex-start', borderLeftWidth: 3, flexDirection: 'row', gap: 7, marginTop: 14, padding: 10 },
  uncertaintyText: { flex: 1, fontSize: 10, lineHeight: 16 },
  detailOpenSection: { marginTop: 20 },
  detailOpenTitle: { fontSize: 17, fontWeight: '900', lineHeight: 23, marginBottom: 11, paddingHorizontal: 2 },
  timelineRow: { flexDirection: 'row', minHeight: 74 },
  timelineRail: { alignItems: 'center', width: 20 },
  timelineDot: { borderRadius: 5, height: 9, marginTop: 5, width: 9 },
  timelineLine: { flex: 1, marginVertical: 4, width: 1 },
  timelineCopy: { flex: 1, paddingBottom: 15, paddingLeft: 7 },
  timelineTime: { fontSize: 9, fontWeight: '600', lineHeight: 13 },
  timelineLabel: { fontSize: 12, fontWeight: '700', lineHeight: 18, marginTop: 2 },
  timelineSource: { fontSize: 9, fontWeight: '700', lineHeight: 13, marginTop: 3 },
  sourceList: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  sourceRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 64, paddingHorizontal: 12, paddingVertical: 9 },
  sourceID: { alignItems: 'center', borderRadius: 6, height: 34, justifyContent: 'center', width: 34 },
  sourceIDText: { fontSize: 10, fontWeight: '900', lineHeight: 14 },
  sourceCopy: { flex: 1, minWidth: 0 },
  sourceName: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  sourceTime: { fontSize: 9, lineHeight: 13, marginTop: 2 },
  sourceDisclaimer: { fontSize: 9, lineHeight: 15, marginTop: 14, paddingHorizontal: 3, textAlign: 'center' },
  preferenceIntro: { alignItems: 'flex-start', borderRadius: 8, gap: 10, padding: 18 },
  preferenceIntroTitle: { color: WHITE, fontSize: 21, fontWeight: '900', lineHeight: 28 },
  preferenceIntroText: { color: '#aebbd0', fontSize: 12, lineHeight: 19 },
  preferenceHeader: { marginBottom: 10, marginTop: 20, paddingHorizontal: 2 },
  preferenceList: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  preferenceRow: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 70, paddingHorizontal: 12, paddingVertical: 10 },
  preferenceIcon: { alignItems: 'center', borderRadius: 8, height: 42, justifyContent: 'center', width: 42 },
  preferenceCopy: { flex: 1 },
  preferenceName: { fontSize: 14, fontWeight: '800', lineHeight: 19 },
  preferenceMeta: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  privacyNote: { alignItems: 'flex-start', borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 17, paddingHorizontal: 3, paddingTop: 14 },
  privacyText: { flex: 1, fontSize: 10, lineHeight: 16 },
  loadingBrief: { alignItems: 'center', borderRadius: 8, gap: 9, minHeight: 180, justifyContent: 'center', padding: 24 },
  loadingBriefTitle: { color: WHITE, fontSize: 19, fontWeight: '900', lineHeight: 26 },
  loadingBriefText: { color: '#aebbd0', fontSize: 11, lineHeight: 17, textAlign: 'center' },
  skeletonRow: { borderBottomWidth: 1, flexDirection: 'row', gap: 12, paddingVertical: 16 },
  skeletonImage: { borderRadius: 6, height: 76, width: 88 },
  skeletonCopy: { flex: 1, gap: 9, paddingTop: 4 },
  skeletonLineLong: { borderRadius: 4, height: 11, width: '90%' },
  skeletonLine: { borderRadius: 4, height: 9, width: '74%' },
  skeletonLineShort: { borderRadius: 4, height: 8, width: '42%' },
  centerState: { alignItems: 'center', minHeight: 320, paddingHorizontal: 30, paddingTop: 58 },
  stateIcon: { alignItems: 'center', borderRadius: 8, height: 58, justifyContent: 'center', width: 58 },
  stateTitle: { fontSize: 18, fontWeight: '900', lineHeight: 24, marginTop: 13 },
  stateDescription: { fontSize: 11, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  retryButton: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 7, height: 42, justifyContent: 'center', marginTop: 17, paddingHorizontal: 17 },
  retryButtonText: { color: WHITE, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  statusNotice: { alignItems: 'flex-start', borderLeftWidth: 3, flexDirection: 'row', gap: 7, marginTop: 11, paddingHorizontal: 10, paddingVertical: 9 },
  statusNoticeText: { flex: 1, fontSize: 10, lineHeight: 16 },
  bottomNav: { borderTopWidth: 1, flexDirection: 'row', height: 70, paddingBottom: 7, paddingTop: 7 },
  bottomNavItem: { alignItems: 'center', flex: 1, gap: 3, justifyContent: 'center' },
  bottomNavLabel: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  pressed: { opacity: 0.7 },
});
