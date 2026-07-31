export type SocialUser = {
  avatarUrl: string;
  displayName: string;
  id: string;
  online: boolean;
  username: string;
};

export type FriendRequest = {
  createdAt: string;
  id: string;
  recipient: SocialUser;
  sender: SocialUser;
  status: 'accepted' | 'pending' | 'rejected';
  updatedAt: string;
};

export type Friend = {
  createdAt: string;
  user: SocialUser;
};

export type SocialMessage = {
  body: string;
  clientMessageId: string;
  conversationId: string;
  createdAt: string;
  id: string;
  read: boolean;
  senderId: string;
};

export type Conversation = {
  id: string;
  lastMessage: SocialMessage | null;
  peer: SocialUser;
  unreadCount: number;
  updatedAt: string;
};

export type RealtimeEvent = {
  data?: unknown;
  type:
    | 'conversation.read'
    | 'friend.accepted'
    | 'friend.rejected'
    | 'friend.requested'
    | 'game.match.finished'
    | 'game.match.invited'
    | 'game.match.updated'
    | 'game.score.updated'
    | 'message.created'
    | 'presence.changed';
};
