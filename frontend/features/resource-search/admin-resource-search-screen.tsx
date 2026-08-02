import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
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

import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  createAdminResourceSearchSource,
  deleteAdminResourceSearchSource,
  getAdminResourceSearchStats,
  getResourceSearchErrorMessage,
  listAdminResourceSearchAuditLogs,
  listAdminResourceSearchSources,
  runAdminResourceSearchHealthCheck,
  runAdminResourceSearchHealthChecks,
  runAdminResourceSearchTest,
  updateAdminResourceSearchSource,
} from '@/lib/resource-search-api';
import { RESOURCE_SEARCH_CATEGORIES } from '@/lib/resource-search';
import type {
  ResourceSearchAdminStats,
  ResourceSearchAuditLog,
  ResourceSearchSource,
  ResourceSearchSourceInput,
  ResourceSearchTestResult,
} from '@/types/resource-search';

type EditorDraft = {
  adapterKey: string;
  cacheTtlMs: string;
  category: string;
  defaultSelected: boolean;
  description: string;
  enabled: boolean;
  homepageUrl: string;
  logoBackground: string;
  logoColor: string;
  logoText: string;
  maxResults: string;
  mode: 'aggregate' | 'direct';
  name: string;
  searchUrlTemplate: string;
  sortOrder: string;
  testQuery: string;
  timeoutMs: string;
};

type TabKey = 'audit' | 'sources' | 'stats';

export function AdminResourceSearchScreen() {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const { accessToken, user } = useAuth();
  const { colors } = useAppTheme();
  const [sources, setSources] = useState<ResourceSearchSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [status, setStatus] = useState('全部状态');
  const [tab, setTab] = useState<TabKey>('sources');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditorDraft>(() => emptyDraft());
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<ResourceSearchTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [healthBusy, setHealthBusy] = useState<string | null>(null);
  const [stats, setStats] = useState<ResourceSearchAdminStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<ResourceSearchAuditLog[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ResourceSearchSource | null>(null);

  const adminToken = accessToken && user?.role === 'admin' ? accessToken : null;

  const loadSources = useCallback(async () => {
    if (!adminToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await listAdminResourceSearchSources(adminToken, {
        category,
        q: query,
        status: status === '全部状态' ? '' : status === '已启用' ? 'enabled' : 'disabled',
      });
      setSources(next);
    } catch (loadError) {
      setError(getResourceSearchErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [adminToken, category, query, status]);

  const loadStats = useCallback(async () => {
    if (!adminToken) return;
    try {
      setStats(await getAdminResourceSearchStats(adminToken, 7));
    } catch (statsError) {
      setError(getResourceSearchErrorMessage(statsError));
    }
  }, [adminToken]);

  const loadAudit = useCallback(async () => {
    if (!adminToken) return;
    try {
      const page = await listAdminResourceSearchAuditLogs(adminToken, { limit: 30 });
      setAuditLogs(page.logs);
    } catch (auditError) {
      setError(getResourceSearchErrorMessage(auditError));
    }
  }, [adminToken]);

  useEffect(() => { void loadSources(); }, [loadSources]);
  useEffect(() => {
    if (tab === 'stats') void loadStats();
    if (tab === 'audit') void loadAudit();
  }, [tab, loadAudit, loadStats]);

  const statsBySource = useMemo(() => {
    const map = new Map((stats?.sources ?? []).map((item) => [item.sourceId, item]));
    return sources.map((source) => map.get(source.id)).filter(Boolean);
  }, [sources, stats]);

  const summary = useMemo(() => ({
    aggregate: sources.filter((source) => source.mode === 'aggregate').length,
    disabled: sources.filter((source) => !source.enabled).length,
    enabled: sources.filter((source) => source.enabled).length,
    total: sources.length,
  }), [sources]);

  if (!adminToken) {
    return (
      <View style={[styles.accessState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={28} color={colors.hero} />
        <Text style={[styles.accessTitle, { color: colors.text }]}>仅管理员可访问</Text>
        <Text style={[styles.accessBody, { color: colors.mutedText }]}>请使用管理员账号登录后管理资源搜索站点。</Text>
      </View>
    );
  }
  const token = adminToken;

  async function runHealth(sourceId: string) {
    setHealthBusy(sourceId);
    setError('');
    try {
      await runAdminResourceSearchHealthCheck(token, sourceId);
      setNotice('真实健康检测完成，状态已更新。');
      await loadSources();
    } catch (healthError) {
      setError(getResourceSearchErrorMessage(healthError));
    } finally {
      setHealthBusy(null);
    }
  }

  async function runAllHealth() {
    setHealthBusy('all');
    setError('');
    try {
      const checks = await runAdminResourceSearchHealthChecks(token);
      setNotice(`已对 ${checks.length} 个启用站点执行真实检测。`);
      await loadSources();
    } catch (healthError) {
      setError(getResourceSearchErrorMessage(healthError));
    } finally {
      setHealthBusy(null);
    }
  }

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setTestResult(null);
    setError('');
    setEditorOpen(true);
  }

  function openEdit(source: ResourceSearchSource) {
    setEditingId(source.id);
    setDraft({
      adapterKey: source.adapterKey,
      cacheTtlMs: String(source.cacheTtlMs),
      category: source.category,
      defaultSelected: source.defaultSelected,
      description: source.description,
      enabled: source.enabled,
      homepageUrl: source.url,
      logoBackground: source.logoBackground,
      logoColor: source.logoColor,
      logoText: source.logo,
      maxResults: String(source.maxResults),
      mode: source.mode,
      name: source.name,
      searchUrlTemplate: source.searchUrlTemplate ?? '',
      sortOrder: String(source.sortOrder),
      testQuery: '',
      timeoutMs: String(source.timeoutMs),
    });
    setTestResult(null);
    setError('');
    setEditorOpen(true);
  }

  async function saveEditor() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const input: ResourceSearchSourceInput = {
        adapterKey: draft.adapterKey,
        cacheTtlMs: Number(draft.cacheTtlMs || 120000),
        category: draft.category || '综合',
        defaultSelected: draft.defaultSelected,
        description: draft.description,
        enabled: draft.enabled,
        homepageUrl: draft.homepageUrl,
        logoBackground: draft.logoBackground || '#e7ecff',
        logoColor: draft.logoColor || '#4b6bff',
        logoText: draft.logoText,
        logoType: 'text',
        maxResults: Number(draft.maxResults || 20),
        mode: draft.mode,
        name: draft.name,
        searchUrlTemplate: draft.searchUrlTemplate,
        sortOrder: Number(draft.sortOrder || 0),
        testQuery: draft.testQuery,
        timeoutMs: Number(draft.timeoutMs || 12000),
      };
      if (editingId) {
        await updateAdminResourceSearchSource(token, editingId, input);
        setNotice('站点配置已保存并通过真实验证。');
      } else {
        await createAdminResourceSearchSource(token, input);
        setNotice('新站点已创建并通过真实验证。');
      }
      setEditorOpen(false);
      await loadSources();
    } catch (saveError) {
      setError(getResourceSearchErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!editingId) return;
    setTesting(true);
    setError('');
    try {
      setTestResult(await runAdminResourceSearchTest(token, editingId, draft.testQuery || '测试'));
    } catch (testError) {
      setError(getResourceSearchErrorMessage(testError));
    } finally {
      setTesting(false);
    }
  }

  async function toggleEnabled(source: ResourceSearchSource) {
    const input: ResourceSearchSourceInput = {
      adapterKey: source.adapterKey,
      cacheTtlMs: source.cacheTtlMs,
      category: source.category,
      defaultSelected: source.defaultSelected,
      description: source.description,
      enabled: !source.enabled,
      homepageUrl: source.url,
      logoBackground: source.logoBackground,
      logoColor: source.logoColor,
      logoText: source.logo,
      logoType: 'text',
      maxResults: source.maxResults,
      mode: source.mode,
      name: source.name,
      searchUrlTemplate: source.searchUrlTemplate ?? '',
      sortOrder: source.sortOrder,
      timeoutMs: source.timeoutMs,
    };
    setError('');
    try {
      await updateAdminResourceSearchSource(token, source.id, input);
      setNotice(source.enabled ? '站点已停用。' : '站点已启用。');
      await loadSources();
    } catch (toggleError) {
      setError(getResourceSearchErrorMessage(toggleError));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setError('');
    try {
      await deleteAdminResourceSearchSource(token, pendingDelete.id);
      setNotice('站点已删除。');
      setPendingDelete(null);
      await loadSources();
    } catch (deleteError) {
      setError(getResourceSearchErrorMessage(deleteError));
      setPendingDelete(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
      <View style={[styles.page, desktop && styles.pageDesktop]}>
        <View style={styles.heading}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.text }]}>资源搜索站点</Text>
            <Text style={[styles.pageSubtitle, { color: colors.mutedText }]}>配置用户端真实使用的搜索站点、接入方式与可用状态</Text>
          </View>
          <View style={styles.headingActions}>
            <Pressable accessibilityRole="button" disabled={healthBusy !== null} onPress={() => void runAllHealth()} style={[styles.secondaryButton, { borderColor: colors.line }]}>
              {healthBusy === 'all' ? <ActivityIndicator color={colors.text} size="small" /> : <MaterialCommunityIcons name="radar" size={17} color={colors.text} />}
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>检测全部</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={openCreate} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="plus" size={17} color="#ffffff" />
              <Text style={styles.primaryButtonText}>新建站点</Text>
            </Pressable>
          </View>
        </View>

        {notice ? <Notice icon="check-circle-outline" tone="#1db991" text={notice} /> : null}
        {error ? <Pressable accessibilityRole="button" onPress={() => setError('')}><Notice icon="alert-circle-outline" tone="#c0465b" text={error} /></Pressable> : null}

        <View style={[styles.metrics, desktop && styles.metricsDesktop]}>
          <Metric label="站点总数" tone={colors.hero} value={summary.total} />
          <Metric label="已启用" tone="#1db991" value={summary.enabled} />
          <Metric label="可聚合" tone="#4b6bff" value={summary.aggregate} />
          <Metric label="已停用" tone="#e8a33d" value={summary.disabled} />
        </View>

        <View style={styles.toolbar}>
          <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedText} />
            <TextInput
              accessibilityLabel="搜索站点名称或域名"
              onChangeText={setQuery}
              onSubmitEditing={() => void loadSources()}
              placeholder="搜索站点名称或域名"
              placeholderTextColor={colors.mutedText}
              style={[styles.searchInput, { color: colors.text }]}
              value={query}
            />
          </View>
          <View style={styles.chipGroups}>
            <ChipGroup active={category} onChange={setCategory} options={['全部', ...RESOURCE_SEARCH_CATEGORIES]} />
            <ChipGroup active={status} onChange={setStatus} options={['全部状态', '已启用', '已停用']} />
          </View>
          <Pressable accessibilityRole="button" onPress={() => void loadSources()} style={[styles.filterButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <Text style={[styles.filterButtonText, { color: colors.text }]}>筛选</Text>
          </Pressable>
        </View>

        <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
          {([
            ['sources', '站点列表', 'view-list-outline'],
            ['stats', '运行概览', 'chart-box-outline'],
            ['audit', '操作审计', 'clipboard-text-clock-outline'],
          ] as const).map(([key, label, icon]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && { backgroundColor: colors.surface }]}>
              <MaterialCommunityIcons name={icon} size={17} color={tab === key ? colors.primary : colors.mutedText} />
              <Text style={[styles.tabText, { color: tab === key ? colors.primary : colors.mutedText }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'sources' ? (
          loading ? (
            <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.line }]}><ActivityIndicator color={colors.primary} /><Text style={[styles.stateText, { color: colors.mutedText }]}>正在加载真实站点配置…</Text></View>
          ) : sources.length === 0 ? (
            <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="database-off-outline" size={26} color={colors.mutedText} />
              <Text style={[styles.stateTitle, { color: colors.text }]}>暂无站点配置</Text>
              <Text style={[styles.stateText, { color: colors.mutedText }]}>新建第一个真实搜索站点，保存前会执行健康检测与试搜。</Text>
              <Pressable accessibilityRole="button" onPress={openCreate} style={[styles.primaryButton, { backgroundColor: colors.primary }]}><Text style={styles.primaryButtonText}>新建站点</Text></Pressable>
            </View>
          ) : (
            <View style={[styles.sourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {sources.map((source) => (
                <View key={source.id} style={[styles.sourceRow, { borderTopColor: colors.line }]}>
                  <View style={[styles.logo, { backgroundColor: source.logoBackground }]}>
                    <Text style={[styles.logoText, { color: source.logoColor }]}>{source.logo}</Text>
                  </View>
                  <View style={styles.sourceCopy}>
                    <View style={styles.sourceTitleLine}>
                      <Text style={[styles.sourceName, { color: colors.text }]}>{source.name}</Text>
                      <Badge mode={source.mode} />
                      {!source.enabled ? <Badge mode="disabled" /> : null}
                    </View>
                    <Text numberOfLines={1} style={[styles.sourceMeta, { color: colors.mutedText }]}>{source.description} · {source.domain}</Text>
                    <HealthLine health={source.health} />
                  </View>
                  <View style={styles.sourceActions}>
                    <Switch
                      accessibilityLabel={`${source.name}启用状态`}
                      onValueChange={() => void toggleEnabled(source)}
                      thumbColor="#ffffff"
                      trackColor={{ false: '#d7dbe4', true: '#92a5ff' }}
                      value={source.enabled}
                    />
                    <View style={styles.rowActions}>
                      <ActionButton icon="pencil-outline" label="编辑" onPress={() => openEdit(source)} />
                      <ActionButton icon="radar" label="检测" loading={healthBusy === source.id} onPress={() => void runHealth(source.id)} />
                      <ActionButton icon="delete-outline" label="删除" onPress={() => setPendingDelete(source)} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )
        ) : null}

        {tab === 'stats' ? (
          stats === null ? (
            <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.line }]}><ActivityIndicator color={colors.primary} /></View>
          ) : stats.totalSearches === 0 ? (
            <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="chart-line" size={26} color={colors.mutedText} />
              <Text style={[styles.stateTitle, { color: colors.text }]}>暂无搜索记录</Text>
              <Text style={[styles.stateText, { color: colors.mutedText }]}>上线后按真实搜索日志统计，不填充假数字。</Text>
            </View>
          ) : (
            <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <View style={styles.statsHeader}>
                <Text style={[styles.statsTitle, { color: colors.text }]}>最近 7 天 · {stats.totalSearches} 次真实搜索</Text>
                <Text style={[styles.statsMeta, { color: colors.mutedText }]}>按站点统计</Text>
              </View>
              {statsBySource.map((item) => item ? (
                <View key={item.sourceId} style={[styles.statRow, { borderTopColor: colors.line }]}>
                  <View style={styles.statCopy}><Text style={[styles.statName, { color: colors.text }]}>{item.name || item.sourceId}</Text><Text style={[styles.statMeta, { color: colors.mutedText }]}>成功 {item.successCount} · 失败 {item.failureCount} · 超时 {item.timeoutCount}</Text></View>
                  <Text style={[styles.statValue, { color: colors.text }]}>{item.searchCount} 次</Text>
                </View>
              ) : null)}
              {stats.topKeywords.length ? <View style={[styles.keywords, { borderTopColor: colors.line }]}><Text style={[styles.statsMeta, { color: colors.mutedText }]}>Top 关键词：{stats.topKeywords.map((item) => `${item.keyword} ${item.count}`).join(' · ')}</Text></View> : null}
            </View>
          )
        ) : null}

        {tab === 'audit' ? (
          auditLogs.length === 0 ? (
            <View style={[styles.stateCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="clipboard-text-clock-outline" size={26} color={colors.mutedText} />
              <Text style={[styles.stateTitle, { color: colors.text }]}>暂无操作记录</Text>
              <Text style={[styles.stateText, { color: colors.mutedText }]}>站点变更、健康检测与试搜都会记录在这里。</Text>
            </View>
          ) : (
            <View style={[styles.statsCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {auditLogs.map((log, index) => (
                <View key={log.id} style={[styles.auditRow, index > 0 ? { borderTopColor: colors.line } : undefined]}>
                  <View style={[styles.auditIcon, { backgroundColor: '#e7ecff' }]}><MaterialCommunityIcons name={auditIcon(log.action)} size={17} color="#4b6bff" /></View>
                  <View style={styles.statCopy}>
                    <Text style={[styles.statName, { color: colors.text }]}>{auditLabel(log.action)} · {log.operatorName}</Text>
                    <Text style={[styles.statMeta, { color: colors.mutedText }]}>{log.message || log.sourceId || '—'} · {formatTime(log.createdAt)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )
        ) : null}
      </View>

      <EditorModal
        colors={colors}
        desktop={desktop}
        draft={draft}
        editingId={editingId}
        error={error}
        onChange={setDraft}
        onClose={() => setEditorOpen(false)}
        onRunTest={() => void runTest()}
        onSave={() => void saveEditor()}
        saving={saving}
        setError={setError}
        testing={testing}
        testResult={testResult}
        visible={editorOpen}
      />

      <DeleteModal colors={colors} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} source={pendingDelete} />
    </ScrollView>
  );
}

function EditorModal({
  colors, desktop, draft, editingId, error, onChange, onClose, onRunTest, onSave, saving, setError, testing, testResult, visible,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  desktop: boolean;
  draft: EditorDraft;
  editingId: string | null;
  error: string;
  onChange: (value: EditorDraft) => void;
  onClose: () => void;
  onRunTest: () => void;
  onSave: () => void;
  saving: boolean;
  setError: (value: string) => void;
  testing: boolean;
  testResult: ResourceSearchTestResult | null;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.editor, desktop && styles.editorDesktop, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.editorHeader, { borderBottomColor: colors.line }]}>
            <View><Text style={[styles.editorTitle, { color: colors.text }]}>{editingId ? '编辑站点' : '新建站点'}</Text><Text style={[styles.editorSubtitle, { color: colors.mutedText }]}>保存前执行真实健康检测与试搜</Text></View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={[styles.iconButton, { backgroundColor: colors.surfaceMuted }]}><MaterialCommunityIcons name="close" size={20} color={colors.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.editorBody} keyboardShouldPersistTaps="handled">
            <FieldRow>
              <Field label="名称" value={draft.name} onChangeText={(name) => onChange({ ...draft, name })} colors={colors} />
              <Field label="分类" value={draft.category} onChangeText={(category) => onChange({ ...draft, category })} colors={colors} />
            </FieldRow>
            <Field label="简介" value={draft.description} onChangeText={(description) => onChange({ ...draft, description })} colors={colors} />
            <Field label="首页地址" value={draft.homepageUrl} onChangeText={(homepageUrl) => onChange({ ...draft, homepageUrl })} colors={colors} />
            <Field label="搜索地址模板" placeholder="https://example.com/s/{keyword}.html" value={draft.searchUrlTemplate} onChangeText={(searchUrlTemplate) => onChange({ ...draft, searchUrlTemplate })} colors={colors} />
            <FieldRow>
              <Field label="接入模式" value={draft.mode} onChangeText={(mode) => onChange({ ...draft, mode: mode === 'aggregate' ? 'aggregate' : 'direct', adapterKey: mode === 'aggregate' ? 'laoer_sse' : draft.searchUrlTemplate ? 'direct_link' : 'homepage_only' })} colors={colors} />
              <Field label="适配器" value={draft.adapterKey} onChangeText={(adapterKey) => onChange({ ...draft, adapterKey })} colors={colors} />
            </FieldRow>
            <FieldRow>
              <Field label="Logo 文字" value={draft.logoText} onChangeText={(logoText) => onChange({ ...draft, logoText })} colors={colors} />
              <Field label="背景色" value={draft.logoBackground} onChangeText={(logoBackground) => onChange({ ...draft, logoBackground })} colors={colors} />
              <Field label="文字色" value={draft.logoColor} onChangeText={(logoColor) => onChange({ ...draft, logoColor })} colors={colors} />
            </FieldRow>
            <View style={[styles.switchRow, { borderTopColor: colors.line }]}>
              <View><Text style={[styles.fieldLabel, { color: colors.text }]}>默认勾选</Text><Text style={[styles.fieldHint, { color: colors.mutedText }]}>用户端首次进入时默认选中</Text></View>
              <Switch thumbColor="#ffffff" trackColor={{ false: '#d7dbe4', true: '#92a5ff' }} value={draft.defaultSelected} onValueChange={(defaultSelected) => onChange({ ...draft, defaultSelected })} />
            </View>
            <View style={[styles.switchRow, { borderTopColor: colors.line }]}>
              <View><Text style={[styles.fieldLabel, { color: colors.text }]}>启用站点</Text><Text style={[styles.fieldHint, { color: colors.mutedText }]}>停用后用户端不可见</Text></View>
              <Switch thumbColor="#ffffff" trackColor={{ false: '#d7dbe4', true: '#92a5ff' }} value={draft.enabled} onValueChange={(enabled) => onChange({ ...draft, enabled })} />
            </View>
            <FieldRow>
              <Field label="排序" value={draft.sortOrder} onChangeText={(sortOrder) => onChange({ ...draft, sortOrder })} colors={colors} />
              <Field label="最大结果" value={draft.maxResults} onChangeText={(maxResults) => onChange({ ...draft, maxResults })} colors={colors} />
              <Field label="超时(ms)" value={draft.timeoutMs} onChangeText={(timeoutMs) => onChange({ ...draft, timeoutMs })} colors={colors} />
            </FieldRow>
            {editingId ? (
              <View style={[styles.verifyCard, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
                <Text style={[styles.verifyTitle, { color: colors.text }]}>真实试搜验证</Text>
                <View style={[styles.testBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <TextInput
                    accessibilityLabel="试搜关键词"
                    onChangeText={(testQuery) => {
                      onChange({ ...draft, testQuery });
                      setError('');
                    }}
                    placeholder="输入真实关键词"
                    placeholderTextColor={colors.mutedText}
                    style={[styles.testInput, { color: colors.text }]}
                    value={draft.testQuery}
                  />
                  <Pressable accessibilityRole="button" disabled={testing} onPress={onRunTest} style={[styles.testButton, { backgroundColor: colors.primary }]}>
                    {testing ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={styles.testButtonText}>真实试搜</Text>}
                  </Pressable>
                </View>
                {testResult ? (
                  <View style={styles.testResult}>
                    <Text style={[styles.testResultTitle, { color: testResult.status === 'error' || testResult.status === 'timeout' ? '#c0465b' : '#0f8a66' }]}>
                      {testResult.status === 'success' ? `返回 ${testResult.count} 条真实结果 · ${testResult.durationMs}ms` : testResult.status === 'direct' ? '已生成真实原站搜索链接' : testResult.message}
                    </Text>
                    {testResult.results.slice(0, 3).map((item) => <Text key={item.title} numberOfLines={1} style={[styles.testResultItem, { color: colors.mutedText }]}>{item.title}</Text>)}
                  </View>
                ) : null}
              </View>
            ) : null}
            {error ? <Notice icon="alert-circle-outline" tone="#c0465b" text={error} /> : null}
          </ScrollView>
          <View style={[styles.editorFooter, { borderTopColor: colors.line }]}>
            <Pressable accessibilityRole="button" onPress={onClose} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={[styles.secondaryButtonText, { color: colors.text }]}>取消</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={saving} onPress={onSave} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
              {saving ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialCommunityIcons name="shield-check-outline" size={17} color="#ffffff" />}
              <Text style={styles.primaryButtonText}>保存并验证</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DeleteModal({ colors, onCancel, onConfirm, source }: { colors: ReturnType<typeof useAppTheme>['colors']; onCancel: () => void; onConfirm: () => void; source: ResourceSearchSource | null }) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={source !== null}>
      <View style={styles.confirmBackdrop}>
        <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="delete-alert-outline" size={28} color="#c0465b" />
          <Text style={[styles.confirmTitle, { color: colors.text }]}>删除站点</Text>
          <Text style={[styles.confirmBody, { color: colors.mutedText }]}>删除“{source?.name}”后不可恢复；有真实使用记录的站点只能停用。</Text>
          <View style={styles.confirmActions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={[styles.secondaryButtonText, { color: colors.text }]}>取消</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onConfirm} style={[styles.dangerButton, { backgroundColor: '#c0465b' }]}><Text style={styles.primaryButtonText}>确认删除</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ colors, label, onChangeText, placeholder, value }: { colors: ReturnType<typeof useAppTheme>['colors']; label: string; onChangeText: (value: string) => void; placeholder?: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text }]}>{label}</Text>
      <TextInput onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.mutedText} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]} value={value} />
    </View>
  );
}

function FieldRow({ children }: React.PropsWithChildren) {
  return <View style={styles.fieldRow}>{children}</View>;
}

function Metric({ label, tone, value }: { label: string; tone: string; value: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.metricValue, { color: tone }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedText }]}>{label}</Text>
    </View>
  );
}

function ChipGroup({ active, onChange, options }: { active: string; onChange: (value: string) => void; options: readonly string[] }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.chipGroup}>
      {options.map((option) => {
        const selected = option === active;
        return (
          <Pressable key={option} onPress={() => onChange(option)} style={[styles.chip, selected ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <Text style={[styles.chipText, { color: selected ? '#ffffff' : colors.text }]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Badge({ mode }: { mode: ResourceSearchSource['mode'] | 'disabled' }) {
  const values = {
    aggregate: { bg: '#e4f8f0', color: '#0f8a66', label: '聚合' },
    direct: { bg: '#e7ecff', color: '#4b6bff', label: '直达' },
    disabled: { bg: '#eef1f7', color: '#7483a2', label: '停用' },
  };
  const value = values[mode];
  return <View style={[styles.badge, { backgroundColor: value.bg }]}><Text style={[styles.badgeText, { color: value.color }]}>{value.label}</Text></View>;
}

function HealthLine({ health }: { health?: ResourceSearchSource['health'] | null }) {
  const { colors } = useAppTheme();
  if (!health) return <Text style={[styles.sourceMeta, { color: colors.mutedText }]}>未检测</Text>;
  const tone = health.status === 'ok' ? '#1db991' : health.status === 'timeout' || health.status === 'error' ? '#c0465b' : '#e8a33d';
  return <View style={styles.healthLine}><View style={[styles.healthDot, { backgroundColor: tone }]} /><Text style={[styles.sourceMeta, { color: colors.mutedText }]}>{health.message || health.status} · {health.latencyMs}ms</Text></View>;
}

function ActionButton({ icon, label, loading = false, onPress }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; loading?: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.actionButton}>
      {loading ? <ActivityIndicator color={colors.primary} size="small" /> : <MaterialCommunityIcons name={icon} size={15} color={colors.primary} />}
      <Text style={[styles.actionText, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

function Notice({ icon, text, tone }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; text: string; tone: string }) {
  return (
    <View style={[styles.notice, { backgroundColor: `${tone}12`, borderColor: `${tone}44` }]}>
      <MaterialCommunityIcons name={icon} size={18} color={tone} />
      <Text style={[styles.noticeText, { color: tone }]}>{text}</Text>
    </View>
  );
}

function emptyDraft(): EditorDraft {
  return {
    adapterKey: 'homepage_only',
    cacheTtlMs: '120000',
    category: '综合',
    defaultSelected: true,
    description: '',
    enabled: true,
    homepageUrl: '',
    logoBackground: '#e7ecff',
    logoColor: '#4b6bff',
    logoText: '',
    maxResults: '20',
    mode: 'direct',
    name: '',
    searchUrlTemplate: '',
    sortOrder: '0',
    testQuery: '',
    timeoutMs: '12000',
  };
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    health_check: '健康检测',
    health_check_all: '全部检测',
    source_create: '新建站点',
    source_delete: '删除站点',
    source_update: '编辑站点',
    test_search: '试搜验证',
  };
  return labels[action] || action;
}

function auditIcon(action: string): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  const icons: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
    health_check: 'radar',
    health_check_all: 'radar',
    source_create: 'plus-circle-outline',
    source_delete: 'delete-outline',
    source_update: 'pencil-outline',
    test_search: 'flask-outline',
  };
  return icons[action] || 'history';
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  accessBody: { fontSize: 12, lineHeight: 19, marginTop: 6, textAlign: 'center' },
  accessState: { alignItems: 'center', borderRadius: 8, borderWidth: 1, margin: 24, padding: 28 },
  accessTitle: { fontSize: 17, fontWeight: '900', marginTop: 12 },
  actionButton: { alignItems: 'center', flexDirection: 'row', gap: 4, paddingVertical: 4 },
  actionText: { fontSize: 10, fontWeight: '800' },
  auditIcon: { alignItems: 'center', borderRadius: 7, height: 34, justifyContent: 'center', width: 34 },
  auditRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 60, paddingHorizontal: 12 },
  badge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 8, fontWeight: '900' },
  confirmActions: { flexDirection: 'row', gap: 9, justifyContent: 'flex-end', marginTop: 12, width: '100%' },
  confirmBackdrop: { alignItems: 'center', backgroundColor: 'rgba(8, 13, 31, 0.56)', flex: 1, justifyContent: 'center', padding: 20 },
  confirmBody: { fontSize: 12, lineHeight: 19, marginTop: 8, textAlign: 'center' },
  confirmCard: { alignItems: 'center', borderRadius: 8, borderWidth: 1, maxWidth: 420, padding: 24, width: '100%' },
  confirmTitle: { fontSize: 18, fontWeight: '900', marginTop: 10 },
  chip: { alignItems: 'center', borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 34, paddingHorizontal: 11 },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipGroups: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipText: { fontSize: 9, fontWeight: '800' },
  dangerButton: { alignItems: 'center', borderRadius: 7, flex: 1, flexDirection: 'row', gap: 7, height: 42, justifyContent: 'center' },
  editor: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, maxHeight: '92%', maxWidth: 760, paddingBottom: 18, width: '100%' },
  editorBody: { gap: 12, padding: 18 },
  editorDesktop: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  editorFooter: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 9, justifyContent: 'flex-end', paddingHorizontal: 18, paddingTop: 14 },
  editorHeader: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 64, paddingHorizontal: 18 },
  editorSubtitle: { fontSize: 9, marginTop: 3 },
  editorTitle: { fontSize: 17, fontWeight: '900' },
  field: { flex: 1, gap: 5, minWidth: 120 },
  fieldHint: { fontSize: 9, marginTop: 2 },
  fieldLabel: { fontSize: 10, fontWeight: '800' },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  filterButton: { alignItems: 'center', borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 40, paddingHorizontal: 14 },
  filterButtonText: { fontSize: 10, fontWeight: '800' },
  heading: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  headingActions: { flexDirection: 'row', gap: 8 },
  healthDot: { borderRadius: 4, height: 7, marginTop: 4, width: 7 },
  healthLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  iconButton: { alignItems: 'center', borderRadius: 9, height: 36, justifyContent: 'center', width: 36 },
  input: { borderRadius: 7, borderWidth: 1, fontSize: 11, height: 38, paddingHorizontal: 10 },
  keywords: { borderTopWidth: 1, marginTop: 10, padding: 12 },
  logo: { alignItems: 'center', borderRadius: 9, height: 40, justifyContent: 'center', width: 40 },
  logoText: { fontSize: 11, fontWeight: '900' },
  metric: { borderRadius: 8, borderWidth: 1, flex: 1, minWidth: 120, padding: 13 },
  metricLabel: { fontSize: 9, fontWeight: '800', marginTop: 4 },
  metricValue: { fontSize: 22, fontWeight: '900' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricsDesktop: { flexWrap: 'nowrap' },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(8, 13, 31, 0.56)', flex: 1, justifyContent: 'flex-end', paddingTop: 30 },
  notice: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 11 },
  noticeText: { flex: 1, fontSize: 11, fontWeight: '700' },
  page: { alignSelf: 'center', gap: 14, maxWidth: 1240, padding: 18, width: '100%' },
  pageDesktop: { padding: 24 },
  pageSubtitle: { fontSize: 11, marginTop: 4 },
  pageTitle: { fontSize: 21, fontWeight: '900' },
  primaryButton: { alignItems: 'center', borderRadius: 7, flexDirection: 'row', gap: 7, height: 42, justifyContent: 'center', minWidth: 108, paddingHorizontal: 14 },
  primaryButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  rowActions: { alignItems: 'center', flexDirection: 'row', gap: 9, marginTop: 6 },
  scroll: { flexGrow: 1 },
  searchBox: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 8, minHeight: 40, paddingHorizontal: 11 },
  searchInput: { flex: 1, fontSize: 11, minWidth: 0, padding: 0 },
  secondaryButton: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 7, height: 42, justifyContent: 'center', paddingHorizontal: 14 },
  secondaryButtonText: { fontSize: 10, fontWeight: '800' },
  selectBox: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 6, height: 40, paddingHorizontal: 10, position: 'relative' },
  selectMenu: { backgroundColor: '#ffffff', borderRadius: 8, display: 'none', position: 'absolute', right: 0, top: 44, width: 120, zIndex: 20 },
  selectOption: { paddingHorizontal: 10, paddingVertical: 8 },
  selectOptionText: { fontSize: 10, fontWeight: '800' },
  selectText: { fontSize: 10, fontWeight: '800' },
  sourceActions: { alignItems: 'flex-end', gap: 8 },
  sourceCopy: { flex: 1, gap: 4, minWidth: 0 },
  sourceList: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  sourceMeta: { fontSize: 9, fontWeight: '700' },
  sourceName: { fontSize: 13, fontWeight: '900' },
  sourceRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', gap: 12, minHeight: 84, padding: 13 },
  sourceTitleLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  statCopy: { flex: 1, minWidth: 0 },
  statMeta: { fontSize: 9, marginTop: 3 },
  statName: { fontSize: 11, fontWeight: '900' },
  statRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', minHeight: 58, paddingHorizontal: 12 },
  statValue: { fontSize: 14, fontWeight: '900' },
  stateCard: { alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 8, padding: 30 },
  stateText: { fontSize: 11, textAlign: 'center' },
  stateTitle: { fontSize: 15, fontWeight: '900', marginTop: 4 },
  statsCard: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  statsHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 },
  statsMeta: { fontSize: 9, fontWeight: '700' },
  statsTitle: { fontSize: 14, fontWeight: '900' },
  switchRow: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 54 },
  tab: { alignItems: 'center', borderRadius: 7, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 38 },
  tabs: { borderRadius: 9, flexDirection: 'row', gap: 4, padding: 4 },
  tabText: { fontSize: 10, fontWeight: '800' },
  testBox: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 8 },
  testButton: { alignItems: 'center', borderRadius: 6, height: 32, justifyContent: 'center', minWidth: 74, paddingHorizontal: 10 },
  testButtonText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  testInput: { flex: 1, fontSize: 10, height: 36, padding: 0 },
  testResult: { backgroundColor: '#f0faf6', borderRadius: 7, gap: 4, marginTop: 9, padding: 10 },
  testResultItem: { fontSize: 9, fontWeight: '700' },
  testResultTitle: { fontSize: 10, fontWeight: '900' },
  toolbar: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  verifyCard: { borderRadius: 8, borderWidth: 1, padding: 12 },
  verifyTitle: { fontSize: 11, fontWeight: '900', marginBottom: 8 },
});
