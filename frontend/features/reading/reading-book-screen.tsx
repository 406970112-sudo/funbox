import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-provider';
import { getReadingBook, getReadingErrorMessage, listReadingChapters, setReadingBookshelf } from '@/lib/reading-api';
import { deleteLocalReadingBook, getLocalReadingBook } from '@/lib/reading-local-storage';
import type { ReadingBook, ReadingChapter } from '@/types/reading';

import { IconButton, NovelCover, PrimaryButton, ReadingEmpty, ReadingLoading, ReadingPage, SourceBadge, readingColors } from './reading-ui';

export function ReadingBookScreen() {
  const { bookId = '' } = useLocalSearchParams<{ bookId: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const { accessToken } = useAuth();
  const [book, setBook] = useState<ReadingBook | null>(null);
  const [chapters, setChapters] = useState<ReadingChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (bookId.startsWith('local-')) {
        const local = await getLocalReadingBook(bookId);
        if (!local) throw new Error('本地图书不存在');
        setBook(local);
        setChapters(local.chapters);
      } else {
        const [nextBook, nextChapters] = await Promise.all([
          getReadingBook(bookId, accessToken),
          listReadingChapters(bookId, accessToken),
        ]);
        setBook(nextBook);
        setChapters(nextChapters);
      }
    } catch (loadError) {
      setError(getReadingErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken, bookId]);

  useEffect(() => { void load(); }, [load]);

  function openChapter(chapterId: string) {
    router.push(`/reading/books/${bookId}/chapters/${chapterId}` as Href);
  }

  async function toggleShelf() {
    if (!book || book.sourceType === 'local') return;
    if (!accessToken) {
      router.push('/auth');
      return;
    }
    setSaving(true);
    try {
      const inBookshelf = !book.inBookshelf;
      await setReadingBookshelf(accessToken, book.id, inBookshelf);
      setBook({ ...book, inBookshelf });
    } catch (requestError) {
      setError(getReadingErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  function removeLocal() {
    if (!book) return;
    Alert.alert('移除本地图书', `确定从当前设备移除《${book.title}》吗？`, [
      { style: 'cancel', text: '取消' },
      { style: 'destructive', text: '移除', onPress: () => void deleteLocalReadingBook(book.id).then(() => router.back()) },
    ]);
  }

  const startChapter = book?.progress?.chapterId || chapters[0]?.id;

  return (
    <ReadingPage>
      <View style={styles.topBar}>
        <View style={styles.topBarInner}>
          <IconButton accessibilityLabel="返回书城" icon="arrow-left" onPress={() => router.back()} />
          <Text numberOfLines={1} style={styles.topTitle}>{book?.title ?? '图书详情'}</Text>
          <IconButton accessibilityLabel={book?.sourceType === 'local' ? '移除本地图书' : '收藏图书'} icon={book?.sourceType === 'local' ? 'delete-outline' : (book?.inBookshelf ? 'bookmark' : 'bookmark-outline')} selected={Boolean(book?.inBookshelf)} onPress={book?.sourceType === 'local' ? removeLocal : () => void toggleShelf()} />
        </View>
      </View>
      {loading ? <ReadingLoading label="正在打开图书…" /> : error && !book ? <ReadingEmpty icon="book-alert-outline" title="图书无法打开" body={error} action={<PrimaryButton onPress={() => void load()}>重新加载</PrimaryButton>} /> : book ? (
        <ScrollView contentContainerStyle={[styles.content, compact && styles.contentCompact]}>
          <View style={[styles.hero, compact && styles.heroCompact]}>
            <NovelCover book={book} />
            <View style={styles.heroCopy}>
              <View style={styles.badgeRow}><SourceBadge sourceType={book.sourceType} /><Text style={styles.category}>{book.category || '小说'}</Text></View>
              <Text style={styles.title}>{book.title}</Text>
              <Text style={styles.author}>{book.author}</Text>
              <Text style={styles.intro}>{book.intro || '这本书还没有简介，翻开第一章开始阅读吧。'}</Text>
              <View style={styles.metadata}>
                <Text style={styles.metadataText}>{book.chapterCount || chapters.length} 章</Text><View style={styles.dot} />
                <Text style={styles.metadataText}>{formatWords(book.wordCount)}</Text><View style={styles.dot} />
                <Text style={styles.metadataText}>{book.serialStatus === 'completed' ? '已完结' : book.sourceType === 'local' ? '本地图书' : '连载中'}</Text>
              </View>
              {book.progress ? (
                <View style={styles.progressBlock}><View style={styles.progressHeading}><Text style={styles.progressLabel}>上次读到</Text><Text style={styles.progressPercent}>{Math.round(book.progress.chapterProgress * 100)}%</Text></View><View style={styles.progressTrack}><View style={[styles.progressValue, { width: `${Math.round(book.progress.chapterProgress * 100)}%` }]} /></View></View>
              ) : null}
              <View style={styles.actions}>
                <PrimaryButton disabled={!startChapter} icon="book-open-page-variant-outline" onPress={() => startChapter && openChapter(startChapter)}>{book.progress ? '继续阅读' : '开始阅读'}</PrimaryButton>
                {book.sourceType !== 'local' ? <PrimaryButton secondary disabled={saving} icon={book.inBookshelf ? 'bookmark-remove-outline' : 'bookmark-plus-outline'} onPress={() => void toggleShelf()}>{book.inBookshelf ? '移出书架' : '加入书架'}</PrimaryButton> : null}
              </View>
            </View>
          </View>

          <View style={styles.catalogHeading}>
            <View><Text style={styles.catalogTitle}>目录</Text><Text style={styles.catalogMeta}>共 {chapters.length} 章</Text></View>
            <MaterialCommunityIcons name="sort-numeric-ascending" size={20} color={readingColors.muted} />
          </View>
          <View style={styles.chapterList}>
            {chapters.map((chapter) => {
              const current = chapter.id === book.progress?.chapterId;
              return (
                <Pressable key={chapter.id} onPress={() => openChapter(chapter.id)} style={({ pressed }) => [styles.chapterRow, current && styles.chapterRowCurrent, pressed && styles.pressed]}>
                  <Text style={[styles.chapterIndex, current && styles.chapterIndexCurrent]}>{String(chapter.sortOrder).padStart(2, '0')}</Text>
                  <View style={styles.chapterCopy}><Text numberOfLines={1} style={[styles.chapterTitle, current && styles.chapterTitleCurrent]}>{chapter.title}</Text><Text style={styles.chapterMeta}>{chapter.wordCount ? `${chapter.wordCount} 字` : '点击阅读'}</Text></View>
                  {current ? <Text style={styles.currentText}>上次阅读</Text> : <MaterialCommunityIcons name="chevron-right" size={20} color="#a5adbe" />}
                </Pressable>
              );
            })}
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.rights}><MaterialCommunityIcons name={book.sourceType === 'local' ? 'cellphone-lock' : 'shield-check-outline'} size={18} color={readingColors.green} /><Text style={styles.rightsText}>{book.sourceType === 'local' ? '正文仅保存在当前设备，不会上传或跨设备同步。' : '本书在有效授权范围内免费提供阅读；内容状态以版权方与平台通知为准。'}</Text></View>
        </ScrollView>
      ) : null}
    </ReadingPage>
  );
}

function formatWords(value: number) { return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万字` : `${value || 0} 字`; }

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  author: { color: readingColors.muted, fontSize: 14, fontWeight: '700' },
  badgeRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  catalogHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  catalogMeta: { color: readingColors.muted, fontSize: 11, marginTop: 3 },
  catalogTitle: { color: readingColors.ink, fontSize: 20, fontWeight: '900' },
  category: { color: readingColors.muted, fontSize: 11, fontWeight: '700' },
  chapterCopy: { flex: 1, gap: 3, minWidth: 0 },
  chapterIndex: { color: '#a2abba', fontSize: 11, fontWeight: '900', width: 28 },
  chapterIndexCurrent: { color: readingColors.coral },
  chapterList: { backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  chapterMeta: { color: readingColors.muted, fontSize: 10 },
  chapterRow: { alignItems: 'center', borderBottomColor: readingColors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 64, paddingHorizontal: 15, paddingVertical: 10 },
  chapterRowCurrent: { backgroundColor: '#fff8f9' },
  chapterTitle: { color: readingColors.ink, fontSize: 14, fontWeight: '700' },
  chapterTitleCurrent: { fontWeight: '900' },
  content: { alignSelf: 'center', gap: 24, maxWidth: 880, padding: 30, width: '100%' },
  contentCompact: { padding: 16 },
  currentText: { color: readingColors.coral, fontSize: 10, fontWeight: '900' },
  dot: { backgroundColor: '#c9cfda', borderRadius: 2, height: 3, width: 3 },
  error: { color: '#c14656', fontSize: 12, textAlign: 'center' },
  hero: { alignItems: 'flex-start', backgroundColor: '#fff', borderColor: readingColors.line, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 26, padding: 24 },
  heroCompact: { gap: 18, padding: 16 },
  heroCopy: { flex: 1, gap: 8, minWidth: 0 },
  intro: { color: '#5f6b84', fontSize: 13, lineHeight: 21, marginTop: 3 },
  metadata: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  metadataText: { color: readingColors.muted, fontSize: 11 },
  pressed: { opacity: 0.74 },
  progressBlock: { gap: 6, marginTop: 5, maxWidth: 380 },
  progressHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { color: readingColors.muted, fontSize: 10 },
  progressPercent: { color: readingColors.coral, fontSize: 10, fontWeight: '900' },
  progressTrack: { backgroundColor: '#edf0f5', borderRadius: 3, height: 5, overflow: 'hidden' },
  progressValue: { backgroundColor: readingColors.coral, borderRadius: 3, height: 5 },
  rights: { alignItems: 'flex-start', borderTopColor: readingColors.line, borderTopWidth: 1, flexDirection: 'row', gap: 8, paddingVertical: 18 },
  rightsText: { color: readingColors.muted, flex: 1, fontSize: 11, lineHeight: 18 },
  title: { color: readingColors.ink, fontSize: 29, fontWeight: '900', lineHeight: 35, marginTop: 2 },
  topBar: { backgroundColor: '#fff', borderBottomColor: readingColors.line, borderBottomWidth: 1 },
  topBarInner: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', maxWidth: 880, paddingHorizontal: 16, paddingVertical: 10, width: '100%' },
  topTitle: { color: readingColors.ink, flex: 1, fontSize: 14, fontWeight: '900', textAlign: 'center' },
});
