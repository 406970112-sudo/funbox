import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  CoolingDecisionInput,
  CoolingEvidence,
  CoolingEvent,
  CoolingHome,
  CoolingItem,
  CoolingItemInput,
  CoolingSettings,
  CoolingSettingsInput,
  CoolingStats,
} from '@/types/impulse-cooler';

type ErrorPayload = { error?: string };

export class CoolingAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'CoolingAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchCoolingHome(token: string) {
  return requestJSON<CoolingHome>('/api/v1/cooling/home', token);
}

export function fetchCoolingStats(token: string) {
  return requestJSON<CoolingStats>('/api/v1/cooling/stats', token);
}

export function fetchCoolingSettings(token: string) {
  return requestJSON<CoolingSettings>('/api/v1/cooling/settings', token);
}

export function saveCoolingSettings(token: string, input: CoolingSettingsInput) {
  return requestJSON<CoolingSettings>('/api/v1/cooling/settings', token, {
    body: JSON.stringify(input),
    method: 'PUT',
  });
}

export function createCoolingItem(token: string, input: CoolingItemInput) {
  return requestJSON<CoolingItem>('/api/v1/cooling/items', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function fetchCoolingItem(token: string, itemId: string) {
  return requestJSON<CoolingItem>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}`,
    token,
  );
}

export function deleteCoolingItem(token: string, itemId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function decideCoolingItem(token: string, itemId: string, input: CoolingDecisionInput) {
  return requestJSON<CoolingItem>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}/decision`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function extendCoolingItem(token: string, itemId: string) {
  return requestJSON<CoolingItem>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}/extend`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export function undoCoolingItem(token: string, itemId: string) {
  return requestJSON<CoolingItem>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}/undo`,
    token,
    {
      body: '{}',
      method: 'POST',
    },
  );
}

export async function fetchCoolingEvents(token: string, itemId: string) {
  const payload = await requestJSON<{ events: CoolingEvent[] }>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}/events`,
    token,
  );
  return payload.events;
}

export async function fetchCoolingEvidence(token: string, itemId: string) {
  const payload = await requestJSON<{ evidence: CoolingEvidence[] }>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}/evidence`,
    token,
  );
  return payload.evidence;
}

export async function uploadCoolingEvidence(
  token: string,
  itemId: string,
  file: { uri: string; name?: string; type?: string },
) {
  const form = new FormData();
  form.append(
    'file',
    {
      uri: file.uri,
      name: file.name ?? 'evidence.jpg',
      type: file.type ?? 'image/jpeg',
    } as unknown as Blob,
  );
  return requestJSON<CoolingEvidence>(
    `/api/v1/cooling/items/${encodeURIComponent(itemId)}/evidence`,
    token,
    {
      body: form,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
}

export function clearCoolingData(token: string) {
  return requestJSON<{ success: boolean }>('/api/v1/cooling/data', token, {
    method: 'DELETE',
  });
}

export async function exportCoolingData(token: string, format: 'csv' | 'json') {
  const response = await fetch(
    `${getAPIBaseUrl()}/api/v1/cooling/export?format=${format}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) {
    throw new CoolingAPIError('export_failed', response.status);
  }
  const text = await response.text();
  const fileName = `impulse-cooler-export.${format}`;
  if (Platform.OS === 'web') {
    const blob = new Blob([text], {
      type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const FileSystem = await import('expo-file-system/legacy');
  const target = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(target, text);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target);
  }
}

export function getCoolingErrorMessage(error: unknown) {
  if (!(error instanceof CoolingAPIError)) {
    return '暂时无法连接冲动消费冷静器，请稍后重试。';
  }
  const messages: Record<string, string> = {
    cooling_invalid_input: '请检查填写内容是否完整，价格需大于 0。',
    cooling_not_found: '记录不存在或已被删除。',
    rate_limited: '请求过于频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] ?? '冲动消费冷静器操作失败，请稍后重试。';
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
  if (!response.ok) {
    throw new CoolingAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
