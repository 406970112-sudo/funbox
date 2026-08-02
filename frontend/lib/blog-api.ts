import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import type {
  AdminBlogPost,
  BlogComment,
  BlogCommentPage,
  BlogCoverAsset,
  BlogNotification,
  BlogNotificationPage,
  BlogPage,
  BlogPost,
  BlogVisibility,
} from '@/types/blog';
import type { SocialUser } from '@/types/social';

type ErrorPayload = {
  error?: string;
};

export class BlogAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'BlogAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function listBlogFeed(
  token: string,
  options: { cursor?: string; tab: 'friends' | 'public' },
) {
  const query = new URLSearchParams({ tab: options.tab });
  if (options.cursor) query.set('cursor', options.cursor);
  const response = await requestJSON<BlogPage & ErrorPayload>(
    `/api/v1/blog/feed?${query.toString()}`,
    token,
  );
  return {
    nextCursor: response.nextCursor,
    posts: response.posts.map(resolveBlogPost),
  };
}

export async function listPublicBlogFeed(options: { cursor?: string } = {}) {
  const query = new URLSearchParams({ tab: 'public' });
  if (options.cursor) query.set('cursor', options.cursor);
  const response = await requestJSON<BlogPage & ErrorPayload>(
    `/api/v1/blog/feed?${query.toString()}`,
    '',
  );
  return {
    nextCursor: response.nextCursor,
    posts: response.posts.map(resolveBlogPost),
  };
}

export async function getBlogPost(token: string, postId: string) {
  const response = await requestJSON<{ post: BlogPost } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}`,
    token,
  );
  return resolveBlogPost(response.post);
}

export async function createBlogPost(
  token: string,
  input: {
    body: string;
    cover?: BlogCoverAsset | null;
    summary: string;
    title: string;
    visibility: BlogVisibility;
  },
) {
  const formData = new FormData();
  formData.append('title', input.title);
  formData.append('summary', input.summary);
  formData.append('body', input.body);
  formData.append('visibility', input.visibility);
  if (input.cover) {
    await appendCover(formData, input.cover);
  }
  const response = await requestJSON<{ post: BlogPost } & ErrorPayload>(
    '/api/v1/blog/posts',
    token,
    {
      body: formData,
      headers: { Authorization: `Bearer ${token}` },
      method: 'POST',
    },
  );
  return resolveBlogPost(response.post);
}

export async function updateBlogPost(
  token: string,
  postId: string,
  input: {
    body: string;
    summary: string;
    title: string;
    visibility: BlogVisibility;
  },
) {
  const response = await requestJSON<{ post: BlogPost } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}`,
    token,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    },
  );
  return resolveBlogPost(response.post);
}

export async function deleteBlogPost(token: string, postId: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function likeBlogPost(token: string, postId: string) {
  const response = await requestJSON<{ liked: boolean } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}/like`,
    token,
    { body: '{}', method: 'POST' },
  );
  return response.liked;
}

export async function unlikeBlogPost(token: string, postId: string) {
  const response = await requestJSON<{ liked: boolean } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}/like`,
    token,
    { method: 'DELETE' },
  );
  return response.liked;
}

export async function createBlogComment(
  token: string,
  postId: string,
  input: {
    body: string;
    mentionUserIds?: string[];
    parentId?: string;
  },
) {
  const response = await requestJSON<{ comment: BlogComment } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}/comments`,
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
  return resolveBlogComment(response.comment);
}

export async function listBlogComments(token: string, postId: string) {
  const response = await requestJSON<BlogCommentPage & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}/comments`,
    token,
  );
  return {
    comments: response.comments.map(resolveBlogComment),
    nextCursor: response.nextCursor,
  };
}

export async function deleteBlogComment(token: string, commentId: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/blog/comments/${encodeURIComponent(commentId)}`,
    token,
    { method: 'DELETE' },
  );
}

export async function reportBlogPost(token: string, postId: string, reason: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/blog/posts/${encodeURIComponent(postId)}/report`,
    token,
    {
      body: JSON.stringify({ reason }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export async function listMyBlogPosts(token: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await requestJSON<BlogPage & ErrorPayload>(
    `/api/v1/blog/me/posts${query}`,
    token,
  );
  return {
    nextCursor: response.nextCursor,
    posts: response.posts.map(resolveBlogPost),
  };
}

export async function listBlogNotifications(token: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await requestJSON<BlogNotificationPage & ErrorPayload>(
    `/api/v1/blog/notifications${query}`,
    token,
  );
  return {
    items: response.items.map(resolveBlogNotification),
    nextCursor: response.nextCursor,
    unreadCount: response.unreadCount,
  };
}

export async function markBlogNotificationsRead(token: string, postId?: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    '/api/v1/blog/notifications/read',
    token,
    {
      body: JSON.stringify({ postId: postId ?? '' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export async function getBlogUnreadCount(token: string) {
  const response = await requestJSON<{ unreadCount: number } & ErrorPayload>(
    '/api/v1/blog/unread-count',
    token,
  );
  return response.unreadCount;
}

export async function adminListBlogPosts(token: string) {
  const response = await requestJSON<{
    nextCursor: string;
    posts: AdminBlogPost[];
  } & ErrorPayload>('/api/v1/admin/blog/posts', token);
  return {
    nextCursor: response.nextCursor,
    posts: response.posts.map((item) => ({
      ...resolveBlogPost(item),
      reportCount: item.reportCount,
    })),
  };
}

export async function adminHideBlogPost(token: string, postId: string) {
  await requestJSON<{ success: boolean } & ErrorPayload>(
    `/api/v1/admin/blog/posts/${encodeURIComponent(postId)}/hide`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export function getBlogErrorMessage(error: unknown) {
  if (!(error instanceof BlogAPIError)) {
    return '博客暂时无法同步，请稍后重试。';
  }
  const messages: Record<string, string> = {
    blog_cover_too_large: '封面不能超过 2MB。',
    blog_cover_type_invalid: '封面仅支持 JPG、PNG 或 WebP。',
    blog_post_invalid: '标题 1-80 字、正文 1-10000 字，且可见范围必须有效。',
    comment_invalid: '评论内容需要 1-200 个字符。',
    forbidden: '当前账号无权查看或操作这篇文章。',
    not_found: '这篇文章已不存在或已删除。',
    report_exists: '你已报告过这篇文章。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '博客操作失败，请稍后重试。';
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
    throw new BlogAPIError(
      (payload as ErrorPayload).error || 'request_failed',
      response.status,
    );
  }
  return payload;
}

async function appendCover(formData: FormData, cover: BlogCoverAsset) {
  const fileName = cover.fileName || `blog-cover-${Date.now()}.jpg`;
  if (cover.uri.startsWith('blob:')) {
    const blobResponse = await fetch(cover.uri);
    const blob = await blobResponse.blob();
    formData.append('cover', blob, fileName);
  } else {
    formData.append(
      'cover',
      {
        name: fileName,
        type: cover.mimeType || 'image/jpeg',
        uri: cover.uri,
      } as never,
    );
  }
}

function resolveBlogPost(post: BlogPost): BlogPost {
  return {
    ...post,
    author: resolveSocialUser(post.author),
    coverUrl: resolveMediaURL(post.coverUrl),
    recentComments: post.recentComments.map(resolveBlogComment),
  };
}

function resolveBlogComment(comment: BlogComment): BlogComment {
  return { ...comment, author: resolveSocialUser(comment.author) };
}

function resolveBlogNotification(
  notification: BlogNotification,
): BlogNotification {
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
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${getAPIBaseUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}
