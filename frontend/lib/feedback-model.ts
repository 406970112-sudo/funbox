import type { FeedbackAsset, FeedbackSubmission } from '@/types/feedback';

export const FEEDBACK_MIN_DESCRIPTION = 10;
export const FEEDBACK_MAX_DESCRIPTION = 1000;
export const FEEDBACK_MIN_TITLE = 5;
export const FEEDBACK_MAX_TITLE = 40;
export const FEEDBACK_MAX_IMAGES = 3;
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const FEEDBACK_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const FEEDBACK_CATEGORIES = [
  { key: 'tool', label: '工具' },
  { key: 'game', label: '游戏' },
  { key: 'social', label: '社交' },
  { key: 'reading', label: '阅读' },
  { key: 'efficiency', label: '效率' },
  { key: 'other', label: '其他' },
] as const;

export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已处理',
};

export const FEEDBACK_KIND_LABELS: Record<string, string> = {
  problem: '问题反馈',
  feature_request: '功能建议',
};

export type FeedbackLayout = 'desktop' | 'mobile';

export type FeedbackValidationResult = {
  category?: string;
  description?: string;
  error?:
    | 'description_invalid'
    | 'feedback_category_invalid'
    | 'feedback_image_too_large'
    | 'feedback_image_type_invalid'
    | 'feedback_images_too_many'
    | 'feedback_kind_invalid'
    | 'feedback_title_invalid';
  title?: string;
};

export function feedbackLayoutForWidth(width: number): FeedbackLayout {
  return width < 768 ? 'mobile' : 'desktop';
}

export function validateFeedback(
  description: string,
  assets: FeedbackAsset[],
): FeedbackValidationResult {
  const normalized = description.trim();
  const length = Array.from(normalized).length;
  if (length < FEEDBACK_MIN_DESCRIPTION || length > FEEDBACK_MAX_DESCRIPTION) {
    return { error: 'description_invalid' };
  }
  if (assets.length > FEEDBACK_MAX_IMAGES) {
    return { error: 'feedback_images_too_many' };
  }
  for (const asset of assets) {
    if (asset.fileSize != null && asset.fileSize > FEEDBACK_MAX_IMAGE_BYTES) {
      return { error: 'feedback_image_too_large' };
    }
    if (asset.mimeType && !FEEDBACK_IMAGE_TYPES.has(asset.mimeType)) {
      return { error: 'feedback_image_type_invalid' };
    }
  }
  return { description: normalized };
}

export function validateFeatureFeedback(
  title: string,
  category: string,
  description: string,
  assets: FeedbackAsset[],
): FeedbackValidationResult {
  const normalizedTitle = title.trim();
  const titleLength = Array.from(normalizedTitle).length;
  if (titleLength < FEEDBACK_MIN_TITLE || titleLength > FEEDBACK_MAX_TITLE) {
    return { error: 'feedback_title_invalid' };
  }
  if (!FEEDBACK_CATEGORIES.some((item) => item.key === category)) {
    return { error: 'feedback_category_invalid' };
  }
  const base = validateFeedback(description, assets);
  if (base.error) return base;
  return { ...base, category, description: base.description, title: normalizedTitle };
}

export function feedbackKindLabel(kind: string) {
  return FEEDBACK_KIND_LABELS[kind] || '反馈';
}

export function feedbackStatusLabel(status: string) {
  return FEEDBACK_STATUS_LABELS[status] || status;
}

export function feedbackCategoryLabel(category: string | null) {
  if (!category) return '';
  return FEEDBACK_CATEGORIES.find((item) => item.key === category)?.label || category;
}

export function feedbackNotificationTitle(kind: string) {
  return kind === 'feature_request' ? '功能建议已处理' : '问题反馈已处理';
}

export function shouldShowFeedbackEntry(authStatus: string) {
  return authStatus === 'authenticated';
}

export function mergeFeedbackPages(
  current: FeedbackSubmission[],
  incoming: FeedbackSubmission[],
) {
  const seen = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export function resolveFeedbackSelection(
  items: FeedbackSubmission[],
  selectedID: string | null,
): string | null {
  if (!selectedID || !items.some((item) => item.id === selectedID)) {
    return items[0]?.id ?? null;
  }
  return selectedID;
}
