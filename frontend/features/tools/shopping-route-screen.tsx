import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
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
import { appLayout } from '@/constants/app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  addShoppingItem,
  completeShoppingRoute,
  createShoppingList,
  createShoppingRoute,
  createShoppingStore,
  deleteShoppingItem,
  deleteShoppingList,
  deleteShoppingStore,
  fetchMappingSuggestions,
  fetchProductByBarcode,
  fetchShoppingList,
  fetchShoppingRouteHistory,
  fetchShoppingRouteHome,
  fetchShoppingStore,
  getShoppingRouteErrorMessage,
  importCookingShoppingList,
  saveShoppingMapping,
  setShoppingZones,
  updateShoppingRouteItem,
  updateShoppingStore,
} from '@/lib/shopping-route-api';
import {
  routeCompletenessLabel,
  sourceLabel,
  zoneTypeLabel,
  ZONE_TYPE_OPTIONS,
} from '@/lib/shopping-route';
import type {
  ShoppingList,
  ShoppingMappingSuggestion,
  ShoppingRoute,
  ShoppingRouteHome,
  ShoppingStore,
  ShoppingZone,
  ShoppingZoneType,
} from '@/types/shopping-route';

type Tab = 'list' | 'store' | 'route';
type ZoneDraft = { name: string; zoneType: ShoppingZoneType };

export function ShoppingRouteScreen() {
  const router = useRouter();
  const { accessToken, status: authStatus, user } = useAuth();
  const { colors, colorScheme } = useAppTheme();
  const dark = colorScheme === 'dark';
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [home, setHome] = useState<ShoppingRouteHome | null>(null);
  const [selectedList, setSelectedList] = useState<ShoppingList | null>(null);
  const [selectedStore, setSelectedStore] = useState<ShoppingStore | null>(null);
  const [activeRoute, setActiveRoute] = useState<ShoppingRoute | null>(null);
  const [history, setHistory] = useState<ShoppingRoute[]>([]);
  const [suggestions, setSuggestions] = useState<ShoppingMappingSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [listModalOpen, setListModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);

  const [listName, setListName] = useState('');
  const [itemDraft, setItemDraft] = useState({
    name: '',
    quantity: '',
    unit: '',
    barcode: '',
    note: '',
  });
  const [importDraft, setImportDraft] = useState({ dishId: '', listName: '' });
  const [storeDraft, setStoreDraft] = useState({ name: '', address: '', note: '' });
  const [zoneDraft, setZoneDraft] = useState<ZoneDraft[]>([]);
  const [endpointDraft, setEndpointDraft] = useState({ entry: '', checkout: '' });
  const requestRef = useRef(0);

  const selectedListId = selectedList?.id ?? home?.lists[0]?.id;
  const selectedStoreId = selectedStore?.id ?? home?.stores[0]?.id;

  const loadAll = useCallback(async () => {
    if (!accessToken) return;
    const requestID = ++requestRef.current;
    setLoading(!home);
    setError(null);
    try {
      const homeData = await fetchShoppingRouteHome(accessToken);
      if (requestID !== requestRef.current) return;
      setHome(homeData);
      setActiveRoute(normalizeRoute(homeData.activeRoute ?? null));

      const nextList =
        homeData.lists.find((item) => item.id === selectedListId) ??
        homeData.lists[0] ??
        null;
      const nextStore =
        homeData.stores.find((item) => item.id === selectedStoreId) ??
        homeData.stores[0] ??
        null;

      const [listDetail, storeDetail, historyItems, suggestionItems] = await Promise.all([
        nextList ? fetchShoppingList(accessToken, nextList.id) : Promise.resolve(null),
        nextStore ? fetchShoppingStore(accessToken, nextStore.id) : Promise.resolve(null),
        fetchShoppingRouteHistory(accessToken),
        nextList && nextStore
          ? fetchMappingSuggestions(accessToken, nextList.id, nextStore.id)
          : Promise.resolve({ items: [] }),
      ]);
      if (requestID !== requestRef.current) return;
      setSelectedList(listDetail);
      setSelectedStore(storeDetail);
      setHistory(historyItems.items);
      setSuggestions(suggestionItems.items);
      setLoading(false);
    } catch (nextError) {
      if (requestID !== requestRef.current) return;
      setError(getShoppingRouteErrorMessage(nextError));
      setLoading(false);
    } finally {
      if (requestID === requestRef.current) setRefreshing(false);
    }
  }, [accessToken, home, selectedListId, selectedStoreId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function runMutation(action: () => Promise<unknown>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await loadAll();
    } catch (nextError) {
      setError(getShoppingRouteErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function submitList() {
    if (!accessToken || !listName.trim()) return;
    await runMutation(
      () => createShoppingList(accessToken, listName.trim()),
      '购物清单已创建',
    );
    setListName('');
    setListModalOpen(false);
  }

  async function submitItem() {
    if (!accessToken || !selectedListId || !itemDraft.name.trim() || !itemDraft.quantity.trim()) {
      setError('请填写商品名称和数量。');
      return;
    }
    await runMutation(
      () =>
        addShoppingItem(accessToken, selectedListId, {
          name: itemDraft.name.trim(),
          quantity: itemDraft.quantity.trim(),
          unit: itemDraft.unit.trim(),
          barcode: itemDraft.barcode.trim(),
          note: itemDraft.note.trim(),
        }),
      '商品已加入真实清单',
    );
    setItemDraft({ name: '', quantity: '', unit: '', barcode: '', note: '' });
    setItemModalOpen(false);
  }

  async function submitImport() {
    if (!accessToken || !importDraft.dishId.trim()) return;
    await runMutation(
      () =>
        importCookingShoppingList(accessToken, {
          dishId: importDraft.dishId.trim(),
          listName: importDraft.listName.trim() || undefined,
        }),
      '菜谱真实食材已导入',
    );
    setImportDraft({ dishId: '', listName: '' });
    setImportModalOpen(false);
  }

  async function submitStore() {
    if (!accessToken || !storeDraft.name.trim()) return;
    await runMutation(
      () =>
        createShoppingStore(accessToken, {
          name: storeDraft.name.trim(),
          address: storeDraft.address.trim(),
          note: storeDraft.note.trim(),
        }),
      '常去超市已创建',
    );
    setStoreDraft({ name: '', address: '', note: '' });
    setStoreModalOpen(false);
  }

  async function submitZones() {
    if (!accessToken || !selectedStoreId) return;
    const cleaned = zoneDraft
      .map((item) => ({ name: item.name.trim(), zoneType: item.zoneType }))
      .filter((item) => item.name.length > 0);
    if (cleaned.length === 0) {
      setError('请至少填写一个真实区域名称。');
      return;
    }
    await runMutation(
      () => setShoppingZones(accessToken, selectedStoreId, cleaned),
      '区域顺序已保存',
    );
    setZoneModalOpen(false);
  }

  async function saveEndpoints() {
    if (!accessToken || !selectedStoreId || !selectedStore) return;
    await runMutation(
      () =>
        updateShoppingStore(accessToken, selectedStoreId, {
          name: selectedStore.name,
          address: selectedStore.address,
          note: selectedStore.note,
          entryZoneId: endpointDraft.entry || undefined,
          checkoutZoneId: endpointDraft.checkout || undefined,
        }),
      '',
    );
    setEndpointModalOpen(false);
  }

  async function confirmSuggestion(suggestion: ShoppingMappingSuggestion) {
    if (!accessToken || !selectedStoreId) return;
    await runMutation(
      () =>
        saveShoppingMapping(accessToken, {
          itemId: suggestion.itemId,
          storeId: selectedStoreId,
          zoneId: suggestion.zoneId || undefined,
          zoneType: suggestion.zoneType,
        }),
      `${suggestion.name} 已归位`,
    );
  }

  async function generateRoute() {
    if (!accessToken || !selectedListId || !selectedStoreId) return;
    await runMutation(
      () => createShoppingRoute(accessToken, selectedListId, selectedStoreId),
      '路线已按真实区域顺序生成',
    );
  }

  async function toggleRouteItem(itemId: string, completed: boolean) {
    if (!accessToken || !activeRoute) return;
    try {
      const updated = await updateShoppingRouteItem(
        accessToken,
        activeRoute.id,
        itemId,
        completed,
      );
      setActiveRoute(normalizeRoute(updated));
      if (updated.status === 'complete') setMessage('本次购物已完成');
    } catch (nextError) {
      setError(getShoppingRouteErrorMessage(nextError));
    }
  }

  async function finishRoute() {
    if (!accessToken || !activeRoute) return;
    await runMutation(
      async () => {
        const updated = await completeShoppingRoute(accessToken, activeRoute.id);
        setActiveRoute(normalizeRoute(updated));
      },
      '本次购物已写入真实历史',
    );
  }

  async function lookupBarcode() {
    if (!accessToken || !itemDraft.barcode.trim()) return;
    try {
      const result = await fetchProductByBarcode(accessToken, itemDraft.barcode.trim());
      if (result.product) {
        setItemDraft((current) => ({
          ...current,
          name: current.name || result.product?.name || '',
          unit: current.unit || '',
        }));
        setMessage(`条码命中真实商品：${result.product.name}`);
      } else {
        setError('条码未命中真实商品，已保留你的输入。');
      }
    } catch (nextError) {
      setError(getShoppingRouteErrorMessage(nextError));
    }
  }

  if (authStatus === 'loading') {
    return <CenterState icon="routes" title="正在打开购物路线" loading />;
  }
  if (!accessToken || !user) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.loginState}>
          <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="routes" size={34} color={colors.primary} />
          </View>
          <ThemedText style={styles.stateTitle}>登录后使用购物路线</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            购物清单、常去超市和路线记录会保存在你的 FunBox 账号里。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/tools/shopping-route' } })}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="login" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>登录</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !home) {
    return <CenterState icon="routes" title="正在整理购物路线" loading />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <ThemedText style={styles.headerTitle}>购物路线</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              清单与区域都可溯源
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              setRefreshing(true);
              void loadAll();
            }}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons
              name={refreshing ? 'loading' : 'refresh'}
              size={22}
              color={colors.primary}
            />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: dark ? colors.surfaceMuted : '#e9eef8' }]}>
          <TabButton
            active={activeTab === 'list'}
            icon="format-list-bulleted"
            label="清单"
            onPress={() => setActiveTab('list')}
          />
          <TabButton
            active={activeTab === 'store'}
            icon="store"
            label="超市"
            onPress={() => setActiveTab('store')}
          />
          <TabButton
            active={activeTab === 'route'}
            icon="routes"
            label="路线"
            onPress={() => setActiveTab('route')}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setRefreshing(true);
                void loadAll();
              }}
              refreshing={refreshing}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}>
          {error ? <Notice tone="error" text={error} /> : null}
          {message ? <Notice tone="success" text={message} /> : null}

          <HomeSummary
            colors={colors}
            dark={dark}
            home={home}
            route={activeRoute}
          />

          {activeTab === 'list' ? (
            <ListView
              busy={busy}
              colors={colors}
              dark={dark}
              home={home}
              selectedList={selectedList}
              onAddItem={() => setItemModalOpen(true)}
              onAddList={() => setListModalOpen(true)}
              onDeleteItem={(itemId) =>
                void runMutation(
                  () => deleteShoppingItem(accessToken, itemId),
                  '商品已删除',
                )
              }
              onDeleteList={(listId) =>
                void runMutation(
                  () => deleteShoppingList(accessToken, listId),
                  '清单已删除',
                )
              }
              onImport={() => setImportModalOpen(true)}
              onSelectList={(listId) => void selectListById(accessToken, listId, setSelectedList, setError, loadAll)}
            />
          ) : null}

          {activeTab === 'store' ? (
            <StoreView
              busy={busy}
              colors={colors}
              dark={dark}
              selectedStore={selectedStore}
              stores={home.stores}
              onAddStore={() => setStoreModalOpen(true)}
              onDeleteStore={(storeId) =>
                void runMutation(
                  () => deleteShoppingStore(accessToken, storeId),
                  '超市已删除',
                )
              }
              onEditZones={(zones) => {
                setZoneDraft(
                  zones.map((zone) => ({ name: zone.name, zoneType: zone.zoneType })),
                );
                setZoneModalOpen(true);
              }}
              onSelectStore={(storeId) => void selectStoreById(accessToken, storeId, setSelectedStore, setError, loadAll)}
              onSetEndpoints={() => {
                setEndpointDraft({
                  entry: selectedStore?.entryZoneId ?? '',
                  checkout: selectedStore?.checkoutZoneId ?? '',
                });
                setEndpointModalOpen(true);
              }}
            />
          ) : null}

          {activeTab === 'route' ? (
            <RouteView
              activeRoute={activeRoute}
              busy={busy}
              colors={colors}
              dark={dark}
              history={history}
              onComplete={() => void finishRoute()}
              onConfirmSuggestion={(suggestion) => void confirmSuggestion(suggestion)}
              onGenerate={() => void generateRoute()}
              onToggle={(itemId, completed) => void toggleRouteItem(itemId, completed)}
              selectedList={selectedList ?? home.lists[0] ?? null}
              selectedStore={selectedStore ?? home.stores[0] ?? null}
              suggestions={suggestions}
            />
          ) : null}
        </ScrollView>
      </View>

      <Modal transparent animationType="slide" visible={listModalOpen} onRequestClose={() => setListModalOpen(false)}>
        <ModalSheet title="建立真实购物清单" onClose={() => setListModalOpen(false)}>
          <FieldLabel text="清单名称" />
          <TextInput
            autoFocus
            placeholder="例如：家庭采购"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={listName}
            onChangeText={setListName}
          />
          <ModalButton label="创建清单" icon="plus" onPress={() => void submitList()} />
        </ModalSheet>
      </Modal>

      <Modal transparent animationType="slide" visible={itemModalOpen} onRequestClose={() => setItemModalOpen(false)}>
        <ModalSheet title="添加真实商品" onClose={() => setItemModalOpen(false)}>
          <FieldLabel text="商品名称" />
          <TextInput
            placeholder="例如：西红柿"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={itemDraft.name}
            onChangeText={(name) => setItemDraft((current) => ({ ...current, name }))}
          />
          <FieldLabel text="数量" />
          <TextInput
            placeholder="例如：2 个 / 500g"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={itemDraft.quantity}
            onChangeText={(quantity) => setItemDraft((current) => ({ ...current, quantity }))}
          />
          <FieldLabel text="条码（选填，查询真实商品）" />
          <View style={styles.barcodeRow}>
            <TextInput
              keyboardType="number-pad"
              placeholder="输入条码"
              placeholderTextColor={colors.mutedText}
              style={[styles.input, styles.barcodeInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              value={itemDraft.barcode}
              onChangeText={(barcode) => setItemDraft((current) => ({ ...current, barcode }))}
            />
            <Pressable
              onPress={() => void lookupBarcode()}
              style={[styles.smallButton, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="barcode-scan" size={17} color={colors.primary} />
            </Pressable>
          </View>
          <FieldLabel text="备注（选填）" />
          <TextInput
            placeholder="真实备注"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={itemDraft.note}
            onChangeText={(note) => setItemDraft((current) => ({ ...current, note }))}
          />
          <ModalButton label="加入清单" icon="basket-plus" onPress={() => void submitItem()} />
        </ModalSheet>
      </Modal>

      <Modal transparent animationType="slide" visible={importModalOpen} onRequestClose={() => setImportModalOpen(false)}>
        <ModalSheet title="从菜谱导入真实食材" onClose={() => setImportModalOpen(false)}>
          <FieldLabel text="菜谱 ID" />
          <TextInput
            placeholder="例如：52947"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={importDraft.dishId}
            onChangeText={(dishId) => setImportDraft((current) => ({ ...current, dishId }))}
          />
          <FieldLabel text="清单名称（可选）" />
          <TextInput
            placeholder="默认：菜谱备菜清单"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={importDraft.listName}
            onChangeText={(listName) => setImportDraft((current) => ({ ...current, listName }))}
          />
          <ModalButton label="导入真实食材" icon="food" onPress={() => void submitImport()} />
        </ModalSheet>
      </Modal>

      <Modal transparent animationType="slide" visible={storeModalOpen} onRequestClose={() => setStoreModalOpen(false)}>
        <ModalSheet title="添加常去超市" onClose={() => setStoreModalOpen(false)}>
          <FieldLabel text="超市名称" />
          <TextInput
            placeholder="例如：常去超市"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={storeDraft.name}
            onChangeText={(name) => setStoreDraft((current) => ({ ...current, name }))}
          />
          <FieldLabel text="地址（选填）" />
          <TextInput
            placeholder="真实地址"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
            value={storeDraft.address}
            onChangeText={(address) => setStoreDraft((current) => ({ ...current, address }))}
          />
          <ModalButton label="保存超市" icon="store-plus" onPress={() => void submitStore()} />
        </ModalSheet>
      </Modal>

      <Modal transparent animationType="slide" visible={zoneModalOpen} onRequestClose={() => setZoneModalOpen(false)}>
        <ModalSheet title="编辑真实区域顺序" onClose={() => setZoneModalOpen(false)}>
          {zoneDraft.map((zone, index) => (
            <View key={index} style={[styles.zoneDraftCard, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
              <View style={styles.zoneDraftHead}>
                <ThemedText style={styles.zoneDraftIndex}>{index + 1}</ThemedText>
                <TextInput
                  placeholder="区域名称"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, styles.zoneDraftInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
                  value={zone.name}
                  onChangeText={(name) => updateZoneDraft(index, { name })}
                />
                <Pressable
                  onPress={() => setZoneDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  style={styles.dangerIcon}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#e8667a" />
                </Pressable>
              </View>
              <View style={styles.chipWrap}>
                {ZONE_TYPE_OPTIONS.map((option) => (
                  <ZoneChip
                    active={zone.zoneType === option.value}
                    key={option.value}
                    label={option.label}
                    onPress={() => updateZoneDraft(index, { zoneType: option.value })}
                  />
                ))}
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => setZoneDraft((current) => [...current, { name: '', zoneType: 'produce' }])}
            style={[styles.addZoneButton, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
            <ThemedText style={[styles.addZoneText, { color: colors.primary }]}>添加区域</ThemedText>
          </Pressable>
          <ModalButton label="保存区域顺序" icon="content-save" onPress={() => void submitZones()} />
        </ModalSheet>
      </Modal>

      <Modal transparent animationType="slide" visible={endpointModalOpen} onRequestClose={() => setEndpointModalOpen(false)}>
        <ModalSheet title="设置路线端点" onClose={() => setEndpointModalOpen(false)}>
          <FieldLabel text="入口" />
          <View style={styles.chipWrap}>
            {selectedStore?.zones.map((zone) => (
              <ZoneChip
                active={endpointDraft.entry === zone.id}
                key={`entry-${zone.id}`}
                label={zone.name}
                onPress={() => setEndpointDraft((current) => ({ ...current, entry: zone.id }))}
              />
            ))}
          </View>
          <FieldLabel text="收银台" />
          <View style={styles.chipWrap}>
            {selectedStore?.zones.map((zone) => (
              <ZoneChip
                active={endpointDraft.checkout === zone.id}
                key={`checkout-${zone.id}`}
                label={zone.name}
                onPress={() => setEndpointDraft((current) => ({ ...current, checkout: zone.id }))}
              />
            ))}
          </View>
          <ModalButton label="保存端点" icon="flag-checkered" onPress={() => void saveEndpoints()} />
        </ModalSheet>
      </Modal>
    </SafeAreaView>
  );

  function updateZoneDraft(index: number, patch: Partial<ZoneDraft>) {
    setZoneDraft((current) =>
      current.map((zone, zoneIndex) => (zoneIndex === index ? { ...zone, ...patch } : zone)),
    );
  }
}

function normalizeRoute(route: ShoppingRoute | null) {
  if (!route) return route;
  return {
    ...route,
    zones: (route.zones ?? []).map((zone) => ({
      ...zone,
      items: zone.items ?? [],
    })),
    unmapped: route.unmapped ?? [],
  };
}

async function selectListById(
  token: string,
  listId: string,
  setter: (list: ShoppingList) => void,
  setError: (error: string) => void,
  loadAll: () => Promise<void>,
) {
  try {
    const list = await fetchShoppingList(token, listId);
    setter(list);
    await loadAll();
  } catch (nextError) {
    setError(getShoppingRouteErrorMessage(nextError));
  }
}

async function selectStoreById(
  token: string,
  storeId: string,
  setter: (store: ShoppingStore) => void,
  setError: (error: string) => void,
  loadAll: () => Promise<void>,
) {
  try {
    const store = await fetchShoppingStore(token, storeId);
    setter(store);
    await loadAll();
  } catch (nextError) {
    setError(getShoppingRouteErrorMessage(nextError));
  }
}

function HomeSummary({
  colors,
  dark,
  home,
  route,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  home: ShoppingRouteHome;
  route: ShoppingRoute | null;
}) {
  return (
    <View style={[styles.summaryHero, { backgroundColor: colors.hero }]}>
      <View style={styles.summaryTop}>
        <View style={styles.summaryIcon}>
          <MaterialCommunityIcons name="routes" size={22} color="#c9f36a" />
        </View>
        <View style={styles.summaryCopy}>
          <ThemedText style={styles.summaryTitle}>购物路线</ThemedText>
          <ThemedText style={styles.summarySub}>按真实区域顺序，不猜距离与时间</ThemedText>
        </View>
      </View>
      <View style={styles.summaryMetaRow}>
        <SummaryMeta label="商品" value={String(home.totalItems)} />
        <SummaryMeta label="已归位" value={String(home.mappedItems)} />
        <SummaryMeta label="未归位" value={String(home.unmappedItems)} />
        <SummaryMeta label="路线" value={routeCompletenessLabel(route)} />
      </View>
    </View>
  );
}

function SummaryMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryMeta}>
      <ThemedText style={styles.summaryMetaValue}>{value}</ThemedText>
      <ThemedText style={styles.summaryMetaLabel}>{label}</ThemedText>
    </View>
  );
}

function ListView({
  busy,
  colors,
  dark,
  home,
  selectedList,
  onAddItem,
  onAddList,
  onDeleteItem,
  onDeleteList,
  onImport,
  onSelectList,
}: {
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  home: ShoppingRouteHome;
  selectedList: ShoppingList | null;
  onAddItem: () => void;
  onAddList: () => void;
  onDeleteItem: (itemId: string) => void;
  onDeleteList: (listId: string) => void;
  onImport: () => void;
  onSelectList: (listId: string) => void;
}) {
  if (home.lists.length === 0) {
    return (
      <EmptyState
        colors={colors}
        icon="basket-plus"
        title="还没有真实购物清单"
        subtitle="先建立清单，或从菜谱导入真实食材，再添加常去超市生成路线。"
        actionLabel="建立购物清单"
        onAction={onAddList}
      />
    );
  }
  return (
    <View style={styles.tabContent}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.panelHead}>
          <ThemedText style={styles.panelTitle}>选择清单</ThemedText>
          <Pressable onPress={onAddList} style={styles.panelAction}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
            <ThemedText style={[styles.panelActionText, { color: colors.primary }]}>新建</ThemedText>
          </Pressable>
        </View>
        <View style={styles.chipWrap}>
          {home.lists.map((list) => (
            <ZoneChip
              active={selectedList?.id === list.id}
              key={list.id}
              label={list.name}
              onPress={() => onSelectList(list.id)}
            />
          ))}
        </View>
      </View>

      {selectedList ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <View>
              <ThemedText style={styles.panelTitle}>{selectedList.name}</ThemedText>
              <ThemedText style={[styles.panelSub, { color: colors.mutedText }]}>
                {selectedList.items.length} 项真实商品
              </ThemedText>
            </View>
            <Pressable onPress={() => onDeleteList(selectedList.id)} style={styles.dangerIcon}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#e8667a" />
            </Pressable>
          </View>
          {selectedList.items.length === 0 ? (
            <EmptyState
              compact
              colors={colors}
              icon="basket-outline"
              title="清单还是空的"
              subtitle="添加商品或从菜谱导入真实食材。"
              actionLabel="添加商品"
              onAction={onAddItem}
            />
          ) : (
            selectedList.items.map((item) => (
              <ItemRow
                colors={colors}
                item={item}
                key={item.id}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))
          )}
        </View>
      ) : null}

      <View style={styles.actionGrid}>
        <Pressable
          onPress={onAddItem}
          style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="basket-plus" size={18} color="#ffffff" />
          <ThemedText style={styles.actionButtonText}>添加商品</ThemedText>
        </Pressable>
        <Pressable
          onPress={onImport}
          style={({ pressed }) => [styles.actionButtonGhost, { borderColor: colors.line, backgroundColor: colors.surface }, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="food" size={18} color={colors.primary} />
          <ThemedText style={[styles.actionButtonGhostText, { color: colors.primary }]}>导入菜谱</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function ItemRow({
  colors,
  item,
  onDelete,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  item: ShoppingList['items'][number];
  onDelete: () => void;
}) {
  return (
    <View style={[styles.itemRow, { borderTopColor: colors.line }]}>
      <View style={styles.itemIcon}>
        <MaterialCommunityIcons name="basket" size={16} color="#ffffff" />
      </View>
      <View style={styles.itemCopy}>
        <ThemedText style={styles.itemName}>{item.name}</ThemedText>
        <ThemedText style={[styles.itemSource, { color: colors.mutedText }]}>
          {sourceLabel(item.source)}
        </ThemedText>
      </View>
      <ThemedText style={styles.itemQty}>{item.quantity}</ThemedText>
      <Pressable onPress={onDelete} style={styles.dangerIcon}>
        <MaterialCommunityIcons name="trash-can-outline" size={16} color="#e8667a" />
      </Pressable>
    </View>
  );
}

function StoreView({
  busy,
  colors,
  dark,
  selectedStore,
  stores,
  onAddStore,
  onDeleteStore,
  onEditZones,
  onSelectStore,
  onSetEndpoints,
}: {
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  selectedStore: ShoppingStore | null;
  stores: ShoppingStore[];
  onAddStore: () => void;
  onDeleteStore: (storeId: string) => void;
  onEditZones: (zones: ShoppingZone[]) => void;
  onSelectStore: (storeId: string) => void;
  onSetEndpoints: () => void;
}) {
  if (stores.length === 0) {
    return (
      <EmptyState
        colors={colors}
        icon="store-plus"
        title="还没有常去超市"
        subtitle="创建超市后，录入真实区域顺序，系统才会用它生成路线。"
        actionLabel="添加常去超市"
        onAction={onAddStore}
      />
    );
  }
  return (
    <View style={styles.tabContent}>
      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.panelHead}>
          <ThemedText style={styles.panelTitle}>选择超市</ThemedText>
          <Pressable onPress={onAddStore} style={styles.panelAction}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.primary} />
            <ThemedText style={[styles.panelActionText, { color: colors.primary }]}>新建</ThemedText>
          </Pressable>
        </View>
        <View style={styles.chipWrap}>
          {stores.map((store) => (
            <ZoneChip
              active={selectedStore?.id === store.id}
              key={store.id}
              label={store.name}
              onPress={() => onSelectStore(store.id)}
            />
          ))}
        </View>
      </View>

      {selectedStore ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <View>
              <ThemedText style={styles.panelTitle}>{selectedStore.name}</ThemedText>
              <ThemedText style={[styles.panelSub, { color: colors.mutedText }]}>
                {selectedStore.zones.length > 0
                  ? `${selectedStore.zones.length} 个真实区域`
                  : '尚未录入区域'}
              </ThemedText>
            </View>
            <Pressable onPress={() => onDeleteStore(selectedStore.id)} style={styles.dangerIcon}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#e8667a" />
            </Pressable>
          </View>
          {selectedStore.zones.map((zone) => (
            <View key={zone.id} style={[styles.zoneRow, { borderTopColor: colors.line }]}>
              <View style={styles.zoneIndex}>
                <ThemedText style={styles.zoneIndexText}>{zone.position}</ThemedText>
              </View>
              <View style={styles.itemCopy}>
                <ThemedText style={styles.itemName}>{zone.name}</ThemedText>
                <ThemedText style={[styles.itemSource, { color: colors.mutedText }]}>
                  {zoneTypeLabel(zone.zoneType)}
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="drag-vertical" size={18} color={colors.mutedText} />
            </View>
          ))}
          <View style={styles.actionGrid}>
            <Pressable
              onPress={() => onEditZones(selectedStore.zones)}
              style={({ pressed }) => [styles.actionButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="format-list-numbered" size={18} color="#ffffff" />
              <ThemedText style={styles.actionButtonText}>编辑区域顺序</ThemedText>
            </Pressable>
            <Pressable
              onPress={onSetEndpoints}
              style={({ pressed }) => [styles.actionButtonGhost, { borderColor: colors.line, backgroundColor: colors.surface }, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="flag-checkered" size={18} color={colors.primary} />
              <ThemedText style={[styles.actionButtonGhostText, { color: colors.primary }]}>入口/收银台</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RouteView({
  activeRoute,
  busy,
  colors,
  dark,
  history,
  onComplete,
  onConfirmSuggestion,
  onGenerate,
  onToggle,
  selectedList,
  selectedStore,
  suggestions,
}: {
  activeRoute: ShoppingRoute | null;
  busy: boolean;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dark: boolean;
  history: ShoppingRoute[];
  onComplete: () => void;
  onConfirmSuggestion: (suggestion: ShoppingMappingSuggestion) => void;
  onGenerate: () => void;
  onToggle: (itemId: string, completed: boolean) => void;
  selectedList: ShoppingList | null;
  selectedStore: ShoppingStore | null;
  suggestions: ShoppingMappingSuggestion[];
}) {
  if (!selectedList || !selectedStore) {
    return (
      <EmptyState
        colors={colors}
        icon="routes"
        title="需要清单和超市"
        subtitle="先在清单页建立真实清单，在超市页录入区域顺序。"
      />
    );
  }
  if (!activeRoute) {
    return (
      <View style={styles.tabContent}>
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <ThemedText style={styles.panelTitle}>未归位确认</ThemedText>
            <ThemedText style={[styles.panelSub, { color: colors.mutedText }]}>
              {selectedStore.zones.length > 0 ? '区域顺序已就绪' : '需要先录入区域'}
            </ThemedText>
          </View>
          {suggestions.length === 0 ? (
            <ThemedText style={[styles.emptyHint, { color: colors.mutedText }]}>
              当前清单没有可自动归位的商品，添加真实商品后再生成路线。
            </ThemedText>
          ) : (
            suggestions.map((suggestion) => (
              <View key={suggestion.itemId} style={[styles.suggestCard, { borderColor: colors.line }]}>
                <View style={styles.suggestHead}>
                  <ThemedText style={styles.suggestName}>{suggestion.name}</ThemedText>
                  <ThemedText style={[styles.suggestQty, { color: colors.mutedText }]}>
                    {zoneTypeLabel(suggestion.zoneType)}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.suggestSource, { color: colors.mutedText }]}>
                  {suggestion.zoneName || '门店尚无此区域'} · {sourceLabel(suggestion.source)}
                </ThemedText>
                <Pressable
                  onPress={() => onConfirmSuggestion(suggestion)}
                  style={[styles.suggestButton, { backgroundColor: colors.primarySoft }]}>
                  <MaterialCommunityIcons name="check" size={16} color={colors.primary} />
                  <ThemedText style={[styles.suggestButtonText, { color: colors.primary }]}>使用建议</ThemedText>
                </Pressable>
              </View>
            ))
          )}
        </View>
        <Pressable
          onPress={onGenerate}
          disabled={busy || selectedStore.zones.length === 0 || suggestions.length === 0}
          style={({ pressed }) => [
            styles.generateButton,
            { backgroundColor: colors.primary },
            (busy || selectedStore.zones.length === 0 || suggestions.length === 0) && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="routes" size={19} color="#ffffff" />
          <ThemedText style={styles.generateButtonText}>生成路线</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <View style={[styles.routeHero, { backgroundColor: colors.hero }]}>
        <ThemedText style={styles.routeKicker}>真实区域顺序</ThemedText>
        <ThemedText style={styles.routeTitle}>
          {routeCompletenessLabel(activeRoute)}
        </ThemedText>
        <View style={styles.routeStops}>
          {routeStops(activeRoute, selectedStore).map((stop, index) => (
            <View key={`${stop}-${index}`} style={styles.routeStopWrap}>
              {index > 0 ? (
                <MaterialCommunityIcons name="arrow-right" size={12} color="rgba(255,255,255,0.55)" />
              ) : null}
              <View style={styles.routeStop}>
                <ThemedText style={styles.routeStopText}>{stop}</ThemedText>
              </View>
            </View>
          ))}
        </View>
      </View>

      {(activeRoute.zones ?? []).map((zoneGroup) => (
        <View key={zoneGroup.zone.id} style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <View style={styles.zoneGroupTitle}>
              <MaterialCommunityIcons name="map-marker-radius" size={17} color={colors.primary} />
              <ThemedText style={styles.panelTitle}>{zoneGroup.zone.name}</ThemedText>
            </View>
            <ThemedText style={[styles.panelSub, { color: colors.mutedText }]}>
              {zoneGroup.completed}/{zoneGroup.total}
            </ThemedText>
          </View>
          {(zoneGroup.items ?? []).map((routeItem) => (
            <Pressable
              key={routeItem.item.id}
              onPress={() => onToggle(routeItem.item.id, !routeItem.completed)}
              style={[styles.checkRow, { borderTopColor: colors.line }]}>
              <View style={[styles.checkCircle, routeItem.completed && { backgroundColor: colors.primary }]}>
                {routeItem.completed ? (
                  <MaterialCommunityIcons name="check" size={12} color="#ffffff" />
                ) : null}
              </View>
              <ThemedText
                style={[
                  styles.checkName,
                  routeItem.completed && { color: colors.mutedText, textDecorationLine: 'line-through' },
                ]}>
                {routeItem.item.name}
              </ThemedText>
              <ThemedText style={[styles.checkQty, { color: colors.mutedText }]}>
                {routeItem.item.quantity}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ))}

      {(activeRoute.unmapped ?? []).length > 0 ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <ThemedText style={styles.panelTitle}>未归位</ThemedText>
            <ThemedText style={[styles.panelSub, { color: colors.mutedText }]}>
              {(activeRoute.unmapped ?? []).length} 项
            </ThemedText>
          </View>
          {(activeRoute.unmapped ?? []).map((routeItem) => (
            <ThemedText key={routeItem.item.id} style={[styles.unmappedText, { color: colors.mutedText }]}>
              {routeItem.item.name} · 未确认区域
            </ThemedText>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={onComplete}
        disabled={busy || activeRoute.status === 'complete'}
        style={({ pressed }) => [
          styles.generateButton,
          { backgroundColor: colors.primary },
          activeRoute.status === 'complete' && styles.disabled,
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons name="check-all" size={19} color="#ffffff" />
        <ThemedText style={styles.generateButtonText}>
          {activeRoute.status === 'complete' ? '已完成' : '完成本次购物'}
        </ThemedText>
      </Pressable>

      {(history ?? []).length > 0 ? (
        <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.panelHead}>
            <ThemedText style={styles.panelTitle}>历史记录</ThemedText>
            <ThemedText style={[styles.panelSub, { color: colors.mutedText }]}>
              {(history ?? []).length} 次
            </ThemedText>
          </View>
          {(history ?? []).map((item) => (
            <ThemedText key={item.id} style={[styles.historyText, { color: colors.mutedText }]}>
              {new Date(item.completedAt).toLocaleString()} · {item.totalCount} 项
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function routeStops(route: ShoppingRoute, store: ShoppingStore) {
  const stops: string[] = [];
  const zoneName = (zoneId: string) =>
    store.zones.find((zone) => zone.id === zoneId)?.name ?? '未知区域';
  if (route.entryZoneId) stops.push(`入口·${zoneName(route.entryZoneId)}`);
  for (const zoneGroup of route.zones ?? []) stops.push(zoneGroup.zone.name);
  if (route.checkoutZoneId) stops.push(`收银台·${zoneName(route.checkoutZoneId)}`);
  return stops;
}

function TabButton({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabButton, active && { backgroundColor: colors.surface, shadowColor: '#17233d' }]}>
      <MaterialCommunityIcons name={icon} size={17} color={active ? colors.primary : colors.mutedText} />
      <ThemedText style={[styles.tabButtonText, active && { color: colors.primary }]}>{label}</ThemedText>
    </Pressable>
  );
}

function ZoneChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.zoneChip,
        { borderColor: colors.line, backgroundColor: colors.surface },
        active && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
      ]}>
      <ThemedText
        style={[
          styles.zoneChipText,
          { color: colors.mutedText },
          active && { color: colors.primary, fontWeight: '800' },
        ]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <ThemedText style={styles.fieldLabel}>{text}</ThemedText>;
}

function ModalButton({
  icon,
  label,
  onPress,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.modalButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
      <MaterialCommunityIcons name={icon} size={18} color="#ffffff" />
      <ThemedText style={styles.modalButtonText}>{label}</ThemedText>
    </Pressable>
  );
}

function ModalSheet({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.modalScrim}>
      <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
        <View style={styles.modalHead}>
          <ThemedText style={styles.modalTitle}>{title}</ThemedText>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <MaterialCommunityIcons name="close" size={22} color={colors.mutedText} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function EmptyState({
  actionLabel,
  colors,
  compact,
  icon,
  onAction,
  subtitle,
  title,
}: {
  actionLabel?: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  compact?: boolean;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  onAction?: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name={icon} size={30} color={colors.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={[styles.emptySub, { color: colors.mutedText }]}>{subtitle}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.emptyButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
          <ThemedText style={styles.emptyButtonText}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Notice({ text, tone }: { text: string; tone: 'error' | 'success' }) {
  return (
    <View
      style={[
        styles.notice,
        {
          backgroundColor: tone === 'error' ? '#fdebed' : '#e1f5ee',
          borderColor: tone === 'error' ? '#f3bcc5' : '#a7ddca',
        },
      ]}>
      <MaterialCommunityIcons
        name={tone === 'error' ? 'alert-circle-outline' : 'check-circle-outline'}
        size={17}
        color={tone === 'error' ? '#c13e58' : '#11745d'}
      />
      <ThemedText style={[styles.noticeText, { color: tone === 'error' ? '#8d2f45' : '#11745d' }]}>{text}</ThemedText>
    </View>
  );
}

function CenterState({
  icon,
  loading,
  title,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  loading?: boolean;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={styles.centerState}>
        <View style={[styles.stateIcon, { backgroundColor: colors.primarySoft }]}>
          {loading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <MaterialCommunityIcons name={icon} size={32} color={colors.primary} />
          )}
        </View>
        <ThemedText style={styles.stateTitle}>{title}</ThemedText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { flex: 1, width: '100%' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 14,
  },
  headerTitleWrap: { flex: 1, paddingHorizontal: 8 },
  headerTitle: { fontSize: 20, fontWeight: '900' },
  headerMeta: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  tabs: {
    borderRadius: 14,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 14,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 42,
  },
  tabButtonText: { fontSize: 12, fontWeight: '700' },
  scrollContent: { padding: 14, paddingBottom: 42 },
  summaryHero: {
    borderRadius: 18,
    marginBottom: 14,
    overflow: 'hidden',
    padding: 16,
  },
  summaryTop: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  summaryIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  summarySub: { color: 'rgba(255,255,255,0.72)', fontSize: 10, fontWeight: '600', marginTop: 4 },
  summaryMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  summaryMeta: { minWidth: 74 },
  summaryMetaValue: { color: '#ffffff', fontFamily: 'monospace', fontSize: 16, fontWeight: '900' },
  summaryMetaLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: '600', marginTop: 3 },
  tabContent: { gap: 14 },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  panelHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  panelTitle: { fontSize: 14, fontWeight: '900' },
  panelSub: { fontSize: 10, fontWeight: '600', marginTop: 3 },
  panelAction: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  panelActionText: { fontSize: 11, fontWeight: '800' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  zoneChip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  zoneChipText: { fontSize: 10, fontWeight: '700' },
  itemRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
  },
  itemIcon: {
    alignItems: 'center',
    backgroundColor: '#1d9c7c',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 12, fontWeight: '800' },
  itemSource: { fontSize: 9, fontWeight: '600', marginTop: 2 },
  itemQty: { fontFamily: 'monospace', fontSize: 11, fontWeight: '800' },
  actionGrid: { flexDirection: 'row', gap: 10 },
  actionButton: {
    alignItems: 'center',
    borderRadius: 13,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
  },
  actionButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  actionButtonGhost: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
  },
  actionButtonGhostText: { fontSize: 12, fontWeight: '800' },
  zoneRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
  },
  zoneIndex: {
    alignItems: 'center',
    backgroundColor: '#e1f5ee',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  zoneIndexText: { color: '#11745d', fontSize: 11, fontWeight: '900' },
  routeHero: {
    borderRadius: 18,
    padding: 16,
  },
  routeKicker: { color: '#c9f36a', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  routeTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginTop: 5 },
  routeStops: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  routeStopWrap: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  routeStop: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  routeStopText: { color: '#ffffff', fontSize: 9, fontWeight: '800' },
  zoneGroupTitle: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  checkRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
  },
  checkCircle: {
    alignItems: 'center',
    borderColor: '#b7c2d6',
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkName: { flex: 1, fontSize: 12, fontWeight: '700' },
  checkQty: { fontFamily: 'monospace', fontSize: 10, fontWeight: '700' },
  unmappedText: { fontSize: 11, fontWeight: '600', lineHeight: 20 },
  historyText: { fontSize: 11, fontWeight: '600', lineHeight: 22 },
  suggestCard: {
    borderRadius: 13,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  suggestHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  suggestName: { fontSize: 12, fontWeight: '900' },
  suggestQty: { fontSize: 10, fontWeight: '700' },
  suggestSource: { fontSize: 9, fontWeight: '600', marginTop: 5 },
  suggestButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 38,
  },
  suggestButtonText: { fontSize: 11, fontWeight: '800' },
  generateButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
  },
  generateButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.82 },
  loginState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 },
  stateIcon: {
    alignItems: 'center',
    borderRadius: 50,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  stateTitle: { fontSize: 16, fontWeight: '900', marginTop: 16 },
  stateText: { fontSize: 12, fontWeight: '600', lineHeight: 20, marginTop: 8, textAlign: 'center' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 48,
    paddingHorizontal: 26,
  },
  primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyState: {
    alignItems: 'center',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginTop: 8,
    padding: 30,
  },
  emptyStateCompact: { padding: 18 },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 50,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  emptyTitle: { fontSize: 15, fontWeight: '900', marginTop: 14 },
  emptySub: { fontSize: 10, fontWeight: '600', lineHeight: 18, marginTop: 6, textAlign: 'center' },
  emptyButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 42,
    paddingHorizontal: 18,
  },
  emptyButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  emptyHint: { fontSize: 11, fontWeight: '600', lineHeight: 18, marginTop: 8 },
  notice: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  noticeText: { flex: 1, fontSize: 11, fontWeight: '700' },
  modalScrim: {
    backgroundColor: 'rgba(20,28,48,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    padding: 18,
    paddingBottom: 28,
  },
  modalHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: '900' },
  modalClose: { padding: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '800', marginBottom: 7, marginTop: 12 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 13,
    fontWeight: '700',
    minHeight: 46,
    paddingHorizontal: 12,
  },
  barcodeRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  barcodeInput: { flex: 1 },
  smallButton: {
    alignItems: 'center',
    borderRadius: 11,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  modalButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 50,
  },
  modalButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  zoneDraftCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  zoneDraftHead: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  zoneDraftIndex: {
    alignItems: 'center',
    color: '#11745d',
    fontSize: 12,
    fontWeight: '900',
    width: 18,
  },
  zoneDraftInput: { flex: 1 },
  dangerIcon: { padding: 6 },
  addZoneButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
  },
  addZoneText: { fontSize: 12, fontWeight: '800' },
});
