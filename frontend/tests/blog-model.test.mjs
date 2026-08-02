import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyBlogComment,
  applyBlogLike,
  blogVisibilityLabel,
  buildBlogCommentThread,
  formatBlogWordCount,
  removeBlogPostById,
  replaceBlogPostById,
} from '../lib/blog-model.ts';

function post(overrides = {}) {
  return {
    author: {
      avatarUrl: '',
      displayName: 'Alice',
      id: 'alice',
      online: false,
      username: 'alice',
    },
    body: '真实正文',
    canDelete: true,
    commentCount: 0,
    coverUrl: '',
    id: 'post-1',
    likeCount: 0,
    likedByMe: false,
    publishedAt: '2026-08-02T00:00:00Z',
    recentComments: [],
    status: 'active',
    summary: '',
    title: '标题',
    visibility: 'public',
    wordCount: 4,
    ...overrides,
  };
}

function comment(overrides = {}) {
  return {
    author: {
      avatarUrl: '',
      displayName: 'Bob',
      id: 'bob',
      online: false,
      username: 'bob',
    },
    body: '写得很好',
    canDelete: false,
    createdAt: '2026-08-02T00:00:00Z',
    id: 'comment-1',
    postId: 'post-1',
    ...overrides,
  };
}

test('applies optimistic like and unlike states', () => {
  const liked = applyBlogLike(post(), true);
  assert.equal(liked.likedByMe, true);
  assert.equal(liked.likeCount, 1);
  assert.equal(applyBlogLike(liked, false).likeCount, 0);
  assert.equal(applyBlogLike(post({ likeCount: 0 }), false).likeCount, 0);
});

test('inserts a real comment into recent comments', () => {
  const created = applyBlogComment(post(), comment());
  assert.equal(created.commentCount, 1);
  assert.equal(created.recentComments[0].id, 'comment-1');
});

test('removes and replaces posts by id', () => {
  const first = post();
  const second = post({ id: 'post-2' });
  assert.deepEqual(removeBlogPostById([first, second], 'post-1'), [second]);
  const updated = post({ title: '修改后' });
  assert.equal(replaceBlogPostById([first], updated)[0].title, '修改后');
});

test('builds comment threads and formats metadata', () => {
  const root = comment();
  const reply = comment({ id: 'comment-2', parentId: 'comment-1' });
  const thread = buildBlogCommentThread([reply, root]);
  assert.equal(thread.roots.length, 1);
  assert.equal(thread.childrenByParent.get('comment-1').length, 1);
  assert.equal(blogVisibilityLabel('public'), '完全公开');
  assert.equal(blogVisibilityLabel('friends'), '好友可见');
  assert.equal(blogVisibilityLabel('self'), '仅自己可见');
  assert.equal(formatBlogWordCount(1200), '1200 字');
  assert.equal(formatBlogWordCount(0), '');
});
