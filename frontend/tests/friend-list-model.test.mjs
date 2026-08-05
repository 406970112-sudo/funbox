import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyConversationPresence,
  applyFriendPresence,
  findFriendConversation,
  getOnlineFriendCount,
  groupFriends,
  readPresenceChange,
} from '../features/social/friend-list-model.ts';

const friend = (id, displayName, username, online = false) => ({
  createdAt: '2026-08-05T00:00:00Z',
  user: { avatarUrl: '', displayName, id, online, username },
});

test('counts every online friend before the chat preview is limited', () => {
  const friends = Array.from({ length: 8 }, (_, index) =>
    friend(String(index), `好友${index}`, `friend-${index}`, index < 7),
  );

  assert.equal(getOnlineFriendCount(friends), 7);
});

test('searches display names and usernames without case or surrounding spaces', () => {
  const friends = [
    friend('1', '阿明', 'AMING', true),
    friend('2', 'BRYNN', 'sunny-day'),
  ];

  assert.deepEqual(groupFriends(friends, '  aming ').online.map((item) => item.user.id), ['1']);
  assert.deepEqual(groupFriends(friends, 'SUNNY').offline.map((item) => item.user.id), ['2']);
});

test('groups online and offline friends with a stable name order', () => {
  const groups = groupFriends(
    [friend('1', 'Zoe', 'zoe', true), friend('2', 'Amy', 'amy'), friend('3', 'Amy', 'amy-2', true)],
    '',
  );

  assert.deepEqual(groups.online.map((item) => item.user.id), ['3', '1']);
  assert.deepEqual(groups.offline.map((item) => item.user.id), ['2']);
  assert.equal(groups.total, 3);
});

test('applies a valid presence event without mutating unrelated records', () => {
  const offlineFriend = friend('1', 'Amy', 'amy');
  const untouchedFriend = friend('2', 'Zoe', 'zoe');
  const change = readPresenceChange({ online: true, userId: '1' });
  assert.ok(change);

  const result = applyFriendPresence([offlineFriend, untouchedFriend], change);
  assert.equal(result[0].user.online, true);
  assert.notEqual(result[0], offlineFriend);
  assert.equal(result[1], untouchedFriend);
  assert.equal(offlineFriend.user.online, false);
});

test('keeps conversation presence synchronized with the friend list', () => {
  const conversation = {
    id: 'conversation-1',
    lastMessage: null,
    peer: friend('1', 'Amy', 'amy').user,
    unreadCount: 0,
    updatedAt: '2026-08-05T00:00:00Z',
  };
  const change = { online: true, userId: '1' };

  const result = applyConversationPresence([conversation], change);
  assert.equal(result[0].peer.online, true);
  assert.equal(findFriendConversation(result, '1')?.id, 'conversation-1');
});

test('rejects malformed presence payloads', () => {
  assert.equal(readPresenceChange(null), null);
  assert.equal(readPresenceChange({ online: 'yes', userId: '1' }), null);
  assert.equal(readPresenceChange({ online: true }), null);
});
