import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  WhereIsItItem,
  WhereIsItItemDetail,
  WhereIsItItemInput,
  WhereIsItMoveEvent,
  WhereIsItMoveInput,
  WhereIsItPhoto,
  WhereIsItRoom,
  WhereIsItRoomInput,
  WhereIsItSummary,
} from '@/types/where-is-it';

type ErrorPayload = { error?: string };

export class WhereIsItAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'WhereIsItAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchWhereIsItSummary(token: string) {
  return requestJSON<WhereIsItSummary>('/api/v1/where-is-it/summary', token);
}

export async function fetchWhereIsItRooms(token: string) {
  const payload = await requestJSON<{ rooms: WhereIsItRoom[] }>('/api/v1/where-is-it/rooms', token);
  return payload.rooms;
}

export function createWhereIsItRoom(token: string, input: WhereIsItRoomInput) {
  return requestJSON<WhereIsItRoom>('/api/v1/where-is-it/rooms', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateWhereIsItRoom(token: string, roomId: string, input: WhereIsItRoomInput) {
  return requestJSON<WhereIsItRoom>(
    `/api/v1/where-is-it/rooms/${encodeURIComponent(roomId)}`,
    token,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function deleteWhereIsItRoom(token: string, roomId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/where-is-it/rooms/${encodeURIComponent(roomId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchWhereIsItItems(
  token: string,
  params: { q?: string; roomId?: string; category?: string; status?: string; sort?: string } = {},
) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.roomId) query.set('roomId', params.roomId);
  if (params.category) query.set('category', params.category);
  if (params.status) query.set('status', params.status);
  if (params.sort) query.set('sort', params.sort);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await requestJSON<{ items: WhereIsItItem[] }>(
    `/api/v1/where-is-it/items${suffix}`,
    token,
  );
  return payload.items;
}

export function fetchWhereIsItItem(token: string, itemId: string) {
  return requestJSON<WhereIsItItemDetail>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}`,
    token,
  );
}

export function createWhereIsItItem(token: string, input: WhereIsItItemInput) {
  return requestJSON<WhereIsItItem>('/api/v1/where-is-it/items', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateWhereIsItItem(token: string, itemId: string, input: Partial<WhereIsItItemInput>) {
  return requestJSON<WhereIsItItem>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}`,
    token,
    { body: JSON.stringify(input), method: 'PATCH' },
  );
}

export function deleteWhereIsItItem(token: string, itemId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function uploadWhereIsItPhoto(
  token: string,
  itemId: string,
  file: { uri: string; name?: string; type?: string },
  options: { cover?: boolean; kind?: string; takenAt?: string } = {},
) {
  const form = new FormData();
  form.append('kind', options.kind ?? 'photo');
  if (options.takenAt) form.append('takenAt', options.takenAt);
  if (options.cover) form.append('cover', 'true');
  form.append('file', {
    uri: file.uri,
    name: file.name ?? 'photo.jpg',
    type: file.type ?? 'image/jpeg',
  } as unknown as Blob);
  return requestJSON<WhereIsItPhoto>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}/photos`,
    token,
    { body: form, method: 'POST', headers: { 'Content-Type': 'multipart/form-data' } },
  );
}

export function deleteWhereIsItPhoto(token: string, itemId: string, photoId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}/photos/${encodeURIComponent(photoId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function moveWhereIsItItem(token: string, itemId: string, input: WhereIsItMoveInput) {
  return requestJSON<WhereIsItItem>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}/move`,
    token,
    { body: JSON.stringify(input), method: 'POST' },
  );
}

export function confirmWhereIsItItem(token: string, itemId: string) {
  return requestJSON<WhereIsItItem>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}/confirm`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export async function fetchWhereIsItHistory(token: string, itemId: string) {
  const payload = await requestJSON<{ events: WhereIsItMoveEvent[] }>(
    `/api/v1/where-is-it/items/${encodeURIComponent(itemId)}/history`,
    token,
  );
  return payload.events;
}

export async function fetchWhereIsItSearchHistory(token: string) {
  const payload = await requestJSON<{ queries: string[] }>('/api/v1/where-is-it/search-history', token);
  return payload.queries;
}

export function clearWhereIsItSearchHistory(token: string) {
  return requestJSON<{ success: boolean }>('/api/v1/where-is-it/search-history', token, {
    method: 'DELETE',
  });
}

export async function downloadWhereIsItExport(token: string, format: 'csv' | 'json') {
  const response = await fetch(`${getAPIBaseUrl()}/api/v1/where-is-it/export?format=${format}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) throw new WhereIsItAPIError(payload.error || 'request_failed', response.status);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = format === 'csv' ? 'where-is-it-export.csv' : 'where-is-it-export.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function whereIsItMediaURL(imageUrl: string) {
  if (!imageUrl) return '';
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `${getAPIBaseUrl()}${imageUrl}`;
}

export function whereIsItImageSource(token: string, imageUrl: string) {
  return { headers: { Authorization: `Bearer ${token}` }, uri: whereIsItMediaURL(imageUrl) };
}

export function getWhereIsItErrorMessage(error: unknown) {
  if (!(error instanceof WhereIsItAPIError)) return '物品在哪里服务暂时不可用，请稍后重试。';
  const messages: Record<string, string> = {
    where_is_it_invalid_input: '请检查物品名称、房间和具体位置是否填写完整。',
    where_is_it_not_found: '物品不存在或已被删除。',
    where_is_it_room_not_empty: '该房间还有物品，请先移动或删除物品。',
    unsupported_file_type: '图片仅支持 JPG、PNG、WebP 或 HEIC 格式。',
    file_too_large: '单张图片不能超过 5 MB。',
    missing_file: '请选择要上传的真实照片。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '物品在哪里操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) throw new WhereIsItAPIError(payload.error || 'request_failed', response.status);
  return payload as T;
}
