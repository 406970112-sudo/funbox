import { Platform } from 'react-native';

import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  FeedbackAsset,
  FeedbackCreated,
  FeedbackKind,
  FeedbackPage,
  FeedbackSubmission,
} from '@/types/feedback';

type APIErrorPayload = {
  error?: string;
};

export class FeedbackAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'FeedbackAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function submitFeedback(
  token: string,
  input: {
    assets: FeedbackAsset[];
    category?: string;
    description: string;
    kind: FeedbackKind;
    title?: string;
  },
) {
  const formData = new FormData();
  formData.append('kind', input.kind);
  if (input.title) formData.append('title', input.title);
  if (input.category) formData.append('category', input.category);
  formData.append('description', input.description);
  for (const asset of input.assets) {
    await appendFeedbackAsset(formData, asset);
  }
  return requestFeedbackJSON<FeedbackCreated>('/api/v1/feedback', token, {
    body: formData,
    method: 'POST',
  });
}

export function listMyFeedback(token: string, limit = 30, offset = 0) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestFeedbackJSON<FeedbackPage>(`/api/v1/feedback/mine?${query}`, token);
}

export function getFeedback(token: string, feedbackId: string) {
  return requestFeedbackJSON<{ item: FeedbackSubmission }>(
    `/api/v1/feedback/${encodeURIComponent(feedbackId)}`,
    token,
  );
}

export function listFeedbackNotifications(token: string, limit = 30, offset = 0) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestFeedbackJSON<FeedbackPage>(`/api/v1/feedback/notifications?${query}`, token);
}

export async function markFeedbackNotificationsRead(token: string, feedbackIds: string[] = []) {
  return requestFeedbackJSON<{ unreadCount: number }>(
    '/api/v1/feedback/notifications/read',
    token,
    {
      body: JSON.stringify({ feedbackIds }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export function getFeedbackUnreadCount(token: string) {
  return requestFeedbackJSON<{ unreadCount: number }>(
    '/api/v1/feedback/notifications?limit=1&offset=0',
    token,
  );
}

export function listAdminFeedback(
  token: string,
  options: { kind?: string; limit?: number; offset?: number; q?: string; status?: string } = {},
) {
  const { kind = '', limit = 30, offset = 0, q = '', status = '' } = options;
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (kind) query.set('kind', kind);
  if (status) query.set('status', status);
  if (q) query.set('q', q);
  return requestFeedbackJSON<FeedbackPage>(`/api/v1/admin/feedback?${query}`, token);
}

export function resolveFeedback(
  token: string,
  feedbackId: string,
  input: { reply?: string; status: 'processing' | 'resolved' },
) {
  return requestFeedbackJSON<{ item: FeedbackSubmission }>(
    `/api/v1/admin/feedback/${encodeURIComponent(feedbackId)}/resolve`,
    token,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  );
}

export function feedbackImageSource(token: string, imagePath: string) {
  return {
    headers: { Authorization: `Bearer ${token}` },
    uri: `${getAPIBaseUrl()}${imagePath}`,
  };
}

export function getFeedbackErrorMessage(error: unknown) {
  if (!(error instanceof FeedbackAPIError)) {
    return '反馈服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    admin_required: '当前账号没有管理员权限。',
    description_invalid: '问题描述需要填写 10 到 1000 个字符。',
    feedback_category_invalid: '请选择有效的功能分类。',
    feedback_kind_invalid: '反馈类型无效。',
    feedback_not_found: '反馈记录不存在或无权查看。',
    feedback_reply_invalid: '处理结果需要填写 10 到 1000 个字符。',
    feedback_status_invalid: '反馈状态变更无效。',
    feedback_title_invalid: '功能名称需要填写 5 到 40 个字符。',
    feedback_image_too_large: '单张图片不能超过 5 MB。',
    feedback_image_type_invalid: '图片仅支持 JPG、PNG 或 WebP 格式。',
    feedback_images_too_many: '最多只能上传 3 张图片。',
    feedback_upload_too_large: '上传内容过大，请减少图片数量或压缩后重试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '反馈提交失败，请稍后重试。';
}

async function requestFeedbackJSON<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & APIErrorPayload;
  if (!response.ok) {
    throw new FeedbackAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}

async function appendFeedbackAsset(formData: FormData, asset: FeedbackAsset) {
  const fileName = asset.fileName || 'feedback-image.jpg';
  if (Platform.OS === 'web') {
    const response = await fetch(asset.uri);
    formData.append('images', await response.blob(), fileName);
    return;
  }
  formData.append('images', {
    name: fileName,
    type: asset.mimeType || 'image/jpeg',
    uri: asset.uri,
  } as never);
}
