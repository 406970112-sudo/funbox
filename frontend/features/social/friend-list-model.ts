import type { Conversation, Friend } from '@/types/social';

export type PresenceChange = {
  online: boolean;
  userId: string;
};

export function getOnlineFriendCount(friends: Friend[]) {
  return friends.reduce((total, friend) => total + (friend.user.online ? 1 : 0), 0);
}

export function groupFriends(friends: Friend[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingFriends = friends
    .filter((friend) => {
      if (!normalizedQuery) return true;
      return [friend.user.displayName, friend.user.username].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    })
    .sort(compareFriends);

  return {
    offline: matchingFriends.filter((friend) => !friend.user.online),
    online: matchingFriends.filter((friend) => friend.user.online),
    total: matchingFriends.length,
  };
}

export function readPresenceChange(data: unknown): PresenceChange | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Partial<PresenceChange>;
  if (typeof candidate.userId !== 'string' || typeof candidate.online !== 'boolean') return null;
  return { online: candidate.online, userId: candidate.userId };
}

export function applyFriendPresence(friends: Friend[], change: PresenceChange) {
  let changed = false;
  const result = friends.map((friend) => {
    if (friend.user.id !== change.userId || friend.user.online === change.online) return friend;
    changed = true;
    return { ...friend, user: { ...friend.user, online: change.online } };
  });
  return changed ? result : friends;
}

export function applyConversationPresence(
  conversations: Conversation[],
  change: PresenceChange,
) {
  let changed = false;
  const result = conversations.map((conversation) => {
    if (conversation.peer.id !== change.userId || conversation.peer.online === change.online) {
      return conversation;
    }
    changed = true;
    return { ...conversation, peer: { ...conversation.peer, online: change.online } };
  });
  return changed ? result : conversations;
}

export function findFriendConversation(conversations: Conversation[], userId: string) {
  return conversations.find((conversation) => conversation.peer.id === userId);
}

function compareFriends(left: Friend, right: Friend) {
  const displayNameOrder = left.user.displayName.localeCompare(right.user.displayName, 'zh-CN', {
    sensitivity: 'base',
  });
  if (displayNameOrder !== 0) return displayNameOrder;
  return left.user.username.localeCompare(right.user.username, 'zh-CN', { sensitivity: 'base' });
}
