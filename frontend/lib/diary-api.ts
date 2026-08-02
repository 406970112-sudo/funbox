import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  DiaryCalendar,
  DiaryEntry,
  DiaryEntryInput,
  DiaryNotebook,
  DiaryNotebookInput,
  DiaryPasswordInput,
  DiaryStats,
} from '@/types/diary';

type ErrorPayload = {
  error?: string;
};

type NotebooksResponse = { notebooks: DiaryNotebook[] };
type NotebookResponse = { notebook: DiaryNotebook };
type EntryResponse = { entry: DiaryEntry };
type EntriesResponse = { entries: DiaryEntry[] };
type UnlockResponse = { unlockToken: string; expiresInSeconds: number };

export class DiaryAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'DiaryAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchDiaryNotebooks(token: string) {
  return requestJSON<NotebooksResponse>('/api/v1/diary/notebooks', token).then(
    (payload) => payload.notebooks,
  );
}

export function createDiaryNotebook(token: string, input: DiaryNotebookInput) {
  return requestJSON<NotebookResponse>('/api/v1/diary/notebooks', token, {
    body: JSON.stringify(input),
    method: 'POST',
  }).then((payload) => payload.notebook);
}

export function updateDiaryNotebook(
  token: string,
  notebookId: string,
  input: Partial<DiaryNotebookInput>,
) {
  return requestJSON<NotebookResponse>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  ).then((payload) => payload.notebook);
}

export function deleteDiaryNotebook(
  token: string,
  notebookId: string,
  password?: string,
) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}`,
    token,
    {
      body: JSON.stringify({ password }),
      method: 'DELETE',
    },
  );
}

export function updateDiaryPassword(
  token: string,
  notebookId: string,
  input: DiaryPasswordInput,
) {
  return requestJSON<NotebookResponse>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/password`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  ).then((payload) => payload.notebook);
}

export function unlockDiaryNotebook(
  token: string,
  notebookId: string,
  password: string,
) {
  return requestJSON<UnlockResponse>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/unlock`,
    token,
    {
      body: JSON.stringify({ password }),
      method: 'POST',
    },
  );
}

export function lockDiaryNotebook(
  token: string,
  notebookId: string,
  unlockToken: string,
) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/lock`,
    token,
    {
      headers: { 'X-Diary-Unlock-Token': unlockToken },
      method: 'POST',
    },
  );
}

export function fetchDiaryEntry(
  token: string,
  notebookId: string,
  date: string,
  unlockToken?: string,
) {
  return requestJSON<EntryResponse>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/entries?date=${encodeURIComponent(date)}`,
    token,
    { headers: unlockToken ? { 'X-Diary-Unlock-Token': unlockToken } : undefined },
  ).then((payload) => payload.entry);
}

export function saveDiaryEntry(
  token: string,
  notebookId: string,
  date: string,
  input: DiaryEntryInput,
  unlockToken?: string,
) {
  return requestJSON<EntryResponse>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/entries/${encodeURIComponent(date)}`,
    token,
    {
      body: JSON.stringify(input),
      headers: unlockToken ? { 'X-Diary-Unlock-Token': unlockToken } : undefined,
      method: 'PUT',
    },
  ).then((payload) => payload.entry);
}

export function deleteDiaryEntry(
  token: string,
  notebookId: string,
  date: string,
  unlockToken?: string,
) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/entries/${encodeURIComponent(date)}`,
    token,
    {
      headers: unlockToken ? { 'X-Diary-Unlock-Token': unlockToken } : undefined,
      method: 'DELETE',
    },
  );
}

export function fetchDiaryCalendar(
  token: string,
  notebookId: string,
  month: string,
) {
  return requestJSON<DiaryCalendar>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/calendar?month=${encodeURIComponent(month)}`,
    token,
  );
}

export function searchDiaryEntries(
  token: string,
  notebookId: string,
  query: string,
  unlockToken?: string,
) {
  return requestJSON<EntriesResponse>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/search?q=${encodeURIComponent(query)}`,
    token,
    { headers: unlockToken ? { 'X-Diary-Unlock-Token': unlockToken } : undefined },
  ).then((payload) => payload.entries);
}

export function fetchDiaryStats(token: string, notebookId: string) {
  return requestJSON<DiaryStats>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/stats`,
    token,
  );
}

export async function exportDiary(
  token: string,
  notebookId: string,
  unlockToken?: string,
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (unlockToken) headers['X-Diary-Unlock-Token'] = unlockToken;
  const response = await fetch(
    `${getAPIBaseUrl()}/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/export`,
    { headers },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new DiaryAPIError(payload.error || 'request_failed', response.status);
  }
  return response.text();
}

export async function uploadDiaryMedia(
  token: string,
  notebookId: string,
  date: string,
  files: { uri: string; name: string; type: string }[],
  unlockToken?: string,
) {
  const form = new FormData();
  for (const file of files) {
    form.append('images', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (unlockToken) headers['X-Diary-Unlock-Token'] = unlockToken;
  const response = await fetch(
    `${getAPIBaseUrl()}/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/entries/${encodeURIComponent(date)}/media`,
    { body: form, headers, method: 'POST' },
  );
  const payload = (await response.json().catch(() => ({}))) as EntryResponse & ErrorPayload;
  if (!response.ok) {
    throw new DiaryAPIError(payload.error || 'request_failed', response.status);
  }
  return payload.entry;
}

export function deleteDiaryMedia(
  token: string,
  notebookId: string,
  mediaId: string,
  unlockToken?: string,
) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/diary/notebooks/${encodeURIComponent(notebookId)}/media/${encodeURIComponent(mediaId)}`,
    token,
    {
      headers: unlockToken ? { 'X-Diary-Unlock-Token': unlockToken } : undefined,
      method: 'DELETE',
    },
  );
}

export function getDiaryErrorMessage(error: unknown) {
  if (!(error instanceof DiaryAPIError)) {
    return '暂时无法连接日记本服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    diary_date_invalid: '日期格式不正确。',
    diary_image_too_large: '图片不能超过 5MB。',
    diary_image_type_invalid: '仅支持 JPG、PNG 或 WebP 图片。',
    diary_images_too_many: '每篇日记最多 9 张图片。',
    diary_invalid_input: '请检查填写内容是否完整。',
    diary_locked: '请先输入日记本密码解锁。',
    diary_no_password: '这个日记本还没有设置密码。',
    diary_not_found: '日记本或日记不存在。',
    diary_password_already_set: '这个日记本已经设置过密码。',
    diary_password_invalid: '密码需为 6-32 位。',
    diary_password_mismatch: '当前密码不正确。',
    rate_limited: '操作过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] ?? '日记本操作失败，请稍后重试。';
}

async function requestJSON<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new DiaryAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
