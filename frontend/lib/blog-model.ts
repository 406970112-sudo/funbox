import type { BlogComment, BlogPost } from '@/types/blog';

export function applyBlogLike(post: BlogPost, liked: boolean): BlogPost {
  return {
    ...post,
    likedByMe: liked,
    likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
  };
}

export function applyBlogComment(post: BlogPost, comment: BlogComment): BlogPost {
  return {
    ...post,
    commentCount: post.commentCount + 1,
    recentComments: [comment, ...post.recentComments].slice(0, 2),
  };
}

export function removeBlogPostById(items: BlogPost[], postId: string): BlogPost[] {
  return items.filter((item) => item.id !== postId);
}

export function replaceBlogPostById(items: BlogPost[], updated: BlogPost): BlogPost[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

export function buildBlogCommentThread(comments: BlogComment[]) {
  const roots: BlogComment[] = [];
  const childrenByParent = new Map<string, BlogComment[]>();
  for (const comment of comments) {
    if (!comment.parentId) {
      roots.push(comment);
      continue;
    }
    const children = childrenByParent.get(comment.parentId) ?? [];
    children.push(comment);
    childrenByParent.set(comment.parentId, children);
  }
  return { childrenByParent, roots };
}

export function blogVisibilityLabel(visibility: BlogPost['visibility']) {
  switch (visibility) {
    case 'public':
      return '完全公开';
    case 'friends':
      return '好友可见';
    case 'self':
      return '仅自己可见';
  }
}

export function formatBlogWordCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万字`;
  return `${value} 字`;
}
