import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createAdminHomeRecommendation,
  deleteAdminHomeRecommendation,
  getAdminHomeRecommendations,
  getHomeRecommendationAuditLog,
  getHomeRecommendationErrorMessage,
  getHomeRecommendationStats,
  reorderAdminHomeRecommendations,
  updateAdminHomeRecommendation,
} from '@/lib/home-recommendation-api';
import { appTools, popularGames } from '@/mocks/app-data';
import type {
  HomeRecommendationAdminListResponse,
  HomeRecommendationAdminSlot,
  HomeRecommendationAuditEntry,
  HomeRecommendationRegistryFeature,
  HomeRecommendationSlotInput,
  HomeRecommendationSlotStats,
} from '@/types/home-recommendation';

type EditorState = {
  ctaLabelOverride: string;
  descriptionOverride: string;
  enabled: boolean;
  endsOn: string;
  featureId: string;
  startsOn: string;
  titleOverride: string;
  weekdays: string;
};

const emptyEditor: EditorState = {
  ctaLabelOverride: '',
  descriptionOverride: '',
  enabled: true,
  endsOn: '',
  featureId: '',
  startsOn: '',
  titleOverride: '',
  weekdays: '',
};

export function AdminHomeRecommendationsScreen() {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const { accessToken, user } = useAuth();
  const [data, setData] = useState<HomeRecommendationAdminListResponse | null>(null);
  const [stats, setStats] = useState<HomeRecommendationSlotStats[]>([]);
  const [audit, setAudit] = useState<HomeRecommendationAuditEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [adminData, statsData, auditData] = await Promise.all([
        getAdminHomeRecommendations(accessToken),
        getHomeRecommendationStats(accessToken),
        getHomeRecommendationAuditLog(accessToken),
      ]);
      setData(adminData);
      setStats(statsData.items);
      setAudit(auditData);
      setSelectedId((current) =>
        adminData.slots.some((item) => item.slot.id === current)
          ? current
          : adminData.slots[0]?.slot.id ?? '',
      );
    } catch (loadError) {
      setError(getHomeRecommendationErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken, user?.role]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selected = useMemo(
    () => data?.slots.find((item) => item.slot.id === selectedId) ?? null,
    [data, selectedId],
  );

  useEffect(() => {
    if (!selected) {
      setEditor(emptyEditor);
      return;
    }
    setEditor({
      ctaLabelOverride: selected.slot.ctaLabelOverride,
      descriptionOverride: selected.slot.descriptionOverride,
      enabled: selected.slot.enabled,
      endsOn: selected.slot.endsOn ?? '',
      featureId: selected.slot.featureId,
      startsOn: selected.slot.startsOn ?? '',
      titleOverride: selected.slot.titleOverride,
      weekdays: selected.slot.weekdays.join(','),
    });
  }, [selected]);

  const previewFeature = useMemo(() => {
    if (!editor.featureId || !data) return null;
    return (
      data.registry.find((feature) => feature.id === editor.featureId) ??
      data.slots.find((item) => item.slot.featureId === editor.featureId)?.feature ??
      null
    );
  }, [data, editor.featureId]);

  const featureIcon = useMemo(() => {
    if (!previewFeature) return 'star-outline';
    const fromTools = appTools.find((tool) => tool.id === previewFeature.id);
    if (fromTools) return fromTools.icon;
    const fromGames = popularGames.find((game) => game.id === previewFeature.id);
    return fromGames ? 'gamepad-variant-outline' : 'star-outline';
  }, [previewFeature]);

  const featureColor = useMemo(() => {
    if (!previewFeature) return '#4b6bff';
    return previewFeature.accentColor || '#4b6bff';
  }, [previewFeature]);

  function selectSlot(slot: HomeRecommendationAdminSlot) {
    setSelectedId(slot.slot.id);
    setError('');
    setNotice('');
  }

  function startCreate() {
    setSelectedId('');
    setEditor({
      ...emptyEditor,
      featureId: data?.registry.find((feature) => feature.status === 'available')?.id ?? '',
    });
    setError('');
    setNotice('');
    setPickerOpen(true);
  }

  function buildSlotInput(): HomeRecommendationSlotInput {
    return {
      ctaLabelOverride: editor.ctaLabelOverride.trim(),
      descriptionOverride: editor.descriptionOverride.trim(),
      enabled: editor.enabled,
      endsOn: editor.endsOn.trim() || null,
      featureId: editor.featureId,
      startsOn: editor.startsOn.trim() || null,
      titleOverride: editor.titleOverride.trim(),
      weekdays: editor.weekdays
        .split(',')
        .map((value) => parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
    };
  }

  async function save() {
    if (!accessToken || !editor.featureId) {
      setError('请先选择推荐功能。');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (selectedId) {
        await updateAdminHomeRecommendation(accessToken, selectedId, buildSlotInput());
        setNotice('推荐位已保存并发布。');
      } else {
        const created = await createAdminHomeRecommendation(accessToken, buildSlotInput());
        setSelectedId(created.slot.id);
        setNotice('推荐位已创建并发布。');
      }
      await load();
    } catch (saveError) {
      setError(getHomeRecommendationErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!accessToken || !pendingDelete) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await deleteAdminHomeRecommendation(accessToken, pendingDelete);
      setPendingDelete(null);
      setNotice('推荐位已删除。');
      await load();
    } catch (deleteError) {
      setError(getHomeRecommendationErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  }

  async function move(slotID: string, direction: -1 | 1) {
    if (!data || !accessToken) return;
    const index = data.slots.findIndex((item) => item.slot.id === slotID);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= data.slots.length) return;
    const next = data.slots.map((item) => item.slot.id);
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true);
    setError('');
    try {
      await reorderAdminHomeRecommendations(accessToken, next);
      await load();
      setSelectedId(slotID);
    } catch (reorderError) {
      setError(getHomeRecommendationErrorMessage(reorderError));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={styles.statsRow}>
        <StatCard
          color="#4b6bff"
          icon="calendar-check-outline"
          label="今日生效"
          value={String(data?.summary.enabledToday ?? 0)}
        />
        <StatCard
          color="#1f7b63"
          icon="star-circle-outline"
          label="默认推荐"
          value={data?.summary.defaultFeature ?? '打牌记分'}
        />
        <StatCard
          color="#a96f12"
          icon="pause-circle-outline"
          label="未启用"
          value={String(data?.summary.disabled ?? 0)}
        />
        <StatCard color="#7a55c7" icon="chart-line" label="30 天点击" value={String(stats.reduce((sum, item) => sum + item.clicks, 0))} />
      </View>

      {notice ? (
        <View style={[styles.notice, { backgroundColor: '#edf9f5', borderColor: '#c8eadf' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={18} color="#18785d" />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
      {error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setError('')}
          style={[styles.notice, { backgroundColor: '#fff0f2', borderColor: '#f4c6cc' }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#a33342" />
          <Text style={[styles.noticeText, { color: '#a33342' }]}>{error}</Text>
          <MaterialCommunityIcons name="close" size={16} color="#a33342" />
        </Pressable>
      ) : null}

      <View style={[styles.managementGrid, compact && styles.managementGridCompact]}>
        <View style={[styles.panel, compact && styles.panelFull]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>推荐位列表</Text>
              <Text style={styles.panelMeta}>至少保留 1 个，同日最多 3 个，横向轮播展示</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={startCreate}
              style={styles.primaryButton}>
              <MaterialCommunityIcons name="plus" size={16} color="#ffffff" />
              <Text style={styles.primaryButtonText}>新建推荐位</Text>
            </Pressable>
          </View>

          <View style={styles.slotList}>
            {(data?.slots ?? []).length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="star-outline" size={26} color={colors.mutedText} />
                <Text style={[styles.emptyText, { color: colors.mutedText }]}>
                  还没有推荐位，新建后首页将展示默认推荐
                </Text>
              </View>
            ) : null}
            {(data?.slots ?? []).map((item, index) => {
              const active = item.slot.id === selectedId;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={item.slot.id}
                  onPress={() => selectSlot(item)}
                  style={[styles.slotRow, active && styles.slotRowActive]}>
                  <View style={[styles.slotIcon, { backgroundColor: `${featureVisualColor(item)}1c` }]}>
                    <MaterialCommunityIcons
                      name={featureVisualIcon(item)}
                      size={19}
                      color={featureVisualColor(item)}
                    />
                  </View>
                  <View style={styles.slotCopy}>
                    <View style={styles.slotTitleRow}>
                      <Text numberOfLines={1} style={styles.slotTitle}>
                        {item.feature.name || item.slot.featureId}
                      </Text>
                      <View
                        style={[
                          styles.kindBadge,
                          item.slot.featureKind === 'game' && styles.kindBadgeGame,
                        ]}>
                        <Text style={styles.kindBadgeText}>
                          {item.slot.featureKind === 'game' ? '游戏' : '工具'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.slotMeta}>
                      {item.valid
                        ? slotScheduleLabel(item.slot.startsOn, item.slot.endsOn, item.slot.weekdays)
                        : item.invalidNote || '功能已失效'}
                    </Text>
                  </View>
                  <View style={styles.slotStatusGroup}>
                    {item.slot.enabled ? (
                      <View style={styles.enabledBadge}>
                        <Text style={styles.enabledBadgeText}>启用</Text>
                      </View>
                    ) : (
                      <View style={styles.disabledBadge}>
                        <Text style={styles.disabledBadgeText}>未启用</Text>
                      </View>
                    )}
                    <View style={styles.slotActions}>
                      <IconButton
                        disabled={index === 0}
                        icon="arrow-up"
                        label="上移"
                        onPress={() => void move(item.slot.id, -1)}
                      />
                      <IconButton
                        disabled={index === (data?.slots.length ?? 1) - 1}
                        icon="arrow-down"
                        label="下移"
                        onPress={() => void move(item.slot.id, 1)}
                      />
                      <IconButton
                        icon="delete-outline"
                        label="删除"
                        onPress={() => setPendingDelete(item.slot.id)}
                      />
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.panel, compact && styles.panelFull]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>
                {selectedId ? '编辑推荐位' : '新建推荐位'}
              </Text>
              <Text style={styles.panelMeta}>保存即生效，变更写入审计日志</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerOpen(true)}
              style={styles.secondaryButton}>
              <MaterialCommunityIcons name="swap-horizontal" size={15} color="#4b6bff" />
              <Text style={styles.secondaryButtonText}>更换功能</Text>
            </Pressable>
          </View>

          <View style={styles.editorBody}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickerOpen(true)}
              style={styles.featurePicker}>
              <View style={[styles.featurePickerIcon, { backgroundColor: `${featureColor}1c` }]}>
                <MaterialCommunityIcons name={featureIcon} size={22} color={featureColor} />
              </View>
              <View style={styles.featurePickerCopy}>
                <Text style={styles.featurePickerTitle}>
                  {previewFeature?.name || editor.featureId || '选择推荐功能'}
                </Text>
                <Text style={styles.featurePickerMeta}>
                  {previewFeature
                    ? `${previewFeature.route} · 状态 ${
                        previewFeature.status === 'playable' ? '可玩' : '可用'
                      }`
                    : '从真实功能注册表选择工具或游戏'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color="#6b7590" />
            </Pressable>

            <View style={styles.twoColumns}>
              <Field
                label="标题覆盖（留空使用真实名称）"
                onChangeText={(titleOverride) => setEditor((value) => ({ ...value, titleOverride }))}
                placeholder="例如：今日牌局"
                value={editor.titleOverride}
              />
              <Field
                label="简介覆盖（留空使用真实简介）"
                onChangeText={(descriptionOverride) =>
                  setEditor((value) => ({ ...value, descriptionOverride }))
                }
                placeholder="例如：多人实时记分"
                value={editor.descriptionOverride}
              />
            </View>
            <Field
              label="CTA 覆盖（留空使用真实文案）"
              onChangeText={(ctaLabelOverride) =>
                setEditor((value) => ({ ...value, ctaLabelOverride }))
              }
              placeholder="例如：立即开始"
              value={editor.ctaLabelOverride}
            />

            <View style={styles.twoColumns}>
              <Field
                label="开始日期（可选）"
                onChangeText={(startsOn) => setEditor((value) => ({ ...value, startsOn }))}
                placeholder="2026-08-10"
                value={editor.startsOn}
              />
              <Field
                label="结束日期（可选）"
                onChangeText={(endsOn) => setEditor((value) => ({ ...value, endsOn }))}
                placeholder="2026-08-31"
                value={editor.endsOn}
              />
            </View>
            <Field
              label="每周生效日（可选，1-7 逗号分隔，留空表示全部）"
              onChangeText={(weekdays) => setEditor((value) => ({ ...value, weekdays }))}
              placeholder="例如：1,2,3,4,5"
              value={editor.weekdays}
            />

            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <Text style={styles.switchTitle}>启用推荐位</Text>
                <Text style={styles.switchHint}>关闭后立即从首页消失，最后一个启用位不可关闭</Text>
              </View>
              <Switch
                onValueChange={(enabled) => setEditor((value) => ({ ...value, enabled }))}
                thumbColor="#ffffff"
                trackColor={{ false: '#d7dbe4', true: '#4b6bff' }}
                value={editor.enabled}
              />
            </View>

            {previewFeature ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>首页预览</Text>
                <View style={[styles.previewCard, { backgroundColor: featureColor || '#123a33' }]}>
                  <View style={styles.previewCardCopy}>
                    <Text style={styles.previewEyebrow}>今日推荐</Text>
                    <Text numberOfLines={1} style={styles.previewTitle}>
                      {editor.titleOverride.trim() || previewFeature.name}
                    </Text>
                    <Text numberOfLines={2} style={styles.previewDesc}>
                      {editor.descriptionOverride.trim() || previewFeature.tagline}
                    </Text>
                    <View style={styles.previewCta}>
                      <Text style={styles.previewCtaText}>
                        {editor.ctaLabelOverride.trim() ||
                          (previewFeature.route.startsWith('/games/')
                            ? '开始游戏'
                            : previewFeature.usageLabel)}
                      </Text>
                      <MaterialCommunityIcons name="arrow-top-right" size={15} color="#173a35" />
                    </View>
                  </View>
                  <View style={styles.previewArt}>
                    <MaterialCommunityIcons name={featureIcon} size={34} color="#c9f36a" />
                  </View>
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.editorFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={startCreate}
              disabled={busy}
              style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>重置</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void save()}
              style={[styles.primaryButton, busy && styles.buttonDisabled]}>
              <MaterialCommunityIcons name="content-save-outline" size={16} color="#ffffff" />
              <Text style={styles.primaryButtonText}>保存并发布</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={[styles.managementGrid, compact && styles.managementGridCompact]}>
        <View style={[styles.panel, compact && styles.panelFull]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>效果概览</Text>
              <Text style={styles.panelMeta}>最近 30 天真实曝光与点击</Text>
            </View>
          </View>
          <View style={styles.statsTable}>
            {(data?.slots ?? []).map((item) => {
              const row = stats.find((stat) => stat.slotId === item.slot.id);
              if (!row) {
                return (
                  <View key={item.slot.id} style={styles.statsRow}>
                    <Text style={styles.statsName}>{item.feature.name || item.slot.featureId}</Text>
                    <Text style={styles.statsEmpty}>暂无曝光</Text>
                  </View>
                );
              }
              return (
                <View key={item.slot.id} style={styles.statsRow}>
                  <Text style={styles.statsName}>{item.feature.name || item.slot.featureId}</Text>
                  <Text style={styles.statsValue}>曝光 {row.views}</Text>
                  <Text style={styles.statsValue}>点击 {row.clicks}</Text>
                  <Text style={styles.statsValue}>
                    {Math.round(row.clickRate * 1000) / 10}%
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={[styles.panel, compact && styles.panelFull]}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>审计记录</Text>
              <Text style={styles.panelMeta}>配置变更全部留痕</Text>
            </View>
          </View>
          <View style={styles.auditList}>
            {audit.length === 0 ? (
              <Text style={styles.emptyText}>暂无变更记录</Text>
            ) : null}
            {audit.slice(0, 10).map((entry) => (
              <View key={entry.id} style={styles.auditRow}>
                <Text style={styles.auditAction}>{entry.action}</Text>
                <Text style={styles.auditDetail}>{entry.detail}</Text>
                <Text style={styles.auditTime}>{formatAuditTime(entry.createdAt)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
        transparent
        visible={pickerOpen}>
        <FeaturePickerModal
          onClose={() => setPickerOpen(false)}
          onSelect={(feature) => {
            setEditor((value) => ({ ...value, featureId: feature.id }));
            setPickerOpen(false);
          }}
          registry={data?.registry ?? []}
          selectedID={editor.featureId}
        />
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
        transparent
        visible={pendingDelete !== null}>
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmDialog}>
            <Text style={styles.confirmTitle}>删除推荐位</Text>
            <Text style={styles.confirmBody}>
              删除后立即从首页消失。至少保留 1 个启用推荐位，最后一个会被阻止。
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPendingDelete(null)}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void remove()}
                style={[styles.dangerButton, busy && styles.buttonDisabled]}>
                <Text style={styles.primaryButtonText}>确认删除</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function StatCard({
  color,
  icon,
  label,
  value,
}: {
  color: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${color}14` }]}>
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#a2a9b8"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function IconButton({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled?: boolean;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, disabled && styles.buttonDisabled]}>
      <MaterialCommunityIcons name={icon} size={16} color={disabled ? '#b9c0cf' : '#6b7590'} />
    </Pressable>
  );
}

function FeaturePickerModal({
  onClose,
  onSelect,
  registry,
  selectedID,
}: {
  onClose: () => void;
  onSelect: (feature: HomeRecommendationRegistryFeature) => void;
  registry: HomeRecommendationRegistryFeature[];
  selectedID: string;
}) {
  const selectable = registry.filter(
    (feature) =>
      !feature.hiddenFromList &&
      (feature.status === 'available' || feature.status === 'playable'),
  );
  return (
    <View style={styles.modalBackdrop}>
      <View style={styles.pickerDialog}>
        <View style={styles.pickerHeader}>
          <View>
            <Text style={styles.confirmTitle}>选择推荐功能</Text>
            <Text style={styles.pickerSub}>仅展示真实注册表中的可用工具与可玩游戏</Text>
          </View>
          <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose}>
            <MaterialCommunityIcons name="close" size={22} color="#6b7590" />
          </Pressable>
        </View>
        <ScrollView style={styles.pickerList}>
          {selectable.map((feature) => {
            const icon = featureVisualIconForRegistry(feature);
            const color = feature.accentColor || '#4b6bff';
            const selected = feature.id === selectedID;
            return (
              <Pressable
                accessibilityRole="button"
                key={feature.id}
                onPress={() => onSelect(feature)}
                style={[styles.pickerRow, selected && styles.pickerRowSelected]}>
                <View style={[styles.pickerIcon, { backgroundColor: `${color}1c` }]}>
                  <MaterialCommunityIcons name={icon} size={19} color={color} />
                </View>
                <View style={styles.pickerCopy}>
                  <Text style={styles.pickerName}>{feature.name}</Text>
                  <Text style={styles.pickerMeta}>
                    {feature.tagline} · {feature.route}
                  </Text>
                </View>
                {selected ? (
                  <MaterialCommunityIcons name="check-circle" size={20} color="#4b6bff" />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function featureVisualIcon(slot: HomeRecommendationAdminSlot) {
  return featureVisualIconForRegistry(slot.feature);
}

function featureVisualColor(slot: HomeRecommendationAdminSlot) {
  return slot.feature.accentColor || '#4b6bff';
}

function featureVisualIconForRegistry(feature: HomeRecommendationRegistryFeature) {
  const fromTools = appTools.find((tool) => tool.id === feature.id);
  if (fromTools) return fromTools.icon;
  const fromGames = popularGames.find((game) => game.id === feature.id);
  return fromGames ? 'gamepad-variant-outline' : 'star-outline';
}

function slotScheduleLabel(startsOn: string | null, endsOn: string | null, weekdays: number[]) {
  const parts: string[] = [];
  if (startsOn && endsOn) {
    parts.push(`${startsOn} 至 ${endsOn}`);
  } else if (startsOn) {
    parts.push(`${startsOn} 起`);
  } else if (endsOn) {
    parts.push(`至 ${endsOn}`);
  }
  if (weekdays.length > 0) {
    parts.push(`每周 ${weekdays.join(',')}`);
  }
  if (parts.length === 0) {
    return '全部日期';
  }
  return parts.join(' · ');
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

const styles = StyleSheet.create({
  auditAction: {
    color: '#4b6bff',
    fontSize: 10,
    fontWeight: '900',
    width: 64,
  },
  auditDetail: {
    color: '#505a72',
    flex: 1,
    fontSize: 10,
  },
  auditList: {
    padding: 6,
  },
  auditRow: {
    alignItems: 'center',
    borderBottomColor: '#e3e7f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 8,
  },
  auditTime: {
    color: '#9aa2b5',
    fontSize: 9,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  confirmBody: {
    color: '#6b7590',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 6,
  },
  confirmDialog: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    maxWidth: 420,
    padding: 22,
    width: '100%',
  },
  confirmTitle: {
    color: '#161b2e',
    fontSize: 17,
    fontWeight: '900',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#d6455a',
    borderRadius: 7,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
  },
  disabledBadge: {
    backgroundColor: '#f0f2f7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  disabledBadgeText: {
    color: '#6b7590',
    fontSize: 9,
    fontWeight: '800',
  },
  editorBody: {
    gap: 13,
    padding: 15,
  },
  editorFooter: {
    alignItems: 'center',
    borderTopColor: '#e3e7f0',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'flex-end',
    padding: 13,
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    padding: 28,
  },
  emptyText: {
    color: '#9aa2b5',
    fontSize: 11,
    padding: 12,
    textAlign: 'center',
  },
  enabledBadge: {
    backgroundColor: '#eaf6dc',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  enabledBadgeText: {
    color: '#4d6b1f',
    fontSize: 9,
    fontWeight: '800',
  },
  featurePicker: {
    alignItems: 'center',
    borderColor: '#4b6bff',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    padding: 10,
  },
  featurePickerCopy: {
    flex: 1,
    minWidth: 0,
  },
  featurePickerIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  featurePickerMeta: {
    color: '#6b7590',
    fontSize: 10,
    marginTop: 2,
  },
  featurePickerTitle: {
    color: '#161b2e',
    fontSize: 13,
    fontWeight: '900',
  },
  field: {
    flex: 1,
    gap: 5,
    minWidth: 180,
  },
  fieldLabel: {
    color: '#505a72',
    fontSize: 10,
    fontWeight: '800',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#f5f7fb',
    borderColor: '#e3e7f0',
    borderRadius: 7,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  input: {
    backgroundColor: '#fbfcfe',
    borderColor: '#e3e7f0',
    borderRadius: 6,
    borderWidth: 1,
    color: '#161b2e',
    fontSize: 12,
    minHeight: 38,
    outlineStyle: 'none',
    paddingHorizontal: 10,
  } as never,
  kindBadge: {
    backgroundColor: '#edf0ff',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  kindBadgeGame: {
    backgroundColor: '#e9f8f1',
  },
  kindBadgeText: {
    color: '#4b6bff',
    fontSize: 8,
    fontWeight: '900',
  },
  managementGrid: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
  },
  managementGridCompact: {
    flexDirection: 'column',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 13, 31, 0.56)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  notice: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 11,
  },
  noticeText: {
    color: '#18785d',
    flex: 1,
    fontSize: 11,
  },
  page: {
    backgroundColor: '#f3f5fa',
    flex: 1,
  },
  pageContent: {
    alignSelf: 'center',
    gap: 14,
    maxWidth: 1280,
    padding: 18,
    width: '100%',
  },
  panel: {
    backgroundColor: '#ffffff',
    borderColor: '#e3e7f0',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },
  panelFull: {
    width: '100%',
  },
  panelHeader: {
    alignItems: 'center',
    borderBottomColor: '#e3e7f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minHeight: 62,
    paddingHorizontal: 15,
  },
  panelMeta: {
    color: '#6b7590',
    fontSize: 9,
    marginTop: 3,
  },
  panelTitle: {
    color: '#161b2e',
    fontSize: 14,
    fontWeight: '900',
  },
  pickerCopy: {
    flex: 1,
    minWidth: 0,
  },
  pickerDialog: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    maxHeight: '80%',
    maxWidth: 560,
    width: '100%',
  },
  pickerHeader: {
    alignItems: 'center',
    borderBottomColor: '#e3e7f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  pickerIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  pickerList: {
    maxHeight: 420,
  },
  pickerMeta: {
    color: '#6b7590',
    fontSize: 10,
    marginTop: 2,
  },
  pickerName: {
    color: '#161b2e',
    fontSize: 12,
    fontWeight: '900',
  },
  pickerRow: {
    alignItems: 'center',
    borderBottomColor: '#eef1f7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 14,
  },
  pickerRowSelected: {
    backgroundColor: '#f2f5ff',
  },
  pickerSub: {
    color: '#6b7590',
    fontSize: 10,
    marginTop: 3,
  },
  previewArt: {
    alignItems: 'center',
    borderColor: 'rgba(201, 243, 106, 0.35)',
    borderRadius: 16,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  previewBox: {
    gap: 8,
  },
  previewCard: {
    borderRadius: 18,
    flexDirection: 'row',
    minHeight: 142,
    overflow: 'hidden',
    padding: 15,
  },
  previewCardCopy: {
    flex: 1,
    minWidth: 0,
  },
  previewCta: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#c9f36a',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  previewCtaText: {
    color: '#16332c',
    fontSize: 11,
    fontWeight: '800',
  },
  previewDesc: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 10,
    marginTop: 4,
  },
  previewEyebrow: {
    color: '#c9f36a',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  previewLabel: {
    color: '#505a72',
    fontSize: 10,
    fontWeight: '800',
  },
  previewTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 8,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 7,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 13,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#edf0ff',
    borderRadius: 7,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 13,
  },
  secondaryButtonText: {
    color: '#4b6bff',
    fontSize: 11,
    fontWeight: '900',
  },
  slotActions: {
    flexDirection: 'row',
    gap: 5,
  },
  slotCopy: {
    flex: 1,
    minWidth: 0,
  },
  slotIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  slotList: {
    minHeight: 120,
  },
  slotMeta: {
    color: '#6b7590',
    fontSize: 9,
    marginTop: 3,
  },
  slotRow: {
    alignItems: 'center',
    borderBottomColor: '#eef1f7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  slotRowActive: {
    backgroundColor: '#f7f9ff',
  },
  slotStatusGroup: {
    alignItems: 'flex-end',
    gap: 7,
  },
  slotTitle: {
    color: '#161b2e',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '900',
  },
  slotTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  statCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e3e7f0',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 150,
    padding: 13,
  },
  statIcon: {
    alignItems: 'center',
    borderRadius: 7,
    height: 36,
    justifyContent: 'center',
    marginBottom: 10,
    width: 36,
  },
  statLabel: {
    color: '#6b7590',
    fontSize: 9,
    fontWeight: '800',
  },
  statsEmpty: {
    color: '#9aa2b5',
    fontSize: 10,
  },
  statsName: {
    color: '#161b2e',
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  statsRow: {
    alignItems: 'center',
    borderBottomColor: '#eef1f7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  statsTable: {
    paddingVertical: 4,
  },
  statsValue: {
    color: '#505a72',
    fontSize: 10,
    fontWeight: '700',
    width: 72,
  },
  statValue: {
    color: '#161b2e',
    fontSize: 21,
    fontWeight: '900',
    marginTop: 3,
  },
  switchCopy: {
    flex: 1,
  },
  switchHint: {
    color: '#9aa2b5',
    fontSize: 9,
    marginTop: 3,
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  switchTitle: {
    color: '#161b2e',
    fontSize: 12,
    fontWeight: '800',
  },
  twoColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
