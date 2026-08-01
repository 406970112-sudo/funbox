import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAuth } from '@/features/auth/auth-provider';
import { getReadingErrorMessage, listReadingBooks, listReadingBookshelf, setReadingBookshelf } from '@/lib/reading-api';
import { listLocalReadingBooks } from '@/lib/reading-local-storage';
import type { ReadingBook } from '@/types/reading';

import {
  IconButton,
  NovelCover,
  PrimaryButton,
  ReadingBrand,
  ReadingEmpty,
  ReadingLoading,
  ReadingPage,
  SourceBadge,
  readingColors,
} from './reading-ui';

const categories = ['全部', '都市', '悬疑', '科幻', '现实'];

export function ReadingHomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const { accessToken, status: authStatus, user } = useAuth();
  const [tab, setTab] = useState<'store' | 'shelf'>('store');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [remoteBooks, setRemoteBooks] = useState<ReadingBook[]>([]);
  const [shelfBooks, setShelfBooks] = useState<ReadingBook[]>([]);
  const [localBooks, setLocalBooks] = useState<ReadingBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const local = await listLocalReadingBooks().catch(() => []);
    setLocalBooks(local);
    try {
      const [online, shelf] = await Promise.all([
        listReadingBooks(),
        accessToken ? listReadingBookshelf(accessToken) : Promise.resolve([]),
      ]);
      setRemoteBooks(online);
      setShelfBooks(shelf);
    } catch (loadError) {
      setError(getReadingErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visibleBooks = useMemo(() => {
    const source = tab === 'store' ? remoteBooks : [...shelfBooks, ...localBooks];
    const normalized = query.trim().toLowerCase();
    return source.filter((book) => {
      const matchesQuery = !normalized || `${book.title} ${book.author} ${book.intro}`.toLowerCase().includes(normalized);
      const matchesCategory = category === '全部' || book.category === category || (category === '现实' && book.category === '本地导入');
      return matchesQuery && matchesCategory;
    });
  }, [category, localBooks, query, remoteBooks, shelfBooks, tab]);

  const continueBook = [...shelfBooks, ...localBooks].find((book) => book.progress) ?? remoteBooks[0];

  async function toggleShelf(book: ReadingBook) {
    if (book.sourceType === 'local') return;
    if (!accessToken) {
      router.push('/auth');
      return;
    }
    const added = !shelfBooks.some((item) => item.id === book.id);
    try {
      await setReadingBookshelf(accessToken, book.id, added);
      await load();
    } catch (requestError) {
      setError(getReadingErrorMessage(requestError));
    }
  }

  function openBook(book: ReadingBook) {
    router.push(`/reading/books/${book.id}` as Href);
  }

  return (
    <ReadingPage>
      <View style={styles.topBar}>
        <View style={styles.topBarInner}>
          <ReadingBrand compact={compact} />
          <View style={styles.topActions}>
            {user?.role === 'admin' ? <PrimaryButton secondary icon="shield-crown-outline" onPress={() => router.push('/admin/reading' as Href)}>内容后台</PrimaryButton> : null}
            <IconButton accessibilityLabel="返回工具" icon="close" onPress={() => router.back()} />
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, compact && styles.contentCompact]} keyboardShouldPersistTaps="handled">
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.eyebrow}>正版免费 · 本地私享</Text>
            <Text style={styles.pageTitle}>{tab === 'store' ? '书城' : '我的书架'}</Text>
            {!compact ? <Text style={styles.pageSubtitle}>发现正版免费小说，或把自己的 TXT / EPUB 留在当前设备阅读。</Text> : null}
          </View>
          <PrimaryButton icon="file-upload-outline" onPress={() => router.push('/reading/import' as Href)}>导入本地图书</PrimaryButton>
        </View>

        <View style={styles.segmented}>
          {(['store', 'shelf'] as const).map((value) => (
            <Pressable key={value} onPress={() => setTab(value)} style={[styles.segment, tab === value && styles.segmentActive]}>
              <MaterialCommunityIcons name={value === 'store' ? 'compass-outline' : 'bookshelf'} size={18} color={tab === value ? readingColors.blue : readingColors.muted} />
              <Text style={[styles.segmentText, tab === value && styles.segmentTextActive]}>{value === 'store' ? '书城' : '书架'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={20} color={readingColors.muted} />
          <TextInput accessibilityLabel="搜索书名或作者" onChangeText={setQuery} placeholder="搜书名、作者或分类" placeholderTextColor="#9ba4b7" style={styles.searchInput} value={query} />
          {query ? <Pressable accessibilityLabel="清空搜索" onPress={() => setQuery('')}><MaterialCommunityIcons name="close-circle" size={18} color={readingColors.muted} /></Pressable> : null}
        </View>

        {continueBook ? (
          <Pressable onPress={() => openBook(continueBook)} style={({ pressed }) => [styles.continueCard, pressed && styles.pressed]}>
            <View style={styles.continueCopy}>
              <Text style={styles.continueEyebrow}>{continueBook.progress ? '继续上次阅读' : '编辑精选 · 今日免费'}</Text>
              <Text numberOfLines={2} style={styles.continueTitle}>{continueBook.title}</Text>
              <Text numberOfLines={2} style={styles.continueIntro}>{continueBook.intro || `${continueBook.author} 的作品，现已加入免费阅读。`}</Text>
              <View style={styles.continueAction}><Text style={styles.continueActionText}>继续阅读</Text><MaterialCommunityIcons name="arrow-right" size={16} color="#fff" /></View>
            </View>
            <NovelCover book={continueBook} compact={compact} />
          </Pressable>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {categories.map((item) => (
            <Pressable key={item} onPress={() => setCategory(item)} style={[styles.categoryChip, category === item && styles.categoryChipActive]}>
              <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionTitle}>{tab === 'store' ? '本周热门' : '收藏与本地'}</Text><Text style={styles.sectionMeta}>{visibleBooks.length} 本可读</Text></View>
          {tab === 'shelf' && authStatus !== 'authenticated' ? <Pressable onPress={() => router.push('/auth')}><Text style={styles.link}>登录同步书架</Text></Pressable> : null}
        </View>

        {loading ? <ReadingLoading /> : error && visibleBooks.length === 0 ? (
          <ReadingEmpty icon="book-alert-outline" title="暂时没有取到书目" body={error} action={<PrimaryButton onPress={() => void load()}>重新加载</PrimaryButton>} />
        ) : visibleBooks.length === 0 ? (
          <ReadingEmpty
            icon={tab === 'store' ? 'book-search-outline' : 'bookshelf'}
            title={tab === 'store' ? '没有匹配的图书' : '书架还是空的'}
            body={tab === 'store' ? '换一个书名、作者或分类试试。' : '在书城收藏正版图书，或从当前设备导入 TXT / EPUB。'}
            action={tab === 'shelf' ? <PrimaryButton icon="file-upload-outline" onPress={() => router.push('/reading/import' as Href)}>导入图书</PrimaryButton> : undefined}
          />
        ) : (
          <View style={[styles.bookGrid, compact && styles.bookGridCompact]}>
            {visibleBooks.map((book) => {
              const saved = book.sourceType === 'local' || shelfBooks.some((item) => item.id === book.id);
              return (
                <Pressable key={book.id} onPress={() => openBook(book)} style={({ pressed }) => [styles.bookCard, compact && styles.bookCardCompact, pressed && styles.pressed]}>
                  <NovelCover book={book} compact={compact} />
                  <View style={styles.bookInfo}>
                    <View style={styles.bookBadges}><SourceBadge sourceType={book.sourceType} /><Text style={styles.bookCategory}>{book.category || '小说'}</Text></View>
                    <Text numberOfLines={2} style={styles.bookTitle}>{book.title}</Text>
                    <Text numberOfLines={1} style={styles.bookAuthor}>{book.author}</Text>
                    <Text numberOfLines={2} style={styles.bookIntro}>{book.intro}</Text>
                    {book.progress ? <View style={styles.progressTrack}><View style={[styles.progressValue, { width: `${Math.round(book.progress.chapterProgress * 100)}%` }]} /></View> : null}
                    <View style={styles.bookFooter}>
                      <Text style={styles.bookMeta}>{book.chapterCount} 章 · {formatWords(book.wordCount)}</Text>
                      {book.sourceType !== 'local' ? <Pressable accessibilityLabel={saved ? '移出书架' : '加入书架'} onPress={(event) => { event.stopPropagation(); void toggleShelf(book); }}><MaterialCommunityIcons name={saved ? 'bookmark' : 'bookmark-outline'} size={20} color={saved ? readingColors.coral : readingColors.muted} /></Pressable> : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {error && visibleBooks.length > 0 ? <Text style={styles.inlineError}>{error}</Text> : null}
        <View style={styles.legalNote}><MaterialCommunityIcons name="shield-check-outline" size={17} color={readingColors.green} /><Text style={styles.legalText}>在线内容由正版合作方或管理员授权提供；本地图书不会上传到服务器。</Text></View>
      </ScrollView>
    </ReadingPage>
  );
}

function formatWords(value: number) {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万字`;
  return `${value || 0} 字`;
}

const styles = StyleSheet.create({
  bookAuthor: { color: readingColors.muted, fontSize: 12 },
  bookBadges: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  bookCard: { backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 16, minHeight: 210, padding: 14, width: '48.7%' },
  bookCardCompact: { gap: 12, minHeight: 140, padding: 10, width: '100%' },
  bookCategory: { color: readingColors.muted, fontSize: 10, fontWeight: '700' },
  bookFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' },
  bookGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  bookGridCompact: { gap: 10 },
  bookInfo: { flex: 1, gap: 6, minWidth: 0 },
  bookIntro: { color: readingColors.muted, fontSize: 12, lineHeight: 18 },
  bookMeta: { color: readingColors.muted, fontSize: 10 },
  bookTitle: { color: readingColors.ink, fontSize: 17, fontWeight: '900', lineHeight: 22 },
  categoryChip: { backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 6, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 9 },
  categoryChipActive: { backgroundColor: readingColors.blue, borderColor: readingColors.blue },
  categoryRow: { gap: 8 },
  categoryText: { color: readingColors.muted, fontSize: 12, fontWeight: '700' },
  categoryTextActive: { color: '#fff' },
  content: { alignSelf: 'center', gap: 20, maxWidth: 980, padding: 28, width: '100%' },
  contentCompact: { gap: 16, padding: 16 },
  continueAction: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: readingColors.blue, borderRadius: 6, flexDirection: 'row', gap: 5, marginTop: 8, paddingHorizontal: 13, paddingVertical: 9 },
  continueActionText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  continueCard: { backgroundColor: '#1e2944', borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', minHeight: 190, overflow: 'hidden', padding: 18 },
  continueCopy: { flex: 1, justifyContent: 'center', maxWidth: 520, paddingRight: 16 },
  continueEyebrow: { color: '#aebdff', fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  continueIntro: { color: '#bfc7d8', fontSize: 12, lineHeight: 18, marginTop: 7 },
  continueTitle: { color: '#fff', fontSize: 27, fontWeight: '900', lineHeight: 33, marginTop: 4 },
  eyebrow: { color: readingColors.blue, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  headingRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  inlineError: { color: '#c14656', fontSize: 12, textAlign: 'center' },
  legalNote: { alignItems: 'center', borderTopColor: readingColors.line, borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 10, paddingVertical: 18 },
  legalText: { color: readingColors.muted, flex: 1, fontSize: 11, lineHeight: 18 },
  link: { color: readingColors.blue, fontSize: 12, fontWeight: '800' },
  pageSubtitle: { color: readingColors.muted, fontSize: 13, marginTop: 5 },
  pageTitle: { color: readingColors.ink, fontSize: 30, fontWeight: '900', lineHeight: 36, marginTop: 2 },
  pressed: { opacity: 0.78 },
  progressTrack: { backgroundColor: '#edf0f5', borderRadius: 3, height: 4, marginTop: 5, overflow: 'hidden' },
  progressValue: { backgroundColor: readingColors.coral, borderRadius: 3, height: 4 },
  searchBox: { alignItems: 'center', backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 46, paddingHorizontal: 14 },
  searchInput: { color: readingColors.ink, flex: 1, fontSize: 14, outlineStyle: 'none' } as never,
  sectionHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  sectionMeta: { color: readingColors.muted, fontSize: 11, marginTop: 3 },
  sectionTitle: { color: readingColors.ink, fontSize: 18, fontWeight: '900' },
  segment: { alignItems: 'center', borderRadius: 6, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 42 },
  segmentActive: { backgroundColor: '#fff', borderColor: '#dce1ef', borderWidth: 1 },
  segmentText: { color: readingColors.muted, fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: readingColors.ink, fontWeight: '900' },
  segmented: { backgroundColor: '#e9edf6', borderRadius: 7, flexDirection: 'row', gap: 3, padding: 3 },
  topActions: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  topBar: { backgroundColor: '#fff', borderBottomColor: readingColors.line, borderBottomWidth: 1 },
  topBarInner: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', maxWidth: 980, paddingHorizontal: 16, paddingVertical: 10, width: '100%' },
});
