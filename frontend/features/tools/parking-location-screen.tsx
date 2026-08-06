import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
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
  fetchParkingLocationState,
  getParkingLocationErrorMessage,
  saveParkingLocationState,
} from '@/lib/parking-location-api';
import {
  addParkingPhoto,
  addParkingRecord,
  calculateEstimatedFeeCents,
  clearParkingSearchHistory,
  deleteParkingFeeRule,
  deleteParkingRecord,
  feeRuleLabel,
  filterParkingRecords,
  formatCents,
  formatParkingDuration,
  formatParkingTime,
  leaveParkingRecord,
  normalizeParkingLocationState,
  parkingLocationSummary,
  parkingReminderModeOptions,
  parkingPositionLabel,
  recordParkingSearchHistory,
  removeParkingPhoto,
  reminderLabel,
  updateParkingRecord,
  updateParkingSettings,
  upsertParkingFeeRule,
} from '@/lib/parking-location';
import {
  getParkingLocationState,
  setParkingLocationState,
} from '@/lib/parking-location-storage';
import type {
  ParkingFeeRule,
  ParkingFeeRuleInput,
  ParkingLocationState,
  ParkingRecord,
  ParkingRecordInput,
  ParkingReminderMode,
} from '@/types/parking-location';
import { createEmptyParkingLocationState } from '@/types/parking-location';

type ScreenView = 'home' | 'detail' | 'settings' | 'fee-rules';
type StatusFilter = 'all' | 'active' | 'left';
type EditorMode = 'create' | 'edit';

type EditorDraft = {
  mode: EditorMode;
  recordId: string | null;
  parkingLotName: string;
  floorLabel: string;
  zoneLabel: string;
  spotLabel: string;
  landmarkNote: string;
  note: string;
  parkedAt: number;
  feeRuleId: string;
  reminderMinutes: number;
  reminderMode: ParkingReminderMode;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  mapPoiId: string;
  mapPoiName: string;
};

type FeeRuleDraft = {
  id: string;
  parkingLotName: string;
  freeMinutes: string;
  firstRuleMinutes: string;
  firstRuleAmountCents: string;
  subsequentMinutes: string;
  subsequentAmountCents: string;
  maxDayAmountCents: string;
  sourceNote: string;
};

type Color = ReturnType<typeof useAppTheme>['colors'];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function emptyDraft(): EditorDraft {
  return {
    mode: 'create',
    recordId: null,
    parkingLotName: '',
    floorLabel: '',
    zoneLabel: '',
    spotLabel: '',
    landmarkNote: '',
    note: '',
    parkedAt: Date.now(),
    feeRuleId: '',
    reminderMinutes: 30,
    reminderMode: 'fixed',
    latitude: null,
    longitude: null,
    accuracyM: null,
    mapPoiId: '',
    mapPoiName: '',
  };
}

function emptyFeeRuleDraft(): FeeRuleDraft {
  return {
    id: '',
    parkingLotName: '',
    freeMinutes: '',
    firstRuleMinutes: '',
    firstRuleAmountCents: '',
    subsequentMinutes: '',
    subsequentAmountCents: '',
    maxDayAmountCents: '',
    sourceNote: '',
  };
}

function numericOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function centsFromYuan(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function ParkingLocationScreen() {
  const { accessToken: token, status: authStatus } = useAuth();
  const { colors } = useAppTheme();
  const [state, setState] = useState<ParkingLocationState>(createEmptyParkingLocationState);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [view, setView] = useState<ScreenView>('home');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft);
  const [feeRuleModal, setFeeRuleModal] = useState(false);
  const [feeDraft, setFeeDraft] = useState<FeeRuleDraft>(emptyFeeRuleDraft);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveAt, setLeaveAt] = useState(Date.now());
  const [actualFee, setActualFee] = useState('');
  const stateRef = useRef(state);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());

  stateRef.current = state;

  const persistAndSync = useCallback(
    (nextState: ParkingLocationState, notice?: string, sync = true) => {
      setState(nextState);
      if (notice) setMessage(notice);
      void setParkingLocationState(nextState);
      if (!token || !sync) return;
      syncQueueRef.current = syncQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const saved = await saveParkingLocationState(token, nextState);
            setSyncMessage(null);
            const normalized = normalizeParkingLocationState(saved);
            setState((current) =>
              current.updatedAt >= normalized.updatedAt ? current : normalized,
            );
          } catch (error) {
            setSyncMessage(getParkingLocationErrorMessage(error));
          }
        });
    },
    [token],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await getParkingLocationState();
      let nextState = normalizeParkingLocationState(local);
      if (token) {
        try {
          const remote = normalizeParkingLocationState(await fetchParkingLocationState(token));
          if (
            remote.updatedAt > 0 &&
            (nextState.updatedAt === 0 || remote.updatedAt > nextState.updatedAt)
          ) {
            nextState = remote;
          } else if (
            nextState.updatedAt > 0 &&
            (remote.updatedAt === 0 || nextState.updatedAt > remote.updatedAt)
          ) {
            const saved = normalizeParkingLocationState(
              await saveParkingLocationState(token, nextState),
            );
            nextState = saved;
          }
        } catch (error) {
          if (active) setSyncMessage(getParkingLocationErrorMessage(error));
        }
      }
      if (!active) return;
      setState(nextState);
      await setParkingLocationState(nextState);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const activeRecord = useMemo(
    () => state.records.find((record) => record.status === 'active') ?? null,
    [state.records],
  );

  const detailRecord = useMemo(
    () => state.records.find((record) => record.id === detailId) ?? null,
    [detailId, state.records],
  );

  const filteredRecords = useMemo(
    () => filterParkingRecords(state, query, statusFilter, 'recent'),
    [query, state, statusFilter],
  );

  function openEditor(record: ParkingRecord | null = null) {
    if (record) {
      setDraft({
        mode: 'edit',
        recordId: record.id,
        parkingLotName: record.parkingLotName,
        floorLabel: record.floorLabel,
        zoneLabel: record.zoneLabel,
        spotLabel: record.spotLabel,
        landmarkNote: record.landmarkNote,
        note: record.note,
        parkedAt: record.parkedAt,
        feeRuleId: record.feeRuleId,
        reminderMinutes: record.reminderMinutes || state.settings.defaultReminderMinutes,
        reminderMode: record.reminderMode,
        latitude: record.latitude,
        longitude: record.longitude,
        accuracyM: record.accuracyM,
        mapPoiId: record.mapPoiId,
        mapPoiName: record.mapPoiName,
      });
    } else {
      setDraft({
        ...emptyDraft(),
        reminderMinutes: state.settings.defaultReminderMinutes,
        reminderMode: state.settings.ruleBoundaryEnabled ? 'rule_boundary' : 'fixed',
        parkedAt: Date.now(),
      });
    }
    setMessage(null);
    setEditorOpen(true);
  }

  function handleSaveRecord() {
    const input: ParkingRecordInput = {
      parkingLotName: draft.parkingLotName,
      mapPoiId: draft.mapPoiId,
      mapPoiName: draft.mapPoiName,
      latitude: draft.latitude,
      longitude: draft.longitude,
      accuracyM: draft.accuracyM,
      floorLabel: draft.floorLabel,
      zoneLabel: draft.zoneLabel,
      spotLabel: draft.spotLabel,
      landmarkNote: draft.landmarkNote,
      note: draft.note,
      parkedAt: draft.parkedAt,
      feeRuleId: draft.feeRuleId,
      reminderMinutes: draft.reminderMinutes,
      reminderMode: draft.reminderMode,
    };
    let nextState: ParkingLocationState;
    let savedRecord: ParkingRecord | null = null;
    if (draft.mode === 'edit' && draft.recordId) {
      const result = updateParkingRecord(stateRef.current, draft.recordId, input);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      nextState = result.state;
      if (!result.error && result.state.records.some((item) => item.id === draft.recordId)) {
        savedRecord = result.state.records.find((item) => item.id === draft.recordId) ?? null;
        if (savedRecord) void cancelParkingReminder(savedRecord.id);
      }
    } else {
      const result = addParkingRecord(stateRef.current, input);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      nextState = result.state;
      savedRecord = result.record;
    }
    persistAndSync(nextState, draft.mode === 'edit' ? '停车记录已更新' : '停车记录已保存');
    setEditorOpen(false);
    if (savedRecord) {
      void scheduleParkingReminder(savedRecord, nextState);
      setDetailId(savedRecord.id);
      setView('detail');
    }
  }

  function handleDeleteRecord(recordId: string) {
    const record = stateRef.current.records.find((item) => item.id === recordId);
    if (!record) return;
    Alert.alert('删除停车记录', `将删除「${record.parkingLotName}」的真实记录，该操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void cancelParkingReminder(recordId);
          const result = deleteParkingRecord(stateRef.current, recordId);
          persistAndSync(result.state, '停车记录已删除');
          setDetailId(null);
          setView('home');
        },
      },
    ]);
  }

  function handleOpenLeave() {
    if (!detailRecord) return;
    setLeaveAt(Date.now());
    setActualFee(detailRecord.actualFeeCents == null ? '' : String(detailRecord.actualFeeCents / 100));
    setMessage(null);
    setLeaveModal(true);
  }

  function handleConfirmLeave() {
    if (!detailRecord) return;
    const fee = actualFee.trim() ? centsFromYuan(actualFee) : null;
    const result = leaveParkingRecord(stateRef.current, detailRecord.id, leaveAt, fee);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    void cancelParkingReminder(detailRecord.id);
    persistAndSync(result.state, '已记录真实取车时间');
    setLeaveModal(false);
    setDetailId(null);
    setView('home');
  }

  async function handleAddPhoto(recordId: string, camera = false) {
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage(camera ? '相机权限未开启，可先保存文字记录' : '相册权限未开启，可先保存文字记录');
        return;
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets[0]) return;
      const photoResult = addParkingPhoto(stateRef.current, recordId, {
        uri: result.assets[0].uri,
        takenAt: Date.now(),
      });
      if (photoResult.error) {
        setMessage(photoResult.error);
        return;
      }
      persistAndSync(photoResult.state, '真实照片已添加');
    } catch {
      setMessage('照片选择失败，请重试');
    }
  }

  function handleRemovePhoto(recordId: string, photoId: string) {
    const result = removeParkingPhoto(stateRef.current, recordId, photoId);
    if (!result.error) persistAndSync(result.state, '真实照片已删除');
  }

  function handleLocate() {
    const geolocation = (globalThis as { navigator?: { geolocation?: WebGeolocation } }).navigator
      ?.geolocation;
    if (!geolocation) {
      setMessage('定位不可用，可手动填写停车场名称');
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        setDraft((current) => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: Math.round(position.coords.accuracy),
          mapPoiName: current.parkingLotName.trim(),
        }));
        setMessage('已获取真实定位');
      },
      () => setMessage('定位不可用，可手动填写停车场名称'),
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }

  function openFeeRuleModal(rule: ParkingFeeRule | null = null) {
    setFeeDraft(
      rule
        ? {
            id: rule.id,
            parkingLotName: rule.parkingLotName,
            freeMinutes: rule.freeMinutes == null ? '' : String(rule.freeMinutes),
            firstRuleMinutes: rule.firstRuleMinutes == null ? '' : String(rule.firstRuleMinutes),
            firstRuleAmountCents:
              rule.firstRuleAmountCents == null ? '' : String(rule.firstRuleAmountCents / 100),
            subsequentMinutes:
              rule.subsequentMinutes == null ? '' : String(rule.subsequentMinutes),
            subsequentAmountCents:
              rule.subsequentAmountCents == null ? '' : String(rule.subsequentAmountCents / 100),
            maxDayAmountCents:
              rule.maxDayAmountCents == null ? '' : String(rule.maxDayAmountCents / 100),
            sourceNote: rule.sourceNote,
          }
        : {
            ...emptyFeeRuleDraft(),
            parkingLotName: draft.parkingLotName || activeRecord?.parkingLotName || '',
          },
    );
    setMessage(null);
    setFeeRuleModal(true);
  }

  function handleSaveFeeRule() {
    const input: ParkingFeeRuleInput = {
      parkingLotName: feeDraft.parkingLotName,
      freeMinutes: numericOrNull(feeDraft.freeMinutes),
      firstRuleMinutes: numericOrNull(feeDraft.firstRuleMinutes),
      firstRuleAmountCents: centsFromYuan(feeDraft.firstRuleAmountCents),
      subsequentMinutes: numericOrNull(feeDraft.subsequentMinutes),
      subsequentAmountCents: centsFromYuan(feeDraft.subsequentAmountCents),
      maxDayAmountCents: centsFromYuan(feeDraft.maxDayAmountCents),
      sourceNote: feeDraft.sourceNote,
    };
    const result = upsertParkingFeeRule(stateRef.current, input, feeDraft.id || undefined);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    persistAndSync(result.state, feeDraft.id ? '收费规则已更新' : '真实收费规则已保存');
    if (draft.feeRuleId === result.rule?.id || !draft.feeRuleId) {
      setDraft((current) => ({ ...current, feeRuleId: result.rule?.id ?? current.feeRuleId }));
    }
    setFeeRuleModal(false);
  }

  function handleDeleteFeeRule(ruleId: string) {
    const rule = stateRef.current.feeRules.find((item) => item.id === ruleId);
    if (!rule) return;
    Alert.alert('删除收费规则', `将删除「${rule.parkingLotName}」的真实收费规则。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          const result = deleteParkingFeeRule(stateRef.current, ruleId);
          persistAndSync(result.state, '收费规则已删除');
          if (draft.feeRuleId === ruleId) setDraft((current) => ({ ...current, feeRuleId: '' }));
          setFeeRuleModal(false);
        },
      },
    ]);
  }

  function handleSearchSubmit() {
    if (!query.trim()) return;
    const next = recordParkingSearchHistory(stateRef.current, query);
    persistAndSync(next, undefined, Boolean(token));
  }

  if (authStatus === 'loading' || loading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <ThemedText style={[styles.stateTitle, { color: colors.text }]}>
            正在打开停车位置记录
          </ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            正在读取本机真实数据
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.screen, { maxWidth: appLayout.screenMaxWidth, alignSelf: 'center' }]}>
        <View style={[styles.header, { borderBottomColor: colors.line }]}>
          <View style={styles.headerTitleWrap}>
            <ThemedText style={styles.headerTitle}>停车位置记录</ThemedText>
            <ThemedText style={[styles.headerMeta, { color: colors.mutedText }]}>
              真实定位 + 文字定位 + 照片 + 缴费提醒
            </ThemedText>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setView('settings');
              setDetailId(null);
            }}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="cog-outline" size={18} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {message ? (
            <Pressable
              onPress={() => setMessage(null)}
              style={[styles.messageBar, { backgroundColor: colors.primarySoft }]}>
              <ThemedText style={[styles.messageText, { color: colors.primary }]}>{message}</ThemedText>
            </Pressable>
          ) : null}
          {syncMessage ? (
            <View style={[styles.messageBar, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.messageText, { color: colors.mutedText }]}>{syncMessage}</ThemedText>
            </View>
          ) : null}

          {view === 'home' ? (
            <HomeView
              colors={colors}
              state={state}
              activeRecord={activeRecord}
              filteredRecords={filteredRecords}
              query={query}
              statusFilter={statusFilter}
              onQueryChange={setQuery}
              onSearchSubmit={handleSearchSubmit}
              onStatusChange={setStatusFilter}
              onCreate={() => openEditor()}
              onOpenDetail={(record) => {
                setDetailId(record.id);
                setView('detail');
              }}
              onOpenFeeRules={() => setView('fee-rules')}
            />
          ) : null}

          {view === 'detail' && detailRecord ? (
            <DetailView
              colors={colors}
              state={state}
              record={detailRecord}
              onBack={() => {
                setDetailId(null);
                setView('home');
              }}
              onEdit={() => openEditor(detailRecord)}
              onLeave={handleOpenLeave}
              onDelete={() => handleDeleteRecord(detailRecord.id)}
              onAddPhoto={handleAddPhoto}
              onRemovePhoto={handleRemovePhoto}
            />
          ) : null}

          {view === 'settings' ? (
            <SettingsView
              colors={colors}
              state={state}
              onBack={() => setView('home')}
              onSave={(patch) => {
                const result = updateParkingSettings(stateRef.current, patch);
                persistAndSync(result.state, '提醒设置已保存');
              }}
              onClearSearch={() => {
                persistAndSync(clearParkingSearchHistory(stateRef.current), '最近搜索已清空');
              }}
            />
          ) : null}

          {view === 'fee-rules' ? (
            <FeeRulesView
              colors={colors}
              state={state}
              onBack={() => setView('home')}
              onAdd={() => openFeeRuleModal()}
              onEdit={openFeeRuleModal}
              onDelete={handleDeleteFeeRule}
            />
          ) : null}
        </ScrollView>
      </View>

      <Modal animationType="slide" transparent visible={editorOpen} onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.line }]}>
              <View>
                <ThemedText style={styles.modalTitle}>
                  {draft.mode === 'edit' ? '编辑停车记录' : '记录本次停车'}
                </ThemedText>
                <ThemedText style={[styles.modalSubtitle, { color: colors.mutedText }]}>
                  所有内容均来自真实录入
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditorOpen(false)}
                style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Pressable
                accessibilityRole="button"
                onPress={handleLocate}
                style={[styles.locationCard, { backgroundColor: colors.primarySoft }]}>
                <MaterialCommunityIcons name="crosshairs-gps" size={20} color={colors.primary} />
                <View style={styles.locationCopy}>
                  <ThemedText style={styles.locationTitle}>
                    {draft.latitude && draft.longitude
                      ? `真实定位 ${draft.latitude.toFixed(4)}, ${draft.longitude.toFixed(4)}`
                      : '获取真实定位'}
                  </ThemedText>
                  <ThemedText style={[styles.locationDesc, { color: colors.mutedText }]}>
                    {draft.accuracyM ? `定位精度约 ${draft.accuracyM} 米` : '地下定位不准确时请结合文字与照片'}
                  </ThemedText>
                </View>
                <MaterialCommunityIcons name="crosshairs" size={18} color={colors.primary} />
              </Pressable>

              <FieldLabel text="停车场名称" />
              <TextInput
                value={draft.parkingLotName}
                onChangeText={(value) => setDraft((current) => ({ ...current, parkingLotName: value }))}
                placeholder="输入真实停车场名称"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              />

              <FieldLabel text="地下位置" />
              <View style={styles.row}>
                <TextInput
                  value={draft.floorLabel}
                  onChangeText={(value) => setDraft((current) => ({ ...current, floorLabel: value }))}
                  placeholder="B3"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, styles.flexInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                />
                <TextInput
                  value={draft.zoneLabel}
                  onChangeText={(value) => setDraft((current) => ({ ...current, zoneLabel: value }))}
                  placeholder="C区"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, styles.flexInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                />
                <TextInput
                  value={draft.spotLabel}
                  onChangeText={(value) => setDraft((current) => ({ ...current, spotLabel: value }))}
                  placeholder="328号"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, styles.flexInput, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                />
              </View>

              <FieldLabel text="附近标志物" />
              <TextInput
                value={draft.landmarkNote}
                onChangeText={(value) => setDraft((current) => ({ ...current, landmarkNote: value }))}
                placeholder="例如：靠近蓝色电梯"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              />

              <FieldLabel text="备注" />
              <TextInput
                value={draft.note}
                onChangeText={(value) => setDraft((current) => ({ ...current, note: value }))}
                placeholder="可选"
                placeholderTextColor={colors.mutedText}
                multiline
                style={[styles.textarea, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              />

              <FieldLabel text="停车时间" />
              <Pressable
                accessibilityRole="button"
                onPress={() => setDraft((current) => ({ ...current, parkedAt: Date.now() }))}
                style={[styles.pickerCard, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="clock-outline" size={17} color={colors.primary} />
                <ThemedText style={styles.pickerText}>{formatParkingTime(draft.parkedAt)}</ThemedText>
                <ThemedText style={[styles.pickerHint, { color: colors.mutedText }]}>点击使用当前时间</ThemedText>
              </Pressable>

              <FieldLabel text="收费规则" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ruleChips}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setDraft((current) => ({ ...current, feeRuleId: '' }))}
                  style={[styles.ruleChip, draft.feeRuleId === '' && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
                  <ThemedText style={[styles.ruleChipText, { color: colors.text }]}>不使用规则</ThemedText>
                </Pressable>
                {state.feeRules.map((rule) => (
                  <Pressable
                    key={rule.id}
                    accessibilityRole="button"
                    onPress={() => setDraft((current) => ({ ...current, feeRuleId: rule.id }))}
                    style={[styles.ruleChip, draft.feeRuleId === rule.id && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
                    <ThemedText style={[styles.ruleChipText, { color: colors.text }]}>{rule.parkingLotName}</ThemedText>
                  </Pressable>
                ))}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => openFeeRuleModal()}
                  style={[styles.ruleChip, { borderStyle: 'dashed' }]}>
                  <MaterialCommunityIcons name="plus" size={15} color={colors.primary} />
                  <ThemedText style={[styles.ruleChipText, { color: colors.primary }]}>新增规则</ThemedText>
                </Pressable>
              </ScrollView>

              <FieldLabel text="缴费提醒" />
              <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
                {parkingReminderModeOptions().map((option) => (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    onPress={() => setDraft((current) => ({ ...current, reminderMode: option.value }))}
                    style={[
                      styles.segmentButton,
                      draft.reminderMode === option.value && { backgroundColor: colors.surface },
                    ]}>
                    <ThemedText
                      style={[
                        styles.segmentText,
                        { color: draft.reminderMode === option.value ? colors.primary : colors.mutedText },
                      ]}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {draft.reminderMode === 'fixed' ? (
                <View style={[styles.segmented, styles.reminderOptions, { backgroundColor: colors.surfaceMuted }]}>
                  {[15, 30, 60, 120].map((minutes) => (
                    <Pressable
                      key={minutes}
                      accessibilityRole="button"
                      onPress={() => setDraft((current) => ({ ...current, reminderMinutes: minutes }))}
                      style={[
                        styles.segmentButton,
                        draft.reminderMinutes === minutes && { backgroundColor: colors.surface },
                      ]}>
                      <ThemedText
                        style={[
                          styles.segmentText,
                          { color: draft.reminderMinutes === minutes ? colors.primary : colors.mutedText },
                        ]}>
                        {minutes}分钟
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                onPress={handleSaveRecord}
                style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
                <MaterialCommunityIcons name="content-save-outline" size={18} color="#c9f36a" />
                <ThemedText style={styles.primaryButtonText}>保存真实记录</ThemedText>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={leaveModal} onRequestClose={() => setLeaveModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.line }]}>
              <View>
                <ThemedText style={styles.modalTitle}>取车确认</ThemedText>
                <ThemedText style={[styles.modalSubtitle, { color: colors.mutedText }]}>
                  {detailRecord
                    ? `${detailRecord.parkingLotName} · ${formatParkingDuration(detailRecord)}`
                    : ''}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setLeaveModal(false)}
                style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <FieldLabel text="取车时间" />
              <Pressable
                accessibilityRole="button"
                onPress={() => setLeaveAt(Date.now())}
                style={[styles.pickerCard, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="car-clock" size={17} color={colors.primary} />
                <ThemedText style={styles.pickerText}>{formatParkingTime(leaveAt)}</ThemedText>
                <ThemedText style={[styles.pickerHint, { color: colors.mutedText }]}>点击使用当前时间</ThemedText>
              </Pressable>
              <FieldLabel text="实际缴费金额（元）" />
              <TextInput
                value={actualFee}
                onChangeText={setActualFee}
                keyboardType="numeric"
                placeholder="如实填写，可空"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={handleConfirmLeave}
                style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
                <MaterialCommunityIcons name="check-circle-outline" size={18} color="#c9f36a" />
                <ThemedText style={styles.primaryButtonText}>确认取车</ThemedText>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={feeRuleModal} onRequestClose={() => setFeeRuleModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.line }]}>
              <View>
                <ThemedText style={styles.modalTitle}>真实收费规则</ThemedText>
                <ThemedText style={[styles.modalSubtitle, { color: colors.mutedText }]}>
                  只保存用户真实录入的规则
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setFeeRuleModal(false)}
                style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}>
                <MaterialCommunityIcons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <FieldLabel text="停车场名称" />
              <TextInput
                value={feeDraft.parkingLotName}
                onChangeText={(value) => setFeeDraft((current) => ({ ...current, parkingLotName: value }))}
                placeholder="输入真实停车场名称"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              />
              <View style={styles.twoCol}>
                <View>
                  <FieldLabel text="免费分钟" />
                  <TextInput
                    value={feeDraft.freeMinutes}
                    onChangeText={(value) => setFeeDraft((current) => ({ ...current, freeMinutes: value }))}
                    keyboardType="numeric"
                    placeholder="可空"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  />
                </View>
                <View>
                  <FieldLabel text="首段分钟" />
                  <TextInput
                    value={feeDraft.firstRuleMinutes}
                    onChangeText={(value) => setFeeDraft((current) => ({ ...current, firstRuleMinutes: value }))}
                    keyboardType="numeric"
                    placeholder="例如 120"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  />
                </View>
              </View>
              <View style={styles.twoCol}>
                <View>
                  <FieldLabel text="首段金额（元）" />
                  <TextInput
                    value={feeDraft.firstRuleAmountCents}
                    onChangeText={(value) => setFeeDraft((current) => ({ ...current, firstRuleAmountCents: value }))}
                    keyboardType="numeric"
                    placeholder="例如 6"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  />
                </View>
                <View>
                  <FieldLabel text="后续每段分钟" />
                  <TextInput
                    value={feeDraft.subsequentMinutes}
                    onChangeText={(value) => setFeeDraft((current) => ({ ...current, subsequentMinutes: value }))}
                    keyboardType="numeric"
                    placeholder="例如 60"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  />
                </View>
              </View>
              <View style={styles.twoCol}>
                <View>
                  <FieldLabel text="后续每段金额（元）" />
                  <TextInput
                    value={feeDraft.subsequentAmountCents}
                    onChangeText={(value) => setFeeDraft((current) => ({ ...current, subsequentAmountCents: value }))}
                    keyboardType="numeric"
                    placeholder="例如 4"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  />
                </View>
                <View>
                  <FieldLabel text="单日封顶（元）" />
                  <TextInput
                    value={feeDraft.maxDayAmountCents}
                    onChangeText={(value) => setFeeDraft((current) => ({ ...current, maxDayAmountCents: value }))}
                    keyboardType="numeric"
                    placeholder="可空"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  />
                </View>
              </View>
              <FieldLabel text="来源备注" />
              <TextInput
                value={feeDraft.sourceNote}
                onChangeText={(value) => setFeeDraft((current) => ({ ...current, sourceNote: value }))}
                placeholder="例如：现场价目表"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
              />
              {feeDraft.id ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleDeleteFeeRule(feeDraft.id)}
                  style={[styles.dangerButton, { borderColor: colors.accent }]}>
                  <ThemedText style={{ color: colors.accent }}>删除此规则</ThemedText>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={handleSaveFeeRule}
                style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
                <MaterialCommunityIcons name="content-save-outline" size={18} color="#c9f36a" />
                <ThemedText style={styles.primaryButtonText}>保存真实收费规则</ThemedText>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function HomeView({
  colors,
  state,
  activeRecord,
  filteredRecords,
  query,
  statusFilter,
  onQueryChange,
  onSearchSubmit,
  onStatusChange,
  onCreate,
  onOpenDetail,
  onOpenFeeRules,
}: {
  colors: Color;
  state: ParkingLocationState;
  activeRecord: ParkingRecord | null;
  filteredRecords: ParkingRecord[];
  query: string;
  statusFilter: StatusFilter;
  onQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onStatusChange: (value: StatusFilter) => void;
  onCreate: () => void;
  onOpenDetail: (record: ParkingRecord) => void;
  onOpenFeeRules: () => void;
}) {
  return (
    <View>
      <View style={[styles.hero, { backgroundColor: colors.hero }]}>
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name="map-marker-radius" size={24} color="#c9f36a" />
        </View>
        <ThemedText style={styles.heroTitle}>记录本次停车</ThemedText>
        <ThemedText style={styles.heroSub}>地图入口坐标 + 地下楼层车位 + 环境照片 + 缴费提醒</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          style={[styles.heroButton, { backgroundColor: '#18a78f' }]}>
          <MaterialCommunityIcons name="car" size={18} color="#ffffff" />
          <ThemedText style={styles.heroButtonText}>开始记录</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedText} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          onSubmitEditing={onSearchSubmit}
          placeholder="搜索停车场 / 楼层 / 区域 / 车位"
          placeholderTextColor={colors.mutedText}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>

      <View style={[styles.filterRow, { backgroundColor: colors.surfaceMuted }]}>
        {(['all', 'active', 'left'] as StatusFilter[]).map((filter) => (
          <Pressable
            key={filter}
            accessibilityRole="button"
            onPress={() => onStatusChange(filter)}
            style={[styles.filterButton, statusFilter === filter && { backgroundColor: colors.surface }]}>
            <ThemedText
              style={[
                styles.filterText,
                { color: statusFilter === filter ? colors.primary : colors.mutedText },
              ]}>
              {filter === 'all' ? '全部' : filter === 'active' ? '停车中' : '已取车'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {activeRecord ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenDetail(activeRecord)}
          style={[styles.activeCard, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
          <View style={styles.activeIcon}>
            <MaterialCommunityIcons name="car-clock" size={22} color={colors.primary} />
          </View>
          <View style={styles.activeCopy}>
            <ThemedText style={[styles.activeTitle, { color: colors.text }]}>
              {activeRecord.parkingLotName}
            </ThemedText>
            <ThemedText style={[styles.activeDesc, { color: colors.mutedText }]}>
              {parkingLocationSummary(activeRecord)} · {formatParkingDuration(activeRecord)}
            </ThemedText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedText} />
        </Pressable>
      ) : null}

      <View style={styles.sectionHead}>
        <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>停车记录</ThemedText>
        <Pressable accessibilityRole="button" onPress={onOpenFeeRules}>
          <ThemedText style={[styles.sectionLink, { color: colors.primary }]}>收费规则</ThemedText>
        </Pressable>
      </View>

      {filteredRecords.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="map-marker-off-outline" size={34} color={colors.mutedText} />
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>还没有停车记录</ThemedText>
          <ThemedText style={[styles.emptyDesc, { color: colors.mutedText }]}>
            所有停车场、车位、照片和收费规则都由你真实录入。
          </ThemedText>
        </View>
      ) : (
        filteredRecords.map((record) => (
          <Pressable
            key={record.id}
            accessibilityRole="button"
            onPress={() => onOpenDetail(record)}
            style={[styles.recordCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.recordIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name={record.status === 'active' ? 'car' : 'car-outline'} size={19} color={colors.primary} />
            </View>
            <View style={styles.recordCopy}>
              <ThemedText style={[styles.recordName, { color: colors.text }]}>{record.parkingLotName}</ThemedText>
              <ThemedText style={[styles.recordMeta, { color: colors.mutedText }]}>
                {parkingLocationSummary(record)}
              </ThemedText>
              <ThemedText style={[styles.recordMeta, { color: colors.mutedText }]}>
                {formatParkingTime(record.parkedAt)}
                {record.leaveAt ? ` - ${formatParkingTime(record.leaveAt)}` : ''} · {formatParkingDuration(record)}
              </ThemedText>
            </View>
            <View style={styles.recordRight}>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: record.status === 'active' ? colors.primarySoft : colors.surfaceMuted },
                ]}>
                <ThemedText
                  style={[
                    styles.statusText,
                    { color: record.status === 'active' ? colors.primary : colors.mutedText },
                  ]}>
                  {record.status === 'active' ? '停车中' : '已取车'}
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

function DetailView({
  colors,
  state,
  record,
  onBack,
  onEdit,
  onLeave,
  onDelete,
  onAddPhoto,
  onRemovePhoto,
}: {
  colors: Color;
  state: ParkingLocationState;
  record: ParkingRecord;
  onBack: () => void;
  onEdit: () => void;
  onLeave: () => void;
  onDelete: () => void;
  onAddPhoto: (recordId: string, camera: boolean) => void;
  onRemovePhoto: (recordId: string, photoId: string) => void;
}) {
  const rule = state.feeRules.find((item) => item.id === record.feeRuleId);
  const estimate =
    record.estimatedFeeCents ??
    calculateEstimatedFeeCents(state, record.id, record.leaveAt ?? Date.now());
  return (
    <View>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <View style={styles.detailHeaderCopy}>
          <ThemedText style={[styles.detailTitle, { color: colors.text }]}>
            {record.status === 'active' ? '停车中' : '已取车'}
          </ThemedText>
          <ThemedText style={[styles.detailMeta, { color: colors.mutedText }]}>
            {record.parkingLotName} · {formatParkingDuration(record)}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onEdit}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[styles.mapCard, { backgroundColor: colors.primarySoft }]}>
        <View style={styles.mapGrid}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={[styles.mapCell, { backgroundColor: colors.surfaceMuted }]} />
          ))}
        </View>
        <View style={styles.mapPin}>
          <MaterialCommunityIcons name="map-marker" size={26} color={colors.primary} />
        </View>
        <View style={[styles.mapChip, { backgroundColor: colors.surface }]}>
          <ThemedText style={[styles.mapChipText, { color: colors.text }]}>
            {record.mapPoiName || record.parkingLotName}
            {record.latitude && record.longitude
              ? ` · ${record.latitude.toFixed(4)}, ${record.longitude.toFixed(4)}`
              : ' · 未获取坐标'}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <InfoRow icon="map-marker-outline" label="停车场" value={record.parkingLotName} colors={colors} />
        <InfoRow icon="parking" label="地下位置" value={parkingPositionLabel(record)} colors={colors} />
        <InfoRow icon="sign-direction" label="标志物" value={record.landmarkNote || '未填写'} colors={colors} />
        <InfoRow icon="clock-outline" label="停车时间" value={formatParkingTime(record.parkedAt)} colors={colors} />
        <InfoRow
          icon="clock-check-outline"
          label="取车时间"
          value={record.leaveAt ? formatParkingTime(record.leaveAt) : '未取车'}
          colors={colors}
        />
        <InfoRow
          icon="currency-cny"
          label="实际缴费"
          value={record.actualFeeCents == null ? '未填写' : formatCents(record.actualFeeCents)}
          colors={colors}
        />
      </View>

      <View style={[styles.photoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.photoHead}>
          <ThemedText style={[styles.photoTitle, { color: colors.text }]}>周边环境照片</ThemedText>
          <ThemedText style={[styles.photoCount, { color: colors.mutedText }]}>
            {record.photoCount} / 6
          </ThemedText>
        </View>
        {record.photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {record.photos.map((photo) => (
              <View key={photo.id} style={styles.photoThumbWrap}>
                <Image source={{ uri: photo.uri }} style={styles.photoThumb} contentFit="cover" />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onRemovePhoto(record.id, photo.id)}
                  style={[styles.photoDelete, { backgroundColor: colors.hero }]}>
                  <MaterialCommunityIcons name="close" size={13} color="#ffffff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : (
          <ThemedText style={[styles.photoEmpty, { color: colors.mutedText }]}>还没有真实照片</ThemedText>
        )}
        <View style={styles.photoActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAddPhoto(record.id, true)}
            style={[styles.photoButton, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="camera-outline" size={16} color={colors.primary} />
            <ThemedText style={[styles.photoButtonText, { color: colors.primary }]}>拍照</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onAddPhoto(record.id, false)}
            style={[styles.photoButton, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="image-plus" size={16} color={colors.primary} />
            <ThemedText style={[styles.photoButtonText, { color: colors.primary }]}>相册</ThemedText>
          </Pressable>
        </View>
      </View>

      <View style={[styles.feeCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={[styles.feeLabel, { color: colors.mutedText }]}>预计收费</ThemedText>
        <ThemedText style={[styles.feeAmount, { color: colors.text }]}>
          {estimate == null ? '未设置收费规则' : formatCents(estimate)}
        </ThemedText>
        <ThemedText style={[styles.feeNote, { color: colors.mutedText }]}>
          {rule ? feeRuleLabel(rule) : '没有真实收费规则时不估算金额'}
          {estimate != null ? ' · 以出口实际收费为准' : ''}
        </ThemedText>
      </View>

      <View style={[styles.reminderCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="bell-outline" size={18} color={colors.primary} />
        <View style={styles.reminderCopy}>
          <ThemedText style={[styles.reminderTitle, { color: colors.text }]}>
            {reminderLabel(record, rule)}
          </ThemedText>
          <ThemedText style={[styles.reminderDesc, { color: colors.mutedText }]}>
            提醒来自真实停车时间，取车后自动取消未触发提醒
          </ThemedText>
        </View>
      </View>

      <View style={styles.detailActions}>
        {record.status === 'active' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onLeave}
            style={[styles.detailPrimaryButton, { backgroundColor: colors.hero }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={18} color="#c9f36a" />
            <ThemedText style={styles.primaryButtonText}>已取车</ThemedText>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onDelete}
          style={[styles.detailDangerButton, { borderColor: colors.accent }]}>
          <ThemedText style={{ color: colors.accent }}>删除记录</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsView({
  colors,
  state,
  onBack,
  onSave,
  onClearSearch,
}: {
  colors: Color;
  state: ParkingLocationState;
  onBack: () => void;
  onSave: (patch: { defaultReminderMinutes?: number; ruleBoundaryEnabled?: boolean; cancelOnLeave?: boolean }) => void;
  onClearSearch: () => void;
}) {
  const [minutes, setMinutes] = useState(String(state.settings.defaultReminderMinutes));
  const [ruleBoundary, setRuleBoundary] = useState(state.settings.ruleBoundaryEnabled);
  const [cancelOnLeave, setCancelOnLeave] = useState(state.settings.cancelOnLeave);
  return (
    <View>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <View style={styles.detailHeaderCopy}>
          <ThemedText style={[styles.detailTitle, { color: colors.text }]}>提醒设置</ThemedText>
          <ThemedText style={[styles.detailMeta, { color: colors.mutedText }]}>
            新记录默认提醒与通知规则
          </ThemedText>
        </View>
      </View>
      <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <FieldLabel text="默认提醒分钟" />
        <TextInput
          value={minutes}
          onChangeText={setMinutes}
          keyboardType="numeric"
          style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
        />
        <ToggleRow
          colors={colors}
          label="收费规则节点提醒"
          desc="在首段结束前 15 分钟提醒"
          value={ruleBoundary}
          onChange={setRuleBoundary}
        />
        <ToggleRow
          colors={colors}
          label="取车自动取消"
          desc="取车后清理未触发提醒"
          value={cancelOnLeave}
          onChange={setCancelOnLeave}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const parsed = Math.round(Number(minutes));
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1440) {
            return;
          }
          onSave({ defaultReminderMinutes: parsed, ruleBoundaryEnabled: ruleBoundary, cancelOnLeave });
        }}
        style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
        <MaterialCommunityIcons name="content-save-outline" size={18} color="#c9f36a" />
        <ThemedText style={styles.primaryButtonText}>保存设置</ThemedText>
      </Pressable>
      <View style={[styles.infoCard, styles.searchHistoryCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={[styles.photoTitle, { color: colors.text }]}>最近搜索</ThemedText>
        {state.searchHistory.length > 0 ? (
          state.searchHistory.map((item) => (
            <ThemedText key={item} style={[styles.historyItem, { color: colors.mutedText }]}>
              {item}
            </ThemedText>
          ))
        ) : (
          <ThemedText style={[styles.photoEmpty, { color: colors.mutedText }]}>暂无最近搜索</ThemedText>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={onClearSearch}
          style={[styles.photoButton, { backgroundColor: colors.surfaceMuted }]}>
          <ThemedText style={[styles.photoButtonText, { color: colors.mutedText }]}>清空最近搜索</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function FeeRulesView({
  colors,
  state,
  onBack,
  onAdd,
  onEdit,
  onDelete,
}: {
  colors: Color;
  state: ParkingLocationState;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (rule: ParkingFeeRule) => void;
  onDelete: (ruleId: string) => void;
}) {
  return (
    <View>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <View style={styles.detailHeaderCopy}>
          <ThemedText style={[styles.detailTitle, { color: colors.text }]}>真实收费规则</ThemedText>
          <ThemedText style={[styles.detailMeta, { color: colors.mutedText }]}>
            只保存用户真实录入规则
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onAdd}
          style={[styles.iconButton, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="plus" size={18} color={colors.primary} />
        </Pressable>
      </View>
      {state.feeRules.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="currency-cny" size={32} color={colors.mutedText} />
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>还没有收费规则</ThemedText>
          <ThemedText style={[styles.emptyDesc, { color: colors.mutedText }]}>
            录入真实规则后，预计收费才会显示金额。
          </ThemedText>
        </View>
      ) : (
        state.feeRules.map((rule) => (
          <Pressable
            key={rule.id}
            accessibilityRole="button"
            onPress={() => onEdit(rule)}
            style={[styles.recordCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.recordIcon, { backgroundColor: colors.primarySoft }]}>
              <MaterialCommunityIcons name="currency-cny" size={19} color={colors.primary} />
            </View>
            <View style={styles.recordCopy}>
              <ThemedText style={[styles.recordName, { color: colors.text }]}>{rule.parkingLotName}</ThemedText>
              <ThemedText style={[styles.recordMeta, { color: colors.mutedText }]}>{feeRuleLabel(rule)}</ThemedText>
              {rule.sourceNote ? (
                <ThemedText style={[styles.recordMeta, { color: colors.mutedText }]}>
                  来源：{rule.sourceNote}
                </ThemedText>
              ) : null}
            </View>
            <Pressable accessibilityRole="button" onPress={() => onDelete(rule.id)}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.accent} />
            </Pressable>
          </Pressable>
        ))
      )}
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <ThemedText style={styles.fieldLabel}>{text}</ThemedText>;
}

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  colors: Color;
}) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      <ThemedText style={[styles.infoLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <ThemedText numberOfLines={2} style={[styles.infoValue, { color: colors.text }]}>
        {value}
      </ThemedText>
    </View>
  );
}

function ToggleRow({
  colors,
  label,
  desc,
  value,
  onChange,
}: {
  colors: Color;
  label: string;
  desc: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      onPress={() => onChange(!value)}
      style={[styles.toggleRow, { borderBottomColor: colors.line }]}>
      <View style={styles.toggleCopy}>
        <ThemedText style={[styles.toggleLabel, { color: colors.text }]}>{label}</ThemedText>
        <ThemedText style={[styles.toggleDesc, { color: colors.mutedText }]}>{desc}</ThemedText>
      </View>
      <View style={[styles.switch, value ? { backgroundColor: colors.success } : { backgroundColor: colors.line }]}>
        <View style={[styles.switchDot, { marginLeft: value ? 'auto' : 2 }]} />
      </View>
    </Pressable>
  );
}

async function scheduleParkingReminder(record: ParkingRecord, state: ParkingLocationState) {
  if (Platform.OS === 'web' || record.status !== 'active' || record.reminderMode === 'none') return;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      if (requested.status !== 'granted') return;
    }
    const rule = state.feeRules.find((item) => item.id === record.feeRuleId);
    const fireAt =
      record.reminderMode === 'rule_boundary' && rule?.firstRuleMinutes
        ? record.parkedAt + rule.firstRuleMinutes * 60 * 1000 - 15 * 60 * 1000
        : record.parkedAt + record.reminderMinutes * 60 * 1000;
    if (fireAt <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '停车缴费提醒',
        body: `${record.parkingLotName} ${parkingLocationSummary(record)}`,
        data: { recordId: record.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAt),
      },
    });
  } catch {
    // Web and unsupported platforms can still use in-app reminder labels.
  }
}

async function cancelParkingReminder(recordId: string) {
  if (Platform.OS === 'web') return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of scheduled) {
      if (item.content.data?.recordId === recordId) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {
    // Best effort.
  }
}

type WebGeolocation = {
  getCurrentPosition(
    success: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    error: (error: unknown) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number },
  ): void;
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
    width: '100%',
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '900',
    marginTop: 14,
  },
  stateText: {
    fontSize: 12,
    marginTop: 6,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 62,
    paddingHorizontal: 16,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  headerMeta: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  iconButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  messageBar: {
    borderRadius: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  messageText: {
    fontSize: 10,
    fontWeight: '700',
  },
  hero: {
    borderRadius: 18,
    padding: 16,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(201, 243, 106, 0.14)',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 13,
  },
  heroSub: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 16,
    marginTop: 5,
  },
  heroButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    height: 44,
    justifyContent: 'center',
    marginTop: 14,
  },
  heroButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  searchBar: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    height: 42,
    marginTop: 14,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
  },
  filterRow: {
    borderRadius: 11,
    flexDirection: 'row',
    marginTop: 10,
    padding: 3,
  },
  filterButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  filterText: {
    fontSize: 10,
    fontWeight: '800',
  },
  activeCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    marginTop: 12,
    padding: 12,
  },
  activeIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  activeCopy: {
    flex: 1,
    marginLeft: 10,
  },
  activeTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  activeDesc: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 4,
    lineHeight: 15,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  sectionLink: {
    fontSize: 10,
    fontWeight: '800',
  },
  emptyCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 30,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '900',
    marginTop: 12,
  },
  emptyDesc: {
    fontSize: 10,
    lineHeight: 17,
    marginTop: 6,
    textAlign: 'center',
  },
  recordCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 10,
    padding: 12,
  },
  recordIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  recordCopy: {
    flex: 1,
    marginLeft: 10,
  },
  recordName: {
    fontSize: 12,
    fontWeight: '900',
  },
  recordMeta: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 15,
    marginTop: 2,
  },
  recordRight: {
    alignItems: 'flex-end',
  },
  statusPill: {
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '800',
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 12,
  },
  detailHeaderCopy: {
    flex: 1,
    marginLeft: 10,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  detailMeta: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
  },
  mapCard: {
    borderRadius: 16,
    height: 138,
    overflow: 'hidden',
    position: 'relative',
  },
  mapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    height: '100%',
  },
  mapCell: {
    borderColor: 'rgba(120, 130, 150, 0.18)',
    borderWidth: 1,
    height: '50%',
    width: '50%',
  },
  mapPin: {
    left: '50%',
    position: 'absolute',
    top: '50%',
    transform: [{ translateX: -13 }, { translateY: -26 }],
  },
  mapChip: {
    borderRadius: 9,
    bottom: 8,
    left: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: 'absolute',
    right: 8,
  },
  mapChipText: {
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  infoRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 42,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 9,
    width: 64,
  },
  infoValue: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'right',
  },
  photoCard: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 12,
    padding: 12,
  },
  photoHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  photoTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  photoCount: {
    fontSize: 9,
    fontWeight: '700',
  },
  photoRow: {
    gap: 8,
    paddingTop: 10,
  },
  photoThumbWrap: {
    height: 78,
    position: 'relative',
    width: 78,
  },
  photoThumb: {
    borderRadius: 10,
    height: 78,
    width: 78,
  },
  photoDelete: {
    alignItems: 'center',
    borderRadius: 10,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -5,
    top: -5,
    width: 22,
  },
  photoEmpty: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 12,
  },
  photoActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  photoButton: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    gap: 5,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  photoButtonText: {
    fontSize: 9,
    fontWeight: '800',
  },
  feeCard: {
    borderWidth: 1,
    borderRadius: 14,
    marginTop: 12,
    padding: 13,
  },
  feeLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  feeAmount: {
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  feeNote: {
    fontSize: 9,
    lineHeight: 15,
    marginTop: 4,
  },
  reminderCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    marginTop: 12,
    padding: 12,
  },
  reminderCopy: {
    flex: 1,
    marginLeft: 9,
  },
  reminderTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  reminderDesc: {
    fontSize: 9,
    lineHeight: 15,
    marginTop: 3,
  },
  detailActions: {
    gap: 8,
    marginTop: 14,
  },
  detailPrimaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    height: 46,
    justifyContent: 'center',
  },
  detailDangerButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(10, 14, 26, 0.48)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '92%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  modalSubtitle: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 3,
  },
  modalBody: {
    padding: 16,
    paddingBottom: 34,
  },
  locationCard: {
    alignItems: 'center',
    borderRadius: 13,
    flexDirection: 'row',
    padding: 12,
  },
  locationCopy: {
    flex: 1,
    marginHorizontal: 10,
  },
  locationTitle: {
    fontSize: 11,
    fontWeight: '900',
  },
  locationDesc: {
    fontSize: 9,
    lineHeight: 15,
    marginTop: 3,
  },
  fieldLabel: {
    color: '#7483a2',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: '700',
    height: 42,
    paddingHorizontal: 11,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: '600',
    minHeight: 68,
    padding: 11,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  flexInput: {
    flex: 1,
  },
  pickerCard: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    height: 42,
    paddingHorizontal: 11,
  },
  pickerText: {
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 8,
  },
  pickerHint: {
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 'auto',
  },
  ruleChips: {
    gap: 7,
  },
  ruleChip: {
    alignItems: 'center',
    borderColor: '#dde6fb',
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  ruleChipText: {
    fontSize: 9,
    fontWeight: '800',
  },
  segmented: {
    borderRadius: 10,
    flexDirection: 'row',
    padding: 3,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 10,
    fontWeight: '800',
  },
  reminderOptions: {
    marginTop: 8,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    height: 46,
    justifyContent: 'center',
    marginTop: 18,
  },
  primaryButtonText: {
    color: '#c9f36a',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 7,
  },
  dangerButton: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    marginTop: 16,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  toggleRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
  },
  toggleCopy: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  toggleDesc: {
    fontSize: 9,
    marginTop: 2,
  },
  switch: {
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 36,
  },
  switchDot: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    height: 16,
    width: 16,
  },
  searchHistoryCard: {
    marginTop: 12,
    padding: 13,
  },
  historyItem: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 8,
  },
});
