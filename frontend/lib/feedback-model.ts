import type { FeedbackAsset, FeedbackSubmission } from '@/types/feedback';

export const FEEDBACK_MIN_DESCRIPTION = 10;
export const FEEDBACK_MAX_DESCRIPTION = 1000;
export const FEEDBACK_MAX_IMAGES = 3;
export const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const FEEDBACK_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type FeedbackLayout = 'desktop' | 'mobile';

export type FeedbackValidationResult = {
  description?: string;
  error?:
    | 'description_invalid'
    | 'feedback_image_too_large'
    | 'feedback_image_type_invalid'
    | 'feedback_images_too_many';
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
