import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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

import { AdminIdentityChip } from '@/components/identity-ui';
import { useAuth } from '@/features/auth/auth-provider';
import {
  changeAdminReadingStatus,
  getAdminReadingChapter,
  getReadingErrorMessage,
  listAdminReadingBooks,
  listAdminReadingChapters,
  patchAdminReadingBook,
  syncAdminReadingProvider,
  uploadAdminReadingBook,
  type AdminBookPatch,
  type ChapterContent,
} from '@/lib/reading-api';
import type { ReadingBook, ReadingChapter } from '@/types/reading';

import { IconButton, NovelCover, PrimaryButton, ReadingBrand, ReadingEmpty, ReadingLoading, ReadingPage, readingColors } from './reading-ui';

type EditorState = {
  allowOffline: boolean;
  author: string;
  category: string;
  coverUrl: string;
  intro: string;
  licensor: string;
  proofNote: string;
  scope: string;
  serialStatus: string;
  title: string;
  validFrom: string;
  validUntil: string;
};

const statusFilters = [
  { label: '全部内容', value: '' },
  { label: '草稿', value: 'draft' },
  { label: '已上架', value: 'published' },
  { label: '已下架', value: 'hidden' },
];

export function AdminReadingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const { accessToken, status: authStatus, user } = useAuth();
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [chapters, setChapters] = useState<ReadingChapter[]>([]);
  const [preview, setPreview] = useState<ChapterContent | null>(null);
  const [editor, setEditor] = useState<EditorState>(() => emptyEditor());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingStatus, setPendingStatus] = useState<'publish' | 'hide' | null>(null);

  const selected = books.find((book) => book.id === selectedId) ?? null;

  const loadBooks = useCallback(async (status = filter) => {
    if (!accessToken || user?.role !== 'admin') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const next = await listAdminReadingBooks(accessToken, status);
      setBooks(next);
      setSelectedId((current) => next.some((book) => book.id === current) ? current : next[0]?.id ?? '');
    } catch (loadError) {
      setError(getReadingErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken, filter, user?.role]);

  useEffect(() => { void loadBooks(); }, [loadBooks]);
  useEffect(() => {
    if (!selected || !accessToken) {
      setChapters([]);
      setPreview(null);
      return;
    }
    setEditor(editorFromBook(selected));
    setPreview(null);
    void listAdminReadingChapters(accessToken, selected.id)
      .then(setChapters)
      .catch((loadError) => setError(getReadingErrorMessage(loadError)));
  }, [accessToken, selected]);

  const stats = useMemo(() => ({
    published: books.filter((book) => book.publishStatus === 'published').length,
    drafts: books.filter((book) => book.publishStatus === 'draft').length,
    providers: new Set(books.filter((book) => book.providerKey).map((book) => book.providerKey)).size,
  }), [books]);

  if (authStatus === 'loading') return <ReadingPage><ReadingLoading label="正在验证管理员权限…" /></ReadingPage>;
  if (!accessToken || user?.role !== 'admin') {
    return <ReadingPage><View style={styles.accessTop}><ReadingBrand /><IconButton accessibilityLabel="返回" icon="close" onPress={() => router.back()} /></View><ReadingEmpty icon="shield-lock-outline" title="仅管理员可访问" body="请使用管理员账号登录后再进入内容管理后台。" action={<PrimaryButton icon="login" onPress={() => router.push('/auth')}>登录管理员账号</PrimaryButton>} /></ReadingPage>;
  }

  const adminToken = accessToken;

  async function chooseUpload() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['text/plain', 'application/epub+zip', 'application/octet-stream'] });
    if (result.canceled) return;
    const asset = result.assets[0];
    setBusy(true);
    setError('');
    setNotice(`正在解析 ${asset.name}…`);
    try {
      const imported = await uploadAdminReadingBook(adminToken, { name: asset.name, type: asset.mimeType, uri: asset.uri });
      setNotice(`解析完成：${imported.chapters.length} 章，已保存为草稿。`);
      await loadBooks('');
      setFilter('');
      setSelectedId(imported.book.id);
    } catch (uploadError) {
      setError(getReadingErrorMessage(uploadError));
      setNotice('');
    } finally {
      setBusy(false);
    }
  }

  async function saveBook() {
    if (!selected) return null;
    setBusy(true);
    setError('');
    try {
      const patch: AdminBookPatch = {
        allowOffline: editor.allowOffline,
        author: editor.author,
        category: editor.category,
        coverUrl: editor.coverUrl,
        intro: editor.intro,
        serialStatus: editor.serialStatus,
        title: editor.title,
      };
      if (editor.licensor && editor.scope && editor.proofNote && editor.validFrom && editor.validUntil) {
        patch.rights = {
          licensor: editor.licensor,
          proofNote: editor.proofNote,
          scope: editor.scope,
          validFrom: new Date(editor.validFrom).toISOString(),
          validUntil: new Date(editor.validUntil).toISOString(),
        };
      }
      const updated = await patchAdminReadingBook(adminToken, selected.id, patch);
      setBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
      setNotice('书籍信息和版权资料已保存。');
      return updated;
    } catch (saveError) {
      setError(getReadingErrorMessage(saveError));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: 'publish' | 'hide') {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      if (status === 'publish') {
        const saved = await saveBook();
        if (!saved) return;
      }
      const updated = await changeAdminReadingStatus(adminToken, selected.id, status);
      setBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
      setNotice(status === 'publish' ? '已上架，读者现在可以在书城看到这本书。' : '已下架，正文不再对读者开放。');
    } catch (statusError) {
      setError(getReadingErrorMessage(statusError));
    } finally {
      setBusy(false);
    }
  }

  async function runProviderSync() {
    setBusy(true);
    setError('');
    setNotice('正在同步正版内容目录…');
    try {
      const result = await syncAdminReadingProvider(adminToken, selected?.providerKey || 'mock');
      setNotice(`正版目录同步完成，本次处理 ${result.bookCount} 本。`);
      await loadBooks();
    } catch (syncError) {
      setError(getReadingErrorMessage(syncError));
      setNotice('');
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(chapter: ReadingChapter) {
    if (!selected) return;
    setBusy(true);
    try {
      setPreview(await getAdminReadingChapter(adminToken, selected.id, chapter.id));
    } catch (previewError) {
      setError(getReadingErrorMessage(previewError));
    } finally {
      setBusy(false);
    }
  }

  function confirmStatus(status: 'publish' | 'hide') {
    setPendingStatus(status);
  }

  function applyPendingStatus() {
    if (!pendingStatus) return;
    const status = pendingStatus;
    setPendingStatus(null);
    void changeStatus(status);
  }

  return (
    <ReadingPage style={styles.adminPage}>
      <View style={styles.adminFrame}>
        {!compact ? <AdminSidebar onBack={() => router.back()} /> : null}
        <View style={styles.workspace}>
          <View style={styles.workspaceTop}>
            {compact ? <ReadingBrand compact /> : <View><Text style={styles.breadcrumb}>工作台 / 内容管理</Text><Text style={styles.workspaceTitle}>内容管理</Text></View>}
            <View style={styles.headerActions}>{!compact && user ? <AdminIdentityChip username={user.username} /> : null}<PrimaryButton secondary icon="sync" disabled={busy} onPress={() => void runProviderSync()}>同步正版 API</PrimaryButton><PrimaryButton icon="upload-outline" disabled={busy} onPress={() => void chooseUpload()}>上传新书</PrimaryButton>{compact ? <IconButton accessibilityLabel="关闭后台" icon="close" onPress={() => router.back()} /> : null}</View>
          </View>
          <ScrollView contentContainerStyle={styles.workspaceScroll}>
            <View style={styles.pageHeading}><View><Text style={styles.pageTitle}>内容概览</Text><Text style={styles.pageSubtitle}>上传、审核与发布免费阅读内容</Text></View><Text style={styles.updatedAt}>数据库实时状态</Text></View>

            <View style={styles.statsGrid}>
              <StatCard icon="book-check-outline" label="当前列表" value={books.length} note="本筛选范围" color={readingColors.blue} />
              <StatCard icon="file-document-edit-outline" label="待审核" value={stats.drafts} note="需要版权资料" color="#d4972e" />
              <StatCard icon="book-open-page-variant-outline" label="已上架" value={stats.published} note="授权期内可读" color={readingColors.green} />
              <StatCard icon="api" label="内容源" value={Math.max(1, stats.providers)} note="正版 API + 上传" color="#7a55c7" />
            </View>

            {notice ? <View style={styles.notice}><MaterialCommunityIcons name="check-circle-outline" size={18} color={readingColors.green} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
            {error ? <Pressable onPress={() => setError('')} style={styles.error}><MaterialCommunityIcons name="alert-circle-outline" size={18} color="#b23d4b" /><Text style={styles.errorText}>{error}</Text><MaterialCommunityIcons name="close" size={16} color="#b23d4b" /></Pressable> : null}

            <View style={styles.filterRow}>{statusFilters.map((item) => <Pressable key={item.value || 'all'} onPress={() => { setFilter(item.value); void loadBooks(item.value); }} style={[styles.filterTab, filter === item.value && styles.filterTabActive]}><Text style={[styles.filterText, filter === item.value && styles.filterTextActive]}>{item.label}</Text></Pressable>)}</View>

            <View style={[styles.managementGrid, compact && styles.managementGridCompact]}>
              <View style={styles.libraryPanel}>
                <View style={styles.panelHeader}><View><Text style={styles.panelTitle}>书库列表</Text><Text style={styles.panelMeta}>点击一项进入审核</Text></View><MaterialCommunityIcons name="filter-variant" size={20} color={readingColors.muted} /></View>
                {loading ? <ReadingLoading /> : books.length === 0 ? <ReadingEmpty icon="book-plus-outline" title="当前没有内容" body="上传 TXT/EPUB，或同步已经配置的正版内容 API。" action={<PrimaryButton icon="upload-outline" onPress={() => void chooseUpload()}>上传新书</PrimaryButton>} /> : <ScrollView style={styles.bookList}>{books.map((book) => <Pressable key={book.id} onPress={() => setSelectedId(book.id)} style={[styles.bookRow, selectedId === book.id && styles.bookRowSelected]}><NovelCover book={book} compact /><View style={styles.bookRowCopy}><View style={styles.bookRowTitleLine}><Text numberOfLines={1} style={styles.bookRowTitle}>{book.title}</Text><StatusBadge status={book.publishStatus} /></View><Text style={styles.bookRowMeta}>{book.author} · {book.sourceType === 'provider' ? `正版 API / ${book.providerKey}` : '管理员上传'}</Text><Text style={styles.bookRowMeta}>{book.chapterCount} 章 · {book.category || '未分类'}</Text></View><MaterialCommunityIcons name="chevron-right" size={20} color={readingColors.muted} /></Pressable>)}</ScrollView>}
              </View>

              <View style={styles.editorPanel}>
                {selected ? <>
                  <View style={styles.panelHeader}><View><Text style={styles.panelTitle}>审核与发布</Text><Text style={styles.panelMeta}>{selected.sourceType === 'provider' ? '正版 API 内容' : '管理员上传内容'}</Text></View><StatusBadge status={selected.publishStatus} /></View>
                  <ScrollView contentContainerStyle={styles.editorScroll} keyboardShouldPersistTaps="handled">
                    <EditorSection icon="book-edit-outline" title="基本信息">
                      <Field label="书名" value={editor.title} onChangeText={(title) => setEditor((value) => ({ ...value, title }))} />
                      <Field label="作者" value={editor.author} onChangeText={(author) => setEditor((value) => ({ ...value, author }))} />
                      <View style={styles.twoColumns}><Field compact label="分类" value={editor.category} onChangeText={(category) => setEditor((value) => ({ ...value, category }))} /><Field compact label="连载状态" value={editor.serialStatus} onChangeText={(serialStatus) => setEditor((value) => ({ ...value, serialStatus }))} /></View>
                      <Field label="简介" multiline value={editor.intro} onChangeText={(intro) => setEditor((value) => ({ ...value, intro }))} />
                      <View style={styles.switchRow}><View><Text style={styles.fieldLabel}>允许离线缓存</Text><Text style={styles.fieldHint}>只适用于管理员上传且已获得对应授权的内容</Text></View><Switch onValueChange={(allowOffline) => setEditor((value) => ({ ...value, allowOffline }))} thumbColor="#fff" trackColor={{ false: '#d7dbe4', true: '#92a5ff' }} value={editor.allowOffline} /></View>
                    </EditorSection>
                    <EditorSection icon="shield-check-outline" title="版权与授权">
                      <Field label="授权方 / 版权方" placeholder="例如：星河版权中心" value={editor.licensor} onChangeText={(licensor) => setEditor((value) => ({ ...value, licensor }))} />
                      <Field label="授权范围" placeholder="免费在线阅读、地域、终端范围" value={editor.scope} onChangeText={(scope) => setEditor((value) => ({ ...value, scope }))} />
                      <Field label="凭证编号或说明" placeholder="合同编号、工单或归档位置" value={editor.proofNote} onChangeText={(proofNote) => setEditor((value) => ({ ...value, proofNote }))} />
                      <View style={styles.twoColumns}><Field compact label="生效日期" placeholder="2026-01-01" value={editor.validFrom} onChangeText={(validFrom) => setEditor((value) => ({ ...value, validFrom }))} /><Field compact label="截止日期" placeholder="2027-12-31" value={editor.validUntil} onChangeText={(validUntil) => setEditor((value) => ({ ...value, validUntil }))} /></View>
                    </EditorSection>
                    <EditorSection icon="format-list-numbered" title={`章节预览 · ${chapters.length} 章`}>
                      <View style={styles.chapterAdminList}>{chapters.slice(0, 20).map((chapter) => <Pressable key={chapter.id} onPress={() => void openPreview(chapter)} style={[styles.chapterAdminRow, preview?.chapterId === chapter.id && styles.chapterAdminRowActive]}><Text style={styles.chapterNumber}>{chapter.sortOrder}</Text><Text numberOfLines={1} style={styles.chapterAdminTitle}>{chapter.title}</Text><MaterialCommunityIcons name="eye-outline" size={17} color={readingColors.blue} /></Pressable>)}</View>
                      {preview ? <View style={styles.previewBox}><Text style={styles.previewTitle}>{preview.title}</Text><Text numberOfLines={8} style={styles.previewBody}>{preview.content}</Text></View> : null}
                    </EditorSection>
                  </ScrollView>
                  <View style={styles.editorFooter}><PrimaryButton secondary disabled={busy} icon="content-save-outline" onPress={() => void saveBook()}>保存草稿</PrimaryButton>{selected.publishStatus === 'published' ? <PrimaryButton disabled={busy} icon="eye-off-outline" onPress={() => confirmStatus('hide')}>下架</PrimaryButton> : <PrimaryButton disabled={busy} icon="publish" onPress={() => confirmStatus('publish')}>确认上架</PrimaryButton>}</View>
                </> : <ReadingEmpty icon="cursor-default-click-outline" title="选择一本书" body="从左侧书库选择内容，开始审核元数据、版权资料与章节。" />}
              </View>
            </View>
            <View style={styles.compliance}><MaterialCommunityIcons name="shield-check-outline" size={18} color={readingColors.green} /><Text style={styles.complianceText}>所有内容都必须有明确授权，发布、下架和资料修改会记录管理员审计日志。</Text></View>
          </ScrollView>
        </View>
      </View>
      <Modal animationType="fade" onRequestClose={() => setPendingStatus(null)} transparent visible={pendingStatus !== null}>
        <View style={styles.confirmBackdrop}>
          <View accessibilityLabel={pendingStatus === 'publish' ? '确认上架图书' : '确认下架图书'} accessibilityRole="alert" style={styles.confirmDialog}>
            <View style={styles.confirmIcon}>
              <MaterialCommunityIcons name={pendingStatus === 'publish' ? 'publish' : 'eye-off-outline'} size={24} color={readingColors.blue} />
            </View>
            <Text style={styles.confirmTitle}>{pendingStatus === 'publish' ? '确认上架' : '确认下架'}</Text>
            <Text style={styles.confirmBody}>{pendingStatus === 'publish' ? '上架后，读者可立即阅读有效授权期内的正文。' : '下架后，正在阅读的用户也无法继续获取正文。'}</Text>
            <View style={styles.confirmActions}>
              <PrimaryButton secondary onPress={() => setPendingStatus(null)}>取消</PrimaryButton>
              <PrimaryButton icon={pendingStatus === 'publish' ? 'publish' : 'eye-off-outline'} onPress={applyPendingStatus}>{pendingStatus === 'publish' ? '确认上架' : '确认下架'}</PrimaryButton>
            </View>
          </View>
        </View>
      </Modal>
    </ReadingPage>
  );
}

function AdminSidebar({ onBack }: { onBack: () => void }) {
  const items = [
    { icon: 'view-dashboard-outline' as const, label: '概览' },
    { icon: 'book-open-page-variant-outline' as const, label: '内容管理', active: true },
    { icon: 'api' as const, label: '供应商 API' },
    { icon: 'shield-check-outline' as const, label: '审核任务' },
    { icon: 'account-key-outline' as const, label: '用户与权限' },
    { icon: 'chart-line' as const, label: '阅读数据' },
    { icon: 'cog-outline' as const, label: '系统设置' },
  ];
  return <View style={styles.sidebar}><ReadingBrand compact inverse /><Text style={styles.sidebarGroup}>工作台</Text>{items.slice(0, 4).map((item) => <View key={item.label} style={[styles.sidebarItem, item.active && styles.sidebarItemActive]}><MaterialCommunityIcons name={item.icon} size={19} color={item.active ? '#fff' : '#929bb4'} /><Text style={[styles.sidebarLabel, item.active && styles.sidebarLabelActive]}>{item.label}</Text></View>)}<Text style={styles.sidebarGroup}>系统</Text>{items.slice(4).map((item) => <View key={item.label} style={styles.sidebarItem}><MaterialCommunityIcons name={item.icon} size={19} color="#929bb4" /><Text style={styles.sidebarLabel}>{item.label}</Text></View>)}<Pressable onPress={onBack} style={styles.sidebarBack}><MaterialCommunityIcons name="arrow-left" size={18} color="#a9b1c7" /><Text style={styles.sidebarLabel}>返回 Funbox</Text></Pressable></View>;
}

function StatCard({ color, icon, label, note, value }: { color: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; note: string; value: number }) { return <View style={styles.statCard}><View style={[styles.statIcon, { backgroundColor: `${color}14` }]}><MaterialCommunityIcons name={icon} size={21} color={color} /></View><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text><Text style={[styles.statNote, { color }]}>{note}</Text></View>; }
function StatusBadge({ status }: { status?: ReadingBook['publishStatus'] }) { const labels = { draft: '待审核', hidden: '已下架', published: '已上架', removed: '已移除' }; const colors = { draft: '#a96f12', hidden: '#b44655', published: readingColors.green, removed: readingColors.muted }; const value = status ?? 'draft'; return <View style={[styles.statusBadge, { backgroundColor: `${colors[value]}16` }]}><View style={[styles.statusDot, { backgroundColor: colors[value] }]} /><Text style={[styles.statusText, { color: colors[value] }]}>{labels[value]}</Text></View>; }
function EditorSection({ children, icon, title }: React.PropsWithChildren<{ icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; title: string }>) { return <View style={styles.editorSection}><View style={styles.editorSectionTitle}><MaterialCommunityIcons name={icon} size={18} color={readingColors.blue} /><Text style={styles.editorSectionText}>{title}</Text></View>{children}</View>; }
function Field({ compact, label, multiline, onChangeText, placeholder, value }: { compact?: boolean; label: string; multiline?: boolean; onChangeText: (value: string) => void; placeholder?: string; value: string }) { return <View style={[styles.field, compact && styles.fieldCompact]}><Text style={styles.fieldLabel}>{label}</Text><TextInput multiline={multiline} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#a2a9b8" style={[styles.input, multiline && styles.inputMultiline]} textAlignVertical={multiline ? 'top' : 'center'} value={value} /></View>; }

function emptyEditor(): EditorState { return { allowOffline: false, author: '', category: '', coverUrl: '', intro: '', licensor: '', proofNote: '', scope: '', serialStatus: 'serializing', title: '', validFrom: '', validUntil: '' }; }
function editorFromBook(book: ReadingBook): EditorState { return { allowOffline: book.allowOffline, author: book.author, category: book.category, coverUrl: book.coverUrl, intro: book.intro, licensor: book.rights?.licensor ?? '', proofNote: book.rights?.proofNote ?? '', scope: book.rights?.scope ?? '', serialStatus: book.serialStatus, title: book.title, validFrom: datePart(book.rights?.validFrom), validUntil: datePart(book.rights?.validUntil) }; }
function datePart(value?: string) { return value ? value.slice(0, 10) : ''; }

const styles = StyleSheet.create({
  accessTop: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  adminFrame: { flex: 1, flexDirection: 'row' },
  adminPage: { backgroundColor: '#f3f5fa' },
  bookList: { maxHeight: 680 },
  bookRow: { alignItems: 'center', borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 11, padding: 12 },
  bookRowCopy: { flex: 1, gap: 4, minWidth: 0 },
  bookRowMeta: { color: readingColors.muted, fontSize: 10 },
  bookRowSelected: { backgroundColor: readingColors.blueSoft },
  bookRowTitle: { color: readingColors.ink, flex: 1, fontSize: 13, fontWeight: '900' },
  bookRowTitleLine: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  breadcrumb: { color: readingColors.muted, fontSize: 9, fontWeight: '700' },
  chapterAdminList: { borderColor: readingColors.line, borderRadius: 6, borderWidth: 1, overflow: 'hidden' },
  chapterAdminRow: { alignItems: 'center', borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 9, minHeight: 42, paddingHorizontal: 10 },
  chapterAdminRowActive: { backgroundColor: readingColors.blueSoft },
  chapterAdminTitle: { color: readingColors.ink, flex: 1, fontSize: 11 },
  chapterNumber: { color: readingColors.muted, fontSize: 9, fontWeight: '900', width: 22 },
  compliance: { alignItems: 'center', borderTopColor: readingColors.line, borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 16 },
  complianceText: { color: readingColors.muted, flex: 1, fontSize: 10 },
  confirmActions: { flexDirection: 'row', gap: 9, justifyContent: 'flex-end', marginTop: 8 },
  confirmBackdrop: { alignItems: 'center', backgroundColor: 'rgba(8, 13, 31, 0.56)', flex: 1, justifyContent: 'center', padding: 20 },
  confirmBody: { color: readingColors.muted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  confirmDialog: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, gap: 10, maxWidth: 420, padding: 24, width: '100%' },
  confirmIcon: { alignItems: 'center', backgroundColor: readingColors.blueSoft, borderRadius: 7, height: 48, justifyContent: 'center', width: 48 },
  confirmTitle: { color: readingColors.ink, fontSize: 18, fontWeight: '900' },
  editorFooter: { alignItems: 'center', borderTopColor: readingColors.line, borderTopWidth: 1, flexDirection: 'row', gap: 9, justifyContent: 'flex-end', padding: 14 },
  editorPanel: { backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 8, borderWidth: 1, flex: 1, minWidth: 0, overflow: 'hidden' },
  editorScroll: { gap: 18, padding: 16 },
  editorSection: { gap: 11 },
  editorSectionText: { color: readingColors.ink, fontSize: 13, fontWeight: '900' },
  editorSectionTitle: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  error: { alignItems: 'center', backgroundColor: '#fff0f2', borderColor: '#f4c6cc', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 11 },
  errorText: { color: '#a33342', flex: 1, fontSize: 11 },
  field: { gap: 5, width: '100%' },
  fieldCompact: { flex: 1 },
  fieldHint: { color: readingColors.muted, fontSize: 9, marginTop: 2 },
  fieldLabel: { color: '#505a72', fontSize: 10, fontWeight: '800' },
  filterRow: { borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 4 },
  filterTab: { borderBottomColor: 'transparent', borderBottomWidth: 2, paddingHorizontal: 14, paddingVertical: 10 },
  filterTabActive: { borderBottomColor: readingColors.blue },
  filterText: { color: readingColors.muted, fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: readingColors.blue, fontWeight: '900' },
  headerActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  input: { backgroundColor: '#fbfcfe', borderColor: readingColors.line, borderRadius: 6, borderWidth: 1, color: readingColors.ink, fontSize: 12, minHeight: 38, outlineStyle: 'none', paddingHorizontal: 10 } as never,
  inputMultiline: { lineHeight: 18, minHeight: 76, paddingTop: 9 },
  libraryPanel: { backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 8, borderWidth: 1, overflow: 'hidden', width: 400 },
  managementGrid: { alignItems: 'flex-start', flexDirection: 'row', gap: 14 },
  managementGridCompact: { flexDirection: 'column' },
  notice: { alignItems: 'center', backgroundColor: '#edf9f5', borderColor: '#c8eadf', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 11 },
  noticeText: { color: '#18785d', flex: 1, fontSize: 11 },
  pageHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  pageSubtitle: { color: readingColors.muted, fontSize: 11, marginTop: 3 },
  pageTitle: { color: readingColors.ink, fontSize: 21, fontWeight: '900' },
  panelHeader: { alignItems: 'center', borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 62, paddingHorizontal: 15 },
  panelMeta: { color: readingColors.muted, fontSize: 9, marginTop: 3 },
  panelTitle: { color: readingColors.ink, fontSize: 14, fontWeight: '900' },
  previewBody: { color: '#59627a', fontFamily: 'serif', fontSize: 12, lineHeight: 20 },
  previewBox: { backgroundColor: '#f8f5ed', borderColor: '#e2d9c8', borderRadius: 6, borderWidth: 1, gap: 7, padding: 12 },
  previewTitle: { color: readingColors.ink, fontSize: 13, fontWeight: '900' },
  sidebar: { backgroundColor: '#141d3d', gap: 5, paddingHorizontal: 14, paddingVertical: 18, width: 210 },
  sidebarBack: { alignItems: 'center', borderTopColor: '#2b3558', borderTopWidth: 1, flexDirection: 'row', gap: 10, marginTop: 'auto', paddingHorizontal: 10, paddingTop: 14 },
  sidebarGroup: { color: '#626d8b', fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4, marginTop: 20, paddingHorizontal: 10 },
  sidebarItem: { alignItems: 'center', borderRadius: 6, flexDirection: 'row', gap: 10, minHeight: 42, paddingHorizontal: 10 },
  sidebarItemActive: { backgroundColor: '#4055bb' },
  sidebarLabel: { color: '#a9b1c7', fontSize: 11, fontWeight: '700' },
  sidebarLabelActive: { color: '#fff', fontWeight: '900' },
  statCard: { backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 7, borderWidth: 1, flex: 1, minWidth: 145, padding: 14 },
  statIcon: { alignItems: 'center', borderRadius: 6, height: 36, justifyContent: 'center', marginBottom: 12, width: 36 },
  statLabel: { color: readingColors.muted, fontSize: 10, fontWeight: '700' },
  statNote: { fontSize: 9, fontWeight: '800', marginTop: 5 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statValue: { color: readingColors.ink, fontSize: 24, fontWeight: '900', marginTop: 3 },
  statusBadge: { alignItems: 'center', borderRadius: 5, flexDirection: 'row', gap: 4, paddingHorizontal: 7, paddingVertical: 5 },
  statusDot: { borderRadius: 3, height: 5, width: 5 },
  statusText: { fontSize: 8, fontWeight: '900' },
  switchRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  twoColumns: { flexDirection: 'row', gap: 10 },
  updatedAt: { color: readingColors.green, fontSize: 9, fontWeight: '800' },
  workspace: { flex: 1, minWidth: 0 },
  workspaceScroll: { alignSelf: 'center', gap: 16, maxWidth: 1180, padding: 22, width: '100%' },
  workspaceTitle: { color: readingColors.ink, fontSize: 17, fontWeight: '900', marginTop: 2 },
  workspaceTop: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 70, paddingHorizontal: 22, paddingVertical: 10 },
});
