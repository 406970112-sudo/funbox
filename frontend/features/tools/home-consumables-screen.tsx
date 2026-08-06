import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createHomeConsumablesEvent,
  createHomeConsumablesItem,
  deleteHomeConsumablesItem,
  dismissHomeConsumablesReminder,
  fetchHomeConsumablesCategories,
  fetchHomeConsumablesEvents,
  fetchHomeConsumablesItemEvents,
  fetchHomeConsumablesItems,
  fetchHomeConsumablesReminders,
  fetchHomeConsumablesShoppingList,
  fetchHomeConsumablesStats,
  fetchHomeConsumablesSummary,
  getHomeConsumablesErrorMessage,
  getHomeConsumablesExportUrl,
  importHomeConsumablesData,
  undoHomeConsumablesEvent,
  updateHomeConsumablesItem,
} from '@/lib/home-consumables-api';
import {
  eventTypeLabel,
  formatDateTime,
  formatStock,
  iconForCategory,
  iconForEventType,
  predictionColor,
  predictionStateLabel,
  remainingText,
  sourceLabel,
  todayDateString,
} from '@/lib/home-consumables';
import type {
  HomeConsumablesCategory,
  HomeConsumablesEvent,
  HomeConsumablesEventInput,
  HomeConsumablesEventType,
  HomeConsumablesItem,
  HomeConsumablesItemInput,
  HomeConsumablesReminder,
  HomeConsumablesStats,
  HomeConsumablesSummary,
} from '@/types/home-consumables';

type HomeConsumablesTab = 'home' | 'items' | 'shopping' | 'events' | 'stats';
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
const EVENT_TYPES: HomeConsumablesEventType[] = ['purchase', 'replace', 'consume', 'count'];

export function HomeConsumablesScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<HomeConsumablesTab>('home');
  const [summary, setSummary] = useState<HomeConsumablesSummary | null>(null);
  const [items, setItems] = useState<HomeConsumablesItem[]>([]);
  const [categories, setCategories] = useState<HomeConsumablesCategory[]>([]);
  const [shopping, setShopping] = useState<HomeConsumablesItem[]>([]);
  const [events, setEvents] = useState<HomeConsumablesEvent[]>([]);
  const [stats, setStats] = useState<HomeConsumablesStats | null>(null);
  const [reminders, setReminders] = useState<Awaited<ReturnType<typeof fetchHomeConsumablesReminders>>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [sort, setSort] = useState('days');
  const [itemModal, setItemModal] = useState<{ open: boolean; item?: HomeConsumablesItem }>({ open: false });
  const [eventModal, setEventModal] = useState<{ open: boolean; item?: HomeConsumablesItem }>({ open: false });
  const [detail, setDetail] = useState<HomeConsumablesItem | null>(null);
  const [detailEvents, setDetailEvents] = useState<HomeConsumablesEvent[]>([]);
  const requestRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!hasLoadedRef.current);
    setError(null);
    try {
      const [summaryData, categoryData, shoppingData, eventData, statData, reminderData] =
        await Promise.all([
          fetchHomeConsumablesSummary(accessToken, todayDateString()),
          fetchHomeConsumablesCategories(accessToken),
          fetchHomeConsumablesShoppingList(accessToken, todayDateString()),
          fetchHomeConsumablesEvents(accessToken),
          fetchHomeConsumablesStats(accessToken, '30d'),
          fetchHomeConsumablesReminders(accessToken, todayDateString()),
        ]);
      if (requestID !== requestRef.current) return;
      setSummary(summaryData);
      setCategories(categoryData);
      setShopping(shoppingData);
      setEvents(eventData);
      setStats(statData);
      setReminders(reminderData);
      setLoading(false);
      hasLoadedRef.current = true;
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getHomeConsumablesErrorMessage(nextError));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken]);

  const loadItems = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    try {
      const nextItems = await fetchHomeConsumablesItems(accessToken, {
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        state: stateFilter === 'all' ? undefined : stateFilter,
        q: search || undefined,
        sort,
      });
      if (requestID !== requestRef.current) return;
      setItems(nextItems);
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getHomeConsumablesErrorMessage(nextError));
    }
  }, [accessToken, categoryFilter, search, sort, stateFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (accessToken && activeTab === 'items') void loadItems();
  }, [accessToken, activeTab, loadItems]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await refresh();
      if (activeTab === 'items') await loadItems();
    } catch (nextError) {
      setError(getHomeConsumablesErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(itemId: string) {
    if (!accessToken) return;
    setDetail(null);
    setDetailEvents([]);
    try {
      const [itemData, eventData] = await Promise.all([
        fetchHomeConsumablesItems(accessToken, { q: itemId }),
        fetchHomeConsumablesItemEvents(accessToken, itemId),
      ]);
      setDetail(itemData.find((item) => item.id === itemId) ?? null);
      setDetailEvents(eventData);
    } catch (nextError) {
      setError(getHomeConsumablesErrorMessage(nextError));
    }
  }

  function openAddItem() {
    setItemModal({ open: true });
  }

  function openEventModal(item: HomeConsumablesItem) {
    setEventModal({ open: true, item });
  }

  if (authStatus === 'loading') {
    return <CenterState icon="home-clock-outline" title="正在打开家庭消耗品预测" loading />;
  }

  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="home-clock-outline" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.loginTitle}>登录后开始记录家庭消耗品</ThemedText>
          <ThemedText style={[styles.loginBody, { color: colors.mutedText }]}>
            登录后物品、余量和事件只属于当前账号。
          </ThemedText>
          <Pressable
            onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/home-consumables' } })}
            style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
            <ThemedText style={styles.primaryButtonText}>登录 / 注册</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <View style={styles.headerTitleWrap}>
          <ThemedText style={styles.headerTitle}>家庭消耗品预测</ThemedText>
          <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
            真实事件账本 · 智能补给
          </ThemedText>
        </View>
        <Pressable onPress={openAddItem} style={[styles.iconButton, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="plus" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        {(
          [
            ['home', '首页'],
            ['items', '物品'],
            ['shopping', '补给'],
            ['events', '账本'],
            ['stats', '统计'],
          ] as const
        ).map(([tab, label]) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tabButton, activeTab === tab && { backgroundColor: colors.surface }]}>
            <ThemedText style={[styles.tabLabel, activeTab === tab && { color: colors.primary }]}>
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {message ? (
        <View style={[styles.notice, { backgroundColor: colors.success + '18', borderColor: colors.success + '44' }]}>
          <ThemedText style={styles.noticeText}>{message}</ThemedText>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.notice, { backgroundColor: '#ff5d6c18', borderColor: '#ff5d6c55' }]}>
          <ThemedText style={styles.noticeText}>{error}</ThemedText>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} tintColor={colors.primary} />
        }>
        {activeTab === 'home' ? (
          <HomeView
            summary={summary}
            loading={loading}
            onAdd={openAddItem}
            onOpen={openDetail}
            onEvent={openEventModal}
          />
        ) : null}
        {activeTab === 'items' ? (
          <ItemsView
            items={items}
            categories={categories}
            loading={loading}
            search={search}
            setSearch={setSearch}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            stateFilter={stateFilter}
            setStateFilter={setStateFilter}
            sort={sort}
            setSort={setSort}
            onAdd={openAddItem}
            onOpen={openDetail}
            onEvent={openEventModal}
          />
        ) : null}
        {activeTab === 'shopping' ? (
          <ShoppingView
            items={shopping}
            reminders={reminders}
            onBuy={(item) => openEventModal(item)}
            onDismiss={(reminder) =>
              runMutation(
                () => dismissHomeConsumablesReminder(accessToken, reminder.itemId, reminder.remindAt),
                '提醒已关闭',
              )
            }
          />
        ) : null}
        {activeTab === 'events' ? (
          <EventsView
            events={events}
            onUndo={(event) =>
              runMutation(() => undoHomeConsumablesEvent(accessToken, event.id), '已撤销最近事件')
            }
            onExport={() => exportData()}
            onImport={() => importJson()}
          />
        ) : null}
        {activeTab === 'stats' ? (
          <StatsView stats={stats} onExport={() => exportData()} />
        ) : null}
      </ScrollView>

      <ItemModal
        visible={itemModal.open}
        item={itemModal.item}
        categories={categories}
        busy={busy}
        onClose={() => setItemModal({ open: false })}
        onSave={async (input) => {
          if (itemModal.item) {
            await runMutation(() => updateHomeConsumablesItem(accessToken, itemModal.item!.id, input), '物品已更新');
          } else {
            await runMutation(() => createHomeConsumablesItem(accessToken, input), '物品已添加');
          }
          setItemModal({ open: false });
        }}
      />
      <EventModal
        visible={eventModal.open}
        item={eventModal.item}
        busy={busy}
        onClose={() => setEventModal({ open: false })}
        onSave={async (input) => {
          if (!eventModal.item) return;
          await runMutation(
            () => createHomeConsumablesEvent(accessToken, eventModal.item!.id, input),
            `${eventTypeLabel(input.eventType)}已记录`,
          );
          setEventModal({ open: false });
        }}
      />
      <DetailModal
        item={detail}
        events={detailEvents}
        onClose={() => setDetail(null)}
        onEdit={(item) => {
          setDetail(null);
          setItemModal({ open: true, item });
        }}
        onEvent={openEventModal}
        onDelete={(item) => {
          Alert.alert('删除物品', `确认删除“${item.name}”吗？事件会进入归档。`, [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: () => {
                void runMutation(() => deleteHomeConsumablesItem(accessToken, item.id), '物品已删除');
                setDetail(null);
              },
            },
          ]);
        }}
      />
    </SafeAreaView>
  );

  async function exportData() {
    if (!accessToken) return;
    const response = await fetch(getHomeConsumablesExportUrl('json'), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      Alert.alert('导出失败', '请稍后重试。');
      return;
    }
    const blob = await response.blob();
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'home-consumables-export.json';
      anchor.click();
      URL.revokeObjectURL(url);
    } else {
      Alert.alert('导出提示', '当前可在网页端下载 JSON 导出文件。');
    }
  }

  async function importJson() {
    if (!accessToken) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    try {
      const uri = picked.assets[0].uri;
      const text = await fetch(uri).then((response) => response.text());
      const backup = JSON.parse(text) as {
        items: HomeConsumablesItem[];
        events: HomeConsumablesEvent[];
      };
      const payload = {
        items: backup.items.map((item) => ({
          categoryName: item.categoryName,
          item: {
            categoryId: item.categoryId,
            name: item.name,
            unit: item.unit,
            currentStock: item.currentStock,
            currentCycleStartedAt: item.currentCycleStartedAt?.slice(0, 10),
            remindDays: item.remindDays,
            note: item.note,
            source: item.source,
            status: item.status,
          },
          events: backup.events
            .filter((event) => event.itemId === item.id)
            .map((event) => ({
              eventType: event.eventType,
              quantity: event.quantity,
              occurredAt: event.occurredAt,
              source: event.source,
              note: event.note,
            })),
        })),
      };
      const count = await importHomeConsumablesData(accessToken, payload);
      Alert.alert('导入完成', `已导入 ${count} 个真实物品。`);
      await refresh();
    } catch {
      Alert.alert('导入失败', '请确认文件是有效的家庭消耗品 JSON 备份。');
    }
  }
}

function HomeView(props: {
  summary: HomeConsumablesSummary | null;
  loading: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onEvent: (item: HomeConsumablesItem) => void;
}) {
  const { colors } = useAppTheme();
  if (props.loading && !props.summary) return <CenterState icon="home-clock-outline" title="正在加载真实数据" loading />;
  if (!props.summary || props.summary.totalItems === 0) {
    return (
      <View style={styles.empty}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="shopping-outline" size={24} color={colors.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>先添加一个真实物品</ThemedText>
        <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
          不预置物品、余量或事件，所有预测只来自真实录入。
        </ThemedText>
        <Pressable onPress={props.onAdd} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
          <ThemedText style={styles.primaryButtonText}>添加第一个物品</ThemedText>
        </Pressable>
      </View>
    );
  }

  const hero = props.summary.items.find(
    (item) => item.prediction.remainingDays !== undefined && item.prediction.remainingDays <= item.remindDays,
  );
  const restock = props.summary.items.filter(
    (item) => item.prediction.remainingDays !== undefined && item.prediction.remainingDays <= item.remindDays,
  );
  const normal = props.summary.items.filter(
    (item) => item.prediction.remainingDays !== undefined && item.prediction.remainingDays > item.remindDays,
  );

  return (
    <View>
      {hero ? (
        <View style={[styles.heroCard, { backgroundColor: colors.hero }]}>
          <View style={styles.heroKicker}>
            <MaterialCommunityIcons name={iconForCategory(hero.categoryIcon)} size={15} color="#c9f36a" />
            <ThemedText style={styles.heroKickerText}>
              {hero.name} · {hero.prediction.sampleCount} 次真实周期
            </ThemedText>
          </View>
          <View style={styles.heroDays}>
            <ThemedText style={styles.heroDaysValue}>{hero.prediction.remainingDays}</ThemedText>
            <ThemedText style={styles.heroDaysUnit}>天</ThemedText>
          </View>
          <ThemedText style={styles.heroTitle}>预计还能用</ThemedText>
          <ThemedText style={styles.heroSubtitle}>
            当前 {formatStock(hero)} · {remainingText(hero)}
          </ThemedText>
          <View style={styles.heroActions}>
            <Pressable
              onPress={() => props.onEvent(hero)}
              style={[styles.heroButton, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
              <MaterialCommunityIcons name="refresh" size={15} color="#ffffff" />
              <ThemedText style={styles.heroButtonText}>换新</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => props.onEvent(hero)}
              style={[styles.heroButton, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
              <MaterialCommunityIcons name="plus" size={15} color="#ffffff" />
              <ThemedText style={styles.heroButtonText}>买了一份</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.heroCard, { backgroundColor: colors.hero }]}>
          <ThemedText style={styles.heroKickerText}>家庭消耗品预测</ThemedText>
          <ThemedText style={styles.heroTitle}>暂无需要立即补给</ThemedText>
          <ThemedText style={styles.heroSubtitle}>所有状态都由真实事件计算。</ThemedText>
        </View>
      )}

      <View style={styles.summaryGrid}>
        <StatCard label="需要补给" value={props.summary.needRestock} color="#ff5d6c" />
        <StatCard label="7 天内" value={props.summary.within7} color="#f1a33b" />
        <StatCard label="30 天内" value={props.summary.within30} color="#4b6bff" />
        <StatCard label="暂无预测" value={props.summary.noData} color="#7483a2" />
      </View>

      <SectionTitle title="需要关注" meta="按真实剩余天数排序" />
      {restock.length === 0 ? (
        <EmptyState icon="check-circle-outline" title="没有需要关注的物品" subtitle="清单不会为了版面填充数据。" />
      ) : (
        restock.map((item) => (
          <ItemCard key={item.id} item={item} onPress={() => props.onOpen(item.id)} onEvent={() => props.onEvent(item)} />
        ))
      )}

      <SectionTitle title="正常库存" meta="基于真实余量" />
      {normal.length === 0 ? (
        <EmptyState icon="database-outline" title="暂无正常库存" subtitle="添加物品或记录余量后会出现在这里。" />
      ) : (
        normal.slice(0, 4).map((item) => (
          <ItemCard key={item.id} item={item} onPress={() => props.onOpen(item.id)} onEvent={() => props.onEvent(item)} />
        ))
      )}
    </View>
  );
}

function ItemsView(props: {
  items: HomeConsumablesItem[];
  categories: HomeConsumablesCategory[];
  loading: boolean;
  search: string;
  setSearch: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  stateFilter: string;
  setStateFilter: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onEvent: (item: HomeConsumablesItem) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View>
      <View style={[styles.searchShell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={17} color={colors.mutedText} />
        <TextInput
          value={props.search}
          onChangeText={props.setSearch}
          placeholder="搜索名称、备注或分类"
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        <FilterPill label="全部" active={props.categoryFilter === 'all'} onPress={() => props.setCategoryFilter('all')} />
        {props.categories.map((category) => (
          <FilterPill
            key={category.id}
            label={category.name}
            active={props.categoryFilter === category.id}
            onPress={() => props.setCategoryFilter(category.id)}
          />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
        <FilterPill label="全部状态" active={props.stateFilter === 'all'} onPress={() => props.setStateFilter('all')} />
        <FilterPill label="需要补给" active={props.stateFilter === 'restock'} onPress={() => props.setStateFilter('restock')} />
        <FilterPill label="正常" active={props.stateFilter === 'normal'} onPress={() => props.setStateFilter('normal')} />
        <FilterPill label="暂无预测" active={props.stateFilter === 'no-data'} onPress={() => props.setStateFilter('no-data')} />
      </ScrollView>
      <View style={styles.sortRow}>
        <ThemedText style={[styles.sortCount, { color: colors.mutedText }]}>共 {props.items.length} 条真实物品</ThemedText>
        <Pressable onPress={() => props.setSort(props.sort === 'days' ? 'recent-replace' : 'days')} style={styles.sortButton}>
          <MaterialCommunityIcons name="swap-vertical" size={14} color={colors.primary} />
          <ThemedText style={[styles.sortText, { color: colors.primary }]}>
            {props.sort === 'days' ? '按剩余天数' : '按最近换新'}
          </ThemedText>
        </Pressable>
      </View>
      {props.loading ? (
        <CenterState icon="package-variant-closed" title="正在加载物品" loading />
      ) : props.items.length === 0 ? (
        <EmptyState
          icon="package-variant-closed"
          title="没有符合条件的真实物品"
          subtitle="清空筛选或添加第一个物品。"
        />
      ) : (
        props.items.map((item) => (
          <ItemCard key={item.id} item={item} onPress={() => props.onOpen(item.id)} onEvent={() => props.onEvent(item)} />
        ))
      )}
    </View>
  );
}

function ShoppingView(props: {
  items: HomeConsumablesItem[];
  reminders: Awaited<ReturnType<typeof fetchHomeConsumablesReminders>>;
  onBuy: (item: HomeConsumablesItem) => void;
  onDismiss: (reminder: HomeConsumablesReminder) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View>
      <View style={[styles.heroCard, darkHero(colors.hero)]}>
        <ThemedText style={styles.heroKickerText}>由真实预测生成</ThemedText>
        <ThemedText style={styles.heroTitle}>建议现在补给</ThemedText>
        <ThemedText style={styles.heroSubtitle}>{props.items.length} 件预计将在提醒阈值内用完</ThemedText>
      </View>
      {props.items.length === 0 ? (
        <EmptyState icon="check-circle-outline" title="没有需要补给的物品" subtitle="只有真实预测和阈值匹配的物品会出现在这里。" />
      ) : (
        props.items.map((item) => (
          <SurfaceCard key={item.id} style={styles.itemCard}>
            <View style={styles.itemMain}>
              <ThemedText style={styles.itemTitle}>{item.name}</ThemedText>
              <ThemedText style={styles.itemSub}>
                当前 {formatStock(item)} · {remainingText(item)}
              </ThemedText>
              <ThemedText style={styles.shoppingDate}>
                建议 {item.prediction.remainingDays !== undefined ? addDaysLabel(item.prediction.remainingDays) : '尽快'} 前购买
              </ThemedText>
            </View>
            <Pressable onPress={() => props.onBuy(item)} style={[styles.buyButton, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
              <ThemedText style={[styles.buyButtonText, { color: colors.primary }]}>买一份</ThemedText>
            </Pressable>
          </SurfaceCard>
        ))
      )}
      {props.reminders.length > 0 ? <SectionTitle title="提醒" meta="可关闭本次提醒" /> : null}
      {props.reminders.map((reminder) => (
        <View key={reminder.id} style={[styles.reminderRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.itemMain}>
            <ThemedText style={styles.itemTitle}>{reminder.itemName}</ThemedText>
            <ThemedText style={styles.itemSub}>预计剩余 {reminder.remainingDays} 天</ThemedText>
          </View>
          <Pressable onPress={() => props.onDismiss(reminder)} style={styles.dismissButton}>
            <ThemedText style={[styles.dismissText, { color: colors.mutedText }]}>关闭</ThemedText>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function EventsView(props: {
  events: HomeConsumablesEvent[];
  onUndo: (event: HomeConsumablesEvent) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View>
      <View style={styles.sortRow}>
        <ThemedText style={[styles.sortCount, { color: colors.mutedText }]}>共 {props.events.length} 条真实事件</ThemedText>
        <View style={styles.sortActions}>
          <Pressable onPress={props.onImport} style={[styles.iconButton, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="upload" size={17} color={colors.primary} />
          </Pressable>
          <Pressable onPress={props.onExport} style={[styles.iconButton, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="download" size={17} color={colors.primary} />
          </Pressable>
        </View>
      </View>
      {props.events.length === 0 ? (
        <EmptyState icon="database-outline" title="暂无事件" subtitle="买了一份、换新、用了部分和盘点都会进入账本。" />
      ) : (
        props.events.slice(0, 40).map((event) => (
          <View key={event.id} style={[styles.eventRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.eventIcon, { backgroundColor: eventColor(event.eventType) + '18' }]}>
              <MaterialCommunityIcons name={iconForEventType(event.eventType)} size={16} color={eventColor(event.eventType)} />
            </View>
            <View style={styles.itemMain}>
              <ThemedText style={styles.itemTitle}>
                {event.itemName ?? '物品'} · {eventTypeLabel(event.eventType)}
              </ThemedText>
              <ThemedText style={styles.itemSub}>
                {formatDateTime(event.occurredAt)} · {sourceLabel(event.source)}
              </ThemedText>
            </View>
            <View style={styles.eventRight}>
              <ThemedText style={styles.eventQuantity}>
                {event.eventType === 'purchase' ? '+' : event.eventType === 'count' ? '' : '-'}
                {event.quantity}
              </ThemedText>
              {!event.undoneAt ? (
                <Pressable onPress={() => props.onUndo(event)} style={styles.undoButton}>
                  <MaterialCommunityIcons name="undo" size={13} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function StatsView(props: { stats: HomeConsumablesStats | null; onExport: () => void }) {
  const { colors } = useAppTheme();
  if (!props.stats) return <CenterState icon="chart-line" title="正在加载统计" loading />;
  return (
    <View>
      <View style={[styles.heroCard, darkHero(colors.hero)]}>
        <ThemedText style={styles.heroKickerText}>近 30 天真实账本</ThemedText>
        <ThemedText style={styles.heroTitle}>月消耗 {props.stats.recent30Consumed}</ThemedText>
        <ThemedText style={styles.heroSubtitle}>购买 {props.stats.recent30Purchases} · 平均周期 {props.stats.avgCycleDays?.toFixed(1) ?? '暂无'} 天</ThemedText>
      </View>
      <View style={styles.summaryGrid}>
        <StatCard label="物品数" value={props.stats.totalItems} color="#4b6bff" />
        <StatCard label="需要补给" value={props.stats.needRestock} color="#ff5d6c" />
        <StatCard label="周期样本" value={props.stats.items.reduce((sum, item) => sum + item.sampleCount, 0)} color="#1db991" />
        <StatCard label="准确度" value={props.stats.predictionAccuracy ?? '暂无'} color="#7483a2" />
      </View>
      <SectionTitle title="周期与预测" meta="真实事件样本" />
      {props.stats.items.length === 0 ? (
        <EmptyState icon="chart-line" title="暂无统计" subtitle="添加物品并记录事件后生成。" />
      ) : (
        props.stats.items.slice(0, 8).map((item) => (
          <View key={item.id} style={[styles.statItem, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={styles.itemMain}>
              <ThemedText style={styles.itemTitle}>{item.name}</ThemedText>
              <ThemedText style={styles.itemSub}>
                当前 {item.currentStock ?? '未填写'} {item.unit} · {item.sampleCount} 次周期
              </ThemedText>
            </View>
            <ThemedText style={styles.itemTitle}>{item.avgCycleDays ? `${item.avgCycleDays.toFixed(1)} 天/${item.unit}` : '暂无'}</ThemedText>
          </View>
        ))
      )}
    </View>
  );
}

function ItemCard(props: { item: HomeConsumablesItem; onPress: () => void; onEvent: () => void }) {
  const { colors } = useAppTheme();
  const color = predictionColor(props.item.prediction.state);
  return (
    <SurfaceCard style={styles.itemCard}>
      <Pressable onPress={props.onPress} style={styles.itemMain}>
        <ThemedText style={styles.itemTitle}>{props.item.name}</ThemedText>
        <ThemedText style={styles.itemSub}>
          {props.item.categoryName} · {formatStock(props.item)}
        </ThemedText>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: color + '18' }]}>
            <ThemedText style={[styles.badgeText, { color }]}>{remainingText(props.item)}</ThemedText>
          </View>
          <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
            <ThemedText style={[styles.badgeText, { color: colors.primary }]}>
              {predictionStateLabel(props.item.prediction.state)}
            </ThemedText>
          </View>
        </View>
      </Pressable>
      <Pressable onPress={props.onEvent} style={[styles.buyButton, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name="plus" size={15} color={colors.primary} />
        <ThemedText style={[styles.buyButtonText, { color: colors.primary }]}>记录</ThemedText>
      </Pressable>
    </SurfaceCard>
  );
}

function ItemModal(props: {
  visible: boolean;
  item?: HomeConsumablesItem;
  categories: HomeConsumablesCategory[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: HomeConsumablesItemInput) => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [stock, setStock] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [remindDays, setRemindDays] = useState('7');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!props.visible) return;
    setName(props.item?.name ?? '');
    setUnit(props.item?.unit ?? '');
    setStock(props.item?.currentStock?.toString() ?? '');
    setStartedAt(props.item?.currentCycleStartedAt?.slice(0, 10) ?? todayDateString());
    setRemindDays(String(props.item?.remindDays ?? 7));
    setCategoryId(props.item?.categoryId ?? props.categories[0]?.id ?? '');
    setNote(props.item?.note ?? '');
  }, [props.visible, props.item, props.categories]);

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
          <ModalHeader title={props.item ? '编辑物品' : '新增物品'} onClose={props.onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <FormLabel label="名称" />
            <FormInput value={name} onChangeText={setName} placeholder="例如 洗衣液" />
            <FormLabel label="分类模板" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
              {props.categories.map((category) => (
                <FilterPill
                  key={category.id}
                  label={category.name}
                  active={categoryId === category.id}
                  onPress={() => setCategoryId(category.id)}
                />
              ))}
            </ScrollView>
            <FormLabel label="单位" />
            <FormInput value={unit} onChangeText={setUnit} placeholder="包 / 瓶 / kg" />
            <FormLabel label="当前余量" />
            <FormInput value={stock} onChangeText={setStock} keyboardType="decimal-pad" placeholder="0.5" />
            <FormLabel label="当前这份开始日期" />
            <FormInput value={startedAt} onChangeText={setStartedAt} placeholder="YYYY-MM-DD" />
            <FormLabel label="提醒阈值（天）" />
            <FormInput value={remindDays} onChangeText={setRemindDays} keyboardType="number-pad" placeholder="7" />
            <FormLabel label="备注" />
            <FormInput value={note} onChangeText={setNote} placeholder="可选" multiline />
            <View style={styles.modalActions}>
              <Pressable onPress={props.onClose} style={[styles.modalButton, { borderColor: colors.line }]}>
                <ThemedText style={styles.modalButtonText}>取消</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  const stockNumber = stock.trim() === '' ? undefined : Number(stock);
                  void props.onSave({
                    categoryId,
                    name,
                    unit,
                    currentStock: stockNumber,
                    currentCycleStartedAt: startedAt || undefined,
                    remindDays: Number(remindDays) || 7,
                    note,
                  });
                }}
                disabled={props.busy}
                style={[styles.modalButton, { backgroundColor: colors.hero }]}>
                {props.busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <ThemedText style={styles.modalButtonPrimaryText}>保存物品</ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EventModal(props: {
  visible: boolean;
  item?: HomeConsumablesItem;
  busy: boolean;
  onClose: () => void;
  onSave: (input: HomeConsumablesEventInput) => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [eventType, setEventType] = useState<HomeConsumablesEventType>('purchase');
  const [quantity, setQuantity] = useState('1');
  const [occurredAt, setOccurredAt] = useState(todayDateString());
  useEffect(() => {
    if (!props.visible) return;
    setEventType('purchase');
    setQuantity(props.item?.currentStock !== undefined && props.item.currentStock < 1 ? String(props.item.currentStock) : '1');
    setOccurredAt(todayDateString());
  }, [props.visible, props.item]);

  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
          <ModalHeader title={props.item ? `${props.item.name} · 记录真实事件` : '记录事件'} onClose={props.onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.seg}>
              {EVENT_TYPES.map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setEventType(type)}
                  style={[styles.segButton, eventType === type && { backgroundColor: colors.surface }]}>
                  <ThemedText style={[styles.segText, eventType === type && { color: colors.primary }]}>
                    {eventTypeLabel(type)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <FormLabel label="实际数量" />
            <FormInput value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="1" />
            <FormLabel label="发生日期" />
            <FormInput value={occurredAt} onChangeText={setOccurredAt} placeholder="YYYY-MM-DD" />
            <View style={styles.modalActions}>
              <Pressable onPress={props.onClose} style={[styles.modalButton, { borderColor: colors.line }]}>
                <ThemedText style={styles.modalButtonText}>取消</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  const quantityNumber = Number(quantity);
                  if (!props.item || Number.isNaN(quantityNumber) || quantityNumber <= 0) return;
                  void props.onSave({
                    eventType,
                    quantity: quantityNumber,
                    occurredAt: `${occurredAt}T12:00:00Z`,
                  });
                }}
                disabled={props.busy}
                style={[styles.modalButton, { backgroundColor: colors.hero }]}>
                {props.busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <ThemedText style={styles.modalButtonPrimaryText}>保存事件</ThemedText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailModal(props: {
  item: HomeConsumablesItem | null;
  events: HomeConsumablesEvent[];
  onClose: () => void;
  onEdit: (item: HomeConsumablesItem) => void;
  onEvent: (item: HomeConsumablesItem) => void;
  onDelete: (item: HomeConsumablesItem) => void;
}) {
  const { colors } = useAppTheme();
  if (!props.item) return null;
  const item = props.item;
  const color = predictionColor(item.prediction.state);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={props.onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
          <ModalHeader title={item.name} onClose={props.onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={[styles.detailHero, { backgroundColor: colors.hero }]}>
              <ThemedText style={styles.heroKickerText}>{item.categoryName} · {item.unit}</ThemedText>
              <ThemedText style={styles.heroTitle}>预计 {item.prediction.remainingDays ?? '暂无'} 天</ThemedText>
              <ThemedText style={styles.heroSubtitle}>当前 {formatStock(item)} · {predictionStateLabel(item.prediction.state)}</ThemedText>
            </View>
            <View style={styles.basisCard}>
              <SectionTitle title="近 3 次周期" meta={`${item.prediction.sampleCount} 次真实周期`} />
              <View style={styles.cycleRow}>
                {item.prediction.cycles.length === 0 ? (
                  <ThemedText style={[styles.itemSub, { color: colors.mutedText }]}>暂无足够周期，不会编造预测。</ThemedText>
                ) : (
                  item.prediction.cycles.map((cycle) => (
                    <View key={`${cycle.from}-${cycle.to}`} style={[styles.cycleBox, { backgroundColor: colors.primarySoft }]}>
                      <ThemedText style={[styles.cycleValue, { color: colors.primary }]}>{cycle.days} 天</ThemedText>
                      <ThemedText style={[styles.cycleLabel, { color: colors.mutedText }]}>
                        {cycle.from.slice(5)} - {cycle.to.slice(5)}
                      </ThemedText>
                    </View>
                  ))
                )}
              </View>
              <ThemedText style={[styles.predictionFormula, { color }]}>
                当前 {formatStock(item)} × 平均 {item.prediction.avgCycleDays?.toFixed(1) ?? '暂无'} 天/{item.unit}
              </ThemedText>
            </View>
            <View style={styles.detailActions}>
              <Pressable onPress={() => props.onEvent(item)} style={[styles.modalButton, { backgroundColor: colors.primarySoft }]}>
                <ThemedText style={[styles.modalButtonText, { color: colors.primary }]}>记录事件</ThemedText>
              </Pressable>
              <Pressable onPress={() => props.onEdit(item)} style={[styles.modalButton, { borderColor: colors.line }]}>
                <ThemedText style={styles.modalButtonText}>编辑</ThemedText>
              </Pressable>
              <Pressable onPress={() => props.onDelete(item)} style={[styles.modalButton, { borderColor: '#ff5d6c55' }]}>
                <ThemedText style={[styles.modalButtonText, { color: '#ff5d6c' }]}>删除</ThemedText>
              </Pressable>
            </View>
            <SectionTitle title="真实事件" meta="倒序" />
            {props.events.length === 0 ? (
              <EmptyState icon="database-outline" title="暂无事件" subtitle="记录买一份或换新后生成。" />
            ) : (
              props.events.slice(0, 8).map((event) => (
                <View key={event.id} style={[styles.eventRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <View style={[styles.eventIcon, { backgroundColor: eventColor(event.eventType) + '18' }]}>
                    <MaterialCommunityIcons name={iconForEventType(event.eventType)} size={16} color={eventColor(event.eventType)} />
                  </View>
                  <View style={styles.itemMain}>
                    <ThemedText style={styles.itemTitle}>{eventTypeLabel(event.eventType)}</ThemedText>
                    <ThemedText style={styles.itemSub}>{formatDateTime(event.occurredAt)} · {sourceLabel(event.source)}</ThemedText>
                  </View>
                  <ThemedText style={styles.eventQuantity}>{event.quantity}</ThemedText>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StatCard(props: { label: string; value: number | string; color: string }) {
  return (
    <View style={styles.statCard}>
      <ThemedText style={[styles.statValue, { color: props.color }]}>{props.value}</ThemedText>
      <ThemedText style={styles.statLabel}>{props.label}</ThemedText>
    </View>
  );
}

function SectionTitle(props: { title: string; meta: string }) {
  return (
    <View style={styles.sectionTitle}>
      <ThemedText style={styles.sectionTitleText}>{props.title}</ThemedText>
      <ThemedText style={styles.sectionMeta}>{props.meta}</ThemedText>
    </View>
  );
}

function EmptyState(props: { icon: IconName; title: string; subtitle: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name={props.icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.emptyText}>
        <ThemedText style={styles.emptyTitle}>{props.title}</ThemedText>
        <ThemedText style={styles.emptySub}>{props.subtitle}</ThemedText>
      </View>
    </View>
  );
}

function FilterPill(props: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={[
        styles.pill,
        { backgroundColor: colors.surface, borderColor: colors.line },
        props.active && { backgroundColor: colors.hero, borderColor: colors.hero },
      ]}>
      <ThemedText style={[styles.pillText, props.active && { color: '#c9f36a' }]}>{props.label}</ThemedText>
    </Pressable>
  );
}

function FormLabel(props: { label: string }) {
  return <ThemedText style={styles.formLabel}>{props.label}</ThemedText>;
}

function FormInput(props: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  multiline?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor={colors.mutedText}
      keyboardType={props.keyboardType}
      multiline={props.multiline}
      style={[
        styles.formInput,
        { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text },
        props.multiline && styles.formInputMultiline,
      ]}
    />
  );
}

function ModalHeader(props: { title: string; onClose: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <ThemedText style={styles.modalTitle}>{props.title}</ThemedText>
      <Pressable onPress={props.onClose} style={styles.modalClose}>
        <MaterialCommunityIcons name="close" size={20} color="#7483a2" />
      </Pressable>
    </View>
  );
}

function CenterState(props: { icon: IconName; title: string; loading?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.centerState}>
        {props.loading ? <ActivityIndicator size="large" color={colors.primary} /> : <MaterialCommunityIcons name={props.icon} size={38} color={colors.primary} />}
        <ThemedText style={styles.centerTitle}>{props.title}</ThemedText>
      </View>
    </SafeAreaView>
  );
}

function SurfaceCard(props: { children: React.ReactNode; style?: object }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.itemCard,
        { backgroundColor: colors.surface, borderColor: colors.line },
        props.style,
      ]}>
      {props.children}
    </View>
  );
}

function eventColor(type: HomeConsumablesEventType) {
  switch (type) {
    case 'purchase':
      return '#1db991';
    case 'replace':
      return '#4b6bff';
    case 'consume':
      return '#f1a33b';
    case 'count':
      return '#7e5bef';
    default:
      return '#7483a2';
  }
}

function darkHero(hero: string) {
  return { backgroundColor: hero };
}

function addDaysLabel(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 54,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  headerTitleWrap: {
    flex: 1,
    paddingHorizontal: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  tabs: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginHorizontal: 14,
    marginTop: 10,
    padding: 3,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  content: {
    paddingBottom: 40,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  notice: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 8,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  heroCard: {
    borderRadius: 18,
    marginBottom: 12,
    padding: 16,
  },
  heroLight: {
    backgroundColor: '#151b3b',
  },
  heroDark: {
    backgroundColor: '#1d2730',
  },
  heroKicker: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  heroKickerText: {
    color: '#c9f36a',
    fontSize: 10,
    fontWeight: '900',
  },
  heroDays: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  heroDaysValue: {
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 38,
  },
  heroDaysUnit: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '800',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 8,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 5,
  },
  heroActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  heroButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 12,
  },
  heroButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  statCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde6fb',
    flex: 1,
    paddingVertical: 10,
  },
  statValue: {
    fontSize: 17,
    fontWeight: '900',
  },
  statLabel: {
    color: '#7483a2',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  sectionTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: '900',
  },
  sectionMeta: {
    color: '#7483a2',
    fontSize: 10,
    fontWeight: '700',
  },
  itemCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 12,
  },
  itemMain: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  itemSub: {
    color: '#7483a2',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 6,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '900',
  },
  buyButton: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 10,
  },
  buyButtonText: {
    fontSize: 10,
    fontWeight: '900',
  },
  shoppingDate: {
    color: '#ff5d6c',
    fontSize: 10,
    fontWeight: '900',
    marginTop: 4,
  },
  searchShell: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    minHeight: 42,
  },
  pills: {
    gap: 7,
    paddingBottom: 10,
    paddingRight: 8,
  },
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 11,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sortRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sortCount: {
    fontSize: 10,
    fontWeight: '700',
  },
  sortButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  sortActions: {
    flexDirection: 'row',
    gap: 6,
  },
  sortText: {
    fontSize: 10,
    fontWeight: '900',
  },
  empty: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 16,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emptyText: {
    flex: 1,
    marginLeft: 10,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  emptyBody: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
    textAlign: 'center',
  },
  emptySub: {
    color: '#7483a2',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  reminderRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 7,
    padding: 11,
  },
  dismissButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  dismissText: {
    fontSize: 10,
    fontWeight: '800',
  },
  eventRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 7,
    padding: 10,
  },
  eventIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  eventRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  eventQuantity: {
    fontSize: 12,
    fontWeight: '900',
  },
  undoButton: {
    padding: 3,
  },
  statItem: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 7,
    padding: 11,
  },
  basisCard: {
    backgroundColor: '#e6ebff',
    borderRadius: 14,
    marginBottom: 12,
    padding: 12,
  },
  cycleRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  cycleBox: {
    borderRadius: 10,
    flex: 1,
    paddingVertical: 8,
  },
  cycleValue: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  cycleLabel: {
    fontSize: 8,
    fontWeight: '700',
    marginTop: 3,
    textAlign: 'center',
  },
  predictionFormula: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 10,
  },
  detailHero: {
    borderRadius: 16,
    marginBottom: 12,
    padding: 14,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 12,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(9,17,38,0.46)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '88%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dde6fb',
    flexDirection: 'row',
    height: 52,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  modalClose: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  modalContent: {
    padding: 16,
  },
  formLabel: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 8,
  },
  formInput: {
    borderRadius: 11,
    borderWidth: 1,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: 11,
  },
  formInputMultiline: {
    minHeight: 72,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  seg: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dde6fb',
    flexDirection: 'row',
    marginBottom: 10,
    padding: 3,
  },
  segButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    minHeight: 32,
  },
  segText: {
    fontSize: 10,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  modalButton: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
  },
  modalButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  modalButtonPrimaryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  loginState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  loginTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 16,
  },
  loginBody: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  centerTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 12,
  },
});
