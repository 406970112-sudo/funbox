import type { Conversation } from '../../types/social';

type UnreadConversation = Pick<Conversation, 'id' | 'unreadCount'>;

export function getUnreadMessageState(conversations: readonly UnreadConversation[]) {
  const unreadCount = conversations.reduce(
    (total, conversation) => total + normalizeUnreadCount(conversation.unreadCount),
    0,
  );

  return {
    accessibilityLabel: unreadCount > 0 ? `消息，${unreadCount} 条未读` : '消息',
    hasUnread: unreadCount > 0,
    unreadCount,
  };
}

export function clearConversationUnreadCount<T extends UnreadConversation>(
  conversations: readonly T[],
  conversationId: string,
): T[] {
  return conversations.map((conversation): T =>
    conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
  );
}

function normalizeUnreadCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
