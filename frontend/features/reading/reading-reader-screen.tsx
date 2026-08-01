import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useAuth } from '@/features/auth/auth-provider';
import {
  createReadingBookmark,
  deleteReadingBookmark,
  getReadingBook,
  getReadingChapter,
  getReadingErrorMessage,
  listReadingBookmarks,
  listReadingChapters,
  saveReadingProgress,
  type ChapterContent,
} from '@/lib/reading-api';
import {
  createLocalBookmark,
  deleteLocalBookmark,
  getLocalReadingBook,
  getReaderSettings,
  listLocalBookmarks,
  saveLocalReadingProgress,
  saveReaderSettings,
} from '@/lib/reading-local-storage';
import { clampChapterProgress, createReaderSettings, readerSettingsReducer, type ReaderSettings, type ReaderTheme } from '@/lib/reading-state';
import type { ReadingBook, ReadingBookmark, ReadingChapter } from '@/types/reading';

import { ReadingLoading, readingColors } from './reading-ui';

const readerThemes: Record<ReaderTheme, { background: string; text: string; muted: string; surface: string; line: string }> = {
  night: { background: '#17191d', line: '#30343a', muted: '#8f959d', surface: '#202328', text: '#d7d5cf' },
  paper: { background: '#f7f2e7', line: '#dfd6c5', muted: '#817a6d', surface: '#fffaf0', text: '#27231d' },
  sepia: { background: '#eee0c3', line: '#d5c29f', muted: '#7d6e57', surface: '#f8eace', text: '#3c3024' },
  white: { background: '#ffffff', line: '#e4e5e8', muted: '#7a808a', surface: '#f8f9fb', text: '#20232b' },
};

export function ReadingReaderScreen() {
  const { bookId = '', chapterId = '' } = useLocalSearchParams<{ bookId: string; chapterId: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const { accessToken } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollDone = useRef(false);
  const latestProgress = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const [book, setBook] = useState<ReadingBook | null>(null);
  const [chapters, setChapters] = useState<ReadingChapter[]>([]);
  const [chapter, setChapter] = useState<ChapterContent | null>(null);
  const [bookmarks, setBookmarks] = useState<ReadingBookmark[]>([]);
  const [settings, dispatchSettings] = useReducer(readerSettingsReducer, createReaderSettings());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [panel, setPanel] = useState<'catalog' | 'settings' | null>(null);

  const local = bookId.startsWith('local-');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    initialScrollDone.current = false;
    try {
      const nextSettings = await getReaderSettings();
	  dispatchSettings({ type: 'set-font-size', fontSize: nextSettings.fontSize });
      dispatchSettings({ type: 'set-theme', theme: nextSettings.theme });
      dispatchSettings({ type: 'set-line-height', lineHeight: nextSettings.lineHeight });
      dispatchSettings({ type: 'set-text-width', textWidth: nextSettings.textWidth });

      if (local) {
        const localBook = await getLocalReadingBook(bookId);
        const localChapter = localBook?.chapters.find((item) => item.id === chapterId);
        if (!localBook || !localChapter?.content) throw new Error('本地章节不存在');
        const index = localBook.chapters.findIndex((item) => item.id === chapterId);
        setBook(localBook);
        setChapters(localBook.chapters);
        setChapter({
          bookId,
          chapterId,
          content: localChapter.content,
          nextId: localBook.chapters[index + 1]?.id,
          previousId: localBook.chapters[index - 1]?.id,
          sortOrder: localChapter.sortOrder,
          sourceType: 'admin',
          title: localChapter.title,
          wordCount: localChapter.wordCount,
        });
        setBookmarks(await listLocalBookmarks(bookId));
        latestProgress.current = localBook.progress?.chapterId === chapterId ? localBook.progress.chapterProgress : 0;
      } else {
        const [nextBook, nextChapters, nextChapter, nextBookmarks] = await Promise.all([
          getReadingBook(bookId, accessToken),
          listReadingChapters(bookId, accessToken),
          getReadingChapter(bookId, chapterId, accessToken),
          accessToken ? listReadingBookmarks(accessToken, bookId) : Promise.resolve([]),
        ]);
        setBook(nextBook);
        setChapters(nextChapters);
        setChapter(nextChapter);
        setBookmarks(nextBookmarks);
        latestProgress.current = nextBook.progress?.chapterId === chapterId ? nextBook.progress.chapterProgress : 0;
      }
    } catch (loadError) {
      setError(getReadingErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken, bookId, chapterId, local]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persistProgress(latestProgress.current);
  }, [accessToken, bookId, chapter, chapterId, local]);

  const theme = readerThemes[settings.theme];
  const paragraphs = useMemo(() => chapter?.content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean) ?? [], [chapter?.content]);

  async function persistProgress(progress: number) {
    if (!chapter) return;
    const value = { chapterId, chapterProgress: clampChapterProgress(progress), updatedAt: new Date().toISOString() };
    try {
      if (local) await saveLocalReadingProgress(bookId, value);
      else if (accessToken) await saveReadingProgress(accessToken, bookId, value);
      else setError('登录状态已失效，阅读进度暂未同步。');
    } catch {
      setError('阅读进度暂未同步，将在后续翻章或滚动时重试。');
    }
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const denominator = Math.max(1, contentSize.height - layoutMeasurement.height);
    latestProgress.current = clampChapterProgress(contentOffset.y / denominator);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistProgress(latestProgress.current), 850);
  }

  function onContentSizeChange(_: number, height: number) {
    contentHeight.current = height;
    if (initialScrollDone.current || latestProgress.current <= 0 || viewportHeight.current <= 0) return;
    initialScrollDone.current = true;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y: latestProgress.current * Math.max(0, height - viewportHeight.current) }));
  }

  async function navigateChapter(nextChapterId?: string) {
    if (!nextChapterId) return;
    await persistProgress(latestProgress.current);
    setPanel(null);
    router.replace(`/reading/books/${bookId}/chapters/${nextChapterId}` as Href);
  }

  async function addBookmark() {
    if (!chapter) return;
    if (!local && !accessToken) {
      setError('登录后可同步在线图书的书签。');
      setControlsVisible(true);
      return;
    }
    try {
      const value = { bookId, chapterId, note: chapter.title, position: latestProgress.current };
      if (local) await createLocalBookmark(value);
      else if (accessToken) await createReadingBookmark(accessToken, value);
      setBookmarks(local ? await listLocalBookmarks(bookId) : await listReadingBookmarks(accessToken!, bookId));
    } catch (requestError) {
      setError(getReadingErrorMessage(requestError));
    }
  }

  async function removeBookmark(bookmark: ReadingBookmark) {
    if (local) await deleteLocalBookmark(bookmark.id);
    else if (accessToken) await deleteReadingBookmark(accessToken, bookmark.id);
    setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
  }

  function changeSettings(action: Parameters<typeof readerSettingsReducer>[1]) {
    const next = readerSettingsReducer(settings, action);
    dispatchSettings(action);
    void saveReaderSettings(next);
  }

  if (loading) return <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}><ReadingLoading label="正在翻开这一章…" /></SafeAreaView>;

  if (!chapter || !book) {
    return <SafeAreaView style={[styles.page, styles.center, { backgroundColor: theme.background }]}><MaterialCommunityIcons name="book-alert-outline" size={40} color={theme.muted} /><Text style={[styles.errorTitle, { color: theme.text }]}>章节无法打开</Text><Text style={[styles.errorBody, { color: theme.muted }]}>{error}</Text><Pressable onPress={() => router.back()} style={styles.returnButton}><Text style={styles.returnText}>返回目录</Text></Pressable></SafeAreaView>;
  }

  const progressPercent = Math.round(latestProgress.current * 100);

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
      <StatusBar hidden={!controlsVisible} style={settings.theme === 'night' ? 'light' : 'dark'} />
      {controlsVisible ? (
        <View style={[styles.toolbar, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
          <Pressable accessibilityLabel="返回图书详情" onPress={() => router.back()} style={styles.toolbarButton}><MaterialCommunityIcons name="chevron-left" size={28} color={theme.text} /></Pressable>
          <View style={styles.toolbarTitleWrap}><Text numberOfLines={1} style={[styles.toolbarBook, { color: theme.muted }]}>{book.title}</Text><Text numberOfLines={1} style={[styles.toolbarChapter, { color: theme.text }]}>{chapter.title}</Text></View>
          <Pressable accessibilityLabel="更多阅读设置" onPress={() => setPanel('settings')} style={styles.toolbarButton}><MaterialCommunityIcons name="dots-horizontal" size={24} color={theme.text} /></Pressable>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={onContentSizeChange}
        onLayout={(event) => { viewportHeight.current = event.nativeEvent.layout.height; }}
        onScroll={onScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => setControlsVisible((visible) => !visible)} style={[styles.readerColumn, { maxWidth: compact ? undefined : settings.textWidth }]}>
          <Text style={[styles.chapterKicker, { color: theme.muted }]}>第 {chapter.sortOrder} 章</Text>
          <Text style={[styles.chapterHeading, { color: theme.text }]}>{chapter.title}</Text>
          <View style={[styles.headingRule, { backgroundColor: theme.line }]} />
          {paragraphs.map((paragraph, index) => (
            <Text key={`${index}-${paragraph.slice(0, 12)}`} style={[styles.paragraph, { color: theme.text, fontSize: settings.fontSize, lineHeight: settings.fontSize * settings.lineHeight }]}>{paragraph}</Text>
          ))}
          <View style={[styles.chapterEnd, { borderTopColor: theme.line }]}><Text style={[styles.chapterEndText, { color: theme.muted }]}>本章完</Text></View>
          <View style={styles.chapterNavigation}>
            <Pressable disabled={!chapter.previousId} onPress={() => void navigateChapter(chapter.previousId)} style={[styles.chapterNavButton, { backgroundColor: theme.surface, borderColor: theme.line }, !chapter.previousId && styles.disabled]}><MaterialCommunityIcons name="arrow-left" size={18} color={theme.text} /><Text style={[styles.chapterNavText, { color: theme.text }]}>上一章</Text></Pressable>
            <Pressable disabled={!chapter.nextId} onPress={() => void navigateChapter(chapter.nextId)} style={[styles.chapterNavButton, { backgroundColor: theme.surface, borderColor: theme.line }, !chapter.nextId && styles.disabled]}><Text style={[styles.chapterNavText, { color: theme.text }]}>下一章</Text><MaterialCommunityIcons name="arrow-right" size={18} color={theme.text} /></Pressable>
          </View>
        </Pressable>
      </ScrollView>

      {controlsVisible ? (
        <View style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.line }]}>
          <ReaderAction icon="format-list-bulleted" label="目录" color={theme.text} onPress={() => setPanel('catalog')} />
          <ReaderAction icon="format-size" label="字号" color={theme.text} onPress={() => setPanel('settings')} />
          <ReaderAction icon="theme-light-dark" label="主题" color={theme.text} onPress={() => changeSettings({ type: 'set-theme', theme: nextTheme(settings.theme) })} />
          <ReaderAction icon="bookmark-outline" label="书签" color={theme.text} onPress={() => void addBookmark()} />
          <View style={[styles.bottomProgress, { backgroundColor: theme.line }]}><View style={[styles.bottomProgressValue, { width: `${progressPercent}%` }]} /></View>
        </View>
      ) : null}

      {error ? <Pressable onPress={() => setError('')} style={styles.toast}><MaterialCommunityIcons name="alert-circle-outline" size={17} color="#fff" /><Text style={styles.toastText}>{error}</Text></Pressable> : null}

      <Modal animationType="slide" onRequestClose={() => setPanel(null)} transparent visible={panel !== null}>
        <Pressable onPress={() => setPanel(null)} style={styles.backdrop}>
          <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <View style={styles.sheetHandle} />
            {panel === 'catalog' ? (
              <CatalogPanel bookmarks={bookmarks} chapters={chapters} currentChapterId={chapterId} onDeleteBookmark={(bookmark) => void removeBookmark(bookmark)} onSelect={(id) => void navigateChapter(id)} theme={theme} />
            ) : (
              <SettingsPanel settings={settings} theme={theme} onChange={changeSettings} />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function ReaderAction({ color, icon, label, onPress }: { color: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.readerAction}><MaterialCommunityIcons name={icon} size={22} color={color} /><Text style={[styles.readerActionText, { color }]}>{label}</Text></Pressable>;
}

function CatalogPanel({ bookmarks, chapters, currentChapterId, onDeleteBookmark, onSelect, theme }: {
  bookmarks: ReadingBookmark[];
  chapters: ReadingChapter[];
  currentChapterId: string;
  onDeleteBookmark: (bookmark: ReadingBookmark) => void;
  onSelect: (id: string) => void;
  theme: (typeof readerThemes)[ReaderTheme];
}) {
  return <View style={styles.panelContent}><View style={styles.panelHeading}><View><Text style={[styles.panelTitle, { color: theme.text }]}>目录与书签</Text><Text style={[styles.panelSubtitle, { color: theme.muted }]}>{chapters.length} 章 · {bookmarks.length} 个书签</Text></View></View>{bookmarks.length ? <View style={styles.bookmarkStrip}>{bookmarks.slice(0, 4).map((bookmark) => <Pressable key={bookmark.id} onPress={() => onSelect(bookmark.chapterId)} style={[styles.bookmarkChip, { borderColor: theme.line }]}><MaterialCommunityIcons name="bookmark" size={14} color={readingColors.coral} /><Text numberOfLines={1} style={[styles.bookmarkChipText, { color: theme.text }]}>{Math.round(bookmark.position * 100)}%</Text><Pressable accessibilityLabel="删除书签" onPress={() => onDeleteBookmark(bookmark)}><MaterialCommunityIcons name="close" size={14} color={theme.muted} /></Pressable></Pressable>)}</View> : null}<ScrollView style={styles.catalogScroll}>{chapters.map((item) => { const current = item.id === currentChapterId; return <Pressable key={item.id} onPress={() => onSelect(item.id)} style={[styles.catalogRow, { borderBottomColor: theme.line }, current && { backgroundColor: `${readingColors.coral}12` }]}><Text style={[styles.catalogIndex, { color: current ? readingColors.coral : theme.muted }]}>{String(item.sortOrder).padStart(2, '0')}</Text><Text numberOfLines={1} style={[styles.catalogTitle, { color: theme.text }, current && styles.catalogTitleCurrent]}>{item.title}</Text>{current ? <MaterialCommunityIcons name="book-open-variant" size={17} color={readingColors.coral} /> : null}</Pressable>; })}</ScrollView></View>;
}

function SettingsPanel({ onChange, settings, theme }: { onChange: (action: Parameters<typeof readerSettingsReducer>[1]) => void; settings: ReaderSettings; theme: (typeof readerThemes)[ReaderTheme] }) {
  return <View style={styles.panelContent}><Text style={[styles.panelTitle, { color: theme.text }]}>阅读设置</Text><SettingRow label="字号"><Pressable accessibilityLabel="减小字号" onPress={() => onChange({ type: 'decrease-font' })} style={[styles.stepButton, { borderColor: theme.line }]}><MaterialCommunityIcons name="minus" size={20} color={theme.text} /></Pressable><Text style={[styles.settingValue, { color: theme.text }]}>{settings.fontSize}</Text><Pressable accessibilityLabel="增大字号" onPress={() => onChange({ type: 'increase-font' })} style={[styles.stepButton, { borderColor: theme.line }]}><MaterialCommunityIcons name="plus" size={20} color={theme.text} /></Pressable></SettingRow><SettingRow label="行距">{[1.55, 1.85, 2.15].map((value) => <Pressable key={value} onPress={() => onChange({ type: 'set-line-height', lineHeight: value })} style={[styles.optionButton, { borderColor: theme.line }, Math.abs(settings.lineHeight - value) < 0.1 && styles.optionButtonActive]}><Text style={[styles.optionText, { color: Math.abs(settings.lineHeight - value) < 0.1 ? readingColors.blue : theme.text }]}>{value === 1.55 ? '紧凑' : value === 1.85 ? '舒适' : '宽松'}</Text></Pressable>)}</SettingRow><SettingRow label="版心">{[560, 680, 820].map((value) => <Pressable key={value} onPress={() => onChange({ type: 'set-text-width', textWidth: value })} style={[styles.optionButton, { borderColor: theme.line }, settings.textWidth === value && styles.optionButtonActive]}><Text style={[styles.optionText, { color: settings.textWidth === value ? readingColors.blue : theme.text }]}>{value === 560 ? '窄' : value === 680 ? '标准' : '宽'}</Text></Pressable>)}</SettingRow><View style={styles.themeRow}>{(Object.keys(readerThemes) as ReaderTheme[]).map((name) => <Pressable accessibilityLabel={`${name}主题`} key={name} onPress={() => onChange({ type: 'set-theme', theme: name })} style={[styles.themeSwatch, { backgroundColor: readerThemes[name].background, borderColor: settings.theme === name ? readingColors.blue : theme.line }]}><View style={[styles.themeSample, { backgroundColor: readerThemes[name].text }]} /></Pressable>)}</View></View>;
}

function SettingRow({ children, label }: React.PropsWithChildren<{ label: string }>) { return <View style={styles.settingRow}><Text style={styles.settingLabel}>{label}</Text><View style={styles.settingControls}>{children}</View></View>; }
function nextTheme(theme: ReaderTheme): ReaderTheme { const values: ReaderTheme[] = ['paper', 'white', 'sepia', 'night']; return values[(values.indexOf(theme) + 1) % values.length]; }

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(10, 14, 28, 0.46)', flex: 1, justifyContent: 'flex-end' },
  bookmarkChip: { alignItems: 'center', borderRadius: 6, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 7 },
  bookmarkChipText: { fontSize: 11, fontWeight: '800' },
  bookmarkStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  bottomBar: { alignItems: 'center', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', minHeight: 66, paddingBottom: 3 },
  bottomProgress: { bottom: 0, height: 3, left: 0, overflow: 'hidden', position: 'absolute', right: 0 },
  bottomProgressValue: { backgroundColor: readingColors.coral, height: 3 },
  catalogIndex: { fontSize: 10, fontWeight: '900', width: 28 },
  catalogRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 9, minHeight: 52, paddingHorizontal: 5 },
  catalogScroll: { maxHeight: 360 },
  catalogTitle: { flex: 1, fontSize: 13 },
  catalogTitleCurrent: { fontWeight: '900' },
  center: { alignItems: 'center', gap: 12, justifyContent: 'center', padding: 24 },
  chapterEnd: { alignItems: 'center', borderTopWidth: 1, marginTop: 20, paddingTop: 28 },
  chapterEndText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  chapterHeading: { fontFamily: 'serif', fontSize: 28, fontWeight: '700', lineHeight: 38, marginTop: 8 },
  chapterKicker: { fontSize: 11, fontWeight: '700' },
  chapterNavButton: { alignItems: 'center', borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 7, minHeight: 44, paddingHorizontal: 16 },
  chapterNavText: { fontSize: 12, fontWeight: '800' },
  chapterNavigation: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  disabled: { opacity: 0.35 },
  errorBody: { fontSize: 13, lineHeight: 20, maxWidth: 360, textAlign: 'center' },
  errorTitle: { fontSize: 19, fontWeight: '900' },
  headingRule: { height: 1, marginBottom: 28, marginTop: 20, width: 48 },
  optionButton: { alignItems: 'center', borderRadius: 6, borderWidth: 1, minWidth: 64, paddingHorizontal: 12, paddingVertical: 9 },
  optionButtonActive: { backgroundColor: readingColors.blueSoft, borderColor: '#aab8ff' },
  optionText: { fontSize: 11, fontWeight: '800' },
  page: { flex: 1 },
  panelContent: { gap: 18 },
  panelHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  panelSubtitle: { fontSize: 11, marginTop: 3 },
  panelTitle: { fontSize: 18, fontWeight: '900' },
  paragraph: { fontFamily: 'serif', marginBottom: 22, textAlign: 'justify' },
  readerAction: { alignItems: 'center', gap: 3, minWidth: 58, padding: 6 },
  readerActionText: { fontSize: 9, fontWeight: '700' },
  readerColumn: { alignSelf: 'center', paddingBottom: 70, paddingHorizontal: 26, paddingTop: 46, width: '100%' },
  returnButton: { backgroundColor: readingColors.blue, borderRadius: 7, marginTop: 8, paddingHorizontal: 18, paddingVertical: 11 },
  returnText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  scrollContent: { flexGrow: 1 },
  settingControls: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  settingLabel: { color: readingColors.muted, fontSize: 12, fontWeight: '700', width: 54 },
  settingRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  settingValue: { fontSize: 15, fontWeight: '900', minWidth: 28, textAlign: 'center' },
  sheet: { alignSelf: 'center', borderRadius: 8, borderWidth: 1, maxWidth: 720, paddingBottom: 24, paddingHorizontal: 22, width: '100%' },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#bbc1cc', borderRadius: 2, height: 4, marginBottom: 17, marginTop: 8, width: 42 },
  stepButton: { alignItems: 'center', borderRadius: 6, borderWidth: 1, height: 38, justifyContent: 'center', width: 42 },
  themeRow: { flexDirection: 'row', gap: 12, paddingTop: 3 },
  themeSample: { borderRadius: 2, height: 2, width: 20 },
  themeSwatch: { alignItems: 'center', borderRadius: 7, borderWidth: 2, height: 44, justifyContent: 'center', width: 54 },
  toast: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#b43b4b', borderRadius: 7, bottom: 78, flexDirection: 'row', gap: 7, maxWidth: 420, paddingHorizontal: 14, paddingVertical: 11, position: 'absolute' },
  toastText: { color: '#fff', flexShrink: 1, fontSize: 11, fontWeight: '700' },
  toolbar: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 58, paddingHorizontal: 8 },
  toolbarBook: { fontSize: 9, fontWeight: '700' },
  toolbarButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  toolbarChapter: { fontSize: 12, fontWeight: '900', marginTop: 1 },
  toolbarTitleWrap: { alignItems: 'center', flex: 1, minWidth: 0 },
});
