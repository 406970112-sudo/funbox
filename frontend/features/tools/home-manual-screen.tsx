import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useAuth } from '@/features/auth/auth-provider';
import {
  exportHomeManual,
  fetchHomeManualState,
  getHomeManualErrorMessage,
  lockHomeManual,
  saveHomeManualState,
  setHomeManualPassword,
  unlockHomeManual,
} from '@/lib/home-manual-api';
import {
  addHomeContact,
  addHomeDevice,
  addHomeNetwork,
  addHomeReminder,
  getFilterDueDate,
  newHomeManualID,
  normalizeHomeManualState,
  removeHomeContact,
  removeHomeDevice,
  removeHomeNetwork,
  removeHomeReminder,
  searchHomeManual,
  updateHomeContact,
  updateHomeDevice,
  updateHomeNetwork,
  updateHomeReminder,
} from '@/lib/home-manual';
import {
  getHomeManualState,
  getHomeManualUnlockToken,
  removeHomeManualUnlockToken,
  setHomeManualState,
  setHomeManualUnlockToken,
} from '@/lib/home-manual-storage';
import {
  createEmptyHomeManualState,
  HOME_CONTACT_KIND_LABELS,
  HOME_DEVICE_CATEGORY_LABELS,
  HOME_REMINDER_KIND_LABELS,
} from '@/types/home-manual';
import type {
  HomeContact,
  HomeContactKind,
  HomeDevice,
  HomeDeviceCategory,
  HomeManualState,
  HomeNetwork,
  HomeReminder,
  HomeReminderKind,
} from '@/types/home-manual';

type Tab = 'home' | 'devices' | 'networks' | 'contacts' | 'reminders' | 'security';
type EditorKind = 'device' | 'network' | 'contact' | 'reminder';
type EditorState = { kind: EditorKind; itemId: string | null } | null;
type Color = ReturnType<typeof useAppTheme>['colors'];
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function HomeManualScreen() {
  const { accessToken: token, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [state, setState] = useState<HomeManualState>(createEmptyHomeManualState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [unlocked, setUnlocked] = useState(false);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<EditorState>(null);
  const stateRef = useRef(state);
  const unlockTokenRef = useRef<string | null>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  stateRef.current = state;
  unlockTokenRef.current = unlockToken;

  const persistAndSync = useCallback(
    (nextState: HomeManualState, notice?: string) => {
      setState(nextState);
      if (notice) setMessage(notice);
      void setHomeManualState(nextState);
      if (!token) return;
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await saveHomeManualState(token, nextState, unlockTokenRef.current ?? undefined);
            setSyncMessage(null);
            setState((current) => (current.updatedAt >= saved.updatedAt ? current : normalizeHomeManualState(saved)));
          } catch (error) {
            setSyncMessage(getHomeManualErrorMessage(error));
          }
        });
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await getHomeManualState();
      let storedUnlock = await getHomeManualUnlockToken();
      let nextState = local;
      let nextUnlocked = Boolean(storedUnlock);
      if (token) {
        try {
          if (storedUnlock) {
            try {
              nextState = normalizeHomeManualState(await fetchHomeManualState(token, storedUnlock));
            } catch {
              storedUnlock = null;
              await removeHomeManualUnlockToken();
              nextUnlocked = false;
              nextState = normalizeHomeManualState(await fetchHomeManualState(token));
            }
          } else {
            const remote = await fetchHomeManualState(token);
            if (remote.updatedAt > 0 && (nextState.updatedAt === 0 || remote.updatedAt > nextState.updatedAt)) {
              nextState = normalizeHomeManualState(remote);
            } else if (nextState.updatedAt > 0 && remote.updatedAt === 0) {
              nextState = normalizeHomeManualState(await saveHomeManualState(token, nextState));
            }
          }
        } catch (error) {
          if (active) setSyncMessage(getHomeManualErrorMessage(error));
        }
      }
      if (!active) return;
      setState(nextState);
      setUnlocked(nextUnlocked);
      setUnlockToken(storedUnlock);
      unlockTokenRef.current = storedUnlock;
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const searchResult = useMemo(() => searchHomeManual(state, query, unlocked), [query, state, unlocked]);

  async function handleUnlock(password: string) {
    if (!token) {
      setMessage('请先登录后再解锁家庭说明书');
      return;
    }
    try {
      const response = await unlockHomeManual(token, password);
      await setHomeManualUnlockToken(response.unlockToken);
      unlockTokenRef.current = response.unlockToken;
      setUnlockToken(response.unlockToken);
      setUnlocked(true);
      const full = normalizeHomeManualState(await fetchHomeManualState(token, response.unlockToken));
      setState(full);
      void setHomeManualState(full);
      setMessage('家庭说明书已解锁');
    } catch (error) {
      setMessage(getHomeManualErrorMessage(error));
    }
  }

  async function handleLock() {
    if (token && unlockToken) {
      try {
        await lockHomeManual(token, unlockToken);
      } catch {
        // Local lock still applies.
      }
    }
    await removeHomeManualUnlockToken();
    setUnlocked(false);
    setUnlockToken(null);
    unlockTokenRef.current = null;
    if (token) {
      try {
        const metadata = normalizeHomeManualState(await fetchHomeManualState(token));
        setState(metadata);
        void setHomeManualState(metadata);
      } catch {
        // Keep local state but lock the UI.
      }
    }
    setMessage('家庭说明书已锁定');
  }

  async function handlePassword(action: 'set' | 'change' | 'remove', current: string, next: string) {
    if (!token) {
      setMessage('请先登录后再管理家庭说明书密码');
      return;
    }
    try {
      await setHomeManualPassword(token, action, current, next);
      if (action === 'remove') {
        await removeHomeManualUnlockToken();
        setUnlocked(false);
        setUnlockToken(null);
        unlockTokenRef.current = null;
        const metadata = normalizeHomeManualState(await fetchHomeManualState(token));
        setState(metadata);
        void setHomeManualState(metadata);
        setMessage('家庭说明书密码已移除');
        return;
      }
      await handleUnlock(next);
      setMessage(action === 'set' ? '家庭说明书密码已设置' : '家庭说明书密码已修改');
    } catch (error) {
      setMessage(getHomeManualErrorMessage(error));
    }
  }

  function handleSaveEditor(item: HomeDevice | HomeNetwork | HomeContact | HomeReminder) {
    if (stateRef.current.security.enabled && !unlockTokenRef.current) {
      setMessage('请先解锁后再修改家庭说明书');
      return;
    }
    if (hasSecretEditorValue(item) && !stateRef.current.security.enabled) {
      setMessage('请先设置家庭说明书密码并解锁，再保存敏感字段');
      return;
    }
    const result = saveEditorItem(stateRef.current, editor?.kind ?? 'device', item, editor?.itemId ?? null);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    setEditor(null);
    persistAndSync(result.state, '已保存真实数据');
  }

  function handleDelete(kind: EditorKind, id: string, label: string) {
    if (stateRef.current.security.enabled && !unlockTokenRef.current) {
      setMessage('请先解锁后再删除');
      return;
    }
    Alert.alert('删除记录', `将删除「${label}」及关联真实数据，该操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          const next = deleteEditorItem(stateRef.current, kind, id);
          setEditor(null);
          persistAndSync(next, '已删除');
        },
      },
    ]);
  }

  function handleClearAll() {
    Alert.alert('清空家庭说明书', '将删除全部设备、网络、联系人与提醒，该操作不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          persistAndSync(createEmptyHomeManualState(), '家庭说明书已清空');
          setEditor(null);
        },
      },
    ]);
  }

  async function handleExport() {
    if (!token || !unlockToken) {
      setMessage('请先登录并解锁后再导出');
      return;
    }
    try {
      const exported = await exportHomeManual(token, unlockToken);
      setMessage(`已导出 ${exported.devices.length} 台设备、${exported.networks.length} 条网络`);
    } catch (error) {
      setMessage(getHomeManualErrorMessage(error));
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>正在打开家庭说明书</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>正在读取真实家庭数据</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  if (editor) {
    const item = getEditorItem(state, editor);
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
          <Header
            colors={colors}
            onBack={() => setEditor(null)}
            subtitle={editorLabel(editor.kind)}
            title={editor.itemId ? '编辑记录' : `添加${editorLabel(editor.kind)}`}
          />
          <EditorForm
            colors={colors}
            initial={item}
            kind={editor.kind}
            onCancel={() => setEditor(null)}
            onSave={(next) => handleSaveEditor(next)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
        <Header
          colors={colors}
          message={message}
          onClearAll={handleClearAll}
          onExport={handleExport}
          onLock={handleLock}
          subtitle={
            state.security.enabled
              ? `${unlocked ? '已解锁' : '已锁定'} · ${state.devices.length} 台设备 · ${state.networks.length} 条网络`
              : '真实录入 · 敏感字段加密'
          }
          syncMessage={syncMessage}
          title="家庭说明书"
          unlocked={unlocked}
        />
        <TabBar activeTab={tab} colors={colors} onSetTab={setTab} state={state} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {tab === 'home' && (
            <HomeTab
              colors={colors}
              onAddContact={() => setEditor({ kind: 'contact', itemId: null })}
              onAddDevice={() => setEditor({ kind: 'device', itemId: null })}
              onAddNetwork={() => setEditor({ kind: 'network', itemId: null })}
              onAddReminder={() => setEditor({ kind: 'reminder', itemId: null })}
              onOpenContact={(id) => setEditor({ kind: 'contact', itemId: id })}
              onOpenDevice={(id) => setEditor({ kind: 'device', itemId: id })}
              onOpenNetwork={(id) => setEditor({ kind: 'network', itemId: id })}
              onOpenReminder={(id) => setEditor({ kind: 'reminder', itemId: id })}
              onQueryChange={setQuery}
              onSecurity={() => setTab('security')}
              query={query}
              result={searchResult}
              state={state}
              unlocked={unlocked}
            />
          )}
          {tab === 'devices' && (
            <EntityList
              colors={colors}
              emptyText="还没有真实设备，先添加家里的空调、洗衣机或净水器。"
              onAdd={() => setEditor({ kind: 'device', itemId: null })}
              onDelete={(id, name) => handleDelete('device', id, name)}
              onOpen={(id) => setEditor({ kind: 'device', itemId: id })}
              rows={state.devices.map((device) => ({
                id: device.id,
                icon: deviceIcon(device.category),
                name: device.name,
                desc: `${HOME_DEVICE_CATEGORY_LABELS[device.category]}${device.model ? ` · ${device.model}` : ''}${device.room ? ` · ${device.room}` : ''}`,
              }))}
              title="设备"
            />
          )}
          {tab === 'networks' && (
            <EntityList
              colors={colors}
              emptyText="还没有真实网络，添加 Wi-Fi、路由器后台或宽带账号。"
              locked={state.security.enabled && !unlocked}
              onAdd={() => {
                if (state.security.enabled && !unlocked) return setMessage('请先解锁后再添加网络');
                setEditor({ kind: 'network', itemId: null });
              }}
              onDelete={(id, name) => handleDelete('network', id, name)}
              onOpen={(id) => {
                if (state.security.enabled && !unlocked) return setMessage('请先解锁后再查看网络');
                setEditor({ kind: 'network', itemId: id });
              }}
              rows={state.networks.map((network) => ({
                id: network.id,
                icon: 'wifi',
                name: network.name,
                desc: network.routerUrl || '后台未填写',
              }))}
              title="网络"
            />
          )}
          {tab === 'contacts' && (
            <EntityList
              colors={colors}
              emptyText="还没有真实联系人，添加物业、宽带或房东联系方式。"
              locked={state.security.enabled && !unlocked}
              onAdd={() => {
                if (state.security.enabled && !unlocked) return setMessage('请先解锁后再添加联系人');
                setEditor({ kind: 'contact', itemId: null });
              }}
              onDelete={(id, name) => handleDelete('contact', id, name)}
              onOpen={(id) => {
                if (state.security.enabled && !unlocked) return setMessage('请先解锁后再查看联系人');
                setEditor({ kind: 'contact', itemId: id });
              }}
              rows={state.contacts.map((contact) => ({
                id: contact.id,
                icon: contactIcon(contact.kind),
                name: contact.name,
                desc: HOME_CONTACT_KIND_LABELS[contact.kind],
              }))}
              title="联系人"
            />
          )}
          {tab === 'reminders' && (
            <EntityList
              colors={colors}
              emptyText="还没有真实提醒，录入购买日期、保修截止或滤芯更换日期后会生成提醒。"
              onAdd={() => setEditor({ kind: 'reminder', itemId: null })}
              onDelete={(id, name) => handleDelete('reminder', id, name)}
              onOpen={(id) => setEditor({ kind: 'reminder', itemId: id })}
              rows={state.reminders.map((reminder) => ({
                id: reminder.id,
                icon: reminderIcon(reminder.kind),
                name: reminder.title,
                desc: `${HOME_REMINDER_KIND_LABELS[reminder.kind]} · ${reminder.targetDate}`,
              }))}
              title="提醒"
            />
          )}
          {tab === 'security' && (
            <SecurityTab
              colors={colors}
              onLock={handleLock}
              onPassword={handlePassword}
              onUnlock={handleUnlock}
              state={state}
              unlocked={unlocked}
            />
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Header({
  colors,
  message,
  onBack,
  onClearAll,
  onExport,
  onLock,
  subtitle,
  syncMessage,
  title,
  unlocked,
}: {
  colors: Color;
  message?: string | null;
  onBack?: () => void;
  onClearAll?: () => void;
  onExport?: () => void;
  onLock?: () => void;
  subtitle: string;
  syncMessage?: string | null;
  title: string;
  unlocked?: boolean;
}) {
  return (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <ThemedText style={[styles.headerTitle, { color: colors.text }]}>{title}</ThemedText>
          <ThemedText style={[styles.headerSub, { color: colors.mutedText }]}>{subtitle}</ThemedText>
        </View>
        <View style={styles.headerActions}>
          {onBack ? (
            <Pressable accessibilityLabel="返回" accessibilityRole="button" onPress={onBack} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="arrow-left" size={19} color={colors.text} />
            </Pressable>
          ) : null}
          {onLock ? (
            <Pressable accessibilityLabel={unlocked ? '上锁' : '锁定'} accessibilityRole="button" onPress={onLock} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name={unlocked ? 'lock-open-variant' : 'lock'} size={19} color={colors.text} />
            </Pressable>
          ) : null}
          {onExport ? (
            <Pressable accessibilityLabel="导出" accessibilityRole="button" onPress={onExport} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="export-variant" size={19} color={colors.text} />
            </Pressable>
          ) : null}
          {onClearAll ? (
            <Pressable accessibilityLabel="清空" accessibilityRole="button" onPress={onClearAll} style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="trash-can-outline" size={19} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {message ? (
        <View style={[styles.messageBanner, { backgroundColor: colors.primarySoft, borderColor: colors.line }]}>
          <ThemedText style={[styles.messageText, { color: colors.primary }]}>{message}</ThemedText>
        </View>
      ) : null}
      {syncMessage ? (
        <View style={[styles.messageBanner, { backgroundColor: '#fff3df', borderColor: '#f1d8a8' }]}>
          <ThemedText style={[styles.messageText, { color: '#8a6419' }]}>{syncMessage}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function TabBar({
  activeTab,
  colors,
  onSetTab,
  state,
}: {
  activeTab: Tab;
  colors: Color;
  onSetTab: (tab: Tab) => void;
  state: HomeManualState;
}) {
  const tabs: [Tab, string, IconName][] = [
    ['home', '主页', 'home'],
    ['devices', `设备 ${state.devices.length}`, 'washing-machine'],
    ['networks', `网络 ${state.networks.length}`, 'wifi'],
    ['contacts', `联系人 ${state.contacts.length}`, 'account-tie'],
    ['reminders', `提醒 ${state.reminders.length}`, 'calendar-clock'],
    ['security', '安全', 'shield-lock'],
  ];
  return (
    <ScrollView contentContainerStyle={styles.tabsContent} horizontal showsHorizontalScrollIndicator={false} style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
      {tabs.map(([tab, label, icon]) => {
        const active = activeTab === tab;
        return (
          <Pressable key={tab} onPress={() => onSetTab(tab)} style={[styles.tab, active && { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name={icon} size={15} color={active ? colors.primary : colors.mutedText} />
            <ThemedText style={[styles.tabText, { color: active ? colors.text : colors.mutedText }]}>{label}</ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function HomeTab({
  colors,
  onAddContact,
  onAddDevice,
  onAddNetwork,
  onAddReminder,
  onOpenContact,
  onOpenDevice,
  onOpenNetwork,
  onOpenReminder,
  onQueryChange,
  onSecurity,
  query,
  result,
  state,
  unlocked,
}: {
  colors: Color;
  onAddContact: () => void;
  onAddDevice: () => void;
  onAddNetwork: () => void;
  onAddReminder: () => void;
  onOpenContact: (id: string) => void;
  onOpenDevice: (id: string) => void;
  onOpenNetwork: (id: string) => void;
  onOpenReminder: (id: string) => void;
  onQueryChange: (value: string) => void;
  onSecurity: () => void;
  query: string;
  result: ReturnType<typeof searchHomeManual>;
  state: HomeManualState;
  unlocked: boolean;
}) {
  return (
    <>
      <View style={[styles.hero, { backgroundColor: colors.hero }]}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="book-open-variant" size={22} color="#c9f36a" />
        </View>
        <ThemedText style={styles.heroTitle}>{state.devices.length} 台设备 · {state.networks.length} 条网络</ThemedText>
        <ThemedText style={styles.heroSub}>设备、网络、联系人与保修都来自真实录入；敏感字段加密查看。</ThemedText>
        <View style={styles.heroMetaRow}>
          <View style={styles.heroMeta}>
            <MaterialCommunityIcons name={unlocked ? 'lock-open-variant' : 'lock'} size={13} color="#c9f36a" />
            <ThemedText style={styles.heroMetaText}>{unlocked ? '已解锁' : '已锁定'}</ThemedText>
          </View>
          <View style={styles.heroMeta}>
            <MaterialCommunityIcons name="calendar-clock" size={13} color="#c9f36a" />
            <ThemedText style={styles.heroMetaText}>{state.reminders.length} 条提醒</ThemedText>
          </View>
        </View>
      </View>
      <View style={styles.quickGrid}>
        <QuickAction colors={colors} icon="plus" label="添加设备" onPress={onAddDevice} />
        <QuickAction colors={colors} icon="wifi" label="添加网络" onPress={onAddNetwork} />
        <QuickAction colors={colors} icon="account-tie" label="联系人" onPress={onAddContact} />
        <QuickAction colors={colors} icon="calendar-clock" label="添加提醒" onPress={onAddReminder} />
        <QuickAction colors={colors} icon="shield-lock" label="安全设置" onPress={onSecurity} />
      </View>
      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedText} />
        <TextInput onChangeText={onQueryChange} placeholder="搜索设备、网络、联系人" placeholderTextColor={colors.mutedText} style={[styles.searchInput, { color: colors.text }]} value={query} />
      </View>
      {query ? (
        <EntityList
          colors={colors}
          emptyText="没有符合条件的真实记录"
          onAdd={() => undefined}
          onOpen={(id) => {
            const device = result.devices.find((item) => item.id === id);
            if (device) return onOpenDevice(id);
            const network = result.networks.find((item) => item.id === id);
            if (network) return onOpenNetwork(id);
            onOpenContact(id);
          }}
          rows={[
            ...result.devices.map((item) => ({ id: item.id, icon: deviceIcon(item.category), name: item.name, desc: '设备' })),
            ...result.networks.map((item) => ({ id: item.id, icon: 'wifi' as IconName, name: item.name, desc: '网络' })),
            ...result.contacts.map((item) => ({ id: item.id, icon: contactIcon(item.kind), name: item.name, desc: '联系人' })),
          ]}
          title="搜索结果"
        />
      ) : (
        <>
          <EntityList colors={colors} emptyText="还没有真实设备" onAdd={onAddDevice} onOpen={onOpenDevice} rows={state.devices.slice(0, 4).map((item) => ({ id: item.id, icon: deviceIcon(item.category), name: item.name, desc: HOME_DEVICE_CATEGORY_LABELS[item.category] }))} title="设备" />
          <EntityList colors={colors} emptyText="还没有真实网络" locked={state.security.enabled && !unlocked} onAdd={onAddNetwork} onOpen={onOpenNetwork} rows={state.networks.slice(0, 4).map((item) => ({ id: item.id, icon: 'wifi' as IconName, name: item.name, desc: item.routerUrl || '后台未填写' }))} title="网络" />
          <EntityList colors={colors} emptyText="还没有真实联系人" locked={state.security.enabled && !unlocked} onAdd={onAddContact} onOpen={onOpenContact} rows={state.contacts.slice(0, 4).map((item) => ({ id: item.id, icon: contactIcon(item.kind), name: item.name, desc: HOME_CONTACT_KIND_LABELS[item.kind] }))} title="联系人" />
          <EntityList colors={colors} emptyText="还没有真实提醒" onAdd={onAddReminder} onOpen={onOpenReminder} rows={state.reminders.slice(0, 4).map((item) => ({ id: item.id, icon: reminderIcon(item.kind), name: item.title, desc: item.targetDate }))} title="提醒" />
        </>
      )}
    </>
  );
}

function QuickAction({ colors, icon, label, onPress }: { colors: Color; icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={[styles.quickItem, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={[styles.quickIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      </View>
      <ThemedText style={[styles.quickText, { color: colors.text }]}>{label}</ThemedText>
    </Pressable>
  );
}

function EntityList({
  colors,
  emptyText,
  locked,
  onAdd,
  onDelete,
  onOpen,
  rows,
  title,
}: {
  colors: Color;
  emptyText: string;
  locked?: boolean;
  onAdd: () => void;
  onDelete?: (id: string, name: string) => void;
  onOpen: (id: string) => void;
  rows: { id: string; icon: IconName; name: string; desc: string }[];
  title: string;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.cardHeader}>
        <ThemedText style={[styles.cardTitle, { color: colors.text }]}>{title}</ThemedText>
        <Pressable accessibilityLabel={`添加${title}`} accessibilityRole="button" onPress={onAdd} style={[styles.addPill, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="plus" size={15} color={colors.primary} />
          <ThemedText style={[styles.addPillText, { color: colors.primary }]}>添加</ThemedText>
        </Pressable>
      </View>
      {locked ? (
        <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>已加密 · 解锁后查看</ThemedText>
      ) : rows.length === 0 ? (
        <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>{emptyText}</ThemedText>
      ) : (
        rows.map((row) => (
          <Pressable key={row.id} onPress={() => onOpen(row.id)} style={[styles.row, { borderBottomColor: colors.line }]}>
            <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name={row.icon} size={18} color={colors.primary} />
            </View>
            <View style={styles.rowCopy}>
              <ThemedText style={[styles.rowName, { color: colors.text }]}>{row.name}</ThemedText>
              <ThemedText style={[styles.rowDesc, { color: colors.mutedText }]} numberOfLines={1}>{row.desc}</ThemedText>
            </View>
            {onDelete ? (
              <Pressable onPress={() => onDelete(row.id, row.name)} style={styles.deleteButton}>
                <MaterialCommunityIcons name="trash-can-outline" size={16} color="#e8667a" />
              </Pressable>
            ) : null}
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
          </Pressable>
        ))
      )}
    </View>
  );
}

function SecurityTab({
  colors,
  onLock,
  onPassword,
  onUnlock,
  state,
  unlocked,
}: {
  colors: Color;
  onLock: () => void;
  onPassword: (action: 'set' | 'change' | 'remove', current: string, next: string) => void;
  onUnlock: (password: string) => void;
  state: HomeManualState;
  unlocked: boolean;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.cardHeader}>
        <ThemedText style={[styles.cardTitle, { color: colors.text }]}>安全密码</ThemedText>
        <View style={[styles.statusPill, { backgroundColor: unlocked ? '#e2f6f1' : '#fff3df' }]}>
          <MaterialCommunityIcons name={unlocked ? 'lock-open-variant' : 'lock'} size={14} color={unlocked ? '#0e806d' : '#b56f12'} />
          <ThemedText style={[styles.statusPillText, { color: unlocked ? '#0e806d' : '#b56f12' }]}>{unlocked ? '已解锁' : '已锁定'}</ThemedText>
        </View>
      </View>
      <Field colors={colors} label="当前密码" onChangeText={setCurrent} secureTextEntry value={current} />
      <Field colors={colors} label={state.security.enabled ? '新密码' : '设置密码'} onChangeText={setNext} secureTextEntry value={next} />
      <View style={styles.buttonRow}>
        {state.security.enabled ? (
          <>
            <Pressable onPress={() => onPassword('change', current, next)} style={[styles.saveButton, { backgroundColor: colors.primary }]}>
              <ThemedText style={styles.saveButtonText}>修改密码</ThemedText>
            </Pressable>
            <Pressable onPress={() => onPassword('remove', current, next)} style={[styles.secondaryButton, { borderColor: colors.line }]}>
              <ThemedText style={[styles.secondaryButtonText, { color: colors.text }]}>移除密码</ThemedText>
            </Pressable>
          </>
        ) : (
          <Pressable onPress={() => onPassword('set', current, next)} style={[styles.saveButton, { backgroundColor: colors.primary }]}>
            <ThemedText style={styles.saveButtonText}>开启加密</ThemedText>
          </Pressable>
        )}
        {!unlocked && state.security.enabled ? (
          <Pressable onPress={() => onUnlock(current)} style={[styles.saveButton, { backgroundColor: colors.success }]}>
            <ThemedText style={styles.saveButtonText}>解锁</ThemedText>
          </Pressable>
        ) : null}
        {unlocked ? (
          <Pressable onPress={onLock} style={[styles.secondaryButton, { borderColor: colors.line }]}>
            <ThemedText style={[styles.secondaryButtonText, { color: colors.text }]}>立即上锁</ThemedText>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.securityNote, { backgroundColor: '#e2f6f1', borderColor: '#9edbcb' }]}>
        <MaterialCommunityIcons name="shield-check" size={17} color="#0e806d" />
        <ThemedText style={[styles.securityNoteText, { color: '#0e806d' }]}>密码 6-32 位，至少包含字母和数字；敏感字段加密保存，忘记密码需清除加密数据并重建。</ThemedText>
      </View>
    </View>
  );
}

function EditorForm({
  colors,
  initial,
  kind,
  onCancel,
  onSave,
}: {
  colors: Color;
  initial: HomeDevice | HomeNetwork | HomeContact | HomeReminder | null;
  kind: EditorKind;
  onCancel: () => void;
  onSave: (item: HomeDevice | HomeNetwork | HomeContact | HomeReminder) => void;
}) {
  const [device, setDevice] = useState<HomeDevice>(initial && isDevice(initial) ? initial : emptyDevice());
  const [network, setNetwork] = useState<HomeNetwork>(initial && isNetwork(initial) ? initial : emptyNetwork());
  const [contact, setContact] = useState<HomeContact>(initial && isContact(initial) ? initial : emptyContact());
  const [reminder, setReminder] = useState<HomeReminder>(initial && isReminder(initial) ? initial : emptyReminder());

  function save() {
    if (kind === 'device') onSave(device);
    if (kind === 'network') onSave(network);
    if (kind === 'contact') onSave(contact);
    if (kind === 'reminder') onSave(reminder);
  }

  return (
    <ScrollView contentContainerStyle={styles.editorContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {kind === 'device' ? (
          <>
            <Segmented colors={colors} label="设备分类" onChange={(value) => setDevice((current) => ({ ...current, category: value as HomeDeviceCategory }))} options={Object.entries(HOME_DEVICE_CATEGORY_LABELS).map(([value, label]) => ({ label, value }))} value={device.category} />
            <Field colors={colors} label="设备名称" onChangeText={(name) => setDevice((current) => ({ ...current, name }))} value={device.name} />
            <Field colors={colors} label="品牌" onChangeText={(brand) => setDevice((current) => ({ ...current, brand }))} value={device.brand} />
            <Field colors={colors} label="型号" onChangeText={(model) => setDevice((current) => ({ ...current, model }))} value={device.model} />
            <Field colors={colors} label="所在房间" onChangeText={(room) => setDevice((current) => ({ ...current, room }))} value={device.room} />
            <Field colors={colors} label="购买日期" onChangeText={(purchaseDate) => setDevice((current) => ({ ...current, purchaseDate }))} value={device.purchaseDate} />
            <Field colors={colors} label="保修截止日期" onChangeText={(warrantyEndDate) => setDevice((current) => ({ ...current, warrantyEndDate }))} value={device.warrantyEndDate} />
            {device.category === 'water-purifier' ? (
              <>
                <Field colors={colors} label="滤芯型号" onChangeText={(filterModel) => setDevice((current) => ({ ...current, filterModel }))} value={device.filterModel} />
                <Field colors={colors} keyboardType="number-pad" label="滤芯数量" onChangeText={(value) => setDevice((current) => ({ ...current, filterQuantity: Number(value) || 0 }))} value={device.filterQuantity ? String(device.filterQuantity) : ''} />
                <Field colors={colors} label="上次更换日期" onChangeText={(filterChangedAt) => setDevice((current) => ({ ...current, filterChangedAt }))} value={device.filterChangedAt} />
                <Field colors={colors} keyboardType="number-pad" label="更换周期（天）" onChangeText={(value) => setDevice((current) => ({ ...current, filterCycleDays: Number(value) || 0 }))} value={device.filterCycleDays ? String(device.filterCycleDays) : ''} />
                {getFilterDueDate(device) ? <ThemedText style={[styles.hintText, { color: colors.success }]}>预计更换日期 {getFilterDueDate(device)}</ThemedText> : null}
              </>
            ) : null}
            <Field colors={colors} label="操作方法" multiline onChangeText={(manualText) => setDevice((current) => ({ ...current, manualText }))} value={device.manualText} />
            <Field colors={colors} label="备注" onChangeText={(note) => setDevice((current) => ({ ...current, note }))} value={device.note} />
          </>
        ) : null}
        {kind === 'network' ? (
          <>
            <Field colors={colors} label="网络名称" onChangeText={(name) => setNetwork((current) => ({ ...current, name }))} value={network.name} />
            <Field colors={colors} label="Wi-Fi 名称 SSID" onChangeText={(ssid) => setNetwork((current) => ({ ...current, ssid }))} value={network.ssid} />
            <Segmented colors={colors} label="加密方式" onChange={(value) => setNetwork((current) => ({ ...current, securityType: value as HomeNetwork['securityType'] }))} options={[{ label: 'WPA2', value: 'WPA2' }, { label: 'WPA3', value: 'WPA3' }, { label: 'WEP', value: 'WEP' }, { label: '开放', value: 'open' }]} value={network.securityType || 'WPA2'} />
            <Field colors={colors} label="Wi-Fi 密码" onChangeText={(wifiPassword) => setNetwork((current) => ({ ...current, wifiPassword }))} secureTextEntry value={network.wifiPassword} />
            <Field colors={colors} label="路由器后台地址" onChangeText={(routerUrl) => setNetwork((current) => ({ ...current, routerUrl }))} value={network.routerUrl} />
            <Field colors={colors} label="路由器管理账号" onChangeText={(routerAccount) => setNetwork((current) => ({ ...current, routerAccount }))} value={network.routerAccount} />
            <Field colors={colors} label="路由器管理密码" onChangeText={(routerPassword) => setNetwork((current) => ({ ...current, routerPassword }))} secureTextEntry value={network.routerPassword} />
            <Field colors={colors} label="宽带运营商" onChangeText={(broadbandCarrier) => setNetwork((current) => ({ ...current, broadbandCarrier }))} value={network.broadbandCarrier} />
            <Field colors={colors} label="宽带账号" onChangeText={(broadbandAccount) => setNetwork((current) => ({ ...current, broadbandAccount }))} value={network.broadbandAccount} />
            <Field colors={colors} label="宽带密码" onChangeText={(broadbandPassword) => setNetwork((current) => ({ ...current, broadbandPassword }))} secureTextEntry value={network.broadbandPassword} />
            <Field colors={colors} label="备注" onChangeText={(note) => setNetwork((current) => ({ ...current, note }))} value={network.note} />
          </>
        ) : null}
        {kind === 'contact' ? (
          <>
            <Segmented colors={colors} label="联系人类型" onChange={(value) => setContact((current) => ({ ...current, kind: value as HomeContactKind }))} options={Object.entries(HOME_CONTACT_KIND_LABELS).map(([value, label]) => ({ label, value }))} value={contact.kind} />
            <Field colors={colors} label="联系人名称" onChangeText={(name) => setContact((current) => ({ ...current, name }))} value={contact.name} />
            <Field colors={colors} keyboardType="phone-pad" label="电话" onChangeText={(phone) => setContact((current) => ({ ...current, phone }))} value={contact.phone} />
            <Field colors={colors} keyboardType="phone-pad" label="备用电话" onChangeText={(phoneAlt) => setContact((current) => ({ ...current, phoneAlt }))} value={contact.phoneAlt} />
            <Field colors={colors} label="微信号" onChangeText={(wechat) => setContact((current) => ({ ...current, wechat }))} value={contact.wechat} />
            <Field colors={colors} label="服务地址" onChangeText={(address) => setContact((current) => ({ ...current, address }))} value={contact.address} />
            <Field colors={colors} label="服务时间" onChangeText={(serviceHours) => setContact((current) => ({ ...current, serviceHours }))} value={contact.serviceHours} />
            <Field colors={colors} label="服务范围" onChangeText={(serviceScope) => setContact((current) => ({ ...current, serviceScope }))} value={contact.serviceScope} />
            <Field colors={colors} label="备注" onChangeText={(note) => setContact((current) => ({ ...current, note }))} value={contact.note} />
          </>
        ) : null}
        {kind === 'reminder' ? (
          <>
            <Segmented colors={colors} label="提醒类型" onChange={(value) => setReminder((current) => ({ ...current, kind: value as HomeReminderKind }))} options={Object.entries(HOME_REMINDER_KIND_LABELS).map(([value, label]) => ({ label, value }))} value={reminder.kind} />
            <Field colors={colors} label="提醒标题" onChangeText={(title) => setReminder((current) => ({ ...current, title }))} value={reminder.title} />
            <Field colors={colors} label="目标日期" onChangeText={(targetDate) => setReminder((current) => ({ ...current, targetDate }))} value={reminder.targetDate} />
            <Field colors={colors} keyboardType="number-pad" label="周期（天）" onChangeText={(value) => setReminder((current) => ({ ...current, cycleDays: Number(value) || 0 }))} value={reminder.cycleDays ? String(reminder.cycleDays) : ''} />
            <Field colors={colors} label="来源设备 ID（可选）" onChangeText={(sourceDeviceId) => setReminder((current) => ({ ...current, sourceDeviceId }))} value={reminder.sourceDeviceId} />
            <Field colors={colors} label="备注" multiline onChangeText={(note) => setReminder((current) => ({ ...current, note }))} value={reminder.note} />
          </>
        ) : null}
      </View>
      <View style={styles.buttonRow}>
        <Pressable onPress={onCancel} style={[styles.secondaryButton, { borderColor: colors.line }]}>
          <ThemedText style={[styles.secondaryButtonText, { color: colors.text }]}>取消</ThemedText>
        </Pressable>
        <Pressable accessibilityLabel="保存真实数据" accessibilityRole="button" onPress={save} style={[styles.saveButton, { backgroundColor: colors.primary }]}>
          <ThemedText style={styles.saveButtonText}>保存真实数据</ThemedText>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Field({
  colors,
  keyboardType,
  label,
  multiline,
  onChangeText,
  secureTextEntry,
  value,
}: {
  colors: Color;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
  label: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <TextInput
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder="请输入真实内容"
        placeholderTextColor={colors.mutedText}
        secureTextEntry={secureTextEntry}
        style={[styles.input, { backgroundColor: colors.background, borderColor: colors.line, color: colors.text }, multiline && styles.multilineInput]}
        value={value}
      />
    </View>
  );
}

function Segmented({
  colors,
  label,
  onChange,
  options,
  value,
}: {
  colors: Color;
  label: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
}) {
  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <View style={[styles.segmentWrap, { backgroundColor: colors.surfaceMuted }]}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.segment, active && { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <ThemedText style={[styles.segmentText, { color: active ? colors.text : colors.mutedText }]}>{option.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function saveEditorItem(
  state: HomeManualState,
  kind: EditorKind,
  item: HomeDevice | HomeNetwork | HomeContact | HomeReminder,
  itemId: string | null,
): { error: string | null; state: HomeManualState } {
  if (kind === 'device') return itemId ? updateHomeDevice(state, item as HomeDevice) : addHomeDevice(state, item as HomeDevice);
  if (kind === 'network') return itemId ? updateHomeNetwork(state, item as HomeNetwork) : addHomeNetwork(state, item as HomeNetwork);
  if (kind === 'contact') return itemId ? updateHomeContact(state, item as HomeContact) : addHomeContact(state, item as HomeContact);
  return itemId ? updateHomeReminder(state, item as HomeReminder) : addHomeReminder(state, item as HomeReminder);
}

function deleteEditorItem(state: HomeManualState, kind: EditorKind, id: string) {
  if (kind === 'device') return removeHomeDevice(state, id);
  if (kind === 'network') return removeHomeNetwork(state, id);
  if (kind === 'contact') return removeHomeContact(state, id);
  return removeHomeReminder(state, id);
}

function getEditorItem(
  state: HomeManualState,
  editor: Exclude<EditorState, null>,
): HomeDevice | HomeNetwork | HomeContact | HomeReminder | null {
  if (editor.kind === 'device') return state.devices.find((item) => item.id === editor.itemId) ?? null;
  if (editor.kind === 'network') return state.networks.find((item) => item.id === editor.itemId) ?? null;
  if (editor.kind === 'contact') return state.contacts.find((item) => item.id === editor.itemId) ?? null;
  return state.reminders.find((item) => item.id === editor.itemId) ?? null;
}

function editorLabel(kind: EditorKind) {
  if (kind === 'device') return '设备';
  if (kind === 'network') return '网络';
  if (kind === 'contact') return '联系人';
  return '提醒';
}

function emptyDevice(): HomeDevice {
  const now = Date.now();
  return { id: newHomeManualID('device'), category: 'other', name: '', brand: '', model: '', room: '', purchaseDate: '', warrantyEndDate: '', manualText: '', note: '', photoIds: [], filterModel: '', filterQuantity: 0, filterChangedAt: '', filterCycleDays: 0, createdAt: now, updatedAt: now };
}

function emptyNetwork(): HomeNetwork {
  const now = Date.now();
  return { id: newHomeManualID('network'), name: '', ssid: '', securityType: 'WPA2', wifiPassword: '', routerUrl: '', routerAccount: '', routerPassword: '', broadbandCarrier: '', broadbandAccount: '', broadbandPassword: '', note: '', createdAt: now, updatedAt: now };
}

function emptyContact(): HomeContact {
  const now = Date.now();
  return { id: newHomeManualID('contact'), kind: 'property', name: '', phone: '', phoneAlt: '', wechat: '', address: '', serviceHours: '', serviceScope: '', note: '', createdAt: now, updatedAt: now };
}

function emptyReminder(): HomeReminder {
  const now = Date.now();
  return { id: newHomeManualID('reminder'), kind: 'custom', title: '', targetDate: '', cycleDays: 0, sourceDeviceId: '', note: '', status: 'pending', doneAt: 0, createdAt: now, updatedAt: now };
}

function isDevice(item: HomeDevice | HomeNetwork | HomeContact | HomeReminder): item is HomeDevice {
  return 'category' in item;
}

function isNetwork(item: HomeDevice | HomeNetwork | HomeContact | HomeReminder): item is HomeNetwork {
  return 'ssid' in item;
}

function isContact(item: HomeDevice | HomeNetwork | HomeContact | HomeReminder): item is HomeContact {
  return 'phone' in item;
}

function isReminder(item: HomeDevice | HomeNetwork | HomeContact | HomeReminder): item is HomeReminder {
  return 'targetDate' in item;
}

function hasSecretEditorValue(item: HomeDevice | HomeNetwork | HomeContact | HomeReminder) {
  if (isNetwork(item)) return Boolean(item.wifiPassword || item.routerAccount || item.routerPassword || item.broadbandAccount || item.broadbandPassword);
  if (isContact(item)) return Boolean(item.phone || item.phoneAlt || item.wechat || item.address);
  return false;
}

function deviceIcon(category: HomeDeviceCategory): IconName {
  const icons: Record<HomeDeviceCategory, IconName> = {
    'air-conditioner': 'air-conditioner',
    'washing-machine': 'washing-machine',
    'water-purifier': 'water',
    refrigerator: 'fridge',
    'water-heater': 'water',
    tv: 'television',
    kitchen: 'silverware-fork-knife',
    security: 'shield-lock',
    other: 'cog',
  };
  return icons[category];
}

function contactIcon(kind: HomeContactKind): IconName {
  const icons: Record<HomeContactKind, IconName> = {
    property: 'home-city',
    broadband: 'broadcast',
    landlord: 'account-tie',
    custom: 'account',
  };
  return icons[kind];
}

function reminderIcon(kind: HomeReminderKind): IconName {
  const icons: Record<HomeReminderKind, IconName> = {
    warranty: 'shield-check',
    filter: 'water',
    maintenance: 'wrench',
    custom: 'calendar-clock',
  };
  return icons[kind];
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screen: { flex: 1, width: '100%' },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 30 },
  stateTitle: { fontSize: 16, fontWeight: '900', marginTop: 12 },
  stateText: { fontSize: 11, fontWeight: '700', marginTop: 6 },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12 },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: '900' },
  headerSub: { fontSize: 10, fontWeight: '700', marginTop: 3 },
  headerActions: { flexDirection: 'row', gap: 7 },
  iconButton: { alignItems: 'center', borderRadius: 11, borderWidth: 1, height: 34, justifyContent: 'center', width: 34 },
  messageBanner: { borderRadius: 10, borderWidth: 1, marginHorizontal: 16, marginTop: 10, padding: 9 },
  messageText: { fontSize: 10, fontWeight: '700', lineHeight: 15 },
  tabs: { marginTop: 12 },
  tabsContent: { gap: 7, paddingHorizontal: 16, paddingVertical: 3 },
  tab: { alignItems: 'center', borderRadius: 11, borderWidth: 1, borderColor: 'transparent', flexDirection: 'row', gap: 5, height: 36, paddingHorizontal: 11 },
  tabText: { fontSize: 10, fontWeight: '800' },
  content: { gap: 12, paddingBottom: 30, paddingHorizontal: 16, paddingTop: 14 },
  hero: { borderRadius: 18, padding: 16 },
  heroIcon: { alignItems: 'center', backgroundColor: 'rgba(201, 243, 106, 0.14)', borderColor: 'rgba(201, 243, 106, 0.28)', borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  heroTitle: { color: '#ffffff', fontSize: 19, fontWeight: '900', marginTop: 13 },
  heroSub: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 10, fontWeight: '600', lineHeight: 16, marginTop: 5 },
  heroMetaRow: { flexDirection: 'row', gap: 8, marginTop: 13 },
  heroMeta: { alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.12)', borderColor: 'rgba(255, 255, 255, 0.14)', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 5, minHeight: 28, paddingHorizontal: 9 },
  heroMetaText: { color: '#ffffff', fontSize: 9, fontWeight: '800' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickItem: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 6, height: 42, justifyContent: 'center', paddingHorizontal: 10, width: '31%' },
  quickIcon: { alignItems: 'center', borderRadius: 8, height: 24, justifyContent: 'center', width: 24 },
  quickText: { fontSize: 9, fontWeight: '800' },
  searchBox: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 8, height: 42, paddingHorizontal: 11 },
  searchInput: { flex: 1, fontSize: 11, fontWeight: '700', height: 42, padding: 0 },
  card: { borderRadius: 15, borderWidth: 1, padding: 12 },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginBottom: 5 },
  cardTitle: { fontSize: 13, fontWeight: '900' },
  addPill: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 4, height: 30, paddingHorizontal: 9 },
  addPillText: { fontSize: 9, fontWeight: '900' },
  row: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 9, minHeight: 54 },
  rowIcon: { alignItems: 'center', borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 11, fontWeight: '800' },
  rowDesc: { fontSize: 9, fontWeight: '600', marginTop: 2 },
  deleteButton: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
  emptyText: { fontSize: 10, fontWeight: '600', lineHeight: 17, paddingVertical: 10 },
  formCard: { borderRadius: 16, borderWidth: 1, padding: 13 },
  editorContent: { gap: 12, padding: 16, paddingBottom: 40 },
  field: { marginTop: 12 },
  fieldLabel: { fontSize: 9, fontWeight: '800', marginBottom: 6 },
  input: { borderRadius: 11, borderWidth: 1, fontSize: 11, fontWeight: '700', height: 42, paddingHorizontal: 11, paddingVertical: 0 },
  multilineInput: { height: 88, paddingTop: 10, textAlignVertical: 'top' },
  segmentWrap: { borderRadius: 11, flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 3 },
  segment: { alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', minHeight: 34, paddingHorizontal: 8 },
  segmentText: { fontSize: 9, fontWeight: '800' },
  hintText: { fontSize: 9, fontWeight: '800', marginTop: 8 },
  securityNote: { alignItems: 'flex-start', borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, padding: 10 },
  securityNoteText: { flex: 1, fontSize: 9, fontWeight: '700', lineHeight: 15 },
  statusPill: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 5, minHeight: 28, paddingHorizontal: 9 },
  statusPillText: { fontSize: 9, fontWeight: '900' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  saveButton: { alignItems: 'center', borderRadius: 12, flexGrow: 1, height: 46, justifyContent: 'center', minWidth: 120 },
  saveButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, height: 46, justifyContent: 'center', minWidth: 100, paddingHorizontal: 12 },
  secondaryButtonText: { fontSize: 11, fontWeight: '900' },
});
