import type { SocialUser } from './social';

export type MomentVisibility = 'friends' | 'self';
export type MomentStatus = 'active' | 'deleted' | 'hidden';

export type MomentImage = {
  height: number;
  url: string;
  width: number;
};

export type MomentAttachment = {
  gameId?: string;
  refId: string;
  result?: string;
  score?: number;
  title?: string;
  type: 'game_result';
};

export type MomentComment = {
  author: SocialUser;
  body: string;
  canDelete: boolean;
  createdAt: string;
  id: string;
  momentId: string;
  parentId?: string;
};

export type Moment = {
  attachments: MomentAttachment[];
  author: SocialUser;
  body: string;
  canDelete: boolean;
  commentCount: number;
  createdAt: string;
  id: string;
  images: MomentImage[];
  likeCount: number;
  likedByMe: boolean;
  recentComments: MomentComment[];
  recentLikers: SocialUser[];
  status: MomentStatus;
  updatedAt: string;
  visibility: MomentVisibility;
};

export type MomentPage = {
  moments: Moment[];
  nextCursor: string;
};

export type MomentNotificationType = 'comment' | 'like' | 'mention' | 'reply';

export type MomentNotification = {
  actor: SocialUser;
  commentId?: string;
  createdAt: string;
  id: string;
  momentId?: string;
  preview: string;
  read: boolean;
  type: MomentNotificationType;
};

export type MomentNotificationPage = {
  items: MomentNotification[];
  nextCursor: string;
  unreadCount: number;
};

export type MomentAttachmentOption = {
  createdAt: string;
  gameId: string;
  refId: string;
  result: string;
  source: 'match' | 'score';
  title: string;
  type: 'game_result';
};

export type AdminMoment = Moment & {
  reportCount: number;
};

export type MomentImageAsset = {
  fileName?: string;
  mimeType?: string;
  uri: string;
};

export type MomentAttachmentInput = {
  refId: string;
  source: 'match' | 'score';
  type: 'game_result';
};
