import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  LeftoverEvent,
  LeftoverHistoryPayload,
  LeftoverHomePayload,
  LeftoverItem,
  LeftoverItemDetail,
  LeftoverItemInput,
  LeftoverPhoto,
  LeftoverSettings,
  Recipe,
  RecipeMatch,
} from '@/types/leftover-manager';

type ErrorPayload = { error?: string };

export class LeftoverManagerAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'LeftoverManagerAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchLeftoverHome(token: string) {
  return requestJSON<LeftoverHomePayload>('/api/v1/leftover-manager/home', token);
}

export async function fetchLeftoverItems(token: string) {
  const payload = await requestJSON<{ items: LeftoverItem[] }>('/api/v1/leftover-manager/items', token);
  return payload.items;
}

export function fetchLeftoverItem(token: string, itemId: string) {
  return requestJSON<LeftoverItemDetail>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}`, token);
}

export function createLeftoverItem(token: string, input: LeftoverItemInput) {
  return requestJSON<LeftoverItem>('/api/v1/leftover-manager/items', token, {
    body: JSON.stringify(input), method: 'POST',
  });
}

export function updateLeftoverItem(token: string, itemId: string, input: LeftoverItemInput) {
  return requestJSON<LeftoverItem>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}`, token, {
    body: JSON.stringify(input), method: 'PATCH',
  });
}

export function deleteLeftoverItem(token: string, itemId: string) {
  return requestJSON<{ success: boolean }>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}`, token, {
    method: 'DELETE',
  });
}

export function reheatLeftoverItem(token: string, itemId: string) {
  return requestJSON<LeftoverItem>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}/reheat`, token, {
    body: '{}', method: 'POST',
  });
}

export function eatLeftoverItem(token: string, itemId: string) {
  return requestJSON<LeftoverItem>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}/eat`, token, {
    body: '{}', method: 'POST',
  });
}

export function discardLeftoverItem(token: string, itemId: string, reason: string) {
  return requestJSON<LeftoverItem>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}/discard`, token, {
    body: JSON.stringify({ reason }), method: 'POST',
  });
}

export function uploadLeftoverPhoto(token: string, itemId: string, file: { uri: string; name?: string; type?: string }) {
  const form = new FormData();
  form.append('file', {
    uri: file.uri,
    name: file.name ?? 'photo.jpg',
    type: file.type ?? 'image/jpeg',
  } as unknown as Blob);
  return requestJSON<LeftoverPhoto>(`/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}/photos`, token, {
    body: form, method: 'POST', headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function deleteLeftoverPhoto(token: string, itemId: string, photoId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}/photos/${encodeURIComponent(photoId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function fetchLeftoverEvents(token: string, itemId: string) {
  const payload = await requestJSON<{ events: LeftoverEvent[] }>(
    `/api/v1/leftover-manager/items/${encodeURIComponent(itemId)}/events`,
    token,
  );
  return payload.events;
}

export async function fetchLeftoverSuggestions(token: string) {
  return requestJSON<{ suggestions: RecipeMatch[]; serverNow: number }>(
    '/api/v1/leftover-manager/suggestions',
    token,
  );
}

export function fetchLeftoverRecipe(token: string, recipeId: string) {
  return requestJSON<Recipe>(`/api/v1/leftover-manager/recipes/${encodeURIComponent(recipeId)}`, token);
}

export function fetchLeftoverHistory(token: string) {
  return requestJSON<LeftoverHistoryPayload>('/api/v1/leftover-manager/history', token);
}

export function fetchLeftoverSettings(token: string) {
  return requestJSON<LeftoverSettings>('/api/v1/leftover-manager/settings', token);
}

export function saveLeftoverSettings(token: string, settings: LeftoverSettings) {
  return requestJSON<LeftoverSettings>('/api/v1/leftover-manager/settings', token, {
    body: JSON.stringify({
      remindBeforeHours: settings.remindBeforeHours,
      daily09Enabled: settings.daily09Enabled,
      evening19Enabled: settings.evening19Enabled,
      notificationEnabled: settings.notificationEnabled,
    }),
    method: 'PUT',
  });
}

export async function downloadLeftoverExport(token: string, format: 'csv' | 'json') {
  const response = await fetch(`${getAPIBaseUrl()}/api/v1/leftover-manager/export?format=${format}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) throw new LeftoverManagerAPIError(payload.error || 'request_failed', response.status);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = format === 'csv' ? 'leftover-manager-export.csv' : 'leftover-manager-export.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function clearLeftoverData(token: string) {
  return requestJSON<{ success: boolean }>('/api/v1/leftover-manager/data', token, { method: 'DELETE' });
}

export function getLeftoverManagerErrorMessage(error: unknown) {
  if (!(error instanceof LeftoverManagerAPIError)) {
    return '冰箱剩菜管家服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    leftover_manager_invalid_input: '请检查名称、时间、剩余分量和加热状态是否填写完整。',
    leftover_manager_not_found: '冰箱记录不存在或已被删除。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unsupported_file_type: '图片仅支持 JPG、PNG、WebP 或 HEIC 格式。',
    file_too_large: '单张图片不能超过 5 MB。',
    missing_file: '请选择要上传的真实照片。',
  };
  return messages[error.code] ?? '冰箱剩菜管家操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) throw new LeftoverManagerAPIError(payload.error || 'request_failed', response.status);
  return payload as T;
}
