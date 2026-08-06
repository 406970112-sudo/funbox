import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { SurfaceCard } from '@/shared/ui/surface-card';
import {
  addQuietHomeContact,
  cancelQuietHomeTrip,
  checkInQuietHomeTrip,
  clearQuietHomeHistory,
  createQuietHomeTrip,
  fetchQuietHomeHistory,
  fetchQuietHomeState,
  getQuietHomeErrorMessage,
  removeQuietHomeContact,
  respondQuietHomeContact,
  saveQuietHomeSettings,
  updateQuietHomeTrip,
} from '@/lib/quiet-home-api';
import {
  buildLocalHistoryRecord,
  buildLocalTrip,
  contactDisplayName,
  contactStatusLabel,
  emptyQuietHomeSettings,
  formatEtaLabel,
  formatEtaTime,
  graceMinutesLabel,
  historyStats,
  isPast,
  minutesUntil,
  notificationLabel,
  notificationStatusLabel,
  parseEtaInput,
} from '@/lib/quiet-home';
import {
  getQuietHomeActiveTrip,
  getQuietHomeHistory,
  getQuietHomeNotifications,
  getQuietHomeSettings,
  setQuietHomeActiveTrip,
  setQuietHomeHistory,
  setQuietHomeNotifications,
  setQuietHomeSettings,
} from '@/lib/quiet-home-storage';
import type {
  QuietHomeContact,
  QuietHomeHistoryRecord,
  QuietHomeNotification,
  QuietHomePrivacyStatus,
  QuietHomeSettings,
  QuietHomeTrip,
} from '@/types/quiet-home';

type QuietHomeTab = 'trip' | 'create' | 'history' | 'privacy';

const tabs: { id: QuietHomeTab; label: string; icon: IconName }[] = [
  { id: 'trip', label: '行程', icon: 'home-heart' },
  { id: 'create', label: '创建', icon: 'plus-circle-outline' },
  { id: 'history', label: '历史', icon: 'history' },
  { id: 'privacy', label: '隐私', icon: 'shield-lock-outline' },
];

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const emptyPrivacy: QuietHomePrivacyStatus = {
  notificationEnabled: false,
  locationUsed: false,
  contactCount: 0,
  retentionDays: 30,
  locationEvents: [],
};

export function QuietHomeScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken: token, status: authStatus } = useAuth();
  const [activeTab, setActiveTab] = useState<QuietHomeTab>('trip');
  const [settings, setSettings] = useState<QuietHomeSettings>(emptyQuietHomeSettings);
  const [activeTrip, setActiveTrip] = useState<QuietHomeTrip | null>(null);
  const [history, setHistory] = useState<QuietHomeHistoryRecord[]>([]);
  const [notifications, setNotifications] = useState<QuietHomeNotification[]>([]);
  const [contacts, setContacts] = useState<QuietHomeContact[]>([]);
  const [privacy, setPrivacy] = useState<QuietHomePrivacyStatus>(emptyPrivacy);
  const [lastCheckIn, setLastCheckIn] = useState<QuietHomeTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [etaInput, setEtaInput] = useState('');
  const [contactUserId, setContactUserId] = useState('');
  const [selfReminder, setSelfReminder] = useState(true);
  const [contactReminder, setContactReminder] = useState(false);
  const [arrivalDetection, setArrivalDetection] = useState(false);
  const [lateSnapshot, setLateSnapshot] = useState(false);
  const [defaultHome, setDefaultHome] = useState('');
  const [graceMinutes, setGraceMinutes] = useState(30);
  const [retentionDays, setRetentionDays] = useState(30);

  const agreedContacts = useMemo(
    () => contacts.filter((contact) => contact.status === 'agreed'),
    [contacts],
  );
  const stats = useMemo(() => historyStats(history), [history]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await loadLocalState();
      let nextSettings = local.settings;
      let nextActiveTrip = local.activeTrip;
      let nextHistory = local.history;
      let nextNotifications = local.notifications;
      let nextContacts: QuietHomeContact[] = [];
      let nextPrivacy: QuietHomePrivacyStatus = emptyPrivacy;
      if (token) {
        try {
          const [state, remoteHistory] = await Promise.all([
            fetchQuietHomeState(token),
            fetchQuietHomeHistory(token),
          ]);
          nextSettings = mergeSettings(nextSettings, state.settings);
          nextActiveTrip = state.activeTrip;
          nextContacts = state.contacts;
          nextNotifications = state.notifications;
          nextPrivacy = state.privacy;
          for (const record of remoteHistory.records) {
            nextHistory = upsertHistory(nextHistory, record);
          }
        } catch (error) {
          if (active) setSyncMessage(getQuietHomeErrorMessage(error));
        }
      }
      if (!active) return;
      setSettings(nextSettings);
      setActiveTrip(nextActiveTrip);
      setHistory(nextHistory);
      setNotifications(nextNotifications);
      setContacts(nextContacts);
      setPrivacy(nextPrivacy);
      setDefaultHome(nextSettings.defaultHome);
      setGraceMinutes(nextSettings.graceMinutes);
      setRetentionDays(nextSettings.retentionDays);
      await setQuietHomeSettings(nextSettings);
      await setQuietHomeActiveTrip(nextActiveTrip);
      await setQuietHomeHistory(nextHistory);
      await setQuietHomeNotifications(nextNotifications);
      if (nextActiveTrip) {
        void scheduleLocalReminders(nextActiveTrip);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  async function loadLocalState() {
    const [settingsValue, activeTripValue, historyValue, notificationsValue] = await Promise.all([
      getQuietHomeSettings(),
      getQuietHomeActiveTrip(),
      getQuietHomeHistory(),
      getQuietHomeNotifications(),
    ]);
    return {
      settings: settingsValue,
      activeTrip: activeTripValue,
      history: historyValue,
      notifications: notificationsValue,
    };
  }

  function handleUseCurrentLocation() {
    const geolocation = (globalThis as Record<string, any>).navigator?.geolocation;
    if (!geolocation?.getCurrentPosition) {
      setMessage('当前设备不支持定位，请直接输入真实出发地点。');
      return;
    }
    setMessage(null);
    geolocation.getCurrentPosition(
      (position: { coords: { latitude: number; longitude: number } }) => {
        setOriginLabel(
          `当前位置 ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`,
        );
      },
      () => setMessage('定位失败，请直接输入出发地点。'),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }

  async function handleCreateTrip() {
    const eta = parseEtaInput(etaInput);
    const origin = originLabel.trim();
    const destination = destinationLabel.trim();
    if (!origin || !destination) {
      setMessage('请填写真实的出发地点和到达地点。');
      return;
    }
    if (!eta || !eta.getTime() || eta.getTime() <= Date.now()) {
      setMessage('预计到家时间必须晚于当前时间。');
      return;
    }
    if (activeTrip) {
      setMessage('已有一个进行中的到家行程，请先完成或取消。');
      return;
    }
    const input = {
      originLabel: origin,
      destinationLabel: destination,
      etaAt: eta.toISOString(),
      graceMinutes,
      selfReminderEnabled: selfReminder,
      contactReminderEnabled: contactReminder && contactUserId !== '',
      arrivalDetectionEnabled: arrivalDetection,
      lateSnapshotEnabled: lateSnapshot,
      contactUserId: contactReminder ? contactUserId : undefined,
    };
    setMessage(null);
    setSyncMessage(null);
    try {
      let trip: QuietHomeTrip;
      if (token) {
        trip = await createQuietHomeTrip(token, input);
      } else {
        trip = buildLocalTrip(input);
      }
      setActiveTrip(trip);
      await setQuietHomeActiveTrip(trip);
      await scheduleLocalReminders(trip);
      setOriginLabel('');
      setDestinationLabel('');
      setEtaInput('');
      setContactUserId('');
      setContactReminder(false);
      setArrivalDetection(false);
      setLateSnapshot(false);
      setActiveTab('trip');
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  async function handleCheckIn() {
    if (!activeTrip) return;
    setMessage(null);
    try {
      let checkedTrip: QuietHomeTrip;
      if (token) {
        checkedTrip = await checkInQuietHomeTrip(token, activeTrip.id);
      } else {
        checkedTrip = {
          ...activeTrip,
          status: 'checked_in',
          checkedInAt: new Date().toISOString(),
          lateMinutes: Math.max(
            0,
            Math.round((Date.now() - new Date(activeTrip.etaAt).getTime()) / 60000),
          ),
          updatedAt: new Date().toISOString(),
        };
      }
      const record = buildLocalHistoryRecord(checkedTrip);
      const nextHistory = upsertHistory(history, record);
      setLastCheckIn(checkedTrip);
      setActiveTrip(null);
      setHistory(nextHistory);
      await setQuietHomeActiveTrip(null);
      await setQuietHomeHistory(nextHistory);
      setNotifications([]);
      await setQuietHomeNotifications([]);
      setActiveTab('trip');
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  async function handleCancelTrip() {
    if (!activeTrip) return;
    setMessage(null);
    try {
      let cancelledTrip: QuietHomeTrip;
      if (token) {
        cancelledTrip = await cancelQuietHomeTrip(token, activeTrip.id);
      } else {
        cancelledTrip = {
          ...activeTrip,
          status: 'cancelled',
          cancelledAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }
      const record = buildLocalHistoryRecord(cancelledTrip);
      const nextHistory = upsertHistory(history, record);
      setActiveTrip(null);
      setHistory(nextHistory);
      await setQuietHomeActiveTrip(null);
      await setQuietHomeHistory(nextHistory);
      setNotifications([]);
      await setQuietHomeNotifications([]);
      setActiveTab('history');
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  async function handleDelayTrip() {
    if (!activeTrip) return;
    const current = new Date(activeTrip.etaAt);
    const nextEta = new Date(current.getTime() + 30 * 60 * 1000).toISOString();
    try {
      let next: QuietHomeTrip;
      if (token) {
        next = await updateQuietHomeTrip(token, activeTrip.id, { etaAt: nextEta });
      } else {
        next = { ...activeTrip, etaAt: nextEta, updatedAt: new Date().toISOString() };
      }
      setActiveTrip(next);
      await setQuietHomeActiveTrip(next);
      await scheduleLocalReminders(next);
      setMessage('已延后 30 分钟，提醒时间已更新。');
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  async function handleClearHistory() {
    if (history.length === 0) return;
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm('确定清除全部真实历史记录吗？此操作不可撤销。')
        : true;
    if (!confirmed) return;
    setHistory([]);
    await setQuietHomeHistory([]);
    if (token) {
      try {
        await clearQuietHomeHistory(token);
      } catch (error) {
        setSyncMessage(getQuietHomeErrorMessage(error));
      }
    }
  }

  async function handleSaveSettings() {
    const next: QuietHomeSettings = {
      ...settings,
      defaultHome: defaultHome.trim(),
      graceMinutes,
      retentionDays,
      updatedAt: Date.now(),
    };
    setSettings(next);
    await setQuietHomeSettings(next);
    if (token) {
      try {
        const saved = await saveQuietHomeSettings(token, next);
        setSettings(saved);
      } catch (error) {
        setSyncMessage(getQuietHomeErrorMessage(error));
      }
    }
    setMessage('设置已保存为真实本地数据。');
  }

  async function handleToggleContact(contact: QuietHomeContact) {
    if (!token) return;
    try {
      await removeQuietHomeContact(token, contact.id);
      setContacts((items) => items.filter((item) => item.id !== contact.id));
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  async function handleAddContact(contact: QuietHomeContact) {
    if (!token) return;
    try {
      await addQuietHomeContact(token, contact.id);
      setContacts((items) =>
        items.map((item) =>
          item.id === contact.id ? { ...item, status: 'pending', incoming: false } : item,
        ),
      );
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  async function handleRespondContact(
    contact: QuietHomeContact,
    status: 'agreed' | 'declined',
  ) {
    if (!token) return;
    try {
      await respondQuietHomeContact(token, contact.id, status);
      setContacts((items) =>
        items.map((item) =>
          item.id === contact.id
            ? {
                ...item,
                status,
                incoming: false,
                agreedAt: status === 'agreed' ? new Date().toISOString() : item.agreedAt,
              }
            : item,
        ),
      );
    } catch (error) {
      setSyncMessage(getQuietHomeErrorMessage(error));
    }
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>正在打开安静到家</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            正在读取真实行程与授权状态
          </ThemedText>
        </View>
      </SafeAreaView>
    );
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
            <ThemedText style={styles.headerTitle}>安静到家</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              报平安，不追踪 · 真实数据
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setMessage(null)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="refresh" size={21} color={colors.text} />
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              onPress={() => {
                setActiveTab(tab.id);
                setMessage(null);
              }}
              style={[styles.tab, activeTab === tab.id && { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons
                name={tab.icon}
                size={16}
                color={activeTab === tab.id ? colors.primary : colors.mutedText}
              />
              <ThemedText
                style={[
                  styles.tabText,
                  { color: activeTab === tab.id ? colors.text : colors.mutedText },
                ]}>
                {tab.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {syncMessage ? (
          <View style={[styles.syncBar, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="cloud-sync-outline" size={15} color={colors.primary} />
            <ThemedText style={[styles.syncText, { color: colors.primary }]}>{syncMessage}</ThemedText>
          </View>
        ) : null}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {activeTab === 'trip' ? (
            <TripView
              colors={colors}
              trip={activeTrip}
              lastCheckIn={lastCheckIn}
              notifications={notifications}
              onCheckIn={() => void handleCheckIn()}
              onCancel={() => void handleCancelTrip()}
              onDelay={() => void handleDelayTrip()}
            />
          ) : null}

          {activeTab === 'create' ? (
            <CreateView
              colors={colors}
              originLabel={originLabel}
              destinationLabel={destinationLabel}
              etaInput={etaInput}
              contactUserId={contactUserId}
              selfReminder={selfReminder}
              contactReminder={contactReminder}
              arrivalDetection={arrivalDetection}
              lateSnapshot={lateSnapshot}
              contacts={agreedContacts}
              token={token}
              message={message}
              onChangeOrigin={setOriginLabel}
              onChangeDestination={setDestinationLabel}
              onChangeEta={setEtaInput}
              onChangeContact={setContactUserId}
              onChangeSelfReminder={setSelfReminder}
              onChangeContactReminder={setContactReminder}
              onChangeArrivalDetection={setArrivalDetection}
              onChangeLateSnapshot={setLateSnapshot}
              onUseLocation={() => handleUseCurrentLocation()}
              onCreate={() => void handleCreateTrip()}
            />
          ) : null}

          {activeTab === 'history' ? (
            <HistoryView
              colors={colors}
              history={history}
              stats={stats}
              onClear={() => void handleClearHistory()}
            />
          ) : null}

          {activeTab === 'privacy' ? (
            <PrivacyView
              colors={colors}
              settings={settings}
              contacts={contacts}
              privacy={privacy}
              token={token}
              defaultHome={defaultHome}
              graceMinutes={graceMinutes}
              retentionDays={retentionDays}
              message={message}
              onChangeDefaultHome={setDefaultHome}
              onChangeGrace={setGraceMinutes}
              onChangeRetention={setRetentionDays}
              onSave={() => void handleSaveSettings()}
              onRemoveContact={(contact) => void handleToggleContact(contact)}
              onAddContact={(contact) => void handleAddContact(contact)}
              onRespondContact={(contact, status) => void handleRespondContact(contact, status)}
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function TripView({
  colors,
  trip,
  lastCheckIn,
  notifications,
  onCheckIn,
  onCancel,
  onDelay,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  trip: QuietHomeTrip | null;
  lastCheckIn: QuietHomeTrip | null;
  notifications: QuietHomeNotification[];
  onCheckIn: () => void;
  onCancel: () => void;
  onDelay: () => void;
}) {
  if (lastCheckIn) {
    return (
      <SurfaceCard style={[styles.successCard, { borderColor: colors.line }]}>
        <View style={[styles.successIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="check-decagram" size={28} color={colors.primary} />
        </View>
        <ThemedText style={styles.successTitle}>已到家，平安</ThemedText>
        <ThemedText style={[styles.successText, { color: colors.mutedText }]}>
          到达时间 {lastCheckIn.checkedInAt ? formatEtaTime(lastCheckIn.checkedInAt) : '--'}，
          比预计{lastCheckIn.lateMinutes ? `晚 ${lastCheckIn.lateMinutes} 分钟` : '早或准时'}。
        </ThemedText>
      </SurfaceCard>
    );
  }
  if (!trip) {
    return (
      <SurfaceCard style={[styles.emptyCard, { borderColor: colors.line }]}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="moon-waning-crescent" size={30} color={colors.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>还没有到家行程</ThemedText>
        <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
          首次使用不会预置示例行程、联系人或历史记录。今晚需要报平安吗？
        </ThemedText>
      </SurfaceCard>
    );
  }
  const remaining = minutesUntil(trip.etaAt);
  const overdue = isPast(trip.etaAt);
  return (
    <>
      <SurfaceCard style={[styles.routeCard, { borderColor: colors.line }]}>
        <View style={styles.routeStop}>
          <View style={styles.routeDot}>
            <MaterialCommunityIcons name="circle" size={12} color={colors.primary} />
          </View>
          <View>
            <ThemedText style={styles.routeLabel}>{trip.originLabel}</ThemedText>
            <ThemedText style={[styles.routeMeta, { color: colors.mutedText }]}>本次出发地</ThemedText>
          </View>
        </View>
        <View style={[styles.routeLine, { backgroundColor: colors.line }]} />
        <View style={styles.routeStop}>
          <View style={styles.routeDot}>
            <MaterialCommunityIcons name="map-marker" size={12} color={colors.primary} />
          </View>
          <View>
            <ThemedText style={styles.routeLabel}>{trip.destinationLabel}</ThemedText>
            <ThemedText style={[styles.routeMeta, { color: colors.mutedText }]}>本次目的地</ThemedText>
          </View>
        </View>
      </SurfaceCard>

      <View style={[styles.etaHero, { backgroundColor: colors.hero }]}>
        <ThemedText style={styles.etaLabel}>预计到家时间</ThemedText>
        <ThemedText style={styles.etaTime}>{formatEtaTime(trip.etaAt)}</ThemedText>
        <ThemedText style={styles.etaMeta}>
          {overdue ? '已到报平安时间，到家后请点“我已到家”' : `距离预计时间还有 ${remaining} 分钟`}
        </ThemedText>
      </View>

      {overdue ? (
        <View style={[styles.warnBanner, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="bell-alert-outline" size={15} color={colors.primary} />
          <ThemedText style={[styles.warnText, { color: colors.primary }]}>
            超过预计到家时间。到点会先提醒本人，超过{graceMinutesLabel(trip.graceMinutes)}后按授权提醒联系人。
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.detectChip, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons
            name={trip.arrivalDetectionEnabled ? 'crosshairs-gps' : 'shield-lock-outline'}
            size={14}
            color={colors.primary}
          />
          <ThemedText style={[styles.detectText, { color: colors.primary }]}>
            {trip.arrivalDetectionEnabled
              ? '仅本次到达检测已开启 · 报平安或取消后自动停止'
              : '本次未开启位置检测 · 默认不读取位置'}
          </ThemedText>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={onCheckIn}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.hero },
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons name="check-circle-outline" size={18} color="#c9f36a" />
        <ThemedText style={[styles.primaryButtonText, { color: '#c9f36a' }]}>我已到家</ThemedText>
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={onDelay}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.line, backgroundColor: colors.surface },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="clock-outline" size={17} color={colors.text} />
          <ThemedText style={styles.secondaryText}>延后 30 分钟</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [
            styles.secondaryButton,
            { borderColor: colors.line, backgroundColor: colors.surface },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name="close-circle-outline" size={17} color={colors.text} />
          <ThemedText style={styles.secondaryText}>取消行程</ThemedText>
        </Pressable>
      </View>

      {notifications.length > 0 ? (
        <SurfaceCard style={[styles.notificationCard, { borderColor: colors.line }]}>
          <View style={styles.sectionHead}>
            <ThemedText style={styles.sectionTitle}>提醒时间线</ThemedText>
            <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>真实事件</ThemedText>
          </View>
          {notifications.map((item) => (
            <View key={item.id} style={styles.notificationRow}>
              <MaterialCommunityIcons
                name={item.status === 'sent' ? 'check-circle' : 'clock-outline'}
                size={16}
                color={item.status === 'sent' ? colors.primary : colors.mutedText}
              />
              <View style={styles.notificationCopy}>
                <ThemedText style={styles.notificationTitle}>
                  {notificationLabel(item.type)} · {formatEtaTime(item.scheduledAt)}
                </ThemedText>
                <ThemedText style={[styles.notificationMeta, { color: colors.mutedText }]}>
                  {notificationStatusLabel(item.status)}
                  {item.error ? ` · ${item.error}` : ''}
                </ThemedText>
              </View>
            </View>
          ))}
        </SurfaceCard>
      ) : null}
    </>
  );
}

function CreateView({
  colors,
  originLabel,
  destinationLabel,
  etaInput,
  contactUserId,
  selfReminder,
  contactReminder,
  arrivalDetection,
  lateSnapshot,
  contacts,
  token,
  message,
  onChangeOrigin,
  onChangeDestination,
  onChangeEta,
  onChangeContact,
  onChangeSelfReminder,
  onChangeContactReminder,
  onChangeArrivalDetection,
  onChangeLateSnapshot,
  onUseLocation,
  onCreate,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  originLabel: string;
  destinationLabel: string;
  etaInput: string;
  contactUserId: string;
  selfReminder: boolean;
  contactReminder: boolean;
  arrivalDetection: boolean;
  lateSnapshot: boolean;
  contacts: QuietHomeContact[];
  token: string | null;
  message: string | null;
  onChangeOrigin: (value: string) => void;
  onChangeDestination: (value: string) => void;
  onChangeEta: (value: string) => void;
  onChangeContact: (value: string) => void;
  onChangeSelfReminder: (value: boolean) => void;
  onChangeContactReminder: (value: boolean) => void;
  onChangeArrivalDetection: (value: boolean) => void;
  onChangeLateSnapshot: (value: boolean) => void;
  onUseLocation: () => void;
  onCreate: () => void;
}) {
  return (
    <>
      <SurfaceCard style={[styles.formCard, { borderColor: colors.line }]}>
        <FieldLabel colors={colors} label="出发地点" />
        <View style={styles.inputRow}>
          <TextInput
            value={originLabel}
            onChangeText={onChangeOrigin}
            placeholder="输入真实出发地点"
            placeholderTextColor={colors.mutedText}
            style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onUseLocation}
            style={[styles.locationButton, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name="crosshairs-gps" size={16} color={colors.primary} />
            <ThemedText style={[styles.locationText, { color: colors.primary }]}>定位</ThemedText>
          </Pressable>
        </View>

        <FieldLabel colors={colors} label="到达地点" />
        <TextInput
          value={destinationLabel}
          onChangeText={onChangeDestination}
          placeholder="输入到达地点，例如我的家"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        />

        <FieldLabel colors={colors} label="预计到家时间" />
        <TextInput
          value={etaInput}
          onChangeText={onChangeEta}
          placeholder="2026-08-06 23:20"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        />

        <ToggleRow
          colors={colors}
          icon="bell-ring-outline"
          title="到点提醒本人"
          subtitle="超过预计时间后提醒自己报平安"
          value={selfReminder}
          onChange={onChangeSelfReminder}
        />
        <ToggleRow
          colors={colors}
          icon="account-check-outline"
          title="超时提醒联系人"
          subtitle="仅提醒已同意的真实 FunBox 好友"
          value={contactReminder}
          onChange={onChangeContactReminder}
        />
        <ToggleRow
          colors={colors}
          icon="crosshairs-gps"
          title="仅本次到达检测"
          subtitle="行程结束或取消后自动停止，不持续追踪"
          value={arrivalDetection}
          onChange={onChangeArrivalDetection}
        />
        <ToggleRow
          colors={colors}
          icon="map-marker-radius-outline"
          title="晚归共享一次位置快照"
          subtitle="联系人提醒触发时只发送一张静态快照"
          value={lateSnapshot}
          onChange={onChangeLateSnapshot}
        />
      </SurfaceCard>

      <SurfaceCard style={[styles.contactCard, { borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>升级提醒联系人</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
            {token ? `${contacts.length} 位已同意` : '登录后可见真实好友'}
          </ThemedText>
        </View>
        {!token ? (
          <ThemedText style={[styles.emptyHint, { color: colors.mutedText }]}>
            登录后可选择真实 FunBox 好友，对方需同意接收。
          </ThemedText>
        ) : contacts.length === 0 ? (
          <ThemedText style={[styles.emptyHint, { color: colors.mutedText }]}>
            还没有已同意的联系人，请先到隐私页添加真实好友。
          </ThemedText>
        ) : (
          <View style={styles.contactChips}>
            {contacts.map((contact) => {
              const selected = contactUserId === contact.id;
              return (
                <Pressable
                  key={contact.id}
                  accessibilityRole="button"
                  onPress={() => onChangeContact(selected ? '' : contact.id)}
                  style={[
                    styles.contactChip,
                    {
                      backgroundColor: selected ? colors.primarySoft : colors.surfaceMuted,
                      borderColor: selected ? colors.primary : colors.line,
                    },
                  ]}>
                  <MaterialCommunityIcons
                    name={selected ? 'check-circle' : 'account-outline'}
                    size={15}
                    color={selected ? colors.primary : colors.mutedText}
                  />
                  <ThemedText
                    style={[styles.contactChipText, { color: selected ? colors.primary : colors.text }]}>
                    {contactDisplayName(contact)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}
      </SurfaceCard>

      {message ? (
        <View style={[styles.messageBox, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="information-outline" size={15} color={colors.primary} />
          <ThemedText style={[styles.messageText, { color: colors.primary }]}>{message}</ThemedText>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onCreate}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: colors.hero },
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons name="home-plus-outline" size={18} color="#c9f36a" />
        <ThemedText style={[styles.primaryButtonText, { color: '#c9f36a' }]}>开始本次行程</ThemedText>
      </Pressable>
    </>
  );
}

function HistoryView({
  colors,
  history,
  stats,
  onClear,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  history: QuietHomeHistoryRecord[];
  stats: { total: number; checkedIn: number; late: number; contactNotified: number };
  onClear: () => void;
}) {
  if (history.length === 0) {
    return (
      <SurfaceCard style={[styles.emptyCard, { borderColor: colors.line }]}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="history" size={30} color={colors.primary} />
        </View>
        <ThemedText style={styles.emptyTitle}>还没有历史记录</ThemedText>
        <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
          真实行程结束后的记录会出现在这里，不会预置任何示例数据。
        </ThemedText>
      </SurfaceCard>
    );
  }
  return (
    <>
      <View style={styles.statsRow}>
        <StatTile colors={colors} label="到家" value={stats.checkedIn} />
        <StatTile colors={colors} label="晚归" value={stats.late} />
        <StatTile colors={colors} label="联系人提醒" value={stats.contactNotified} />
      </View>
      <SurfaceCard style={[styles.historyCard, { borderColor: colors.line }]}>
        {history.map((item, index) => (
          <View
            key={item.id}
            style={[styles.historyRow, index > 0 && styles.historyRowBorder]}>
            <View style={styles.historyIcon}>
              <MaterialCommunityIcons
                name={item.checkedInAt ? 'check-circle-outline' : 'close-circle-outline'}
                size={18}
                color={item.checkedInAt ? colors.primary : colors.mutedText}
              />
            </View>
            <View style={styles.historyCopy}>
              <ThemedText style={styles.historyTitle}>
                {item.originLabel} → {item.destinationLabel}
              </ThemedText>
              <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                {formatEtaLabel(item.etaAt)}
                {item.lateMinutes ? ` · 晚 ${item.lateMinutes} 分钟` : ''}
                {item.contactNotified ? ' · 已提醒联系人' : ''}
              </ThemedText>
            </View>
          </View>
        ))}
      </SurfaceCard>
      <Pressable
        accessibilityRole="button"
        onPress={onClear}
        style={[styles.ghostButton, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="delete-outline" size={17} color={colors.text} />
        <ThemedText style={styles.ghostText}>清除全部真实历史</ThemedText>
      </Pressable>
    </>
  );
}

function PrivacyView({
  colors,
  settings,
  contacts,
  privacy,
  token,
  defaultHome,
  graceMinutes,
  retentionDays,
  message,
  onChangeDefaultHome,
  onChangeGrace,
  onChangeRetention,
  onSave,
  onRemoveContact,
  onAddContact,
  onRespondContact,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  settings: QuietHomeSettings;
  contacts: QuietHomeContact[];
  privacy: QuietHomePrivacyStatus;
  token: string | null;
  defaultHome: string;
  graceMinutes: number;
  retentionDays: number;
  message: string | null;
  onChangeDefaultHome: (value: string) => void;
  onChangeGrace: (value: number) => void;
  onChangeRetention: (value: number) => void;
  onSave: () => void;
  onRemoveContact: (contact: QuietHomeContact) => void;
  onAddContact: (contact: QuietHomeContact) => void;
  onRespondContact: (contact: QuietHomeContact, status: 'agreed' | 'declined') => void;
}) {
  return (
    <>
      <SurfaceCard style={[styles.formCard, { borderColor: colors.line }]}>
        <FieldLabel colors={colors} label="我的家" />
        <TextInput
          value={defaultHome}
          onChangeText={onChangeDefaultHome}
          placeholder="首次使用为空，不预置默认家"
          placeholderTextColor={colors.mutedText}
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        />
        <FieldLabel colors={colors} label="宽限时间" />
        <View style={styles.segmented}>
          {[10, 30, 60].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              onPress={() => onChangeGrace(value)}
              style={[
                styles.segment,
                graceMinutes === value && { backgroundColor: colors.primarySoft },
              ]}>
              <ThemedText
                style={[
                  styles.segmentText,
                  { color: graceMinutes === value ? colors.primary : colors.mutedText },
                ]}>
                {value} 分钟
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <FieldLabel colors={colors} label="数据保留" />
        <View style={styles.segmented}>
          {[7, 30, 90].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              onPress={() => onChangeRetention(value)}
              style={[
                styles.segment,
                retentionDays === value && { backgroundColor: colors.primarySoft },
              ]}>
              <ThemedText
                style={[
                  styles.segmentText,
                  { color: retentionDays === value ? colors.primary : colors.mutedText },
                ]}>
                {value} 天
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onSave}
          style={[styles.saveButton, { backgroundColor: colors.hero }]}>
          <ThemedText style={[styles.saveText, { color: '#c9f36a' }]}>保存真实设置</ThemedText>
        </Pressable>
      </SurfaceCard>

      <SurfaceCard style={[styles.contactCard, { borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>联系人授权</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
            {token ? `${privacy.contactCount} 位已同意` : '登录后可见'}
          </ThemedText>
        </View>
        {!token ? (
          <ThemedText style={[styles.emptyHint, { color: colors.mutedText }]}>
            联系人必须来自真实 FunBox 好友，且对方同意接收。
          </ThemedText>
        ) : contacts.length === 0 ? (
          <ThemedText style={[styles.emptyHint, { color: colors.mutedText }]}>
            还没有真实好友联系人。请在 FunBox 添加好友后回到这里授权。
          </ThemedText>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactStatusRow}>
              <View style={styles.contactAvatar}>
                <MaterialCommunityIcons name="account-outline" size={17} color={colors.primary} />
              </View>
              <View style={styles.contactStatusCopy}>
                <ThemedText style={styles.contactStatusName}>{contactDisplayName(contact)}</ThemedText>
                <ThemedText style={[styles.contactStatusMeta, { color: colors.mutedText }]}>
                  {contactStatusLabel(contact.status)}
                </ThemedText>
              </View>
              {contact.incoming && contact.status === 'pending' ? (
                <View style={styles.contactActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onRespondContact(contact, 'agreed')}
                    style={[styles.smallPrimaryButton, { backgroundColor: colors.primarySoft }]}>
                    <ThemedText style={[styles.smallPrimaryText, { color: colors.primary }]}>同意</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => onRespondContact(contact, 'declined')}
                    style={[styles.smallDangerButton, { borderColor: colors.line }]}>
                    <ThemedText style={[styles.smallDangerText, { color: colors.mutedText }]}>拒绝</ThemedText>
                  </Pressable>
                </View>
              ) : !contact.incoming && contact.status === '' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onAddContact(contact)}
                  style={[styles.smallPrimaryButton, { backgroundColor: colors.primarySoft }]}>
                  <ThemedText style={[styles.smallPrimaryText, { color: colors.primary }]}>添加</ThemedText>
                </Pressable>
              ) : contact.status ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRemoveContact(contact)}
                  style={[styles.smallDangerButton, { borderColor: colors.line }]}>
                  <ThemedText style={[styles.smallDangerText, { color: colors.mutedText }]}>移除</ThemedText>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </SurfaceCard>

      <SurfaceCard style={[styles.privacyCard, { borderColor: colors.line }]}>
        <View style={styles.sectionHead}>
          <ThemedText style={styles.sectionTitle}>隐私状态</ThemedText>
          <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>
            真实授权
          </ThemedText>
        </View>
        <PrivacyLine
          colors={colors}
          icon="bell-outline"
          label="系统通知"
          value="未验证系统权限"
        />
        <PrivacyLine
          colors={colors}
          icon={privacy.locationUsed ? 'crosshairs-gps' : 'shield-lock-outline'}
          label="位置"
          value={privacy.locationUsed ? '仅本次事件' : '未使用'}
        />
        <PrivacyLine
          colors={colors}
          icon="database-outline"
          label="数据保留"
          value={`${privacy.retentionDays} 天`}
        />
        <PrivacyLine
          colors={colors}
          icon="history"
          label="位置事件"
          value={`${privacy.locationEvents.length} 次`}
        />
      </SurfaceCard>

      {message ? (
        <View style={[styles.messageBox, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="information-outline" size={15} color={colors.primary} />
          <ThemedText style={[styles.messageText, { color: colors.primary }]}>{message}</ThemedText>
        </View>
      ) : null}
    </>
  );
}

function FieldLabel({ colors, label }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string }) {
  return (
    <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>{label}</ThemedText>
  );
}

function ToggleRow({
  colors,
  icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  icon: IconName;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={[styles.toggleIcon, { backgroundColor: colors.primarySoft }]}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      </View>
      <View style={styles.toggleCopy}>
        <ThemedText style={styles.toggleTitle}>{title}</ThemedText>
        <ThemedText style={[styles.toggleSubtitle, { color: colors.mutedText }]}>{subtitle}</ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.line, true: colors.primary }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

function StatTile({
  colors,
  label,
  value,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  label: string;
  value: number;
}) {
  return (
    <View style={[styles.statTile, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={[styles.statValue, { color: colors.primary }]}>{value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
}

function PrivacyLine({
  colors,
  icon,
  label,
  value,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.privacyLine}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      <ThemedText style={styles.privacyLabel}>{label}</ThemedText>
      <ThemedText style={[styles.privacyValue, { color: colors.mutedText }]}>{value}</ThemedText>
    </View>
  );
}

async function scheduleLocalReminders(trip: QuietHomeTrip) {
  if (Platform.OS === 'web' || typeof globalThis === 'undefined') return;
  try {
    const Notifications = await import('expo-notifications');
    const eta = new Date(trip.etaAt).getTime();
    if (!Number.isNaN(eta)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '安静到家',
          body: `预计 ${formatEtaTime(trip.etaAt)} 到家，到点记得报平安。`,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(eta),
        },
      });
      if (trip.selfReminderEnabled) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '安静到家',
            body: '已经超过预计到家时间，到家后请点“我已到家”。',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(eta + 15 * 60 * 1000),
          },
        });
      }
    }
  } catch {
    // Local notifications are best effort; the in-app state remains the real status.
  }
}

function mergeSettings(local: QuietHomeSettings, remote: QuietHomeSettings) {
  if (!remote.userId) return local;
  return remote.updatedAt >= local.updatedAt ? remote : local;
}

function upsertHistory(items: QuietHomeHistoryRecord[], item: QuietHomeHistoryRecord) {
  const next = items.filter((entry) => entry.id !== item.id);
  return [item, ...next];
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    width: '100%',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 14,
  },
  stateText: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 52,
    justifyContent: 'space-between',
  },
  iconButton: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  pressed: {
    opacity: 0.7,
  },
  headerTitleWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  tabs: {
    borderRadius: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    height: 38,
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '800',
  },
  syncBar: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
    padding: 9,
  },
  syncText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 36,
    paddingTop: 12,
  },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 16,
    height: 58,
    justifyContent: 'center',
    marginBottom: 12,
    width: 58,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  routeCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  routeStop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    minHeight: 34,
  },
  routeDot: {
    alignItems: 'center',
    width: 14,
  },
  routeLabel: {
    fontSize: 13,
    fontWeight: '900',
  },
  routeMeta: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  routeLine: {
    height: 14,
    marginLeft: 6,
    width: 2,
  },
  etaHero: {
    alignItems: 'center',
    borderRadius: 18,
    padding: 18,
  },
  etaLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '800',
  },
  etaTime: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    marginTop: 3,
  },
  etaMeta: {
    color: '#c9f36a',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 6,
  },
  warnBanner: {
    alignItems: 'flex-start',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  warnText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 17,
  },
  detectChip: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    padding: 10,
  },
  detectText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    height: 48,
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: '900',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 12,
    fontWeight: '800',
  },
  notificationCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  sectionMeta: {
    fontSize: 10,
    fontWeight: '700',
  },
  notificationRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 9,
  },
  notificationCopy: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  notificationMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  successCard: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
  },
  successIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  successTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 11,
  },
  successText: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  formCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 10,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    fontSize: 12,
    height: 42,
    paddingHorizontal: 11,
  },
  locationButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  locationText: {
    fontSize: 11,
    fontWeight: '800',
  },
  toggleRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
  },
  toggleIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  toggleCopy: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  toggleSubtitle: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 14,
    marginTop: 2,
  },
  contactCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
  },
  emptyHint: {
    fontSize: 11,
    lineHeight: 18,
  },
  contactChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  contactChip: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  contactChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  messageBox: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    padding: 10,
  },
  messageText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statTile: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 3,
  },
  historyCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 13,
  },
  historyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 12,
  },
  historyRowBorder: {
    borderTopWidth: 1,
  },
  historyIcon: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  historyCopy: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  historyMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  ghostText: {
    fontSize: 12,
    fontWeight: '800',
  },
  segmented: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 11,
    fontWeight: '800',
  },
  saveButton: {
    alignItems: 'center',
    borderRadius: 11,
    height: 42,
    justifyContent: 'center',
    marginTop: 14,
  },
  saveText: {
    fontSize: 13,
    fontWeight: '900',
  },
  contactStatusRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    paddingVertical: 9,
  },
  contactAvatar: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  contactStatusCopy: {
    flex: 1,
  },
  contactStatusName: {
    fontSize: 11,
    fontWeight: '900',
  },
  contactStatusMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  contactActions: {
    flexDirection: 'row',
    gap: 6,
  },
  smallPrimaryButton: {
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  smallPrimaryText: {
    fontSize: 10,
    fontWeight: '900',
  },
  smallDangerButton: {
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  smallDangerText: {
    fontSize: 10,
    fontWeight: '800',
  },
  privacyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 13,
  },
  privacyLine: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 9,
  },
  privacyLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  privacyValue: {
    fontSize: 10,
    fontWeight: '700',
  },
});
