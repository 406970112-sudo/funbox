import { Platform } from 'react-native';

import type { AuthSession, AuthUser, AvatarAsset } from '@/types/auth';

const defaultApiBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://127.0.0.1:3000';

type APIErrorPayload = {
  error?: string;
};

type UserResponse = {
  user: AuthUser;
};

export class AuthAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'AuthAPIError';
    this.code = code;
    this.status = status;
  }
}

export function getAPIBaseUrl() {
  return (
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_VOICE_SERVER_URL?.trim() ||
    defaultApiBaseUrl
  ).replace(/\/$/, '');
}

export function resolveAvatarURL(avatarUrl: string) {
  if (!avatarUrl || /^https?:\/\//i.test(avatarUrl)) {
    return avatarUrl;
  }
  return `${getAPIBaseUrl()}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
}

export async function login(username: string, password: string) {
  const session = await requestJSON<AuthSession>('/api/v1/auth/login', {
    body: JSON.stringify({ password, username }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return withResolvedSession(session);
}

export async function register(username: string, password: string, displayName: string) {
  const session = await requestJSON<AuthSession>('/api/v1/auth/register', {
    body: JSON.stringify({ displayName, password, username }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return withResolvedSession(session);
}

export async function getCurrentUser(token: string) {
  const response = await requestJSON<UserResponse>('/api/v1/auth/me', withToken(token));
  return withResolvedAvatar(response.user);
}

export async function updateDisplayName(token: string, displayName: string) {
  const response = await requestJSON<UserResponse>('/api/v1/users/me', {
    ...withToken(token),
    body: JSON.stringify({ displayName }),
    headers: {
      ...withToken(token).headers,
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
  return withResolvedAvatar(response.user);
}

export async function changePassword(token: string, currentPassword: string, newPassword: string) {
  const session = await requestJSON<AuthSession>('/api/v1/users/me/password', {
    body: JSON.stringify({ currentPassword, newPassword }),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
  return withResolvedSession(session);
}

export async function uploadAvatar(token: string, asset: AvatarAsset) {
  const formData = new FormData();
  const fileName = asset.fileName || `avatar.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`;

  if (Platform.OS === 'web') {
    const assetResponse = await fetch(asset.uri);
    const blob = await assetResponse.blob();
    formData.append('avatar', blob, fileName);
  } else {
    formData.append(
      'avatar',
      {
        name: fileName,
        type: asset.mimeType || 'image/jpeg',
        uri: asset.uri,
      } as never,
    );
  }

  const response = await requestJSON<UserResponse>('/api/v1/users/me/avatar', {
    body: formData,
    headers: { Authorization: `Bearer ${token}` },
    method: 'POST',
  });
  return withResolvedAvatar(response.user);
}

export function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof AuthAPIError)) {
    return '暂时无法连接账户服务，请稍后重试。';
  }

  const messages: Record<string, string> = {
    avatar_required: '请选择一张头像图片。',
    avatar_too_large: '头像不能超过 3 MB。',
    avatar_type_invalid: '头像仅支持 JPG 或 PNG 格式。',
    current_password_invalid: '当前密码不正确。',
    display_name_invalid: '昵称需为 1 至 32 个字符。',
    invalid_credentials: '账号或密码不正确。',
    password_invalid: '密码需为 8 至 72 个字符。',
    rate_limited: '操作太频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
    username_invalid: '账号需为 3 至 32 位英文、数字或 . _ -。',
    username_taken: '这个账号已经被使用。',
  };

  return messages[error.code] || '账户操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${getAPIBaseUrl()}${path}`, options);
  const payload = (await response.json().catch(() => ({}))) as T & APIErrorPayload;
  if (!response.ok) {
    throw new AuthAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}

function withToken(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function withResolvedAvatar(user: AuthUser): AuthUser {
  return { ...user, avatarUrl: resolveAvatarURL(user.avatarUrl) };
}

function withResolvedSession(session: AuthSession): AuthSession {
  return { ...session, user: withResolvedAvatar(session.user) };
}
