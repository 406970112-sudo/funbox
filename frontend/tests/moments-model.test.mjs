import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMomentComment,
  applyMomentLike,
  buildCommentThread,
  removeMomentById,
  replaceMomentById,
} from '../lib/moments-model.ts';

function moment(overrides = {}) {
  return {
    attachments: [],
    author: {
      avatarUrl: '',
      displayName: 'Alice',
      id: 'alice',
      online: false,
      username: 'alice',
    },
    body: '真实动态',
    canDelete: true,
    commentCount: 0,
    createdAt: '2026-08-02T00:00:00Z',
    id: 'moment-1',
    images: [],
    likeCount: 0,
    likedByMe: false,
    recentComments: [],
    recentLikers: [],
    status: 'active',
    updatedAt: '2026-08-02T00:00:00Z',
    visibility: 'friends',
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
    body: '厉害',
    canDelete: false,
    createdAt: '2026-08-02T00:00:00Z',
    id: 'comment-1',
    momentId: 'moment-1',
    ...overrides,
  };
}

test('applies optimistic like and unlike states', () => {
  const liked = applyMomentLike(moment(), true);
  assert.equal(liked.likedByMe, true);
  assert.equal(liked.likeCount, 1);
  assert.equal(applyMomentLike(liked, false).likeCount, 0);
});

test('keeps like count above zero for invalid states', () => {
  assert.equal(applyMomentLike(moment({ likeCount: 0 }), false).likeCount, 0);
});

test('inserts a real comment into recent comments', () => {
  const created = applyMomentComment(moment(), comment());
  assert.equal(created.commentCount, 1);
  assert.equal(created.recentComments[0].id, 'comment-1');
});

test('removes and replaces moments by id', () => {
  const first = moment();
  const second = moment({ id: 'moment-2' });
  assert.deepEqual(removeMomentById([first, second], 'moment-1'), [second]);
  const updated = moment({ body: '修改后' });
  assert.equal(replaceMomentById([first], updated)[0].body, '修改后');
});

test('builds a reply thread from flat comments', () => {
  const root = comment({ id: 'root', parentId: undefined });
  const reply = comment({ id: 'reply', parentId: 'root' });
  const { childrenByParent, roots } = buildCommentThread([reply, root]);
  assert.equal(roots[0].id, 'root');
  assert.equal(childrenByParent.get('root')[0].id, 'reply');
});
