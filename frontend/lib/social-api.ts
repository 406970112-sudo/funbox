import { getAPIBaseUrl, resolveAvatarURL } from '@/lib/auth-api';
import type {
  Conversation,
  Friend,
  FriendRequest,
  SocialMessage,
  SocialUser,
} from '@/types/social';

type ErrorPayload = {
  error?: string;
};

type UsersResponse = {
  users: SocialUser[];
};

type FriendsResponse = {
  friends: Friend[];
};

type FriendRequestsResponse = {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

type FriendRequestResponse = {
  conversation?: Conversation;
  request: FriendRequest;
};

type ConversationsResponse = {
  conversations: Conversation[];
};

type MessagesResponse = {
  messages: SocialMessage[];
};

type MessageResponse = {
  message: SocialMessage;
};

type RealtimeTicketResponse = {
  expiresAt: string;
  ticket: string;
};

export class SocialAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'SocialAPIError';
    this.code = code;
    this.status = status;
  }
}

export async function searchSocialUsers(token: string, query: string) {
  const response = await requestJSON<UsersResponse>(
    `/api/v1/users/search?q=${encodeURIComponent(query)}`,
    token,
  );
  return response.users.map(resolveSocialUser);
}

export async function listFriends(token: string) {
  const response = await requestJSON<FriendsResponse>('/api/v1/friends', token);
  return response.friends.map((friend) => ({ ...friend, user: resolveSocialUser(friend.user) }));
}

export async function listFriendRequests(token: string) {
  const response = await requestJSON<FriendRequestsResponse>('/api/v1/friend-requests', token);
  return {
    incoming: response.incoming.map(resolveFriendRequest),
    outgoing: response.outgoing.map(resolveFriendRequest),
  };
}

export async function createFriendRequest(token: string, userId: string) {
  const response = await requestJSON<FriendRequestResponse>('/api/v1/friend-requests', token, {
    body: JSON.stringify({ userId }),
    method: 'POST',
  });
  return resolveFriendRequest(response.request);
}

export async function respondToFriendRequest(
  token: string,
  requestId: string,
  action: 'accept' | 'reject',
) {
  const response = await requestJSON<FriendRequestResponse>(
    `/api/v1/friend-requests/${encodeURIComponent(requestId)}/${action}`,
    token,
    { body: '{}', method: 'POST' },
  );
  return {
    ...response,
    conversation: response.conversation ? resolveConversation(response.conversation) : undefined,
    request: resolveFriendRequest(response.request),
  };
}

export async function listConversations(token: string) {
  const response = await requestJSON<ConversationsResponse>('/api/v1/conversations', token);
  return response.conversations.map(resolveConversation);
}

export async function listMessages(token: string, conversationId: string) {
  const response = await requestJSON<MessagesResponse>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?limit=60`,
    token,
  );
  return response.messages;
}

export async function createMessage(
  token: string,
  conversationId: string,
  body: string,
  clientMessageId: string,
) {
  const response = await requestJSON<MessageResponse>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    token,
    { body: JSON.stringify({ body, clientMessageId }), method: 'POST' },
  );
  return response.message;
}

export async function markConversationRead(token: string, conversationId: string) {
  await requestJSON(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/read`,
    token,
    { body: '{}', method: 'POST' },
  );
}

export async function createRealtimeTicket(token: string) {
  return requestJSON<RealtimeTicketResponse>('/api/v1/realtime/ticket', token, {
    body: '{}',
    method: 'POST',
  });
}

export function getRealtimeURL(ticket: string) {
  const base = getAPIBaseUrl().replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${base}/api/v1/realtime/ws?ticket=${encodeURIComponent(ticket)}`;
}

export function getSocialErrorMessage(error: unknown) {
  if (!(error instanceof SocialAPIError)) {
    return '暂时无法连接消息服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    already_friends: '你们已经是好友了。',
    cannot_add_yourself: '不能添加自己为好友。',
    forbidden: '当前账号无法执行这个操作。',
    friend_request_exists: '好友申请已经发送或正在等待你处理。',
    message_invalid: '消息内容需为 1 至 2000 个字符。',
    not_found: '目标用户或会话不存在。',
    rate_limited: '操作太频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] || '消息操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new SocialAPIError(payload.error || 'request_failed', response.status);
  }
  return payload;
}

function resolveSocialUser(user: SocialUser): SocialUser {
  return { ...user, avatarUrl: resolveAvatarURL(user.avatarUrl) };
}

function resolveFriendRequest(request: FriendRequest): FriendRequest {
  return {
    ...request,
    recipient: resolveSocialUser(request.recipient),
    sender: resolveSocialUser(request.sender),
  };
}

function resolveConversation(conversation: Conversation): Conversation {
  return { ...conversation, peer: resolveSocialUser(conversation.peer) };
}
