import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import type {
  AdminMoment,
  Moment,
  MomentAttachmentInput,
  MomentAttachmentOption,
  MomentComment,
  MomentImageAsset,
  MomentNotification,
  MomentNotificationPage,
  MomentPage,
} from '@/types/moments';
import type { SocialUser } from '@/types/social';

type ErrorPayload = {
  error?: string;
};

export class MomentsAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'MomentsAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function listMomentFeed(
  token: string,
  options: { cursor?: string; scope?: '' | 'mine' } = {},
) {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.scope) query.set('scope', options.scope);
  const response = await requestJSON<MomentPage & ErrorPayload>(
    `/api/v1/moments/feed?${query.toString()}`,
    token,
  );
  return {
    moments: response.moments.map(resolveMoment),
    nextCursor: response.nextCursor,
  };
}

export async function getMoment(token: string, momentId: string) {
  const response = await requestJSON<{ moment: Moment } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}`,
    token,
  );
  return resolveMoment(response.moment);
}

export async function createMoment(
  token: string,
  input: {
    attachment?: MomentAttachmentInput | null;
    body: string;
    images: MomentImageAsset[];
    visibility: 'friends' | 'self';
  },
) {
  const formData = new FormData();
  formData.append('body', input.body);
  formData.append('visibility', input.visibility);
  if (input.attachment) {
    formData.append('attachmentType', input.attachment.type);
    formData.append('attachmentRefId', input.attachment.refId);
    formData.append('attachmentSource', input.attachment.source);
  }
  for (const asset of input.images) {
    const fileName = asset.fileName || `moment-${Date.now()}.jpg`;
    if (typeof asset.uri === 'string' && asset.uri.startsWith('blob:')) {
      const blobResponse = await fetch(asset.uri);
      const blob = await blobResponse.blob();
      formData.append('images', blob, fileName);
    } else {
      formData.append(
        'images',
        {
          name: fileName,
          type: asset.mimeType || 'image/jpeg',
          uri: asset.uri,
        } as never,
      );
    }
  }
  const response = await requestJSON<{ moment: Moment } & ErrorPayload>(
    '/api/v1/moments',
    token,
    {
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
      method: 'POST',
    },
  );
  return resolveMoment(response.moment);
}

export async function updateMomentVisibility(
  token: string,
  momentId: string,
  visibility: 'friends' | 'self',
) {
  const response = await requestJSON<{ moment: Moment } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}`,
    token,
    {
      body: JSON.stringify({ visibility }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    },
  );
  return resolveMoment(response.moment);
}

export async function deleteMoment(token: string, momentId: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function likeMoment(token: string, momentId: string) {
  const response = await requestJSON<{ liked: boolean } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}/like`,
    token,
    { body: '{}', method: 'POST' },
  );
  return response.liked;
}

export async function unlikeMoment(token: string, momentId: string) {
  const response = await requestJSON<{ liked: boolean } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}/like`,
    token,
    { method: 'DELETE' },
  );
  return response.liked;
}

export async function listMomentLikes(token: string, momentId: string) {
  const response = await requestJSON<{
    likes: Array<{
      avatarUrl: string;
      displayName: string;
      id: string;
      online: boolean;
      role?: SocialUser['role'];
      username: string;
    }>;
    nextCursor: string;
  } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}/likes`,
    token,
  );
  return {
    likes: response.likes.map(resolveSocialUser),
    nextCursor: response.nextCursor,
  };
}

export async function createMomentComment(
  token: string,
  momentId: string,
  input: {
    body: string;
    mentionUserIds?: string[];
    parentId?: string;
  },
) {
  const response = await requestJSON<{ comment: MomentComment } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}/comments`,
    token,
    {
      body: JSON.stringify({
        body: input.body,
        mentionUserIds: input.mentionUserIds ?? [],
        parentId: input.parentId ?? '',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
  return resolveMomentComment(response.comment);
}

export async function listMomentComments(token: string, momentId: string) {
  const response = await requestJSON<{
    comments: MomentComment[];
    nextCursor: string;
  } & ErrorPayload>(`/api/v1/moments/${encodeURIComponent(momentId)}/comments`, token);
  return {
    comments: response.comments.map(resolveMomentComment),
    nextCursor: response.nextCursor,
  };
}

export async function deleteMomentComment(token: string, commentId: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/moment-comments/${encodeURIComponent(commentId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function listMomentNotifications(token: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await requestJSON<MomentNotificationPage & ErrorPayload>(
    `/api/v1/moments/notifications${query}`,
    token,
  );
  return {
    items: response.items.map(resolveMomentNotification),
    nextCursor: response.nextCursor,
    unreadCount: response.unreadCount,
  };
}

export async function markMomentNotificationsRead(token: string, momentId?: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    '/api/v1/moments/notifications/read',
    token,
    {
      body: JSON.stringify({ momentId: momentId ?? '' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export async function getMomentUnreadCount(token: string) {
  const response = await requestJSON<{ unreadCount: number } & ErrorPayload>(
    '/api/v1/moments/unread-count',
    token,
  );
  return response.unreadCount;
}

export async function listMomentAttachmentOptions(token: string) {
  const response = await requestJSON<{ items: MomentAttachmentOption[] } & ErrorPayload>(
    '/api/v1/moments/attachment-options',
    token,
  );
  return response.items;
}

export async function reportMoment(token: string, momentId: string, reason: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/moments/${encodeURIComponent(momentId)}/report`,
    token,
    {
      body: JSON.stringify({ reason }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export async function adminListMoments(token: string) {
  const response = await requestJSON<{
    moments: AdminMoment[];
    nextCursor: string;
  } & ErrorPayload>('/api/v1/admin/moments', token);
  return {
    moments: response.moments.map((item) => ({
      ...resolveMoment(item),
      reportCount: item.reportCount,
    })),
    nextCursor: response.nextCursor,
  };
}

export async function adminHideMoment(token: string, momentId: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/admin/moments/${encodeURIComponent(momentId)}/hide`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function getMomentErrorMessage(error: unknown) {
  if (!(error instanceof MomentsAPIError)) {
    return '朋友圈暂时无法同步，请稍后重试。';
  }
  const messages: Record<string, string> = {
    comment_invalid: '评论内容需要 1-200 个字符。',
    forbidden: '当前账号无权查看或操作这条动态。',
    moment_attachment_invalid: '战绩卡片引用无效，请重新选择。',
    moment_body_invalid: '动态内容需要 1-500 个字符。',
    moment_image_too_large: '单张图片不能超过 5MB。',
    moment_images_too_many: '最多只能上传 9 张图片。',
    moment_image_type_invalid: '图片仅支持 JPG、PNG 或 WebP。',
    not_found: '这条动态已不存在或已删除。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '朋友圈操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new MomentsAPIError(
      (payload as ErrorPayload).error || 'request_failed',
      response.status,
    );
  }
  return payload;
}

function resolveMoment(moment: Moment): Moment {
  return {
    ...moment,
    author: resolveSocialUser(moment.author),
    images: moment.images.map((image) => ({
      ...image,
      url: resolveMediaURL(image.url),
    })),
    recentLikers: moment.recentLikers.map(resolveSocialUser),
    recentComments: moment.recentComments.map(resolveMomentComment),
  };
}

function resolveMomentComment(comment: MomentComment): MomentComment {
  return { ...comment, author: resolveSocialUser(comment.author) };
}

function resolveMomentNotification(
  notification: MomentNotification,
): MomentNotification {
  return { ...notification, actor: resolveSocialUser(notification.actor) };
}

function resolveSocialUser(user: {
  avatarUrl: string;
  displayName: string;
  id: string;
  online: boolean;
  role?: SocialUser['role'];
  username: string;
}): SocialUser {
  return { ...user, avatarUrl: resolveAvatarURL(user.avatarUrl) };
}

function resolveMediaURL(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${getAPIBaseUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}
