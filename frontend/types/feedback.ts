export type FeedbackAsset = {
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string;
  uri: string;
};

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
  createdAt: string;
  description: string;
  id: string;
  images: FeedbackImage[];
  user: FeedbackUser;
};

export type FeedbackPage = {
  items: FeedbackSubmission[];
  limit: number;
  offset: number;
  total: number;
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
