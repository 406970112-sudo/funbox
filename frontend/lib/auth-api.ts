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

type RecoveryQuestionResponse = {
  securityQuestion: string;
};

type RecoveryTokenResponse = {
  recoveryToken: string;
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

export async function register(
  username: string,
  password: string,
  displayName: string,
  securityQuestion: string,
  securityAnswer: string,
) {
  const session = await requestJSON<AuthSession>('/api/v1/auth/register', {
    body: JSON.stringify({
      displayName,
      password,
      securityAnswer,
      securityQuestion,
      username,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return withResolvedSession(session);
}

export async function getPasswordRecoveryQuestion(username: string) {
  const response = await requestJSON<RecoveryQuestionResponse>(
    '/api/v1/auth/password-recovery/question',
    {
      body: JSON.stringify({ username }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  return response.securityQuestion;
}

export async function verifyPasswordRecoveryAnswer(username: string, securityAnswer: string) {
  const response = await requestJSON<RecoveryTokenResponse>(
    '/api/v1/auth/password-recovery/verify',
    {
      body: JSON.stringify({ securityAnswer, username }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  return response.recoveryToken;
}

export async function resetPasswordWithRecoveryToken(
  recoveryToken: string,
  newPassword: string,
) {
  await requestJSON<{ success: boolean }>('/api/v1/auth/password-recovery/reset', {
    body: JSON.stringify({ newPassword, recoveryToken }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
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
    invalid_credentials: '手机号或密码不正确。',
    password_invalid: '密码需为 8 至 72 个字符，并同时包含字母和数字。',
    rate_limited: '操作太频繁，请稍后再试。',
    recovery_answer_invalid: '密保答案不正确。',
    recovery_locked: '密保答案连续输错 5 次，请 30 分钟后再试。',
    recovery_token_invalid: '本次身份验证已失效，请重新找回密码。',
    recovery_unavailable: '该手机号未注册，或账号尚未设置密保问题。',
    security_answer_invalid: '密保答案需为 2 至 32 个字符。',
    security_question_invalid: '请选择有效的密保问题。',
    unauthorized: '登录状态已失效，请重新登录。',
    username_invalid: '请输入正确的 11 位中国大陆手机号。',
    username_taken: '该手机号已经注册，可直接登录或找回密码。',
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
