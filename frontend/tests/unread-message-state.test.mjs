import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearConversationUnreadCount,
  getUnreadMessageState,
} from '../features/social/unread-message-state.ts';

const conversation = (id, unreadCount) => ({ id, unreadCount });

test('hides the dot when every conversation is read', () => {
  assert.deepEqual(getUnreadMessageState([]), {
    accessibilityLabel: '消息',
    hasUnread: false,
    unreadCount: 0,
  });
  assert.equal(getUnreadMessageState([conversation('a', 0)]).hasUnread, false);
});

test('sums unread chat messages for the tab state', () => {
  assert.deepEqual(
    getUnreadMessageState([conversation('a', 2), conversation('b', 3)]),
    { accessibilityLabel: '消息，5 条未读', hasUnread: true, unreadCount: 5 },
  );
});

test('ignores invalid unread counts', () => {
  const state = getUnreadMessageState([
    conversation('a', -2),
    conversation('b', Number.NaN),
    conversation('c', 1.9),
  ]);

  assert.equal(state.unreadCount, 1);
});

test('clears only the opened conversation', () => {
  const untouched = conversation('b', 3);
  const result = clearConversationUnreadCount([conversation('a', 2), untouched], 'a');

  assert.equal(result[1], untouched);
  assert.deepEqual(result.map(({ id, unreadCount }) => ({ id, unreadCount })), [
    { id: 'a', unreadCount: 0 },
    { id: 'b', unreadCount: 3 },
  ]);
  assert.equal(getUnreadMessageState(result).hasUnread, true);
});

test('removes the final unread state', () => {
  const result = clearConversationUnreadCount([conversation('a', 1)], 'a');

  assert.equal(getUnreadMessageState(result).hasUnread, false);
});
