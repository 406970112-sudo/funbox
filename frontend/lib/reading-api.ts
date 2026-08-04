import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  ContentRights,
  ReadingBook,
  ReadingBookmark,
  ReadingChapter,
  ReadingProgress,
} from '@/types/reading';

type APIErrorPayload = { detail?: string; error?: string };

export class ReadingAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, detail = '') {
    super(detail || code);
    this.name = 'ReadingAPIError';
    this.code = code;
    this.status = status;
  }
}

export type ChapterContent = {
  bookId: string;
  chapterId: string;
  content: string;
  nextId?: string;
  previousId?: string;
  sortOrder: number;
  sourceType: 'provider' | 'admin';
  title: string;
  wordCount: number;
};

export type AdminBookPatch = Partial<Pick<
  ReadingBook,
  'allowOffline' | 'author' | 'category' | 'coverUrl' | 'intro' | 'serialStatus' | 'title'
>> & { rights?: Omit<ContentRights, 'bookId' | 'reviewedAt' | 'reviewedBy'> };

export function listReadingBooks(query = '', category = '') {
  const search = new URLSearchParams();
  if (query.trim()) search.set('q', query.trim());
  if (category.trim() && category !== '全部') search.set('category', category.trim());
  return readingRequest<{ books: ReadingBook[] }>(`/api/v1/reading/books?${search}`).then((value) => value.books);
}

export function getReadingBook(bookId: string, token?: string | null) {
  return readingRequest<{ book: ReadingBook }>(`/api/v1/reading/books/${encodeURIComponent(bookId)}`, {}, token)
    .then((value) => value.book);
}

export function listReadingChapters(bookId: string, token?: string | null) {
  return readingRequest<{ chapters: ReadingChapter[] }>(`/api/v1/reading/books/${encodeURIComponent(bookId)}/chapters`, {}, token)
    .then((value) => value.chapters);
}

export function getReadingChapter(bookId: string, chapterId: string, token?: string | null) {
  return readingRequest<ChapterContent>(`/api/v1/reading/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`, {}, token);
}

export function listReadingBookshelf(token: string) {
  return readingRequest<{ books: ReadingBook[] }>('/api/v1/reading/bookshelf', {}, token).then((value) => value.books);
}

export function setReadingBookshelf(token: string, bookId: string, added: boolean) {
  return readingRequest<{ inBookshelf: boolean; ok: boolean }>(`/api/v1/reading/bookshelf/${encodeURIComponent(bookId)}`, { method: added ? 'PUT' : 'DELETE' }, token);
}

export function saveReadingProgress(token: string, bookId: string, progress: ReadingProgress) {
  return readingRequest<ReadingProgress>(`/api/v1/reading/progress/${encodeURIComponent(bookId)}`, jsonRequest('PUT', progress), token);
}

export function listReadingBookmarks(token: string, bookId: string) {
  return readingRequest<{ bookmarks: ReadingBookmark[] }>(`/api/v1/reading/bookmarks?bookId=${encodeURIComponent(bookId)}`, {}, token)
    .then((value) => value.bookmarks);
}

export function createReadingBookmark(token: string, value: Omit<ReadingBookmark, 'createdAt' | 'id'>) {
  return readingRequest<ReadingBookmark>('/api/v1/reading/bookmarks', jsonRequest('POST', value), token);
}

export function deleteReadingBookmark(token: string, bookmarkId: string) {
  return readingRequest<{ ok: boolean }>(`/api/v1/reading/bookmarks/${encodeURIComponent(bookmarkId)}`, { method: 'DELETE' }, token);
}

export function listAdminReadingBooks(token: string, status = '') {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return readingRequest<{ books: ReadingBook[] }>(`/api/v1/admin/reading/books${query}`, {}, token).then((value) => value.books);
}

export function listAdminReadingChapters(token: string, bookId: string) {
  return readingRequest<{ chapters: ReadingChapter[] }>(`/api/v1/admin/reading/books/${encodeURIComponent(bookId)}/chapters`, {}, token).then((value) => value.chapters);
}

export function getAdminReadingChapter(token: string, bookId: string, chapterId: string) {
  return readingRequest<ChapterContent>(`/api/v1/admin/reading/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`, {}, token);
}

export async function uploadAdminReadingBook(token: string, file: { name: string; type?: string; uri: string }) {
  const form = new FormData();
  if (typeof window !== 'undefined') {
    const response = await fetch(file.uri);
    form.append('file', await response.blob(), file.name);
  } else {
    form.append('file', { name: file.name, type: file.type || 'application/octet-stream', uri: file.uri } as never);
  }
  return readingRequest<{ book: ReadingBook; chapters: ReadingChapter[]; importId: string; warnings: string[] }>(
    '/api/v1/admin/reading/imports',
    { body: form, method: 'POST' },
    token,
  );
}

export function patchAdminReadingBook(token: string, bookId: string, patch: AdminBookPatch) {
  return readingRequest<{ book: ReadingBook }>(`/api/v1/admin/reading/books/${encodeURIComponent(bookId)}`, jsonRequest('PATCH', patch), token)
    .then((value) => value.book);
}

export function patchAdminReadingChapter(token: string, bookId: string, chapterId: string, patch: Pick<ReadingChapter, 'sortOrder' | 'title'>) {
  return readingRequest<{ chapter: ReadingChapter }>(`/api/v1/admin/reading/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`, jsonRequest('PATCH', patch), token)
    .then((value) => value.chapter);
}

export function changeAdminReadingStatus(token: string, bookId: string, status: 'publish' | 'hide' | 'remove') {
  return readingRequest<{ book: ReadingBook }>(`/api/v1/admin/reading/books/${encodeURIComponent(bookId)}/${status}`, { method: 'POST' }, token)
    .then((value) => value.book);
}

export function syncAdminReadingProvider(token: string, providerKey = 'mock') {
  return readingRequest<{ bookCount: number; status: string }>(`/api/v1/admin/reading/providers/${encodeURIComponent(providerKey)}/sync`, { method: 'POST' }, token);
}

export function getReadingErrorMessage(error: unknown) {
  if (!(error instanceof ReadingAPIError)) return '阅读服务暂时不可用，请稍后再试。';
  const messages: Record<string, string> = {
    reading_content_unavailable: '内容暂不可读，可能已下架或授权已到期。',
    reading_file_required: '请选择一个 TXT 或 EPUB 文件。',
    reading_import_failed: '文件解析失败，请检查格式后重试。',
    reading_library_disabled: '在线书城当前未开放。',
    reading_not_found: '没有找到这本书或章节。',
    reading_provider_unavailable: '正版内容服务暂时不可用。',
    reading_rights_required: '请先补全版权方、授权范围、凭证和有效期。',
  };
  if (error.code === 'reading_import_failed') {
    const importDetails: Record<string, string> = {
      'TXT encoding is not supported': 'TXT 编码暂不支持，请另存为 UTF-8 或 GBK 后重试。',
      'book contains no readable chapters': '没有识别到可阅读的正文，请确认 TXT 内容完整。',
      'only TXT and EPUB files are supported': '仅支持 TXT 和 EPUB 文件。',
      'uploaded book is empty': '上传的文件是空的。',
    };
    for (const [detail, message] of Object.entries(importDetails)) {
      if (error.message.includes(detail)) return message;
    }
    if (error.message && error.message !== error.code) return `文件解析失败：${error.message}`;
  }
  return messages[error.code] ?? error.message ?? '阅读请求失败。';
}

async function readingRequest<T>(path: string, init: RequestInit = {}, token?: string | null) {
  const response = await fetch(`${getAPIBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as APIErrorPayload;
    throw new ReadingAPIError(payload.error || 'reading_request_failed', response.status, payload.detail);
  }
  return await response.json() as T;
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return {
    body: JSON.stringify(value),
    headers: { 'Content-Type': 'application/json' },
    method,
  };
}
