import AsyncStorage from '@react-native-async-storage/async-storage';

import { createReaderSettings, shouldReplaceReadingProgress, type ReaderSettings } from '@/lib/reading-state';
import type { ParsedLocalReadingFile } from '@/lib/reading-local-import';
import type { LocalReadingBook, ReadingBookmark, ReadingProgress } from '@/types/reading';

const indexKey = 'funbox.reading.local.index.v1';
const bookPrefix = 'funbox.reading.local.book.v1.';
const settingsKey = 'funbox.reading.settings.v1';
const bookmarkKey = 'funbox.reading.local.bookmarks.v1';

export async function listLocalReadingBooks() {
  const ids = await getLocalBookIDs();
  const values = await AsyncStorage.multiGet(ids.map((id) => `${bookPrefix}${id}`));
  return values.flatMap(([, value]) => {
    const book = parseJSON<LocalReadingBook>(value);
    return book ? [book] : [];
  }).sort((left, right) => right.importedAt.localeCompare(left.importedAt));
}

export async function getLocalReadingBook(bookId: string) {
  return parseJSON<LocalReadingBook>(await AsyncStorage.getItem(`${bookPrefix}${bookId}`));
}

export async function saveImportedLocalBook(parsed: ParsedLocalReadingFile) {
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const importedAt = new Date().toISOString();
  const book: LocalReadingBook = {
    allowOffline: true,
    author: parsed.author,
    category: '本地导入',
    chapterCount: parsed.chapters.length,
    chapters: parsed.chapters.map((chapter, index) => ({
      ...chapter,
      bookId: id,
      id: `${id}-chapter-${index + 1}`,
    })),
    coverUrl: '',
    format: parsed.format,
    id,
    importedAt,
    inBookshelf: true,
    intro: `本地 ${parsed.format.toUpperCase()} 图书，仅保存在当前设备。`,
    local: true,
    serialStatus: 'local',
    sourceType: 'local',
    tags: ['本地', parsed.format.toUpperCase()],
    title: parsed.title,
    updatedAt: importedAt,
    wordCount: parsed.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
  };
  const ids = await getLocalBookIDs();
  await AsyncStorage.multiSet([
    [indexKey, JSON.stringify([id, ...ids.filter((value) => value !== id)])],
    [`${bookPrefix}${id}`, JSON.stringify(book)],
  ]);
  return book;
}

export async function deleteLocalReadingBook(bookId: string) {
  const ids = await getLocalBookIDs();
  await AsyncStorage.multiSet([[indexKey, JSON.stringify(ids.filter((id) => id !== bookId))]]);
  await AsyncStorage.removeItem(`${bookPrefix}${bookId}`);
}

export async function saveLocalReadingProgress(bookId: string, progress: ReadingProgress) {
  const book = await getLocalReadingBook(bookId);
  if (!book || !shouldReplaceReadingProgress(book.progress, progress)) return book;
  book.progress = { ...progress, bookId };
  book.updatedAt = progress.updatedAt;
  await AsyncStorage.setItem(`${bookPrefix}${bookId}`, JSON.stringify(book));
  return book;
}

export async function getReaderSettings() {
  return createReaderSettings(parseJSON<Partial<ReaderSettings>>(await AsyncStorage.getItem(settingsKey)) ?? {});
}

export async function saveReaderSettings(settings: ReaderSettings) {
  await AsyncStorage.setItem(settingsKey, JSON.stringify(createReaderSettings(settings)));
}

export async function listLocalBookmarks(bookId: string) {
  const bookmarks = parseJSON<ReadingBookmark[]>(await AsyncStorage.getItem(bookmarkKey)) ?? [];
  return bookmarks.filter((bookmark) => bookmark.bookId === bookId);
}

export async function createLocalBookmark(value: Omit<ReadingBookmark, 'createdAt' | 'id'>) {
  const bookmarks = parseJSON<ReadingBookmark[]>(await AsyncStorage.getItem(bookmarkKey)) ?? [];
  const bookmark: ReadingBookmark = {
    ...value,
    createdAt: new Date().toISOString(),
    id: `local-bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  await AsyncStorage.setItem(bookmarkKey, JSON.stringify([bookmark, ...bookmarks]));
  return bookmark;
}

export async function deleteLocalBookmark(bookmarkId: string) {
  const bookmarks = parseJSON<ReadingBookmark[]>(await AsyncStorage.getItem(bookmarkKey)) ?? [];
  await AsyncStorage.setItem(bookmarkKey, JSON.stringify(bookmarks.filter((bookmark) => bookmark.id !== bookmarkId)));
}

async function getLocalBookIDs() {
  return parseJSON<string[]>(await AsyncStorage.getItem(indexKey)) ?? [];
}

function parseJSON<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
