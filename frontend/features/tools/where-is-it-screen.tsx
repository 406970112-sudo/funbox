import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import { SurfaceCard } from '@/shared/ui/surface-card';
import {
  clearWhereIsItSearchHistory,
  confirmWhereIsItItem,
  createWhereIsItItem,
  createWhereIsItRoom,
  deleteWhereIsItItem,
  deleteWhereIsItPhoto,
  deleteWhereIsItRoom,
  downloadWhereIsItExport,
  fetchWhereIsItHistory,
  fetchWhereIsItItem,
  fetchWhereIsItItems,
  fetchWhereIsItRooms,
  fetchWhereIsItSearchHistory,
  fetchWhereIsItSummary,
  getWhereIsItErrorMessage,
  moveWhereIsItItem,
  updateWhereIsItItem,
  updateWhereIsItRoom,
  uploadWhereIsItPhoto,
  whereIsItImageSource,
  whereIsItMediaURL,
} from '@/lib/where-is-it-api';
import {
  categoriesForPicker,
  eventActionLabel,
  formatWhereIsItTime,
  lastSeenLabel,
  locationLabel,
  parseTags,
  roomIconName,
  sortOptions,
  tagsText,
  unconfirmedLabel,
} from '@/lib/where-is-it';
import type {
  WhereIsItItem,
  WhereIsItItemDetail,
  WhereIsItItemInput,
  WhereIsItMoveEvent,
  WhereIsItPhoto,
  WhereIsItRoom,
  WhereIsItRoomInput,
  WhereIsItSummary,
} from '@/types/where-is-it';

type Tab = 'items' | 'rooms';
type StatusFilter = 'all' | 'confirmed' | 'unconfirmed';
type PickedPhoto = { uri: string; name?: string; type?: string };

export function WhereIsItScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [tab, setTab] = useState<Tab>('items');
  const [summary, setSummary] = useState<WhereIsItSummary | null>(null);
  const [rooms, setRooms] = useState<WhereIsItRoom[]>([]);
  const [items, setItems] = useState<WhereIsItItem[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState('updated');
  const [detail, setDetail] = useState<WhereIsItItemDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailHistory, setDetailHistory] = useState<WhereIsItMoveEvent[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WhereIsItItem | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [movingItem, setMovingItem] = useState<WhereIsItItem | null>(null);
  const [roomModal, setRoomModal] = useState<{ open: boolean; room?: WhereIsItRoom }>({ open: false });
  const [initialPhotoCapture, setInitialPhotoCapture] = useState(false);
  const refreshRequestRef = useRef(0);
  const itemsRequestRef = useRef(0);

  const refreshAll = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++refreshRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [summaryData, roomData, historyData] = await Promise.all([
        fetchWhereIsItSummary(accessToken),
        fetchWhereIsItRooms(accessToken),
        fetchWhereIsItSearchHistory(accessToken),
      ]);
      if (requestID !== refreshRequestRef.current) return;
      setSummary(summaryData);
      setRooms(roomData);
      setSearchHistory(historyData);
      setLoading(false);
    } catch (nextError) {
      if (requestID !== refreshRequestRef.current) return;
      setError(getWhereIsItErrorMessage(nextError));
      setLoading(false);
    }
  }, [accessToken]);

  const loadItems = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++itemsRequestRef.current;
    try {
      const nextItems = await fetchWhereIsItItems(accessToken, {
        q: search.trim() || undefined,
        roomId: roomFilter || undefined,
        category: categoryFilter || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
        sort,
      });
      if (requestID !== itemsRequestRef.current) return;
      setItems(nextItems);
      setError(null);
    } catch (nextError) {
      if (requestID !== itemsRequestRef.current) return;
      setError(getWhereIsItErrorMessage(nextError));
    }
  }, [accessToken, search, roomFilter, categoryFilter, statusFilter, sort]);

  useEffect(() => {
    if (accessToken) void refreshAll();
  }, [accessToken, refreshAll]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = setTimeout(() => void loadItems(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [accessToken, loadItems, search]);

  useEffect(() => {
    if (accessToken && !search) void loadItems();
  }, [accessToken, roomFilter, categoryFilter, statusFilter, sort, loadItems, search]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await Promise.all([refreshAll(), loadItems()]);
    } catch (nextError) {
      setError(getWhereIsItErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(itemId: string) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const [itemDetail, history] = await Promise.all([
        fetchWhereIsItItem(accessToken, itemId),
        fetchWhereIsItHistory(accessToken, itemId),
      ]);
      setDetail(itemDetail);
      setDetailHistory(history);
      setDetailOpen(true);
    } catch (nextError) {
      setError(getWhereIsItErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  function openAdd(photoFirst = false) {
    setEditingItem(null);
    setInitialPhotoCapture(photoFirst);
    setEditOpen(true);
  }

  if (authStatus === 'loading') return <PageLoadingFrame title="物品在哪里" variant="workbench" />;
  if (!accessToken) {
    return (
      <MobileScreen>
        <PageHeader
          title="物品在哪里"
          subtitle="记录不常用物品的真实位置"
          rightSlot={
            <Pressable onPress={() => router.push('/auth')} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="login" size={18} color={colors.primary} />
            </Pressable>
          }
        />
        <SurfaceCard style={styles.noticeCard}>
          <View style={[styles.noticeIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="map-marker-radius" size={28} color={colors.primary} />
          </View>
          <ThemedText style={styles.noticeTitle}>登录后使用真实数据</ThemedText>
          <ThemedText style={[styles.noticeBody, { color: colors.mutedText }]}>
            物品、房间、照片与位置历史只保存在当前账号下。
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
            <ThemedText style={styles.primaryButtonText}>登录 / 注册</ThemedText>
            <MaterialCommunityIcons name="arrow-right" size={17} color="#c9f36a" />
          </Pressable>
        </SurfaceCard>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen scrollContentStyle={styles.pageContent}>
      <PageHeader
        title="物品在哪里"
        subtitle="真实物品、真实位置、真实历史"
        eyebrow="FunBox Tools"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="刷新" onPress={() => void refreshAll()} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="添加物品" onPress={() => openAdd(false)} style={[styles.iconButton, { backgroundColor: colors.hero, borderColor: colors.hero }]}>
              <MaterialCommunityIcons name="plus" size={19} color="#c9f36a" />
            </Pressable>
          </View>
        }
      />
      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        <Pressable accessibilityRole="button" onPress={() => setTab('items')} style={[styles.tabButton, tab === 'items' && { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="package-variant-closed" size={17} color={tab === 'items' ? colors.primary : colors.mutedText} />
          <ThemedText style={[styles.tabLabel, { color: tab === 'items' ? colors.text : colors.mutedText }]}>物品</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setTab('rooms')} style={[styles.tabButton, tab === 'rooms' && { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="home-city" size={17} color={tab === 'rooms' ? colors.primary : colors.mutedText} />
          <ThemedText style={[styles.tabLabel, { color: tab === 'rooms' ? colors.text : colors.mutedText }]}>房间</ThemedText>
        </Pressable>
      </View>
      {message ? <MessageBanner text={message} color={colors.success} /> : null}
      {error ? <MessageBanner text={error} color={colors.accent} /> : null}
      {loading ? (
        <SurfaceCard style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>正在读取真实数据</ThemedText>
        </SurfaceCard>
      ) : tab === 'items' ? (
        <ItemsTab
          accessToken={accessToken}
          summary={summary}
          rooms={rooms}
          items={items}
          search={search}
          roomFilter={roomFilter}
          categoryFilter={categoryFilter}
          statusFilter={statusFilter}
          sort={sort}
          searchHistory={searchHistory}
          colors={colors}
          onSearch={setSearch}
          onRoomFilter={setRoomFilter}
          onCategoryFilter={setCategoryFilter}
          onStatusFilter={setStatusFilter}
          onSort={setSort}
          onOpenAdd={() => openAdd(false)}
          onOpenAddPhoto={() => openAdd(true)}
          onOpenItem={(itemId) => void openDetail(itemId)}
          onClearSearchHistory={() =>
            void runMutation(async () => {
              await clearWhereIsItSearchHistory(accessToken);
              setSearchHistory([]);
            }, '搜索历史已清空')
          }
          onExport={(format) =>
            void runMutation(async () => {
              await downloadWhereIsItExport(accessToken, format);
            }, `已导出 ${format === 'csv' ? 'CSV' : 'JSON'} 真实数据`)
          }
        />
      ) : (
        <RoomsTab
          rooms={rooms}
          summary={summary}
          colors={colors}
          onOpenRoom={(roomId) => {
            setRoomFilter(roomId);
            setTab('items');
          }}
          onAddRoom={() => setRoomModal({ open: true })}
          onEditRoom={(room) => setRoomModal({ open: true, room })}
          onDeleteRoom={(room) =>
            void runMutation(async () => {
              await deleteWhereIsItRoom(accessToken, room.id);
            }, '房间已删除')
          }
        />
      )}
      <ItemEditModal
        open={editOpen}
        item={editingItem}
        rooms={rooms}
        accessToken={accessToken}
        initialPhotoCapture={initialPhotoCapture}
        colors={colors}
        onClose={() => {
          setEditOpen(false);
          setInitialPhotoCapture(false);
        }}
        onSaved={async () => {
          setEditOpen(false);
          setInitialPhotoCapture(false);
          await Promise.all([refreshAll(), loadItems()]);
        }}
      />
      <ItemDetailModal
        open={detailOpen}
        item={detail}
        history={detailHistory}
        accessToken={accessToken}
        colors={colors}
        onClose={() => setDetailOpen(false)}
        onEdit={() => {
          if (!detail) return;
          setEditingItem(detail);
          setDetailOpen(false);
          setEditOpen(true);
        }}
        onMove={() => {
          if (!detail) return;
          setMovingItem(detail);
          setDetailOpen(false);
          setMoveOpen(true);
        }}
        onConfirm={() =>
          void runMutation(async () => {
            await confirmWhereIsItItem(accessToken, detail!.id);
            const [itemDetail, history] = await Promise.all([
              fetchWhereIsItItem(accessToken, detail!.id),
              fetchWhereIsItHistory(accessToken, detail!.id),
            ]);
            setDetail(itemDetail);
            setDetailHistory(history);
          }, '已确认物品还在原位置')
        }
        onDelete={() => {
          if (!detail) return;
          Alert.alert('删除物品', '删除后物品不再出现在列表中，位置历史会保留。', [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: () =>
                void runMutation(async () => {
                  await deleteWhereIsItItem(accessToken, detail.id);
                  setDetailOpen(false);
                  setDetail(null);
                }, '物品已删除'),
            },
          ]);
        }}
        onDeletePhoto={(photo) =>
          void runMutation(async () => {
            if (!detail) return;
            await deleteWhereIsItPhoto(accessToken, detail.id, photo.id);
            const [itemDetail, history] = await Promise.all([
              fetchWhereIsItItem(accessToken, detail.id),
              fetchWhereIsItHistory(accessToken, detail.id),
            ]);
            setDetail(itemDetail);
            setDetailHistory(history);
          }, '照片已删除')
        }
      />
      <MoveModal
        open={moveOpen}
        item={movingItem}
        rooms={rooms}
        accessToken={accessToken}
        colors={colors}
        onClose={() => setMoveOpen(false)}
        onSaved={async () => {
          setMoveOpen(false);
          await Promise.all([refreshAll(), loadItems()]);
        }}
      />
      <RoomModal
        open={roomModal.open}
        room={roomModal.room}
        accessToken={accessToken}
        colors={colors}
        onClose={() => setRoomModal({ open: false })}
        onSaved={async () => {
          setRoomModal({ open: false });
          await Promise.all([refreshAll(), loadItems()]);
        }}
      />
    </MobileScreen>
  );
}

function ItemsTab(props: {
  accessToken: string;
  summary: WhereIsItSummary | null;
  rooms: WhereIsItRoom[];
  items: WhereIsItItem[];
  search: string;
  roomFilter: string;
  categoryFilter: string;
  statusFilter: StatusFilter;
  sort: string;
  searchHistory: string[];
  colors: ReturnType<typeof useAppTheme>['colors'];
  onSearch: (value: string) => void;
  onRoomFilter: (value: string) => void;
  onCategoryFilter: (value: string) => void;
  onStatusFilter: (value: StatusFilter) => void;
  onSort: (value: string) => void;
  onOpenAdd: () => void;
  onOpenAddPhoto: () => void;
  onOpenItem: (itemId: string) => void;
  onClearSearchHistory: () => void;
  onExport: (format: 'csv' | 'json') => void;
}) {
  const { summary, rooms, items, search, roomFilter, categoryFilter, statusFilter, sort, searchHistory, colors } = props;
  const filtered = Boolean(roomFilter || categoryFilter || statusFilter !== 'all' || search.trim());
  return (
    <>
      <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.primary} />
        <TextInput value={search} onChangeText={props.onSearch} placeholder="搜索物品、房间、位置或标签" placeholderTextColor={colors.mutedText} style={[styles.searchInput, { color: colors.text }]} />
        {search ? (
          <Pressable onPress={() => props.onSearch('')} style={styles.clearSearch}>
            <MaterialCommunityIcons name="close-circle" size={17} color={colors.mutedText} />
          </Pressable>
        ) : null}
      </View>
      {!search && searchHistory.length > 0 ? (
        <View style={styles.sectionBlock}>
          <SectionTitle title="最近搜索" meta="真实搜索词" actionLabel="清空" onAction={props.onClearSearchHistory} />
          <View style={styles.chipWrap}>
            {searchHistory.map((query) => (
              <FilterPill key={query} label={query} icon="history" active={search === query} onPress={() => props.onSearch(query)} colors={colors} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.quickActions}>
        <Pressable accessibilityRole="button" onPress={props.onOpenAddPhoto} style={[styles.quickButton, { backgroundColor: colors.hero }]}>
          <MaterialCommunityIcons name="camera" size={18} color="#c9f36a" />
          <ThemedText style={styles.quickButtonText}>拍照记录</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onOpenAdd} style={[styles.quickButton, { backgroundColor: colors.primary }]}>
          <MaterialCommunityIcons name="pencil-plus" size={18} color="#ffffff" />
          <ThemedText style={styles.quickButtonPrimaryText}>手动添加</ThemedText>
        </Pressable>
      </View>
      <View style={styles.sectionBlock}>
        <SectionTitle title="房间" meta={`${summary?.totalItems ?? 0} 件真实物品`} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomChipRow}>
          <FilterPill label="全部房间" icon="home-variant" active={roomFilter === ''} onPress={() => props.onRoomFilter('')} colors={colors} />
          {rooms.map((room) => (
            <FilterPill key={room.id} label={`${room.name} ${room.itemCount}`} icon={roomIconName(room.icon)} active={roomFilter === room.id} onPress={() => props.onRoomFilter(roomFilter === room.id ? '' : room.id)} colors={colors} iconColor={room.color} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.sectionBlock}>
        <SectionTitle title="筛选" meta="与搜索叠加" />
        <View style={styles.chipWrap}>
          {categoriesForPicker().map((category) => (
            <FilterPill key={category} label={category} active={categoryFilter === category} onPress={() => props.onCategoryFilter(categoryFilter === category ? '' : category)} colors={colors} />
          ))}
          <FilterPill label="已确认" icon="check" active={statusFilter === 'confirmed'} onPress={() => props.onStatusFilter(statusFilter === 'confirmed' ? 'all' : 'confirmed')} colors={colors} />
          <FilterPill label="未确认" icon="timer-outline" active={statusFilter === 'unconfirmed'} onPress={() => props.onStatusFilter(statusFilter === 'unconfirmed' ? 'all' : 'unconfirmed')} colors={colors} />
        </View>
      </View>
      <View style={styles.sectionBlock}>
        <SectionTitle title="排序" meta="真实时间" />
        <View style={styles.chipWrap}>
          {sortOptions().map((option) => (
            <FilterPill key={option.value} label={option.label} active={sort === option.value} onPress={() => props.onSort(option.value)} colors={colors} />
          ))}
        </View>
      </View>
      {items.length === 0 ? (
        <SurfaceCard style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name={filtered ? 'magnify-close' : 'package-variant-closed'} size={30} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>{filtered ? '没有找到匹配物品' : '还没有物品'}</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
            {filtered ? '清除筛选或搜索词后查看真实记录。' : '从手边的真实物品开始记录，不预置任何演示数据。'}
          </ThemedText>
          {!filtered ? (
            <Pressable accessibilityRole="button" onPress={props.onOpenAdd} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
              <ThemedText style={styles.primaryButtonText}>添加第一件物品</ThemedText>
              <MaterialCommunityIcons name="plus" size={17} color="#c9f36a" />
            </Pressable>
          ) : null}
        </SurfaceCard>
      ) : (
        <View style={styles.itemList}>
          {items.map((item) => (
            <ItemCard key={item.id} item={item} accessToken={props.accessToken} colors={colors} onPress={() => props.onOpenItem(item.id)} />
          ))}
        </View>
      )}
      <View style={styles.exportRow}>
        <Pressable accessibilityRole="button" onPress={() => props.onExport('csv')} style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="file-delimited-outline" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导出 CSV</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => props.onExport('json')} style={[styles.exportButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="code-json" size={16} color={colors.primary} />
          <ThemedText style={[styles.exportText, { color: colors.text }]}>导出 JSON</ThemedText>
        </Pressable>
      </View>
    </>
  );
}

function RoomsTab(props: {
  rooms: WhereIsItRoom[];
  summary: WhereIsItSummary | null;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onOpenRoom: (roomId: string) => void;
  onAddRoom: () => void;
  onEditRoom: (room: WhereIsItRoom) => void;
  onDeleteRoom: (room: WhereIsItRoom) => void;
}) {
  const { rooms, summary, colors } = props;
  return (
    <>
      <SurfaceCard style={styles.summaryCard}>
        <View style={[styles.summaryIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="home-city" size={20} color={colors.primary} />
        </View>
        <View style={styles.summaryCopy}>
          <ThemedText style={styles.summaryTitle}>{rooms.length} 个房间</ThemedText>
          <ThemedText style={[styles.summaryMeta, { color: colors.mutedText }]}>
            {summary?.totalItems ?? 0} 件真实物品 · {summary?.unconfirmedCount ?? 0} 件久未确认
          </ThemedText>
        </View>
      </SurfaceCard>
      <View style={styles.roomGrid}>
        {rooms.map((room) => (
          <Pressable key={room.id} accessibilityRole="button" onPress={() => props.onOpenRoom(room.id)} style={[styles.roomCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.roomIcon, { backgroundColor: `${room.color}18` }]}>
              <MaterialCommunityIcons name={roomIconName(room.icon)} size={20} color={room.color} />
            </View>
            <View style={styles.roomCopy}>
              <ThemedText style={styles.roomName}>{room.name}</ThemedText>
              <ThemedText style={[styles.roomMeta, { color: colors.mutedText }]}>{room.itemCount} 件物品</ThemedText>
            </View>
            {!room.isSystem ? (
              <View style={styles.roomActions}>
                <Pressable accessibilityRole="button" onPress={() => props.onEditRoom(room)} style={styles.smallIconButton}>
                  <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => Alert.alert('删除房间', `确定删除“${room.name}”吗？`, [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => props.onDeleteRoom(room) }])} style={styles.smallIconButton}>
                  <MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.accent} />
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={props.onAddRoom} style={[styles.addRoomButton, { borderColor: colors.line, backgroundColor: colors.surface }]}>
        <MaterialCommunityIcons name="plus" size={17} color={colors.primary} />
        <ThemedText style={[styles.addRoomText, { color: colors.primary }]}>添加自定义房间</ThemedText>
      </Pressable>
    </>
  );
}

function ItemCard(props: { item: WhereIsItItem; accessToken: string; colors: ReturnType<typeof useAppTheme>['colors']; onPress: () => void }) {
  const { item, colors } = props;
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {item.coverPhotoUrl ? (
        <WhereIsItPhotoImage imageUrl={item.coverPhotoUrl} token={props.accessToken} style={styles.itemThumb} />
      ) : (
        <View style={[styles.itemThumb, { backgroundColor: `${item.roomColor || '#4b6bff'}18` }]}>
          <MaterialCommunityIcons name={roomIconName(item.roomIcon)} size={20} color={item.roomColor || '#4b6bff'} />
        </View>
      )}
      <View style={styles.itemCopy}>
        <ThemedText style={styles.itemName}>{item.name}</ThemedText>
        <ThemedText style={[styles.itemLocation, { color: colors.mutedText }]}>{locationLabel(item)}</ThemedText>
        <ThemedText style={[styles.itemMeta, { color: item.unconfirmedDays >= 180 ? colors.accent : colors.mutedText }]}>
          {unconfirmedLabel(item.unconfirmedDays)} · {item.photoCount} 张照片
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
    </Pressable>
  );
}

function WhereIsItPhotoImage(props: { imageUrl: string; token: string; style?: object }) {
  const [webURI, setWebURI] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !props.imageUrl) return;
    let active = true;
    let objectURL: string | null = null;
    void fetch(whereIsItMediaURL(props.imageUrl), { headers: { Authorization: `Bearer ${props.token}` } })
      .then((response) => {
        if (!response.ok) throw new Error('where is it image request failed');
        return response.blob();
      })
      .then((blob) => {
        objectURL = URL.createObjectURL(blob);
        if (active) setWebURI(objectURL);
      })
      .catch(() => {
        if (active) setWebURI(null);
      });
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [props.imageUrl, props.token]);
  const source = Platform.OS === 'web' ? (webURI ? { uri: webURI } : undefined) : whereIsItImageSource(props.token, props.imageUrl);
  return <Image contentFit="cover" source={source} style={props.style} />;
}

function ItemEditModal(props: {
  open: boolean;
  item: WhereIsItItem | null;
  rooms: WhereIsItRoom[];
  accessToken: string;
  initialPhotoCapture?: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { open, item, rooms, accessToken, initialPhotoCapture, colors, onClose, onSaved } = props;
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [nearby, setNearby] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [pickedPhotos, setPickedPhotos] = useState<PickedPhoto[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickPhoto = useCallback(async (source: 'camera' | 'library') => {
    try {
      const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setSubmitError(source === 'camera' ? '需要相机权限才能拍照。' : '需要相册权限才能选择照片。');
        return;
      }
      const picked = source === 'camera' ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      setPickedPhotos((current) => [...current, { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg' }]);
    } catch {
      if (source === 'camera' && Platform.OS === 'web') {
        await pickPhoto('library');
        return;
      }
      setSubmitError('无法打开照片来源，请重试。');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setRoomId(item?.roomId ?? rooms[0]?.id ?? '');
    setLocation(item?.locationDetail ?? '');
    setCategory(item?.category ?? '');
    setNearby(item?.nearbyHint ?? '');
    setNote(item?.note ?? '');
    setTags(tagsText(item?.tags ?? []));
    setPickedPhotos([]);
    setSubmitError(null);
  }, [open, item, rooms]);

  useEffect(() => {
    if (!open || !initialPhotoCapture) return;
    const timer = setTimeout(() => void pickPhoto('camera'), 250);
    return () => clearTimeout(timer);
  }, [open, initialPhotoCapture, pickPhoto]);

  async function save() {
    setSubmitError(null);
    if (!name.trim() || !roomId || !location.trim()) {
      setSubmitError('物品名称、房间和具体位置为必填项。');
      return;
    }
    setBusy(true);
    try {
      const input: WhereIsItItemInput = { name: name.trim(), roomId, locationDetail: location.trim(), category: category || '', nearbyHint: nearby.trim(), note: note.trim(), tags: parseTags(tags), coverPhotoId: item?.coverPhotoId ?? null };
      let saved = item?.id ? await updateWhereIsItItem(accessToken, item.id, input) : await createWhereIsItItem(accessToken, input);
      for (let index = 0; index < pickedPhotos.length; index += 1) {
        await uploadWhereIsItPhoto(accessToken, saved.id, pickedPhotos[index], { cover: index === 0 && !saved.coverPhotoId });
      }
      await onSaved();
    } catch (nextError) {
      setSubmitError(getWhereIsItErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title={item ? '编辑物品' : '新增物品'} onClose={onClose} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <View style={styles.photoPickerRow}>
              {pickedPhotos.map((photo) => <Image key={photo.uri} source={{ uri: photo.uri }} style={styles.pickedPhoto} contentFit="cover" />)}
              <PhotoAddButton icon="camera" label="拍照" onPress={() => void pickPhoto('camera')} colors={colors} />
              <PhotoAddButton icon="image-plus" label="相册" onPress={() => void pickPhoto('library')} colors={colors} />
            </View>
            <FormLabel label="物品名称 *" />
            <TextInput value={name} onChangeText={setName} placeholder="例如：备用钥匙" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <FormLabel label="房间 *" />
            <View style={styles.chipWrap}>
              {rooms.map((room) => <FilterPill key={room.id} label={room.name} icon={roomIconName(room.icon)} active={roomId === room.id} onPress={() => setRoomId(room.id)} colors={colors} />)}
            </View>
            <FormLabel label="具体位置 *" />
            <TextInput value={location} onChangeText={setLocation} placeholder="例如：电视柜第二层" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <FormLabel label="物品分类" />
            <View style={styles.chipWrap}>
              {categoriesForPicker().map((value) => <FilterPill key={value} label={value} active={category === value} onPress={() => setCategory(category === value ? '' : value)} colors={colors} />)}
            </View>
            <FormLabel label="附近标志物" />
            <TextInput value={nearby} onChangeText={setNearby} placeholder="例如：白色抽屉第二格" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <FormLabel label="标签" />
            <TextInput value={tags} onChangeText={setTags} placeholder="用逗号分隔，最多 8 个" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <FormLabel label="备注" />
            <TextInput value={note} onChangeText={setNote} multiline numberOfLines={3} placeholder="补充真实说明" placeholderTextColor={colors.mutedText} style={[styles.textarea, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            {submitError ? <ThemedText style={[styles.formError, { color: colors.accent }]}>{submitError}</ThemedText> : null}
            <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.hero, opacity: busy ? 0.65 : 1 }]}>
              <ThemedText style={styles.primaryButtonText}>{busy ? '保存中' : '保存物品'}</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ItemDetailModal(props: {
  open: boolean;
  item: WhereIsItItemDetail | null;
  history: WhereIsItMoveEvent[];
  accessToken: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onEdit: () => void;
  onMove: () => void;
  onConfirm: () => void;
  onDelete: () => void;
  onDeletePhoto: (photo: WhereIsItPhoto) => void;
}) {
  const { open, item, history, accessToken, colors, onClose } = props;
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
        <ModalHeader title={item?.name ?? '物品详情'} onClose={onClose} />
        <ScrollView contentContainerStyle={styles.modalContent}>
          {item ? (
            <>
              {item.photos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.detailPhotos}>
                  {item.photos.map((photo) => (
                    <View key={photo.id} style={styles.detailPhotoWrap}>
                      <WhereIsItPhotoImage imageUrl={photo.fileUrl} token={accessToken} style={styles.detailPhoto} />
                      <Pressable accessibilityRole="button" onPress={() => props.onDeletePhoto(photo)} style={styles.photoDeleteButton}>
                        <MaterialCommunityIcons name="trash-can-outline" size={14} color="#ffffff" />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={[styles.detailPhoto, { backgroundColor: colors.primarySoft }]}>
                  <MaterialCommunityIcons name="image-off-outline" size={28} color={colors.primary} />
                </View>
              )}
              <SurfaceCard style={styles.detailLocationCard}>
                <View style={[styles.detailLocationIcon, { backgroundColor: `${item.roomColor || '#4b6bff'}18` }]}>
                  <MaterialCommunityIcons name={roomIconName(item.roomIcon)} size={20} color={item.roomColor || '#4b6bff'} />
                </View>
                <View style={styles.detailLocationCopy}>
                  <ThemedText style={styles.detailLocationTitle}>{locationLabel(item)}</ThemedText>
                  <ThemedText style={[styles.detailLocationMeta, { color: colors.mutedText }]}>{item.nearbyHint ? `附近标志物：${item.nearbyHint}` : '暂无附近标志物'}</ThemedText>
                  <ThemedText style={[styles.detailLocationMeta, { color: colors.mutedText }]}>最后确认：{lastSeenLabel(item)}</ThemedText>
                </View>
              </SurfaceCard>
              <View style={styles.detailTags}>
                {item.category ? <View style={[styles.detailTag, { backgroundColor: colors.primarySoft }]}><ThemedText style={[styles.detailTagText, { color: colors.primary }]}>{item.category}</ThemedText></View> : null}
                {item.tags.map((tag) => <View key={tag} style={[styles.detailTag, { backgroundColor: colors.surfaceMuted }]}><ThemedText style={[styles.detailTagText, { color: colors.mutedText }]}>{tag}</ThemedText></View>)}
              </View>
              {item.note ? <SurfaceCard style={styles.noteCard}><ThemedText style={styles.noteText}>{item.note}</ThemedText></SurfaceCard> : null}
              <View style={styles.detailActions}>
                <Pressable accessibilityRole="button" onPress={props.onMove} style={[styles.actionButton, { backgroundColor: colors.accent }]}>
                  <ThemedText style={styles.actionButtonText}>移动位置</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={props.onConfirm} style={[styles.actionButton, { backgroundColor: colors.success }]}>
                  <ThemedText style={styles.actionButtonText}>确认还在</ThemedText>
                </Pressable>
              </View>
              <View style={styles.detailInlineActions}>
                <Pressable accessibilityRole="button" onPress={props.onEdit} style={[styles.inlineButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <ThemedText style={[styles.inlineButtonText, { color: colors.primary }]}>编辑</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={props.onDelete} style={[styles.inlineButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <ThemedText style={[styles.inlineButtonText, { color: colors.accent }]}>删除</ThemedText>
                </Pressable>
              </View>
              <SectionTitle title="位置历史" meta="真实操作" />
              {history.length === 0 ? <ThemedText style={[styles.emptyHistory, { color: colors.mutedText }]}>暂无移动与确认记录。</ThemedText> : history.map((event) => (
                <View key={event.id} style={[styles.historyItem, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <View style={[styles.historyIcon, { backgroundColor: event.action === 'move' ? colors.accent + '18' : colors.success + '18' }]}>
                    <MaterialCommunityIcons name={event.action === 'move' ? 'move-resize-variant' : 'check'} size={15} color={event.action === 'move' ? colors.accent : colors.success} />
                  </View>
                  <View style={styles.historyCopy}>
                    <ThemedText style={styles.historyTitle}>{eventActionLabel(event.action)}{event.action === 'move' ? ` 到 ${event.toRoomName} · ${event.toLocationDetail}` : ''}</ThemedText>
                    <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>{event.action === 'move' ? `从 ${event.fromRoomName} · ${event.fromLocationDetail}` : `确认仍在 ${event.toRoomName} · ${event.toLocationDetail}`}</ThemedText>
                  </View>
                  <ThemedText style={[styles.historyTime, { color: colors.mutedText }]}>{formatWhereIsItTime(event.movedAt)}</ThemedText>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function MoveModal(props: {
  open: boolean;
  item: WhereIsItItem | null;
  rooms: WhereIsItRoom[];
  accessToken: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { open, item, rooms, accessToken, colors, onClose, onSaved } = props;
  const [roomId, setRoomId] = useState('');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [pickedPhoto, setPickedPhoto] = useState<PickedPhoto | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRoomId(item?.roomId ?? rooms[0]?.id ?? '');
    setLocation(item?.locationDetail ?? '');
    setNote('');
    setPickedPhoto(null);
    setSubmitError(null);
  }, [open, item, rooms]);

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setSubmitError('需要相册权限才能选择移动照片。');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    setPickedPhoto({ uri: asset.uri, name: asset.fileName ?? 'move.jpg', type: asset.mimeType ?? 'image/jpeg' });
  }

  async function save() {
    if (!item || !roomId || !location.trim()) {
      setSubmitError('请选择新房间并填写具体位置。');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      let photoId = '';
      if (pickedPhoto) {
        const uploaded = await uploadWhereIsItPhoto(accessToken, item.id, pickedPhoto, { kind: 'move' });
        photoId = uploaded.id;
      }
      await moveWhereIsItItem(accessToken, item.id, { roomId, locationDetail: location.trim(), note: note.trim(), photoId: photoId || undefined });
      await onSaved();
    } catch (nextError) {
      setSubmitError(getWhereIsItErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title="移动位置" onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            {item ? <SurfaceCard style={styles.moveCurrentCard}><ThemedText style={styles.moveCurrentValue}>{locationLabel(item)}</ThemedText></SurfaceCard> : null}
            <FormLabel label="新房间 *" />
            <View style={styles.chipWrap}>
              {rooms.map((room) => <FilterPill key={room.id} label={room.name} icon={roomIconName(room.icon)} active={roomId === room.id} onPress={() => setRoomId(room.id)} colors={colors} />)}
            </View>
            <FormLabel label="新具体位置 *" />
            <TextInput value={location} onChangeText={setLocation} placeholder="例如：衣柜顶部" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <FormLabel label="备注" />
            <TextInput value={note} onChangeText={setNote} placeholder="可填写真实说明" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <Pressable accessibilityRole="button" onPress={() => void pickPhoto()} style={[styles.photoPickerSingle, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {pickedPhoto ? <Image source={{ uri: pickedPhoto.uri }} style={styles.pickedPhoto} contentFit="cover" /> : <MaterialCommunityIcons name="camera-plus-outline" size={20} color={colors.primary} />}
              <ThemedText style={[styles.photoAddText, { color: colors.primary }]}>{pickedPhoto ? '更换移动照片' : '添加移动照片（可选）'}</ThemedText>
            </Pressable>
            {submitError ? <ThemedText style={[styles.formError, { color: colors.accent }]}>{submitError}</ThemedText> : null}
            <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.hero, opacity: busy ? 0.65 : 1 }]}>
              <ThemedText style={styles.primaryButtonText}>{busy ? '保存中' : '确认移动'}</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RoomModal(props: {
  open: boolean;
  room?: WhereIsItRoom;
  accessToken: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { open, room, accessToken, colors, onClose, onSaved } = props;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('home-outline');
  const [color, setColor] = useState('#4b6bff');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const icons = ['home-outline', 'door-open', 'sofa', 'bed', 'notebook-edit-outline', 'bathtub-outline', 'flower-outline', 'warehouse'];
  const colorsList = ['#4b6bff', '#ff6b8f', '#f1a33b', '#20ad78', '#8b5cf6', '#18a78f'];
  useEffect(() => {
    if (!open) return;
    setName(room?.name ?? '');
    setIcon(room?.icon ?? 'home-outline');
    setColor(room?.color ?? '#4b6bff');
    setSubmitError(null);
  }, [open, room]);
  async function save() {
    if (!name.trim()) {
      setSubmitError('请输入房间名称。');
      return;
    }
    setBusy(true);
    try {
      const input: WhereIsItRoomInput = { name: name.trim(), icon, color, sortOrder: room?.sortOrder ?? 99 };
      if (room) await updateWhereIsItRoom(accessToken, room.id, input);
      else await createWhereIsItRoom(accessToken, input);
      await onSaved();
    } catch (nextError) {
      setSubmitError(getWhereIsItErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <ModalHeader title={room ? '编辑房间' : '添加房间'} onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalContent}>
            <FormLabel label="房间名称 *" />
            <TextInput value={name} onChangeText={setName} placeholder="例如：储物间" placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} />
            <FormLabel label="图标" />
            <View style={styles.chipWrap}>{icons.map((iconName) => <FilterPill key={iconName} label="" icon={iconName} active={icon === iconName} onPress={() => setIcon(iconName)} colors={colors} />)}</View>
            <FormLabel label="颜色" />
            <View style={styles.colorRow}>{colorsList.map((value) => <Pressable key={value} onPress={() => setColor(value)} style={[styles.colorSwatch, { backgroundColor: value, borderColor: color === value ? colors.text : 'transparent' }]}>{color === value ? <MaterialCommunityIcons name="check" size={14} color="#ffffff" /> : null}</Pressable>)}</View>
            {submitError ? <ThemedText style={[styles.formError, { color: colors.accent }]}>{submitError}</ThemedText> : null}
            <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.hero, opacity: busy ? 0.65 : 1 }]}>
              <ThemedText style={styles.primaryButtonText}>{busy ? '保存中' : '保存房间'}</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SectionTitle(props: { title: string; meta?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <ThemedText style={styles.sectionTitle}>{props.title}</ThemedText>
      <View style={styles.sectionMetaRow}>
        {props.meta ? <ThemedText style={[styles.sectionMeta, { color: '#7483a2' }]}>{props.meta}</ThemedText> : null}
        {props.onAction && props.actionLabel ? <Pressable onPress={props.onAction}><ThemedText style={[styles.sectionAction, { color: '#4b6bff' }]}>{props.actionLabel}</ThemedText></Pressable> : null}
      </View>
    </View>
  );
}

function FormLabel(props: { label: string }) {
  return <ThemedText style={styles.formLabel}>{props.label}</ThemedText>;
}

function ModalHeader(props: { title: string; onClose: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <ThemedText style={styles.modalTitle}>{props.title}</ThemedText>
      <Pressable accessibilityRole="button" onPress={props.onClose} style={styles.modalClose}>
        <MaterialCommunityIcons name="close" size={20} color="#7483a2" />
      </Pressable>
    </View>
  );
}

function PhotoAddButton(props: { icon: string; label: string; onPress: () => void; colors: ReturnType<typeof useAppTheme>['colors'] }) {
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={[styles.photoAddButton, { backgroundColor: props.colors.surface, borderColor: props.colors.line }]}>
      <MaterialCommunityIcons name={props.icon as never} size={18} color={props.colors.primary} />
      <ThemedText style={[styles.photoAddText, { color: props.colors.primary }]}>{props.label}</ThemedText>
    </Pressable>
  );
}

function FilterPill(props: { label: string; icon?: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useAppTheme>['colors']; iconColor?: string }) {
  const { label, icon, active, onPress, colors, iconColor } = props;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.filterPill, { backgroundColor: active ? colors.hero : colors.surface, borderColor: active ? colors.hero : colors.line }]}>
      {icon ? <MaterialCommunityIcons name={icon as never} size={13} color={active ? '#c9f36a' : iconColor || colors.primary} /> : null}
      {label ? <ThemedText style={[styles.filterPillText, { color: active ? '#ffffff' : colors.text }]}>{label}</ThemedText> : null}
    </Pressable>
  );
}

function MessageBanner(props: { text: string; color: string }) {
  return (
    <View style={[styles.messageBanner, { backgroundColor: props.color + '18' }]}>
      <ThemedText style={[styles.messageText, { color: props.color }]}>{props.text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pageContent: { gap: 14, paddingBottom: 48 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  tabs: { borderRadius: 16, borderWidth: 1, flexDirection: 'row', padding: 4 },
  tabButton: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 42 },
  tabLabel: { fontSize: 13, fontWeight: '800' },
  searchField: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 46, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 13, fontWeight: '700', paddingVertical: 10 },
  clearSearch: { alignItems: 'center', height: 32, justifyContent: 'center', width: 32 },
  quickActions: { flexDirection: 'row', gap: 10 },
  quickButton: { alignItems: 'center', borderRadius: 14, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  quickButtonText: { color: '#c9f36a', fontSize: 13, fontWeight: '800' },
  quickButtonPrimaryText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  sectionBlock: { gap: 9 },
  sectionHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionMetaRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  sectionMeta: { fontSize: 11, fontWeight: '700' },
  sectionAction: { fontSize: 11, fontWeight: '800' },
  roomChipRow: { gap: 8, paddingRight: 20 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterPill: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 34, paddingHorizontal: 11 },
  filterPillText: { fontSize: 11, fontWeight: '800' },
  itemList: { gap: 10 },
  itemCard: { alignItems: 'center', borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 11, minHeight: 78, padding: 11 },
  itemThumb: { alignItems: 'center', borderRadius: 13, height: 50, justifyContent: 'center', width: 50 },
  itemCopy: { flex: 1, gap: 3 },
  itemName: { fontSize: 14, fontWeight: '900' },
  itemLocation: { fontSize: 12, fontWeight: '700' },
  itemMeta: { fontSize: 10, fontWeight: '700' },
  emptyCard: { alignItems: 'center', borderRadius: 20, gap: 8, paddingHorizontal: 20, paddingVertical: 28 },
  emptyIcon: { alignItems: 'center', borderRadius: 18, height: 58, justifyContent: 'center', width: 58 },
  emptyTitle: { fontSize: 16, fontWeight: '900' },
  emptyBody: { fontSize: 12, lineHeight: 19, textAlign: 'center' },
  primaryButton: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 46, paddingHorizontal: 18 },
  primaryButtonText: { color: '#c9f36a', fontSize: 13, fontWeight: '900' },
  exportRow: { flexDirection: 'row', gap: 10 },
  exportButton: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 44 },
  exportText: { fontSize: 12, fontWeight: '800' },
  summaryCard: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 12, padding: 14 },
  summaryIcon: { alignItems: 'center', borderRadius: 13, height: 44, justifyContent: 'center', width: 44 },
  summaryCopy: { flex: 1, gap: 2 },
  summaryTitle: { fontSize: 15, fontWeight: '900' },
  summaryMeta: { fontSize: 11, fontWeight: '700' },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  roomCard: { alignItems: 'center', borderRadius: 17, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 70, padding: 10, width: '48.5%' },
  roomIcon: { alignItems: 'center', borderRadius: 12, height: 40, justifyContent: 'center', width: 40 },
  roomCopy: { flex: 1, gap: 2 },
  roomName: { fontSize: 13, fontWeight: '900' },
  roomMeta: { fontSize: 10, fontWeight: '700' },
  roomActions: { gap: 4 },
  smallIconButton: { alignItems: 'center', height: 24, justifyContent: 'center', width: 24 },
  addRoomButton: { alignItems: 'center', borderRadius: 14, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48 },
  addRoomText: { fontSize: 12, fontWeight: '800' },
  noticeCard: { alignItems: 'center', borderRadius: 22, gap: 10, padding: 22 },
  noticeIcon: { alignItems: 'center', borderRadius: 18, height: 58, justifyContent: 'center', width: 58 },
  noticeTitle: { fontSize: 17, fontWeight: '900' },
  noticeBody: { fontSize: 12, lineHeight: 19, textAlign: 'center' },
  loadingCard: { alignItems: 'center', borderRadius: 18, gap: 10, paddingVertical: 34 },
  loadingText: { fontSize: 11, fontWeight: '700' },
  messageBanner: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 7, padding: 10 },
  messageText: { flex: 1, fontSize: 11, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9, 17, 38, 0.42)' },
  modalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '88%', paddingBottom: 24 },
  modalHeader: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dce5f6', flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 18 },
  modalTitle: { fontSize: 17, fontWeight: '900' },
  modalClose: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  modalContent: { gap: 10, padding: 18 },
  photoPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  photoAddButton: { alignItems: 'center', borderRadius: 13, borderWidth: 1, gap: 3, height: 76, justifyContent: 'center', width: 76 },
  photoAddText: { fontSize: 10, fontWeight: '800' },
  pickedPhoto: { borderRadius: 13, height: 76, width: 76 },
  formLabel: { fontSize: 12, fontWeight: '900', marginTop: 4 },
  input: { borderRadius: 13, borderWidth: 1, fontSize: 13, fontWeight: '700', minHeight: 44, paddingHorizontal: 12 },
  textarea: { borderRadius: 13, borderWidth: 1, fontSize: 13, fontWeight: '700', minHeight: 86, padding: 12, textAlignVertical: 'top' },
  formError: { fontSize: 11, fontWeight: '800' },
  detailPhotos: { gap: 9, paddingBottom: 4 },
  detailPhotoWrap: { position: 'relative' },
  detailPhoto: { borderRadius: 15, height: 150, width: 230 },
  photoDeleteButton: { alignItems: 'center', backgroundColor: 'rgba(9, 17, 38, 0.72)', borderRadius: 10, height: 28, justifyContent: 'center', position: 'absolute', right: 7, top: 7, width: 28 },
  detailLocationCard: { alignItems: 'center', borderRadius: 18, flexDirection: 'row', gap: 11, padding: 13 },
  detailLocationIcon: { alignItems: 'center', borderRadius: 12, height: 42, justifyContent: 'center', width: 42 },
  detailLocationCopy: { flex: 1, gap: 2 },
  detailLocationTitle: { fontSize: 15, fontWeight: '900' },
  detailLocationMeta: { fontSize: 11, fontWeight: '700' },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  detailTag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  detailTagText: { fontSize: 10, fontWeight: '800' },
  noteCard: { borderRadius: 15, gap: 5, padding: 12 },
  noteText: { fontSize: 12, lineHeight: 19 },
  detailActions: { flexDirection: 'row', gap: 9 },
  actionButton: { alignItems: 'center', borderRadius: 14, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  actionButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  detailInlineActions: { flexDirection: 'row', gap: 9 },
  inlineButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 40 },
  inlineButtonText: { fontSize: 12, fontWeight: '800' },
  emptyHistory: { fontSize: 11 },
  historyItem: { alignItems: 'flex-start', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 10 },
  historyIcon: { alignItems: 'center', borderRadius: 9, height: 30, justifyContent: 'center', width: 30 },
  historyCopy: { flex: 1, gap: 2 },
  historyTitle: { fontSize: 12, fontWeight: '900' },
  historyMeta: { fontSize: 10, fontWeight: '700' },
  historyTime: { fontSize: 9, fontWeight: '700' },
  moveCurrentCard: { borderRadius: 15, gap: 3, padding: 12 },
  moveCurrentValue: { fontSize: 14, fontWeight: '900' },
  photoPickerSingle: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 84, padding: 8 },
  colorRow: { flexDirection: 'row', gap: 10 },
  colorSwatch: { alignItems: 'center', borderRadius: 20, borderWidth: 2, height: 36, justifyContent: 'center', width: 36 },
});
