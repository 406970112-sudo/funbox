import type { SocialUser } from './social';

export type BlogVisibility = 'public' | 'friends' | 'self';
export type BlogStatus = 'active' | 'deleted' | 'hidden';

export type BlogComment = {
  author: SocialUser;
  body: string;
  canDelete: boolean;
  createdAt: string;
  id: string;
  parentId?: string;
  postId: string;
};

export type BlogNotification = {
  actor: SocialUser;
  commentId?: string;
  createdAt: string;
  id: string;
  postId?: string;
  preview: string;
  read: boolean;
  type: 'post.comment' | 'post.like' | 'post.mention' | 'post.reply';
};

export type BlogPost = {
  author: SocialUser;
  body: string;
  canDelete: boolean;
  commentCount: number;
  coverUrl: string;
  id: string;
  likeCount: number;
  likedByMe: boolean;
  publishedAt: string;
  recentComments: BlogComment[];
  status: BlogStatus;
  summary: string;
  title: string;
  visibility: BlogVisibility;
  wordCount: number;
};

export type BlogPage = {
  nextCursor: string;
  posts: BlogPost[];
};

export type BlogCommentPage = {
  comments: BlogComment[];
  nextCursor: string;
};

export type BlogNotificationPage = {
  items: BlogNotification[];
  nextCursor: string;
  unreadCount: number;
};

export type AdminBlogPost = BlogPost & {
  reportCount: number;
};

export type BlogCoverAsset = {
  fileName?: string;
  mimeType?: string;
  uri: string;
};
