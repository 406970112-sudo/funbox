import { Platform } from 'react-native';

import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  DaysLeftSource,
  FocusSource,
  TimeCapsule,
  TimeCapsuleContent,
  TimeCapsuleContentInput,
  TimeCapsuleDetail,
  TimeCapsuleHome,
  TimeCapsuleInput,
  TimeCapsuleMedia,
  TimeCapsuleNotification,
} from '@/types/time-capsule';

type ErrorPayload = { error?: string };

export class TimeCapsuleAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'TimeCapsuleAPIError';
    this.code = code;
    this.status = status;
  }
}

export type TimeCapsuleMediaAsset = {
  uri: string;
  name?: string;
  type?: string;
  durationMs?: number;
};

export function fetchTimeCapsuleHome(token: string) {
  return requestJSON<TimeCapsuleHome>('/api/v1/time-capsule/home', token);
}

export function createTimeCapsule(token: string, input: TimeCapsuleInput) {
  return requestJSON<{ capsule: TimeCapsule }>('/api/v1/time-capsules', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function fetchTimeCapsule(token: string, capsuleId: string) {
  return requestJSON<TimeCapsuleDetail>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}`,
    token,
  );
}

export function updateTimeCapsule(token: string, capsuleId: string, input: Partial<TimeCapsuleInput>) {
  return requestJSON<{ capsule: TimeCapsule }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteTimeCapsule(token: string, capsuleId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function addTimeCapsuleContent(
  token: string,
  capsuleId: string,
  input: TimeCapsuleContentInput,
) {
  return requestJSON<{ content: TimeCapsuleContent }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/contents`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function updateTimeCapsuleContent(
  token: string,
  capsuleId: string,
  contentId: string,
  input: Partial<TimeCapsuleContentInput>,
) {
  return requestJSON<{ content: TimeCapsuleContent }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/contents/${encodeURIComponent(contentId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteTimeCapsuleContent(token: string, capsuleId: string, contentId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/contents/${encodeURIComponent(contentId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function uploadTimeCapsuleMedia(
  token: string,
  capsuleId: string,
  kind: 'photo' | 'voice',
  asset: TimeCapsuleMediaAsset,
) {
  const form = new FormData();
  form.append('kind', kind);
  if (asset.durationMs != null) form.append('durationMs', String(asset.durationMs));
  const fileName = asset.name || (kind === 'photo' ? 'capsule.jpg' : 'capsule.m4a');
  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    form.append('file', blob, fileName);
  } else {
    form.append(
      'file',
      {
        name: fileName,
        type: asset.type || (kind === 'photo' ? 'image/jpeg' : 'audio/mp4'),
        uri: asset.uri,
      } as unknown as Blob,
    );
  }
  const payload = await requestJSON<{ media: TimeCapsuleMedia; draftUrl: string }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/media`,
    token,
    { body: form, method: 'POST' },
  );
  return {
    ...payload,
    draftUrl: resolveMediaURL(payload.draftUrl),
  };
}

export function acceptTimeCapsuleInvite(token: string, capsuleId: string) {
  return requestJSON<{ capsule: TimeCapsule }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/accept`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function declineTimeCapsuleInvite(token: string, capsuleId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/decline`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function exitTimeCapsule(token: string, capsuleId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/exit`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function sealTimeCapsule(token: string, capsuleId: string) {
  return requestJSON<{ capsule: TimeCapsule }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/seal`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function archiveTimeCapsule(token: string, capsuleId: string) {
  return requestJSON<{ capsule: TimeCapsule }>(
    `/api/v1/time-capsules/${encodeURIComponent(capsuleId)}/archive`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function fetchTimeCapsuleBirthday(token: string) {
  return requestJSON<{ birthday: string }>('/api/v1/time-capsule/sources/birthday', token);
}

export async function fetchTimeCapsuleDaysLeftSources(token: string) {
  const payload = await requestJSON<{ sources: DaysLeftSource[] }>(
    '/api/v1/time-capsule/sources/days-left',
    token,
  );
  return payload.sources;
}

export async function fetchTimeCapsuleFocusSources(token: string) {
  const payload = await requestJSON<{ sources: FocusSource[] }>(
    '/api/v1/time-capsule/sources/focus',
    token,
  );
  return payload.sources;
}

export async function fetchTimeCapsuleNotifications(token: string) {
  const payload = await requestJSON<{ notifications: TimeCapsuleNotification[] }>(
    '/api/v1/time-capsule/notifications',
    token,
  );
  return payload.notifications;
}

export function markTimeCapsuleNotificationsRead(token: string, ids: string[]) {
  return requestJSON<{ success: boolean }>('/api/v1/time-capsule/notifications/read', token, {
    body: JSON.stringify({ ids }),
    method: 'POST',
  });
}

export function getTimeCapsuleErrorMessage(error: unknown) {
  if (!(error instanceof TimeCapsuleAPIError)) {
    return '暂时无法连接时间胶囊服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    invalid_media_token: '媒体访问地址已失效，请重新进入胶囊。',
    media_not_available: '封存期间内容不可查看。',
    rate_limited: '操作太频繁，请稍后再试。',
    time_capsule_forbidden: '当前账号无法执行这个操作。',
    time_capsule_invalid_input: '请检查胶囊标题、开启条件或内容是否填写完整。',
    time_capsule_not_found: '时间胶囊不存在或已删除。',
    unauthorized: '登录状态已失效，请重新登录。',
    unsupported_file_type: '文件格式不支持，照片仅支持 JPG/PNG/WebP，语音仅支持 M4A/WAV/MP3。',
  };
  return messages[error.code] ?? '时间胶囊操作失败，请稍后重试。';
}

function resolveMediaURL(value: string) {
  if (!value || /^https?:\/\//i.test(value)) return value;
  return `${getAPIBaseUrl()}${value.startsWith('/') ? '' : '/'}${value}`;
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
    throw new TimeCapsuleAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
