import type { Moment, MomentComment } from '@/types/moments';

export function applyMomentLike(moment: Moment, liked: boolean): Moment {
  return {
    ...moment,
    likedByMe: liked,
    likeCount: Math.max(0, moment.likeCount + (liked ? 1 : -1)),
  };
}

export function applyMomentComment(moment: Moment, comment: MomentComment): Moment {
  return {
    ...moment,
    commentCount: moment.commentCount + 1,
    recentComments: [comment, ...moment.recentComments].slice(0, 2),
  };
}

export function removeMomentById(items: Moment[], momentId: string): Moment[] {
  return items.filter((item) => item.id !== momentId);
}

export function replaceMomentById(items: Moment[], updated: Moment): Moment[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

export function buildCommentThread(comments: MomentComment[]) {
  const roots: MomentComment[] = [];
  const childrenByParent = new Map<string, MomentComment[]>();
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
