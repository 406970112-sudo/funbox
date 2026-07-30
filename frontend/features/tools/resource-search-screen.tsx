import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { startTransition, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  DEFAULT_RESOURCE_SEARCH_SOURCE_IDS,
  getResourceSearchQueue,
  normalizeResourceSearchQuery,
  RESOURCE_SEARCH_SOURCES,
  type ResourceSearchSource,
  type ResourceSearchSourceId,
} from '@/lib/resource-search';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type SearchPhase = 'search' | 'select' | 'handoff';

const HERO_COLOR = '#151b3b';
const HERO_MUTED = '#aab5d1';
const BRAND_BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff6b8f';
const INITIAL_HISTORY = ['流浪地球 2', 'Figma 插件'];

export function ResourceSearchScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const [phase, setPhase] = useState<SearchPhase>('search');
  const [query, setQuery] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<ResourceSearchSourceId[]>([
    ...DEFAULT_RESOURCE_SEARCH_SOURCE_IDS,
  ]);
  const [history, setHistory] = useState(INITIAL_HISTORY);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [sourceOptionsVisible, setSourceOptionsVisible] = useState(false);
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  const [openedSourceIds, setOpenedSourceIds] = useState<ResourceSearchSourceId[]>([]);
  const [openingSourceId, setOpeningSourceId] = useState<ResourceSearchSourceId | null>(null);
  const [feedback, setFeedback] = useState('');
  const selectedSources = getResourceSearchQueue(selectedSourceIds);
  const normalizedQuery = normalizeResourceSearchQuery(query);
  const currentSource = selectedSources[currentSourceIndex];
  const allSourcesSelected = selectedSourceIds.length === RESOURCE_SEARCH_SOURCES.length;
  const pageBackground = colorScheme === 'dark' ? colors.background : '#eef4ff';

  function goBack() {
    if (phase === 'handoff') {
      setFeedback('');
      startTransition(() => setPhase('select'));
      return;
    }

    if (phase === 'select') {
      startTransition(() => setPhase('search'));
      return;
    }

    router.back();
  }

  function beginSearch(value = query) {
    const nextQuery = normalizeResourceSearchQuery(value);

    if (!nextQuery) {
      setFeedback('先输入想找的电影、剧集、软件或资料。');
      return;
    }

    setQuery(nextQuery);
    setFeedback('');
    setHistory((current) => [nextQuery, ...current.filter((item) => item !== nextQuery)].slice(0, 6));
    startTransition(() => setPhase('select'));
  }

  function toggleSource(sourceId: ResourceSearchSourceId) {
    setFeedback('');
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((item) => item !== sourceId)
        : [...current, sourceId],
    );
  }

  function toggleAllSources() {
    setSelectedSourceIds(
      allSourcesSelected ? [] : RESOURCE_SEARCH_SOURCES.map((source) => source.id),
    );
    setFeedback('');
  }

  function restoreDefaultSources() {
    setSelectedSourceIds([...DEFAULT_RESOURCE_SEARCH_SOURCE_IDS]);
    setSourceOptionsVisible(false);
    setFeedback('已恢复默认的 3 个搜索站点。');
  }

  function prepareHandoff() {
    if (!normalizedQuery) {
      setFeedback('搜索关键词不能为空。');
      return;
    }

    if (!selectedSources.length) {
      setFeedback('至少选择一个搜索站点。');
      return;
    }

    setCurrentSourceIndex(0);
    setOpenedSourceIds([]);
    setFeedback('');
    startTransition(() => setPhase('handoff'));
  }

  async function copyQuery() {
    if (!normalizedQuery) {
      return;
    }

    await Clipboard.setStringAsync(normalizedQuery);
    setFeedback('关键词已复制。');
  }

  async function openSource(source: ResourceSearchSource, copyCurrentQuery = false) {
    setOpeningSourceId(source.id);
    setFeedback('');

    try {
      if (copyCurrentQuery && normalizedQuery) {
        await Clipboard.setStringAsync(normalizedQuery);
      }

      await Linking.openURL(source.url);
      return true;
    } catch {
      setFeedback(`无法打开 ${source.name}，请稍后重试。`);
      return false;
    } finally {
      setOpeningSourceId(null);
    }
  }

  async function openCurrentSource() {
    if (!currentSource || openingSourceId) {
      return;
    }

    const opened = await openSource(currentSource, true);

    if (!opened) {
      return;
    }

    setOpenedSourceIds((current) =>
      current.includes(currentSource.id) ? current : [...current, currentSource.id],
    );
    setCurrentSourceIndex((current) => current + 1);
    setFeedback(
      currentSourceIndex + 1 < selectedSources.length
        ? `已打开 ${currentSource.name}，关键词已复制。`
        : '所选站点已全部打开，关键词仍在剪贴板中。',
    );
  }

  function useHistoryItem(value: string) {
    setHistoryVisible(false);
    beginSearch(value);
  }

  function resetSearch() {
    setQuery('');
    setFeedback('');
    setCurrentSourceIndex(0);
    setOpenedSourceIds([]);
    startTransition(() => setPhase('search'));
  }

  function reselectSources() {
    setFeedback('');
    startTransition(() => setPhase('select'));
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: pageBackground }]}>
      <View style={[styles.screenShell, { backgroundColor: pageBackground }]}>
        <SearchTopBar
          onBack={goBack}
          onRightAction={() => {
            if (phase === 'search') setHistoryVisible(true);
            if (phase === 'select') setSourceOptionsVisible(true);
            if (phase === 'handoff') resetSearch();
          }}
          phase={phase}
        />

        <View style={styles.body}>
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              phase === 'select' ? styles.scrollContentWithFooter : undefined,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {phase === 'search' ? (
              <SearchLanding
                feedback={feedback}
                history={history}
                onOpenSource={(source) => void openSource(source, Boolean(normalizedQuery))}
                onQueryChange={(value) => {
                  setQuery(value);
                  setFeedback('');
                }}
                onSearch={beginSearch}
                openingSourceId={openingSourceId}
                query={query}
              />
            ) : null}

            {phase === 'select' ? (
              <SourceSelector
                allSelected={allSourcesSelected}
                feedback={feedback}
                onQueryChange={(value) => {
                  setQuery(value);
                  setFeedback('');
                }}
                onToggleAll={toggleAllSources}
                onToggleSource={toggleSource}
                query={query}
                selectedSourceIds={selectedSourceIds}
              />
            ) : null}

            {phase === 'handoff' ? (
              <HandoffPanel
                currentSource={currentSource}
                feedback={feedback}
                onCopy={() => void copyQuery()}
                onOpenCurrent={() => void openCurrentSource()}
                onReselect={reselectSources}
                onReset={resetSearch}
                openedSourceIds={openedSourceIds}
                opening={Boolean(openingSourceId)}
                query={normalizedQuery}
                sources={selectedSources}
              />
            ) : null}
          </ScrollView>

          {phase === 'select' ? (
            <View
              style={[
                styles.actionFooter,
                { backgroundColor: pageBackground, borderTopColor: colors.line },
              ]}>
              <Pressable
                accessibilityRole="button"
                disabled={!selectedSources.length}
                onPress={prepareHandoff}
                testID="prepare-search-button"
                style={({ pressed }) => [
                  styles.prepareButton,
                  { backgroundColor: HERO_COLOR },
                  !selectedSources.length && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <ThemedText style={styles.prepareButtonText}>开始搜索</ThemedText>
                <View style={styles.selectionCount}>
                  <ThemedText style={styles.selectionCountText}>{selectedSources.length}</ThemedText>
                </View>
              </Pressable>
              <ThemedText style={[styles.footerHint, { color: colors.mutedText }]}>
                将按顺序打开所选第三方网站
              </ThemedText>
            </View>
          ) : null}
        </View>

        <ToolBottomNavigation />
      </View>

      <HistorySheet
        history={history}
        onClear={() => setHistory([])}
        onClose={() => setHistoryVisible(false)}
        onSelect={useHistoryItem}
        visible={historyVisible}
      />
      <SourceOptionsSheet
        allSelected={allSourcesSelected}
        onClose={() => setSourceOptionsVisible(false)}
        onRestoreDefaults={restoreDefaultSources}
        onToggleAll={() => {
          toggleAllSources();
          setSourceOptionsVisible(false);
        }}
        visible={sourceOptionsVisible}
      />
    </SafeAreaView>
  );
}

type SearchTopBarProps = {
  onBack: () => void;
  onRightAction: () => void;
  phase: SearchPhase;
};

function SearchTopBar({ onBack, onRightAction, phase }: SearchTopBarProps) {
  const { colors } = useAppTheme();
  const title = phase === 'search' ? '资源搜索' : phase === 'select' ? '选择搜索源' : '准备打开';
  const rightIcon: IconName =
    phase === 'search' ? 'history' : phase === 'select' ? 'dots-horizontal' : 'close';
  const rightLabel =
    phase === 'search' ? '搜索历史' : phase === 'select' ? '搜索源选项' : '关闭并重新搜索';

  return (
    <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.topBarSide, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
      </Pressable>
      <ThemedText style={styles.topBarTitle}>{title}</ThemedText>
      <Pressable
        accessibilityLabel={rightLabel}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onRightAction}
        style={({ pressed }) => [
          styles.topBarAction,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.line },
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons name={rightIcon} size={19} color={colors.text} />
      </Pressable>
    </View>
  );
}

type SearchLandingProps = {
  feedback: string;
  history: string[];
  onOpenSource: (source: ResourceSearchSource) => void;
  onQueryChange: (value: string) => void;
  onSearch: (value?: string) => void;
  openingSourceId: ResourceSearchSourceId | null;
  query: string;
};

function SearchLanding({
  feedback,
  history,
  onOpenSource,
  onQueryChange,
  onSearch,
  openingSourceId,
  query,
}: SearchLandingProps) {
  const { colors } = useAppTheme();

  return (
    <>
      <View style={styles.hero}>
        <View style={styles.heroTextureTop} />
        <View style={styles.heroTextureBottom} />
        <View style={styles.heroMeta}>
          <MaterialCommunityIcons name="radar" size={18} color={LIME} />
          <ThemedText style={styles.heroMetaText}>聚合 5 个搜索站点</ThemedText>
        </View>
        <ThemedText style={styles.heroTitle}>一次输入{`\n`}去更多地方寻找</ThemedText>
        <View style={styles.heroSearch}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.mutedText} />
          <TextInput
            accessibilityLabel="资源搜索关键词"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onQueryChange}
            onSubmitEditing={() => onSearch()}
            placeholder="电影、剧集、软件或资料"
            placeholderTextColor={colors.mutedText}
            returnKeyType="search"
            style={[styles.heroInput, { color: '#18233d' }]}
            testID="resource-search-input"
            value={query}
          />
          <Pressable
            accessibilityLabel="开始搜索"
            accessibilityRole="button"
            onPress={() => onSearch()}
            testID="start-search-button"
            style={({ pressed }) => [styles.heroSearchButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="arrow-right" size={21} color={HERO_COLOR} />
          </Pressable>
        </View>
        <View style={styles.quickSearches}>
          <ThemedText style={styles.quickLabel}>大家在搜</ThemedText>
          {['沙丘 2', '三体', '设计素材'].map((item) => (
            <Pressable key={item} onPress={() => onSearch(item)}>
              <ThemedText style={styles.quickItem}>{item}</ThemedText>
            </Pressable>
          ))}
        </View>
        {feedback ? <ThemedText style={styles.heroFeedback}>{feedback}</ThemedText> : null}
      </View>

      <View style={styles.sectionHeader}>
        <ThemedText style={styles.sectionTitle}>搜索站点</ThemedText>
        <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>5 个可用入口</ThemedText>
      </View>

      <View style={[styles.sourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {RESOURCE_SEARCH_SOURCES.map((source, index) => (
          <Pressable
            accessibilityHint="打开第三方网站"
            accessibilityLabel={`${source.name}，${source.domain}`}
            accessibilityRole="link"
            key={source.id}
            onPress={() => onOpenSource(source)}
            style={({ pressed }) => [
              styles.sourceRow,
              index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}>
            <SourceLogo source={source} />
            <View style={styles.sourceCopy}>
              <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
              <ThemedText numberOfLines={1} style={[styles.sourceDomain, { color: colors.mutedText }]}>
                {source.domain}
              </ThemedText>
            </View>
            {openingSourceId === source.id ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <MaterialCommunityIcons name="open-in-new" size={18} color={colors.mutedText} />
            )}
          </Pressable>
        ))}
      </View>

      {history.length ? (
        <View style={styles.recentRow}>
          <MaterialCommunityIcons name="clock-outline" size={16} color={colors.mutedText} />
          <ThemedText numberOfLines={1} style={[styles.recentText, { color: colors.mutedText }]}>
            最近搜索：{history.slice(0, 2).join('、')}
          </ThemedText>
        </View>
      ) : null}
    </>
  );
}

type SourceSelectorProps = {
  allSelected: boolean;
  feedback: string;
  onQueryChange: (value: string) => void;
  onToggleAll: () => void;
  onToggleSource: (sourceId: ResourceSearchSourceId) => void;
  query: string;
  selectedSourceIds: ResourceSearchSourceId[];
};

function SourceSelector({
  allSelected,
  feedback,
  onQueryChange,
  onToggleAll,
  onToggleSource,
  query,
  selectedSourceIds,
}: SourceSelectorProps) {
  const { colors } = useAppTheme();

  return (
    <>
      <View style={[styles.queryBar, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.primary} />
        <TextInput
          accessibilityLabel="编辑搜索关键词"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onQueryChange}
          style={[styles.queryInput, { color: colors.text }]}
          value={query}
        />
        <Pressable
          accessibilityLabel="清除关键词"
          accessibilityRole="button"
          onPress={() => onQueryChange('')}
          style={[styles.queryClear, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="close" size={16} color={colors.mutedText} />
        </Pressable>
      </View>

      <View style={styles.selectorHeader}>
        <View>
          <ThemedText style={styles.selectorTitle}>去哪里找？</ThemedText>
          <ThemedText style={[styles.selectorSubtitle, { color: colors.mutedText }]}>
            可同时选择多个站点
          </ThemedText>
        </View>
        <Pressable accessibilityRole="button" onPress={onToggleAll}>
          <ThemedText style={[styles.selectAllText, { color: colors.primary }]}>
            {allSelected ? '取消全选' : '全选'}
          </ThemedText>
        </Pressable>
      </View>

      <View style={[styles.sourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {RESOURCE_SEARCH_SOURCES.map((source, index) => {
          const selected = selectedSourceIds.includes(source.id);

          return (
            <Pressable
              accessibilityLabel={`${source.name}，${selected ? '已选择' : '未选择'}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              key={source.id}
              onPress={() => onToggleSource(source.id)}
              testID={`source-checkbox-${source.id}`}
              style={({ pressed }) => [
                styles.selectorRow,
                index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}>
              <SourceLogo source={source} />
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                <ThemedText numberOfLines={1} style={[styles.sourceDescription, { color: colors.mutedText }]}>
                  {source.description} · {source.domain}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: selected ? BRAND_BLUE : 'transparent',
                    borderColor: selected ? BRAND_BLUE : colors.line,
                  },
                ]}>
                {selected ? <MaterialCommunityIcons name="check" size={15} color="#ffffff" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {feedback ? <FeedbackLine message={feedback} /> : null}
    </>
  );
}

type HandoffPanelProps = {
  currentSource: ResourceSearchSource | undefined;
  feedback: string;
  onCopy: () => void;
  onOpenCurrent: () => void;
  onReselect: () => void;
  onReset: () => void;
  openedSourceIds: ResourceSearchSourceId[];
  opening: boolean;
  query: string;
  sources: ResourceSearchSource[];
};

function HandoffPanel({
  currentSource,
  feedback,
  onCopy,
  onOpenCurrent,
  onReselect,
  onReset,
  openedSourceIds,
  opening,
  query,
  sources,
}: HandoffPanelProps) {
  const { colors } = useAppTheme();
  const complete = !currentSource;

  return (
    <>
      <View style={styles.handoffIntro}>
        <View style={styles.handoffIcon}>
          <MaterialCommunityIcons name="open-in-new" size={30} color={LIME} />
          <View style={styles.handoffAccent} />
        </View>
        <ThemedText style={styles.handoffTitle}>
          搜索 <ThemedText style={[styles.handoffTitle, { color: BRAND_BLUE }]}>“{query}”</ThemedText>
        </ThemedText>
        <ThemedText style={[styles.handoffDescription, { color: colors.mutedText }]}>
          已选 {sources.length} 个站点，逐个打开可以避免{`\n`}浏览器一次拦截多个窗口。
        </ThemedText>
      </View>

      <View style={[styles.queue, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {sources.map((source, index) => {
          const opened = openedSourceIds.includes(source.id);
          const active = currentSource?.id === source.id;
          const status = opened ? '已打开' : active ? '即将打开' : '等待中';

          return (
            <View
              key={source.id}
              style={[
                styles.queueRow,
                index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
              ]}>
              <ThemedText style={[styles.queueNumber, { color: colors.mutedText }]}>
                {String(index + 1).padStart(2, '0')}
              </ThemedText>
              <SourceLogo source={source} />
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                <ThemedText numberOfLines={1} style={[styles.sourceDomain, { color: colors.mutedText }]}>
                  {source.domain}
                </ThemedText>
              </View>
              <ThemedText
                style={[
                  styles.queueStatus,
                  { color: active ? colors.success : opened ? colors.primary : colors.mutedText },
                ]}>
                {status}
              </ThemedText>
            </View>
          );
        })}
      </View>

      <View style={styles.handoffActions}>
        <Pressable
          accessibilityLabel={complete ? '开始新的搜索' : `打开${currentSource.name}`}
          accessibilityRole="button"
          disabled={opening}
          onPress={complete ? onReset : onOpenCurrent}
          testID="open-current-source-button"
          style={({ pressed }) => [
            styles.openButton,
            { backgroundColor: BRAND_BLUE },
            opening && styles.disabled,
            pressed && styles.pressed,
          ]}>
          {opening ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <MaterialCommunityIcons
              name={complete ? 'magnify' : 'open-in-new'}
              size={19}
              color="#ffffff"
            />
          )}
          <ThemedText style={styles.openButtonText}>
            {complete ? '开始新的搜索' : `打开${currentSource.name}`}
          </ThemedText>
        </Pressable>
        <View style={styles.secondaryActions}>
          <SecondaryAction icon="content-copy" label="复制关键词" onPress={onCopy} />
          <SecondaryAction icon="format-list-bulleted" label="重新选择" onPress={onReselect} />
        </View>
      </View>

      {feedback ? <FeedbackLine message={feedback} /> : null}

      <View style={styles.legalNote}>
        <MaterialCommunityIcons name="shield-check-outline" size={15} color={colors.mutedText} />
        <ThemedText style={[styles.legalText, { color: colors.mutedText }]}>
          FunBox 仅提供第三方网站导航，不存储或提供搜索结果；访问与内容规则以目标网站为准。
        </ThemedText>
      </View>
    </>
  );
}

function SourceLogo({ source }: { source: ResourceSearchSource }) {
  return (
    <View style={[styles.sourceLogo, { backgroundColor: source.logoBackground }]}>
      <ThemedText style={[styles.sourceLogoText, { color: source.logoColor }]}>{source.logo}</ThemedText>
    </View>
  );
}

function SecondaryAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondaryButton,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.text} />
      <ThemedText style={styles.secondaryButtonText}>{label}</ThemedText>
    </Pressable>
  );
}

function FeedbackLine({ message }: { message: string }) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.feedbackLine}>
      <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
      <ThemedText style={[styles.feedbackText, { color: colors.mutedText }]}>{message}</ThemedText>
    </View>
  );
}

function ToolBottomNavigation() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const items: { icon: IconName; label: string; onPress: () => void; selected?: boolean }[] = [
    { icon: 'home-outline', label: '首页', onPress: () => router.replace('/') },
    { icon: 'view-grid', label: '工具', onPress: () => router.replace('/tools'), selected: true },
    { icon: 'message-outline', label: '消息', onPress: () => router.replace('/messages') },
    { icon: 'account-circle-outline', label: '我的', onPress: () => router.replace('/profile') },
  ];

  return (
    <View style={[styles.bottomNav, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
      {items.map((item) => {
        const color = item.selected ? colors.primary : colors.tabInactive;

        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: Boolean(item.selected) }}
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressed]}>
            <MaterialCommunityIcons name={item.icon} size={22} color={color} />
            <ThemedText style={[styles.bottomNavLabel, { color }]}>{item.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

type HistorySheetProps = {
  history: string[];
  onClear: () => void;
  onClose: () => void;
  onSelect: (value: string) => void;
  visible: boolean;
};

function HistorySheet({ history, onClear, onClose, onSelect, visible }: HistorySheetProps) {
  const { colors } = useAppTheme();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭搜索历史" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>最近搜索</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>选择一项继续搜索</ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={onClear}>
              <ThemedText style={[styles.sheetAction, { color: colors.primary }]}>清空</ThemedText>
            </Pressable>
          </View>
          {history.length ? (
            history.map((item, index) => (
              <Pressable
                accessibilityRole="button"
                key={item}
                onPress={() => onSelect(item)}
                style={[
                  styles.historyRow,
                  index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
                ]}>
                <MaterialCommunityIcons name="history" size={18} color={colors.mutedText} />
                <ThemedText style={styles.historyText}>{item}</ThemedText>
                <MaterialCommunityIcons name="arrow-right" size={18} color={colors.mutedText} />
              </Pressable>
            ))
          ) : (
            <ThemedText style={[styles.emptyHistory, { color: colors.mutedText }]}>还没有搜索记录</ThemedText>
          )}
        </View>
      </View>
    </Modal>
  );
}

type SourceOptionsSheetProps = {
  allSelected: boolean;
  onClose: () => void;
  onRestoreDefaults: () => void;
  onToggleAll: () => void;
  visible: boolean;
};

function SourceOptionsSheet({
  allSelected,
  onClose,
  onRestoreDefaults,
  onToggleAll,
  visible,
}: SourceOptionsSheetProps) {
  const { colors } = useAppTheme();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭搜索源选项" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>搜索源选项</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>快速调整站点选择</ThemedText>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose}>
              <MaterialCommunityIcons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>
          <SecondaryAction
            icon={allSelected ? 'checkbox-blank-outline' : 'checkbox-multiple-marked-outline'}
            label={allSelected ? '取消全选' : '选择全部站点'}
            onPress={onToggleAll}
          />
          <SecondaryAction icon="restore" label="恢复默认 3 个站点" onPress={onRestoreDefaults} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screenShell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: appLayout.screenMaxWidth,
    overflow: 'hidden',
    width: '100%',
  },
  topBar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBarSide: {
    alignItems: 'flex-start',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 23,
  },
  topBarAction: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 26,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  scrollContentWithFooter: {
    paddingBottom: 34,
  },
  hero: {
    backgroundColor: HERO_COLOR,
    borderRadius: 24,
    minHeight: 248,
    overflow: 'hidden',
    padding: 22,
    position: 'relative',
  },
  heroTextureTop: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    borderWidth: 1,
    height: 112,
    position: 'absolute',
    right: -44,
    top: -30,
    transform: [{ rotate: '-17deg' }],
    width: 220,
  },
  heroTextureBottom: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    borderWidth: 1,
    height: 112,
    position: 'absolute',
    right: -78,
    top: 96,
    transform: [{ rotate: '-17deg' }],
    width: 220,
  },
  heroMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  heroMetaText: {
    color: LIME,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 36,
    marginBottom: 17,
    marginTop: 17,
  },
  heroSearch: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 15,
    flexDirection: 'row',
    gap: 9,
    height: 54,
    paddingLeft: 14,
    paddingRight: 8,
  },
  heroInput: {
    flex: 1,
    fontSize: 13,
    height: 50,
    minWidth: 0,
    padding: 0,
  },
  heroSearchButton: {
    alignItems: 'center',
    backgroundColor: LIME,
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  quickSearches: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 11,
  },
  quickLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 15,
  },
  quickItem: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  heroFeedback: {
    color: CORAL,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 8,
  },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 11,
    marginTop: 19,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  sourceList: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sourceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  sourceLogo: {
    alignItems: 'center',
    borderRadius: 13,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  sourceLogoText: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceName: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  sourceDomain: {
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 15,
    marginTop: 2,
  },
  sourceDescription: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  recentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 2,
  },
  recentText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 16,
  },
  queryBar: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    height: 54,
    paddingHorizontal: 10,
  },
  queryInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    height: 50,
    minWidth: 0,
    padding: 0,
  },
  queryClear: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  selectorHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 20,
    paddingHorizontal: 2,
  },
  selectorTitle: {
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 30,
  },
  selectorSubtitle: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  selectAllText: {
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 17,
    paddingVertical: 4,
  },
  selectorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  actionFooter: {
    borderTopWidth: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  prepareButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    height: 54,
    justifyContent: 'center',
  },
  prepareButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 20,
  },
  selectionCount: {
    alignItems: 'center',
    backgroundColor: LIME,
    borderRadius: 8,
    height: 25,
    justifyContent: 'center',
    marginLeft: 10,
    width: 25,
  },
  selectionCountText: {
    color: HERO_COLOR,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  footerHint: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 7,
    textAlign: 'center',
  },
  handoffIntro: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 5,
  },
  handoffIcon: {
    alignItems: 'center',
    backgroundColor: HERO_COLOR,
    borderRadius: 23,
    boxShadow: '0 12px 22px rgba(21, 27, 59, 0.18)',
    height: 72,
    justifyContent: 'center',
    marginBottom: 17,
    position: 'relative',
    width: 72,
  },
  handoffAccent: {
    backgroundColor: CORAL,
    borderColor: '#eef4ff',
    borderRadius: 9,
    borderWidth: 3,
    height: 18,
    position: 'absolute',
    right: -3,
    top: -3,
    width: 18,
  },
  handoffTitle: {
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 31,
    textAlign: 'center',
  },
  handoffDescription: {
    fontSize: 11,
    lineHeight: 18,
    marginTop: 7,
    textAlign: 'center',
  },
  queue: {
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 20,
    overflow: 'hidden',
  },
  queueRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 66,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  queueNumber: {
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 15,
    width: 24,
  },
  queueStatus: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15,
  },
  handoffActions: {
    marginTop: 17,
  },
  openButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    height: 54,
    justifyContent: 'center',
  },
  openButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    height: 44,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  feedbackLine: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    marginTop: 11,
    paddingHorizontal: 3,
  },
  feedbackText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  legalNote: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  legalText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 15,
  },
  bottomNav: {
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 72,
    paddingBottom: 8,
    paddingTop: 8,
  },
  bottomNavItem: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  bottomNavLabel: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
  },
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 15, 30, 0.56)',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    gap: 10,
    maxWidth: appLayout.screenMaxWidth,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    width: '100%',
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 27,
  },
  sheetMeta: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  sheetAction: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  historyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 50,
  },
  historyText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  emptyHistory: {
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 28,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.45,
  },
});
