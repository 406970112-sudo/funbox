export type FeedbackAsset = {
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string;
  uri: string;
};

export type FeedbackKind = 'problem' | 'feature_request';

export type FeedbackStatus = 'pending' | 'processing' | 'resolved';

export type FeedbackCategory =
  | 'efficiency'
  | 'game'
  | 'other'
  | 'reading'
  | 'social'
  | 'tool';

export type FeedbackUser = {
  avatarUrl: string;
  displayName: string;
  id: string;
  username: string;
};

export type FeedbackImage = {
  contentType: string;
  id: string;
  path: string;
  sizeBytes: number;
  sortOrder: number;
};

export type FeedbackSubmission = {
  adminReply: string | null;
  category: string | null;
  createdAt: string;
  description: string;
  id: string;
  images: FeedbackImage[];
  kind: FeedbackKind;
  processedAt: string | null;
  read: boolean;
  replyUpdatedAt: string | null;
  status: FeedbackStatus;
  title: string | null;
  user: FeedbackUser;
};

export type FeedbackPage = {
  items: FeedbackSubmission[];
  limit: number;
  offset: number;
  total: number;
  unreadCount: number;
};

export type FeedbackCreated = {
  createdAt: string;
  id: string;
};

export type FeedbackValidationResult = {
  description?: string;
  error?:
    | 'description_invalid'
    | 'feedback_image_too_large'
    | 'feedback_image_type_invalid'
    | 'feedback_images_too_many';
};
