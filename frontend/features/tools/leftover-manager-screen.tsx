import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  clearLeftoverData,
  createLeftoverItem,
  deleteLeftoverItem,
  deleteLeftoverPhoto,
  discardLeftoverItem,
  downloadLeftoverExport,
  eatLeftoverItem,
  fetchLeftoverHistory,
  fetchLeftoverHome,
  fetchLeftoverItem,
  fetchLeftoverItems,
  fetchLeftoverRecipe,
  fetchLeftoverSettings,
  getLeftoverManagerErrorMessage,
  reheatLeftoverItem,
  saveLeftoverSettings,
  updateLeftoverItem,
  uploadLeftoverPhoto,
} from '@/lib/leftover-manager-api';
import {
  buildLocalHistory,
  buildLocalHome,
  deadlineLabel,
  eventActionLabel,
  formatLeftoverTime,
  INGREDIENT_TAG_OPTIONS,
  localAddItem,
  localAddPhoto,
  localClearState,
  localDeleteItem,
  localDeletePhoto,
  localDiscard,
  localEat,
  localReheat,
  localUpdateItem,
  localUpdateSettings,
  reheatLabel,
  remainingLabel,
  sourceTypeLabel,
  statusLabel,
  validateLeftoverItemInput,
  zoneLabel,
} from '@/lib/leftover-manager';
import {
  clearLeftoverLocalState,
  getLeftoverLocalState,
  setLeftoverLocalState,
} from '@/lib/leftover-manager-storage';
import type {
  LeftoverHistoryPayload,
  LeftoverHomePayload,
  LeftoverItem,
  LeftoverItemDetail,
  LeftoverItemInput,
  LeftoverLocalState,
  LeftoverSettings,
  Recipe,
  RecipeMatch,
} from '@/types/leftover-manager';
import {
  createEmptyLeftoverLocalState,
  createEmptyLeftoverSettings,
  LEFTOVER_SOURCE_TYPES,
  LEFTOVER_ZONES,
} from '@/types/leftover-manager';

type Tab = 'home' | 'inventory' | 'history';
type PickedPhoto = { uri: string; name?: string; type?: string };
type Color = ReturnType<typeof useAppTheme>['colors'];

const remainingOptions = [
  { value: 100, label: '完整' },
  { value: 66, label: '三分之二' },
  { value: 50, label: '一半' },
  { value: 25, label: '少量' },
  { value: 10, label: '一口' },
];

function emptyInput(): LeftoverItemInput {
  const now = Date.now();
  return {
    name: '', sourceType: 'leftover', merchant: '',
    enteredFridgeAt: now, expectedConsumeAt: now + 24 * 60 * 60 * 1000,
    storedZone: 'fridge', remainingPercent: 50, remainingText: '一半',
    reheatCount: 0, tags: [], costCents: 0, notes: '',
  };
}

function formatDateTimeLocal(value: number) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value: string) {
  const parsed = new Date(value.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function LeftoverManagerScreen() {
  const router = useRouter();
  const { accessToken: token, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [tab, setTab] = useState<Tab>('home');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localState, setLocalState] = useState<LeftoverLocalState>(createEmptyLeftoverLocalState);
  const [remoteHome, setRemoteHome] = useState<LeftoverHomePayload | null>(null);
  const [remoteItems, setRemoteItems] = useState<LeftoverItem[]>([]);
  const [remoteHistory, setRemoteHistory] = useState<LeftoverHistoryPayload | null>(null);
  const [remoteSettings, setRemoteSettings] = useState<LeftoverSettings | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<LeftoverItem | null>(null);
  const [draft, setDraft] = useState<LeftoverItemInput>(emptyInput);
  const [pendingPhotos, setPendingPhotos] = useState<PickedPhoto[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<LeftoverItemDetail | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');

  const isRemote = Boolean(token);
  const localHome = useMemo(
    () => (isRemote ? null : buildLocalHome(localState)),
    [isRemote, localState],
  );
  const home = isRemote ? remoteHome : localHome;
  const currentItems = isRemote ? remoteItems : localState.items;
  const currentHistory = isRemote ? remoteHistory : buildLocalHistory(localState);

  const refreshRemote = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [homeData, items, history, settings] = await Promise.all([
        fetchLeftoverHome(token),
        fetchLeftoverItems(token),
        fetchLeftoverHistory(token),
        fetchLeftoverSettings(token),
      ]);
      setRemoteHome(homeData);
      setRemoteItems(items);
      setRemoteHistory(history);
      setRemoteSettings(settings);
      setLoading(false);
    } catch (nextError) {
      setError(getLeftoverManagerErrorMessage(nextError));
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (token) {
        await refreshRemote();
      } else {
        const stored = await getLeftoverLocalState();
        if (active) {
          setLocalState(stored);
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [token, refreshRemote]);

  async function persistLocal(nextState: LeftoverLocalState, notice?: string) {
    setLocalState(nextState);
    await setLeftoverLocalState(nextState);
    if (notice) setMessage(notice);
  }

  async function runMutation(action: () => Promise<unknown>, notice?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (notice) setMessage(notice);
      if (token) await refreshRemote();
    } catch (nextError) {
      setError(getLeftoverManagerErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  function openAdd() {
    setEditingItem(null);
    setDraft(emptyInput());
    setPendingPhotos([]);
    setEditOpen(true);
  }

  function openEdit(item: LeftoverItem) {
    setEditingItem(item);
    setDraft({
      name: item.name, sourceType: item.sourceType, merchant: item.merchant,
      enteredFridgeAt: item.enteredFridgeAt, expectedConsumeAt: item.expectedConsumeAt,
      storedZone: item.storedZone, remainingPercent: item.remainingPercent,
      remainingText: item.remainingText, reheatCount: item.reheatCount,
      tags: item.tags, costCents: item.costCents, notes: item.notes,
    });
    setPendingPhotos([]);
    setEditOpen(true);
  }

  async function openDetail(item: LeftoverItem) {
    if (isRemote && token) {
      setBusy(true);
      try {
        setDetail(await fetchLeftoverItem(token, item.id));
        setDetailOpen(true);
      } catch (nextError) {
        setError(getLeftoverManagerErrorMessage(nextError));
      } finally {
        setBusy(false);
      }
      return;
    }
    setDetail({
      ...item,
      photos: [],
      events: localState.events
        .filter((event) => event.itemId === item.id)
        .sort((left, right) => right.happenedAt - left.happenedAt),
    });
    setDetailOpen(true);
  }

  async function saveItem() {
    const validationError = validateLeftoverItemInput(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isRemote && token) {
        const saved = editingItem
          ? await updateLeftoverItem(token, editingItem.id, draft)
          : await createLeftoverItem(token, draft);
        for (const photo of pendingPhotos) {
          await uploadLeftoverPhoto(token, saved.id, photo);
        }
        await refreshRemote();
        setMessage(editingItem ? '记录已更新' : '记录已保存');
      } else {
        let nextState = localState;
        let saved: LeftoverItem | null = null;
        const result = editingItem
          ? localUpdateItem(nextState, editingItem.id, draft)
          : localAddItem(nextState, draft);
        if (result.error) throw new Error(result.error);
        nextState = result.state;
        saved = result.item;
        if (saved) {
          for (const photo of pendingPhotos) {
            const photoResult = localAddPhoto(nextState, saved.id, photo.uri);
            if (photoResult.error) throw new Error(photoResult.error);
            nextState = photoResult.state;
          }
        }
        await persistLocal(nextState, editingItem ? '记录已更新' : '记录已保存');
      }
      setEditOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  async function pickPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 3 - pendingPhotos.length,
      quality: 0.8,
    });
    if (result.canceled) return;
    const next = result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    }));
    setPendingPhotos((current) => [...current, ...next].slice(0, 3));
  }

  function itemAction(kind: 'reheat' | 'eat' | 'discard', item: LeftoverItem) {
    void runMutation(async () => {
      if (isRemote && token) {
        if (kind === 'reheat') await reheatLeftoverItem(token, item.id);
        if (kind === 'eat') await eatLeftoverItem(token, item.id);
        if (kind === 'discard') await discardLeftoverItem(token, item.id, '变质');
      } else if (kind === 'reheat') {
        await persistLocal(localReheat(localState, item.id).state);
      } else if (kind === 'eat') {
        await persistLocal(localEat(localState, item.id).state);
      } else {
        const result = localDiscard(localState, item.id, '变质');
        if (result.error) throw new Error(result.error);
        await persistLocal(result.state);
      }
    }, kind === 'reheat' ? '已记录加热一次' : kind === 'eat' ? '已标记吃完' : '已记录丢弃');
  }

  function handleDiscard(item: LeftoverItem) {
    Alert.alert('丢弃记录', '将记录为“变质”，如需其他原因请稍后在详情中补充。', [
      { text: '取消', style: 'cancel' },
      { text: '丢弃', style: 'destructive', onPress: () => itemAction('discard', item) },
    ]);
  }

  function handleDelete(item: LeftoverItem) {
    Alert.alert('删除记录', `将删除「${item.name}」及其全部真实数据，该操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void runMutation(async () => {
            if (isRemote && token) await deleteLeftoverItem(token, item.id);
            else await persistLocal(localDeleteItem(localState, item.id));
          }, '记录已删除');
        },
      },
    ]);
  }

  async function removePhoto(photoId: string) {
    if (!detail) return;
    await runMutation(async () => {
      if (isRemote && token) await deleteLeftoverPhoto(token, detail.id, photoId);
      else {
        const index = Number(photoId);
        if (Number.isFinite(index)) await persistLocal(localDeletePhoto(localState, detail.id, index));
      }
    }, '照片已删除');
  }

  async function openRecipe(recipe: RecipeMatch) {
    if (isRemote && token) {
      try {
        setSelectedRecipe(await fetchLeftoverRecipe(token, recipe.recipeId));
      } catch (nextError) {
        setError(getLeftoverManagerErrorMessage(nextError));
      }
    } else {
      const local = await import('@/lib/leftover-manager');
      setSelectedRecipe(local.LEFT_OVER_RECIPE_LIBRARY.find((item) => item.id === recipe.recipeId) ?? null);
    }
  }

  async function saveSettings(settings: LeftoverSettings) {
    await runMutation(async () => {
      if (isRemote && token) setRemoteSettings(await saveLeftoverSettings(token, settings));
      else await persistLocal(localUpdateSettings(localState, settings));
    }, '设置已保存');
  }

  function clearAll() {
    Alert.alert('清空冰箱数据', '将删除全部真实记录、事件与照片，该操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          void runMutation(async () => {
            if (isRemote && token) await clearLeftoverData(token);
            else {
              await clearLeftoverLocalState();
              await persistLocal(localClearState());
            }
          }, '冰箱数据已清空');
        },
      },
    ]);
  }

  if (authStatus === 'loading') {
    return <PageLoadingFrame title="冰箱剩菜管家" variant="workbench" />;
  }

  return (
    <MobileScreen scrollContentStyle={styles.pageContent}>
      <PageHeader
        title="冰箱剩菜管家"
        subtitle="真实数据，到期优先"
        eyebrow="FunBox Tools"
        rightSlot={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="设置"
              onPress={() => setSettingsOpen(true)}
              style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="cog-outline" size={18} color={colors.primary} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加记录"
              onPress={openAdd}
              style={[styles.iconButton, { backgroundColor: colors.hero, borderColor: colors.hero }]}>
              <MaterialCommunityIcons name="plus" size={19} color="#c9f36a" />
            </Pressable>
          </View>
        }
      />

      {!token ? (
        <SurfaceCard style={styles.localBanner}>
          <MaterialCommunityIcons name="cellphone-lock" size={18} color={colors.primary} />
          <ThemedText style={[styles.localBannerText, { color: colors.mutedText }]}>
            当前为本机真实数据，登录后同步到账号
          </ThemedText>
          <Pressable onPress={() => router.push('/auth')}>
            <ThemedText style={[styles.localLogin, { color: colors.primary }]}>去登录</ThemedText>
          </Pressable>
        </SurfaceCard>
      ) : null}

      {message ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.success + '18' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={15} color={colors.success} />
          <ThemedText style={[styles.messageText, { color: colors.success }]}>{message}</ThemedText>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.accent + '18' }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.accent} />
          <ThemedText style={[styles.messageText, { color: colors.accent }]}>{error}</ThemedText>
        </View>
      ) : null}

      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
        {(['home', 'inventory', 'history'] as Tab[]).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            onPress={() => setTab(item)}
            style={[styles.tabButton, tab === item && { backgroundColor: colors.surface }]}>
            <MaterialCommunityIcons
              name={tabIcon(item)}
              size={16}
              color={tab === item ? colors.primary : colors.mutedText}
            />
            <ThemedText style={[styles.tabLabel, { color: tab === item ? colors.text : colors.mutedText }]}>
              {tabLabel(item)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <SurfaceCard style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>正在读取真实数据</ThemedText>
        </SurfaceCard>
      ) : tab === 'home' ? (
        <HomeTab home={home} colors={colors} onOpenItem={(item) => void openDetail(item)} onOpenSuggestions={() => setSuggestionsOpen(true)} onAdd={openAdd} />
      ) : tab === 'inventory' ? (
        <InventoryTab
          items={currentItems}
          search={inventorySearch}
          colors={colors}
          onSearch={setInventorySearch}
          onOpenItem={(item) => void openDetail(item)}
          onEdit={openEdit}
          onAdd={openAdd}
        />
      ) : (
        <HistoryTab history={currentHistory} colors={colors} />
      )}

      <EditModal
        visible={editOpen}
        draft={draft}
        pendingPhotos={pendingPhotos}
        editingItem={editingItem}
        busy={busy}
        colors={colors}
        onChange={setDraft}
        onPickPhotos={() => void pickPhotos()}
        onClose={() => setEditOpen(false)}
        onSave={() => void saveItem()}
      />
      <DetailModal
        visible={detailOpen}
        detail={detail}
        localPhotos={isRemote ? [] : detail ? localState.localPhotos[detail.id] ?? [] : []}
        colors={colors}
        busy={busy}
        onClose={() => setDetailOpen(false)}
        onReheat={(item) => itemAction('reheat', item)}
        onEat={(item) => itemAction('eat', item)}
        onDiscard={(item) => handleDiscard(item)}
        onEdit={(item) => {
          setDetailOpen(false);
          openEdit(item);
        }}
        onDelete={(item) => handleDelete(item)}
        onRemovePhoto={(photoId) => void removePhoto(photoId)}
      />
      <SuggestionsModal
        visible={suggestionsOpen}
        suggestions={home?.suggestions ?? []}
        selectedRecipe={selectedRecipe}
        colors={colors}
        busy={busy}
        onClose={() => setSuggestionsOpen(false)}
        onOpenRecipe={(recipe) => void openRecipe(recipe)}
        onCloseRecipe={() => setSelectedRecipe(null)}
      />
      <SettingsModal
        visible={settingsOpen}
        settings={isRemote ? remoteSettings : localState.settings}
        colors={colors}
        busy={busy}
        onClose={() => setSettingsOpen(false)}
        onSave={(settings) => void saveSettings(settings)}
        onClear={() => void clearAll()}
        onExport={(format) => {
          if (token) void runMutation(async () => downloadLeftoverExport(token, format), '真实数据已导出');
          else setMessage('本机模式暂不支持文件导出');
        }}
      />
    </MobileScreen>
  );
}

function HomeTab({ home, colors, onOpenItem, onOpenSuggestions, onAdd }: {
  home: LeftoverHomePayload | null;
  colors: Color;
  onOpenItem: (item: LeftoverItem) => void;
  onOpenSuggestions: () => void;
  onAdd: () => void;
}) {
  if (!home) return null;
  const now = home.serverNow;
  return (
    <>
      <SurfaceCard style={styles.heroCard}>
        <ThemedText style={styles.heroTitle}>
          {home.summary.activeCount > 0 ? `今天 ${home.summary.todayCount} 件优先吃` : '冰箱还是空的'}
        </ThemedText>
        <ThemedText style={[styles.heroSub, { color: colors.mutedText }]}>
          {home.summary.activeCount > 0
            ? `待处理 ${home.summary.activeCount} 件 · 已过期 ${home.summary.expiredCount} 件`
            : '先添加一件真实剩菜、外卖或食材。'}
        </ThemedText>
        <View style={styles.summaryRow}>
          <SummaryPill label="待处理" value={home.summary.activeCount} color={colors.primary} />
          <SummaryPill label="24h 内" value={home.summary.todayCount} color="#e8a33d" />
          <SummaryPill label="已过期" value={home.summary.expiredCount} color="#e8667a" />
        </View>
      </SurfaceCard>
      <SurfaceCard style={styles.panel}>
        <View style={styles.panelTitleRow}>
          <ThemedText style={styles.panelTitle}>优先吃掉</ThemedText>
          <ThemedText style={[styles.panelCount, { color: colors.mutedText }]}>{home.summary.activeCount} 件</ThemedText>
        </View>
        {home.priority.length === 0 ? (
          <EmptyState colors={colors} icon="fridge-outline" title="还没有待处理记录" subtitle="添加后，按真实到期时间自动排序。" actionLabel="添加记录" onAction={onAdd} />
        ) : (
          home.priority.slice(0, 5).map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => onOpenItem(item)} style={styles.itemRow}>
              <ItemThumb item={item} colors={colors} />
              <View style={styles.itemCopy}>
                <View style={styles.itemNameRow}>
                  <ThemedText style={styles.itemName}>{item.name}</ThemedText>
                  <DeadlineBadge item={item} now={now} />
                </View>
                <ThemedText style={[styles.itemDesc, { color: colors.mutedText }]}>
                  {sourceTypeLabel(item.sourceType)} · {zoneLabel(item.storedZone)} · {remainingLabel(item)} · {reheatLabel(item.reheatCount)}
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
            </Pressable>
          ))
        )}
      </SurfaceCard>
      <SurfaceCard style={styles.panel}>
        <View style={styles.panelTitleRow}>
          <ThemedText style={styles.panelTitle}>今晚建议</ThemedText>
          <Pressable accessibilityRole="button" onPress={onOpenSuggestions}>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
          </Pressable>
        </View>
        {home.suggestions.length === 0 ? (
          <ThemedText style={[styles.emptyInline, { color: colors.mutedText }]}>还没有可匹配的冰箱食材</ThemedText>
        ) : (
          home.suggestions.map((suggestion) => (
            <View key={suggestion.recipeId} style={styles.suggestionLine}>
              <MaterialCommunityIcons name="pot-steam-outline" size={17} color={colors.success} />
              <ThemedText style={styles.suggestionName}>{suggestion.name}</ThemedText>
              <ThemedText style={[styles.suggestionMeta, { color: colors.mutedText }]}>{suggestion.matchPercent}%</ThemedText>
            </View>
          ))
        )}
      </SurfaceCard>
    </>
  );
}

function InventoryTab({ items, search, colors, onSearch, onOpenItem, onEdit, onAdd }: {
  items: LeftoverItem[];
  search: string;
  colors: Color;
  onSearch: (value: string) => void;
  onOpenItem: (item: LeftoverItem) => void;
  onEdit: (item: LeftoverItem) => void;
  onAdd: () => void;
}) {
  const filtered = items.filter((item) => {
    const query = search.trim();
    if (!query) return true;
    return item.name.includes(query) || item.merchant.includes(query) || item.tags.some((tag) => tag.includes(query));
  });
  return (
    <>
      <View style={[styles.searchRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedText} />
        <TextInput value={search} onChangeText={onSearch} placeholder="搜索名称、商家或食材标签" placeholderTextColor={colors.mutedText} style={[styles.searchInput, { color: colors.text }]} />
      </View>
      {filtered.length === 0 ? (
        <EmptyState colors={colors} icon="fridge-outline" title="没有匹配的真实记录" subtitle="换个关键词，或添加一件新记录。" actionLabel="添加记录" onAction={onAdd} />
      ) : (
        filtered.map((item) => (
          <SurfaceCard key={item.id} style={styles.itemCard}>
            <Pressable accessibilityRole="button" onPress={() => onOpenItem(item)} style={styles.itemRow}>
              <ItemThumb item={item} colors={colors} />
              <View style={styles.itemCopy}>
                <View style={styles.itemNameRow}>
                  <ThemedText style={styles.itemName}>{item.name}</ThemedText>
                  <StatusPill status={item.status} colors={colors} />
                </View>
                <ThemedText style={[styles.itemDesc, { color: colors.mutedText }]}>
                  {sourceTypeLabel(item.sourceType)} · {zoneLabel(item.storedZone)} · {remainingLabel(item)}
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="编辑" onPress={() => onEdit(item)}>
                <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.primary} />
              </Pressable>
            </Pressable>
          </SurfaceCard>
        ))
      )}
    </>
  );
}

function HistoryTab({ history, colors }: { history: LeftoverHistoryPayload | null; colors: Color }) {
  if (!history) return null;
  return (
    <>
      <View style={styles.statsGrid}>
        <StatCard label="本周吃完" value={history.summary.thisWeekEaten} color={colors.success} />
        <StatCard label="本周丢弃" value={history.summary.thisWeekDiscarded} color="#e8667a" />
        <StatCard label="避免浪费" value={`${(history.summary.avoidWasteCents / 100).toFixed(1)} 元`} color={colors.primary} />
      </View>
      <SurfaceCard style={styles.panel}>
        <View style={styles.panelTitleRow}>
          <ThemedText style={styles.panelTitle}>真实动作记录</ThemedText>
          <ThemedText style={[styles.panelCount, { color: colors.mutedText }]}>{history.items.length} 条</ThemedText>
        </View>
        {history.items.length === 0 ? (
          <ThemedText style={[styles.emptyInline, { color: colors.mutedText }]}>还没有吃完或丢弃记录</ThemedText>
        ) : (
          history.items.map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={[styles.historyIcon, { backgroundColor: item.status === 'eaten' ? colors.success + '18' : '#fde9ed' }]}>
                <MaterialCommunityIcons name={item.status === 'eaten' ? 'check' : 'trash-can-outline'} size={15} color={item.status === 'eaten' ? colors.success : '#e8667a'} />
              </View>
              <View style={styles.itemCopy}>
                <ThemedText style={styles.itemName}>{item.name}</ThemedText>
                <ThemedText style={[styles.itemDesc, { color: colors.mutedText }]}>
                  {statusLabel(item.status)}{item.discardReason ? ` · ${item.discardReason}` : ''} · {formatLeftoverTime(item.eatenAt ?? item.discardedAt)}
                </ThemedText>
              </View>
            </View>
          ))
        )}
      </SurfaceCard>
    </>
  );
}

function EditModal({ visible, draft, pendingPhotos, editingItem, busy, colors, onChange, onPickPhotos, onClose, onSave }: {
  visible: boolean;
  draft: LeftoverItemInput;
  pendingPhotos: PickedPhoto[];
  editingItem: LeftoverItem | null;
  busy: boolean;
  colors: Color;
  onChange: (value: LeftoverItemInput) => void;
  onPickPhotos: () => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>{editingItem ? '编辑记录' : '添加记录'}</ThemedText>
            <Pressable accessibilityRole="button" onPress={onClose}>
              <MaterialCommunityIcons name="close" size={20} color={colors.mutedText} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
              {LEFTOVER_SOURCE_TYPES.map((source) => (
                <Pressable key={source} accessibilityRole="button" onPress={() => onChange({ ...draft, sourceType: source })} style={[styles.segButton, draft.sourceType === source && { backgroundColor: colors.surface }]}>
                  <ThemedText style={[styles.segLabel, { color: draft.sourceType === source ? colors.text : colors.mutedText }]}>{sourceTypeLabel(source)}</ThemedText>
                </Pressable>
              ))}
            </View>
            <FormField label="菜品名称" colors={colors}>
              <TextInput value={draft.name} onChangeText={(value) => onChange({ ...draft, name: value })} placeholder="请输入真实菜名" placeholderTextColor={colors.mutedText} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
            </FormField>
            <FormField label="来源 / 商家" colors={colors}>
              <TextInput value={draft.merchant} onChangeText={(value) => onChange({ ...draft, merchant: value })} placeholder="选填，例如 老王家常菜" placeholderTextColor={colors.mutedText} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
            </FormField>
            <FormField label="放入冰箱时间" colors={colors}>
              <TextInput value={formatDateTimeLocal(draft.enteredFridgeAt)} onChangeText={(value) => onChange({ ...draft, enteredFridgeAt: parseDateTimeLocal(value) })} placeholder="2026-08-06T20:00" placeholderTextColor={colors.mutedText} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
            </FormField>
            <FormField label="预计食用期限" colors={colors}>
              <TextInput value={formatDateTimeLocal(draft.expectedConsumeAt)} onChangeText={(value) => onChange({ ...draft, expectedConsumeAt: parseDateTimeLocal(value) })} placeholder="2026-08-07T20:00" placeholderTextColor={colors.mutedText} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
              <View style={styles.chipWrap}>
                {[
                  { label: '今晚 23:59', delta: 0 },
                  { label: '明天 23:59', delta: 1 },
                  { label: '后天 23:59', delta: 2 },
                ].map((option) => {
                  const end = new Date();
                  end.setHours(23, 59, 0, 0);
                  const value = end.getTime() + option.delta * 24 * 60 * 60 * 1000;
                  return (
                    <Pressable key={option.label} accessibilityRole="button" onPress={() => onChange({ ...draft, expectedConsumeAt: value })} style={[styles.chip, draft.expectedConsumeAt === value && styles.chipActive]}>
                      <ThemedText style={[styles.chipLabel, draft.expectedConsumeAt === value && styles.chipActiveLabel]}>{option.label}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </FormField>
            <FormField label="存放位置" colors={colors}>
              <View style={styles.chipWrap}>
                {LEFTOVER_ZONES.map((zone) => (
                  <Pressable key={zone} accessibilityRole="button" onPress={() => onChange({ ...draft, storedZone: zone })} style={[styles.chip, draft.storedZone === zone && styles.chipActive]}>
                    <ThemedText style={[styles.chipLabel, draft.storedZone === zone && styles.chipActiveLabel]}>{zoneLabel(zone)}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </FormField>
            <FormField label="剩余分量" colors={colors}>
              <View style={styles.chipWrap}>
                {remainingOptions.map((option) => (
                  <Pressable key={option.value} accessibilityRole="button" onPress={() => onChange({ ...draft, remainingPercent: option.value, remainingText: option.label })} style={[styles.chip, draft.remainingPercent === option.value && styles.chipActive]}>
                    <ThemedText style={[styles.chipLabel, draft.remainingPercent === option.value && styles.chipActiveLabel]}>{option.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <TextInput value={draft.remainingText} onChangeText={(value) => onChange({ ...draft, remainingText: value })} placeholder="例如 约 1 碗" placeholderTextColor={colors.mutedText} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
            </FormField>
            <FormField label="加热状态" colors={colors}>
              <View style={styles.chipWrap}>
                {[0, 1, 2].map((count) => (
                  <Pressable key={count} accessibilityRole="button" onPress={() => onChange({ ...draft, reheatCount: count })} style={[styles.chip, draft.reheatCount === count && styles.chipActive]}>
                    <ThemedText style={[styles.chipLabel, draft.reheatCount === count && styles.chipActiveLabel]}>{reheatLabel(count)}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </FormField>
            <FormField label="食材标签" colors={colors}>
              <View style={styles.chipWrap}>
                {INGREDIENT_TAG_OPTIONS.map((tag) => {
                  const active = draft.tags.includes(tag);
                  return (
                    <Pressable key={tag} accessibilityRole="button" onPress={() => onChange({ ...draft, tags: active ? draft.tags.filter((item) => item !== tag) : [...draft.tags, tag] })} style={[styles.chip, active && styles.chipActive]}>
                      <ThemedText style={[styles.chipLabel, active && styles.chipActiveLabel]}>{tag}</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </FormField>
            <FormField label="成本金额（元）" colors={colors}>
              <TextInput value={draft.costCents === 0 ? '' : String(draft.costCents / 100)} onChangeText={(value) => onChange({ ...draft, costCents: Math.round(Number(value) * 100) })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.mutedText} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
            </FormField>
            <FormField label="备注" colors={colors}>
              <TextInput value={draft.notes} onChangeText={(value) => onChange({ ...draft, notes: value })} placeholder="选填，例如 加热时加一点水" placeholderTextColor={colors.mutedText} multiline style={[styles.input, styles.textArea, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
            </FormField>
            <FormField label="真实照片" colors={colors}>
              <View style={styles.photoRow}>
                {pendingPhotos.map((photo, index) => <Image key={index} source={{ uri: photo.uri }} style={styles.photoPreview} contentFit="cover" />)}
                {pendingPhotos.length < 3 ? (
                  <Pressable accessibilityRole="button" onPress={onPickPhotos} style={[styles.photoAdd, { borderColor: colors.line, backgroundColor: colors.surface }]}>
                    <MaterialCommunityIcons name="camera-outline" size={20} color={colors.primary} />
                    <ThemedText style={[styles.photoAddText, { color: colors.mutedText }]}>拍照 / 相册</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            </FormField>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onSave} style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
              {busy ? <ActivityIndicator color="#c9f36a" /> : <ThemedText style={styles.primaryButtonText}>保存记录</ThemedText>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DetailModal({ visible, detail, localPhotos, colors, busy, onClose, onReheat, onEat, onDiscard, onEdit, onDelete, onRemovePhoto }: {
  visible: boolean;
  detail: LeftoverItemDetail | null;
  localPhotos: string[];
  colors: Color;
  busy: boolean;
  onClose: () => void;
  onReheat: (item: LeftoverItem) => void;
  onEat: (item: LeftoverItem) => void;
  onDiscard: (item: LeftoverItem) => void;
  onEdit: (item: LeftoverItem) => void;
  onDelete: (item: LeftoverItem) => void;
  onRemovePhoto: (photoId: string) => void;
}) {
  if (!detail) return null;
  const photos = detail.photos.length > 0 ? detail.photos.map((photo) => photo.fileUrl) : localPhotos;
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <View style={styles.itemCopy}>
              <ThemedText style={styles.modalTitle}>{detail.name}</ThemedText>
              <ThemedText style={[styles.itemDesc, { color: colors.mutedText }]}>{sourceTypeLabel(detail.sourceType)} · {zoneLabel(detail.storedZone)}</ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose}><MaterialCommunityIcons name="close" size={20} color={colors.mutedText} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            {photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detailPhotoScroll}>
                {photos.map((uri, index) => (
                  <Pressable key={`${uri}-${index}`} accessibilityRole="button" accessibilityLabel="删除照片" onPress={() => onRemovePhoto(detail.photos[index]?.id ?? String(index))} style={styles.detailPhotoWrap}>
                    <Image source={{ uri }} style={styles.detailPhoto} contentFit="cover" />
                    <View style={styles.photoDeleteOverlay}><MaterialCommunityIcons name="trash-can-outline" size={15} color="#ffffff" /></View>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.noPhoto, { borderColor: colors.line, backgroundColor: colors.surface }]}>
                <MaterialCommunityIcons name="camera-outline" size={24} color={colors.mutedText} />
                <ThemedText style={[styles.noPhotoText, { color: colors.mutedText }]}>暂无真实照片</ThemedText>
              </View>
            )}
            <SurfaceCard style={styles.detailCard}>
              <DetailRow label="入冰箱时间" value={formatLeftoverTime(detail.enteredFridgeAt)} colors={colors} />
              <DetailRow label="预计食用期限" value={formatLeftoverTime(detail.expectedConsumeAt)} colors={colors} />
              <DetailRow label="剩余分量" value={remainingLabel(detail)} colors={colors} />
              <DetailRow label="加热状态" value={reheatLabel(detail.reheatCount)} colors={colors} />
              <DetailRow label="成本金额" value={`${(detail.costCents / 100).toFixed(2)} 元`} colors={colors} />
              <DetailRow label="食材标签" value={detail.tags.join('、') || '未设置'} colors={colors} />
              <DetailRow label="备注" value={detail.notes || '无'} colors={colors} />
            </SurfaceCard>
            {detail.status === 'active' ? (
              <View style={styles.actionGrid}>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => onReheat(detail)} style={[styles.actionButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <MaterialCommunityIcons name="pot-steam-outline" size={18} color="#e8a33d" />
                  <ThemedText style={styles.actionButtonText}>加热一下</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => onEat(detail)} style={[styles.actionButton, { backgroundColor: colors.hero }]}>
                  <MaterialCommunityIcons name="check" size={18} color="#c9f36a" />
                  <ThemedText style={[styles.actionButtonText, { color: '#ffffff' }]}>标记吃完</ThemedText>
                </Pressable>
              </View>
            ) : null}
            {detail.status === 'active' ? (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onDiscard(detail)} style={[styles.dangerButton, { borderColor: '#f3c6cd' }]}>
                <MaterialCommunityIcons name="trash-can-outline" size={17} color="#e8667a" />
                <ThemedText style={[styles.dangerText, { color: '#e8667a' }]}>丢弃并记录原因</ThemedText>
              </Pressable>
            ) : null}
            <View style={styles.detailActions}>
              <Pressable accessibilityRole="button" onPress={() => onEdit(detail)} style={styles.textAction}>
                <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.primary} />
                <ThemedText style={[styles.textActionLabel, { color: colors.primary }]}>编辑</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onDelete(detail)} style={styles.textAction}>
                <MaterialCommunityIcons name="delete-outline" size={15} color="#e8667a" />
                <ThemedText style={[styles.textActionLabel, { color: '#e8667a' }]}>删除</ThemedText>
              </Pressable>
            </View>
            <SurfaceCard style={styles.detailCard}>
              <ThemedText style={styles.panelTitle}>事件时间线</ThemedText>
              {detail.events.length === 0 ? (
                <ThemedText style={[styles.emptyInline, { color: colors.mutedText }]}>暂无真实事件</ThemedText>
              ) : detail.events.map((event) => (
                <View key={event.id} style={styles.eventRow}>
                  <MaterialCommunityIcons name="clock-outline" size={14} color={colors.mutedText} />
                  <ThemedText style={[styles.eventText, { color: colors.mutedText }]}>{eventActionLabel(event.eventType)} · {formatLeftoverTime(event.happenedAt)}</ThemedText>
                </View>
              ))}
            </SurfaceCard>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SuggestionsModal({ visible, suggestions, selectedRecipe, colors, busy, onClose, onOpenRecipe, onCloseRecipe }: {
  visible: boolean;
  suggestions: RecipeMatch[];
  selectedRecipe: Recipe | null;
  colors: Color;
  busy: boolean;
  onClose: () => void;
  onOpenRecipe: (recipe: RecipeMatch) => void;
  onCloseRecipe: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>{selectedRecipe ? selectedRecipe.name : '今晚建议'}</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => { onCloseRecipe(); onClose(); }}><MaterialCommunityIcons name="close" size={20} color={colors.mutedText} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            {selectedRecipe ? (
              <RecipeCard recipe={selectedRecipe} colors={colors} />
            ) : suggestions.length === 0 ? (
              <EmptyState colors={colors} icon="pot-steam-outline" title="还没有可匹配的冰箱食材" subtitle="先添加食材和剩菜，建议只来自你的真实冰箱记录。" />
            ) : suggestions.map((suggestion) => (
              <Pressable key={suggestion.recipeId} accessibilityRole="button" disabled={busy} onPress={() => onOpenRecipe(suggestion)} style={styles.suggestionCard}>
                <View style={styles.suggestionHead}>
                  <View style={styles.itemCopy}>
                    <ThemedText style={styles.itemName}>{suggestion.name}</ThemedText>
                    <ThemedText style={[styles.itemDesc, { color: colors.mutedText }]}>{suggestion.source} · {suggestion.estimatedMinutes} 分钟</ThemedText>
                  </View>
                  <View style={[styles.matchPill, { backgroundColor: colors.success + '18' }]}>
                    <ThemedText style={[styles.matchText, { color: colors.success }]}>匹配 {suggestion.matchPercent}%</ThemedText>
                  </View>
                </View>
                <ThemedText style={[styles.suggestionDetail, { color: colors.mutedText }]}>
                  用到了 {suggestion.matchedCount}/{suggestion.totalCount} 项真实冰箱食材{suggestion.missing.length > 0 ? ` · 缺 ${suggestion.missing.length} 项` : ' · 食材已齐'}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RecipeCard({ recipe, colors }: { recipe: Recipe; colors: Color }) {
  return (
    <SurfaceCard style={styles.panel}>
      <ThemedText style={styles.panelTitle}>{recipe.name}</ThemedText>
      <ThemedText style={[styles.itemDesc, { color: colors.mutedText }]}>{recipe.source} · 预计 {recipe.estimatedMinutes} 分钟</ThemedText>
      <View style={styles.recipeIngredients}>
        {recipe.mainIngredients.map((ingredient) => (
          <View key={ingredient.keyword} style={[styles.ingredientPill, { backgroundColor: colors.success + '16' }]}>
            <ThemedText style={[styles.ingredientText, { color: colors.success }]}>{ingredient.label} {ingredient.quantity}</ThemedText>
          </View>
        ))}
      </View>
      <View style={styles.stepList}>
        {recipe.steps.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <View style={[styles.stepNumber, { backgroundColor: colors.primarySoft }]}>
              <ThemedText style={[styles.stepNumberText, { color: colors.primary }]}>{index + 1}</ThemedText>
            </View>
            <ThemedText style={[styles.stepText, { color: colors.text }]}>{step}</ThemedText>
          </View>
        ))}
      </View>
    </SurfaceCard>
  );
}

function SettingsModal({ visible, settings, colors, busy, onClose, onSave, onClear, onExport }: {
  visible: boolean;
  settings: LeftoverSettings | null;
  colors: Color;
  busy: boolean;
  onClose: () => void;
  onSave: (settings: LeftoverSettings) => void;
  onClear: () => void;
  onExport: (format: 'csv' | 'json') => void;
}) {
  const current = settings ?? createEmptyLeftoverSettings();
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>设置与数据</ThemedText>
            <Pressable accessibilityRole="button" onPress={onClose}><MaterialCommunityIcons name="close" size={20} color={colors.mutedText} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            <SurfaceCard style={styles.panel}>
              <View style={styles.settingRow}>
                <ThemedText style={styles.settingLabel}>提前提醒（小时）</ThemedText>
                <TextInput value={String(current.remindBeforeHours)} onChangeText={(value) => onSave({ ...current, remindBeforeHours: Math.max(1, Math.min(24, Number(value) || 2)) })} keyboardType="number-pad" style={[styles.smallInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.line }]} />
              </View>
              <SettingSwitch label="每天 09:00 汇总临期" value={current.daily09Enabled} colors={colors} onValueChange={(value) => onSave({ ...current, daily09Enabled: value })} />
              <SettingSwitch label="每天 19:00 汇总未处理" value={current.evening19Enabled} colors={colors} onValueChange={(value) => onSave({ ...current, evening19Enabled: value })} />
              <SettingSwitch label="系统通知" value={current.notificationEnabled} colors={colors} onValueChange={(value) => onSave({ ...current, notificationEnabled: value })} />
            </SurfaceCard>
            <View style={styles.actionGrid}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onExport('csv')} style={[styles.actionButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="download-outline" size={18} color={colors.primary} />
                <ThemedText style={styles.actionButtonText}>导出 CSV</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => onExport('json')} style={[styles.actionButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="file-code-outline" size={18} color={colors.primary} />
                <ThemedText style={styles.actionButtonText}>导出 JSON</ThemedText>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onClear} style={[styles.dangerButton, { borderColor: '#f3c6cd' }]}>
              <MaterialCommunityIcons name="trash-can-outline" size={17} color="#e8667a" />
              <ThemedText style={[styles.dangerText, { color: '#e8667a' }]}>清空全部真实数据</ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SettingSwitch({ label, value, colors, onValueChange }: {
  label: string;
  value: boolean;
  colors: Color;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <ThemedText style={styles.settingLabel}>{label}</ThemedText>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.line, true: colors.primary }} thumbColor={colors.surface} />
    </View>
  );
}

function FormField({ label, colors, children }: { label: string; colors: Color; children: ReactNode }) {
  return (
    <View style={styles.formField}>
      <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      {children}
    </View>
  );
}

function DetailRow({ label, value, colors }: { label: string; value: string; colors: Color }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText style={[styles.detailLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <ThemedText style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

function ItemThumb({ item, colors }: { item: LeftoverItem; colors: Color }) {
  if (item.coverPhotoUrl) return <Image source={{ uri: item.coverPhotoUrl }} style={styles.itemThumb} contentFit="cover" />;
  return (
    <View style={[styles.itemThumb, { backgroundColor: colors.primarySoft }]}>
      <MaterialCommunityIcons name={itemIcon(item.sourceType)} size={18} color={colors.primary} />
    </View>
  );
}

function DeadlineBadge({ item, now }: { item: LeftoverItem; now: number }) {
  const expired = item.expectedConsumeAt < now;
  const today = !expired && item.expectedConsumeAt <= now + 24 * 60 * 60 * 1000;
  return (
    <View style={[styles.deadlineBadge, { backgroundColor: expired ? '#fde9ed' : today ? '#fff3df' : '#e2f6f1' }]}>
      <ThemedText style={[styles.deadlineBadgeText, { color: expired ? '#c43f52' : today ? '#a96f12' : '#0e806d' }]}>{deadlineLabel(item, now)}</ThemedText>
    </View>
  );
}

function StatusPill({ status, colors }: { status: string; colors: Color }) {
  return (
    <View style={[styles.deadlineBadge, { backgroundColor: status === 'eaten' ? colors.success + '18' : status === 'discarded' ? '#fde9ed' : colors.primarySoft }]}>
      <ThemedText style={[styles.deadlineBadgeText, { color: status === 'eaten' ? colors.success : status === 'discarded' ? '#c43f52' : colors.primary }]}>{statusLabel(status)}</ThemedText>
    </View>
  );
}

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryPill}>
      <ThemedText style={[styles.summaryValue, { color }]}>{value}</ThemedText>
      <ThemedText style={styles.summaryLabel}>{label}</ThemedText>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <SurfaceCard style={styles.statCard}>
      <ThemedText style={[styles.statValue, { color }]}>{value}</ThemedText>
      <ThemedText style={styles.statLabel}>{label}</ThemedText>
    </SurfaceCard>
  );
}

function EmptyState({ colors, icon, title, subtitle, actionLabel, onAction }: {
  colors: Color;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={[styles.emptyState, { borderColor: colors.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name={icon} size={28} color={colors.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: colors.mutedText }]}>{subtitle}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={[styles.emptyButton, { backgroundColor: colors.hero }]}>
          <ThemedText style={styles.primaryButtonText}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function tabLabel(tab: Tab) {
  return tab === 'home' ? '首页' : tab === 'inventory' ? '冰箱' : '历史';
}

function tabIcon(tab: Tab): ComponentProps<typeof MaterialCommunityIcons>['name'] {
  return tab === 'home' ? 'fridge-outline' : tab === 'inventory' ? 'archive-outline' : 'history';
}

function itemIcon(sourceType: string): ComponentProps<typeof MaterialCommunityIcons>['name'] {
  if (sourceType === 'takeout') return 'food-takeout-box-outline';
  if (sourceType === 'opened') return 'package-variant-closed';
  if (sourceType === 'ingredient') return 'food-apple-outline';
  return 'pot-steam-outline';
}

const styles = StyleSheet.create({
  pageContent: { gap: 14, paddingBottom: 40 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  localBanner: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 12 },
  localBannerText: { flex: 1, fontSize: 12 },
  localLogin: { fontSize: 12, fontWeight: '700' },
  messageBanner: { alignItems: 'center', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 12 },
  messageText: { flex: 1, fontSize: 12 },
  tabs: { borderRadius: 14, flexDirection: 'row', gap: 4, padding: 4 },
  tabButton: { alignItems: 'center', borderRadius: 10, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 40 },
  tabLabel: { fontSize: 13, fontWeight: '700' },
  loadingCard: { alignItems: 'center', gap: 10, padding: 28 },
  loadingText: { fontSize: 13 },
  heroCard: { padding: 18 },
  heroTitle: { fontSize: 22, fontWeight: '800' },
  heroSub: { fontSize: 13, marginTop: 6 },
  summaryRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  summaryPill: { alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)', flex: 1, paddingVertical: 10 },
  summaryValue: { fontSize: 18, fontWeight: '800' },
  summaryLabel: { fontSize: 10, marginTop: 2 },
  panel: { padding: 14 },
  panelTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  panelTitle: { fontSize: 16, fontWeight: '800' },
  panelCount: { fontSize: 12 },
  itemRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 62 },
  itemCard: { paddingHorizontal: 12 },
  itemThumb: { alignItems: 'center', borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  itemCopy: { flex: 1, minWidth: 0 },
  itemNameRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  itemName: { fontSize: 14, fontWeight: '800' },
  itemDesc: { fontSize: 11, marginTop: 3 },
  deadlineBadge: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 },
  deadlineBadgeText: { fontSize: 9, fontWeight: '700' },
  suggestionLine: { alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', flexDirection: 'row', gap: 8, minHeight: 42 },
  suggestionName: { flex: 1, fontSize: 13, fontWeight: '700' },
  suggestionMeta: { fontSize: 12 },
  emptyInline: { fontSize: 12, paddingVertical: 14 },
  searchRow: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 13, minHeight: 44 },
  statsGrid: { flexDirection: 'row', gap: 10 },
  statCard: { alignItems: 'center', flex: 1, padding: 12 },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, marginTop: 4 },
  historyRow: { alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', flexDirection: 'row', gap: 10, minHeight: 54 },
  historyIcon: { alignItems: 'center', borderRadius: 9, height: 30, justifyContent: 'center', width: 30 },
  modalBackdrop: { backgroundColor: 'rgba(10, 15, 30, 0.36)', flex: 1, justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', minHeight: 520, paddingHorizontal: 16, paddingTop: 14 },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800' },
  modalContent: { gap: 14, paddingBottom: 32 },
  segmented: { borderRadius: 12, flexDirection: 'row', gap: 3, padding: 3 },
  segButton: { alignItems: 'center', borderRadius: 9, flex: 1, justifyContent: 'center', minHeight: 36 },
  segLabel: { fontSize: 12, fontWeight: '700' },
  formField: { gap: 7 },
  formLabel: { fontSize: 12 },
  input: { borderRadius: 12, borderWidth: 1, fontSize: 13, minHeight: 44, paddingHorizontal: 12 },
  textArea: { minHeight: 72, paddingTop: 10, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', justifyContent: 'center', minHeight: 32, paddingHorizontal: 12 },
  chipActive: { backgroundColor: '#e2f6f1', borderColor: '#9edbcb' },
  chipLabel: { fontSize: 12 },
  chipActiveLabel: { color: '#0e806d', fontWeight: '700' },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoPreview: { borderRadius: 12, height: 76, width: 76 },
  photoAdd: { alignItems: 'center', borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, gap: 4, height: 76, justifyContent: 'center', width: 110 },
  photoAddText: { fontSize: 10 },
  primaryButton: { alignItems: 'center', borderRadius: 14, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50 },
  primaryButtonText: { color: '#c9f36a', fontSize: 14, fontWeight: '800' },
  detailPhotoScroll: { marginBottom: 4 },
  detailPhotoWrap: { marginRight: 8, position: 'relative' },
  detailPhoto: { borderRadius: 14, height: 160, width: 220 },
  photoDeleteOverlay: { alignItems: 'center', backgroundColor: 'rgba(15, 20, 40, 0.55)', borderRadius: 10, height: 28, justifyContent: 'center', position: 'absolute', right: 7, top: 7, width: 28 },
  noPhoto: { alignItems: 'center', borderRadius: 14, borderWidth: 1, gap: 6, height: 120, justifyContent: 'center' },
  noPhotoText: { fontSize: 11 },
  detailCard: { padding: 12 },
  detailRow: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', flexDirection: 'row', gap: 10, minHeight: 40, paddingVertical: 8 },
  detailLabel: { flex: 1, fontSize: 12 },
  detailValue: { flex: 2, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  actionGrid: { flexDirection: 'row', gap: 10 },
  actionButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  actionButtonText: { fontSize: 13, fontWeight: '700' },
  dangerButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 44 },
  dangerText: { fontSize: 13, fontWeight: '700' },
  detailActions: { flexDirection: 'row', gap: 18, justifyContent: 'center' },
  textAction: { alignItems: 'center', flexDirection: 'row', gap: 5, padding: 8 },
  textActionLabel: { fontSize: 13, fontWeight: '700' },
  eventRow: { alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', flexDirection: 'row', gap: 8, minHeight: 34 },
  eventText: { fontSize: 11 },
  suggestionCard: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: 'rgba(255,255,255,0.7)', padding: 14 },
  suggestionHead: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  matchPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  matchText: { fontSize: 11, fontWeight: '700' },
  suggestionDetail: { fontSize: 11, marginTop: 8 },
  recipeIngredients: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 },
  ingredientPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  ingredientText: { fontSize: 11, fontWeight: '700' },
  stepList: { gap: 9, marginTop: 14 },
  stepRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  stepNumber: { alignItems: 'center', borderRadius: 8, height: 24, justifyContent: 'center', width: 24 },
  stepNumberText: { fontSize: 11, fontWeight: '800' },
  stepText: { flex: 1, fontSize: 13, lineHeight: 20 },
  settingRow: { alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)', flexDirection: 'row', gap: 10, justifyContent: 'space-between', minHeight: 50 },
  settingLabel: { flex: 1, fontSize: 13 },
  smallInput: { borderRadius: 10, borderWidth: 1, fontSize: 13, minHeight: 38, paddingHorizontal: 10, textAlign: 'center', width: 64 },
  emptyState: { alignItems: 'center', borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, gap: 8, padding: 26 },
  emptyIcon: { alignItems: 'center', borderRadius: 50, height: 56, justifyContent: 'center', width: 56 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptySubtitle: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  emptyButton: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 42, paddingHorizontal: 18 },
});
