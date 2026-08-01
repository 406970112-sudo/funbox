import { Platform } from 'react-native';

import { getAPIBaseUrl } from '@/lib/auth-api';
import type { FeedbackAsset, FeedbackCreated, FeedbackPage } from '@/types/feedback';

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
  description: string,
  assets: FeedbackAsset[],
) {
  const formData = new FormData();
  formData.append('description', description);
  for (const asset of assets) {
    await appendFeedbackAsset(formData, asset);
  }
  return requestFeedbackJSON<FeedbackCreated>('/api/v1/feedback', token, {
    body: formData,
    method: 'POST',
  });
}

export function listAdminFeedback(token: string, limit = 30, offset = 0) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestFeedbackJSON<FeedbackPage>(`/api/v1/admin/feedback?${query}`, token);
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
