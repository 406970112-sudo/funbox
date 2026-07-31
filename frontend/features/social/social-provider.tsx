import {
  createContext,
  type PropsWithChildren,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { createLatestRequestGate } from '@/features/social/latest-request-gate';
import { clearConversationUnreadCount } from '@/features/social/unread-message-state';
import {
  createFriendRequest,
  createMessage,
  createRealtimeTicket,
  getRealtimeURL,
  listConversations,
  listFriendRequests,
  listFriends,
  listMessages,
  markConversationRead,
  respondToFriendRequest,
  searchSocialUsers,
} from '@/lib/social-api';
import type {
  Conversation,
  Friend,
  FriendRequest,
  RealtimeEvent,
  SocialMessage,
  SocialUser,
} from '@/types/social';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'idle';

type SocialContextValue = {
  connectionStatus: ConnectionStatus;
  conversations: Conversation[];
  error: string;
  friends: Friend[];
  incomingRequests: FriendRequest[];
  lastEvent: RealtimeEvent | null;
  lastEventSequence: number;
  loading: boolean;
  loadMessages: (conversationId: string) => Promise<SocialMessage[]>;
  markRead: (conversationId: string) => Promise<void>;
  outgoingRequests: FriendRequest[];
  refresh: () => Promise<void>;
  respondToRequest: (requestId: string, action: 'accept' | 'reject') => Promise<void>;
  searchUsers: (query: string) => Promise<SocialUser[]>;
  sendFriendRequest: (userId: string) => Promise<void>;
  sendMessage: (conversationId: string, body: string) => Promise<SocialMessage>;
};

const SocialContext = createContext<SocialContextValue | undefined>(undefined);

export function SocialProvider({ children }: PropsWithChildren) {
  const { accessToken } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState('');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [lastEventSequence, setLastEventSequence] = useState(0);
  const [loading, setLoading] = useState(false);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const refreshGateRef = useRef<ReturnType<typeof createLatestRequestGate> | null>(null);
  if (refreshGateRef.current === null) {
    refreshGateRef.current = createLatestRequestGate();
  }
  const refreshGate = refreshGateRef.current;

  async function refreshForToken(token: string, showLoading = false) {
    if (showLoading) setLoading(true);
    try {
      const nextState = await refreshGate.run(() =>
        Promise.all([listFriends(token), listFriendRequests(token), listConversations(token)]),
      );
      if (!nextState) return;
      const [nextFriends, nextRequests, nextConversations] = nextState;
      startTransition(() => {
        setFriends(nextFriends);
        setIncomingRequests(nextRequests.incoming);
        setOutgoingRequests(nextRequests.outgoing);
        setConversations(nextConversations);
        setError('');
      });
    } catch {
      setError('消息列表暂时无法同步。');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    if (!accessToken) {
      refreshGate.invalidate();
      setConnectionStatus('idle');
      setConversations([]);
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setLastEvent(null);
      setLastEventSequence(0);
      return;
    }

    let active = true;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;

    void refreshForToken(accessToken, true);

    async function connect() {
      if (!active) return;
      setConnectionStatus('connecting');
      try {
        const { ticket } = await createRealtimeTicket(accessToken as string);
        if (!active) return;
        socket = new WebSocket(getRealtimeURL(ticket));
        socket.onopen = () => {
          reconnectAttempt = 0;
          setConnectionStatus('connected');
          void refreshForToken(accessToken as string);
        };
        socket.onmessage = (message) => {
          try {
            const event = JSON.parse(String(message.data)) as RealtimeEvent;
            setLastEvent(event);
            setLastEventSequence((value) => value + 1);
            void refreshForToken(accessToken as string);
          } catch {
            // Ignore malformed events and keep the live connection available.
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          if (!active) return;
          setConnectionStatus('disconnected');
          const delay = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
          reconnectAttempt += 1;
          reconnectTimer = setTimeout(() => void connect(), delay);
        };
      } catch {
        if (!active) return;
        setConnectionStatus('disconnected');
        const delay = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(() => void connect(), delay);
      }
    }

    void connect();
    return () => {
      active = false;
      refreshGate.invalidate();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [accessToken, refreshGate]);

  async function refresh() {
    if (!accessToken) return;
    await refreshForToken(accessToken, true);
  }

  async function searchUsers(query: string) {
    if (!accessToken) throw new Error('Authentication required');
    return searchSocialUsers(accessToken, query);
  }

  async function sendFriendRequest(userId: string) {
    if (!accessToken) throw new Error('Authentication required');
    await createFriendRequest(accessToken, userId);
    await refreshForToken(accessToken);
  }

  async function respondToRequest(requestId: string, action: 'accept' | 'reject') {
    if (!accessToken) throw new Error('Authentication required');
    await respondToFriendRequest(accessToken, requestId, action);
    await refreshForToken(accessToken);
  }

  async function loadConversationMessages(conversationId: string) {
    if (!accessToken) throw new Error('Authentication required');
    return listMessages(accessToken, conversationId);
  }

  async function sendConversationMessage(conversationId: string, body: string) {
    if (!accessToken) throw new Error('Authentication required');
    const message = await createMessage(
      accessToken,
      conversationId,
      body,
      createClientMessageId(),
    );
    await refreshForToken(accessToken);
    return message;
  }

  const markRead = useCallback(async (conversationId: string) => {
    if (!accessToken) throw new Error('Authentication required');
    await markConversationRead(accessToken, conversationId);
    setConversations((items) => clearConversationUnreadCount(items, conversationId));
  }, [accessToken]);

  return (
    <SocialContext.Provider
      value={{
        connectionStatus,
        conversations,
        error,
        friends,
        incomingRequests,
        lastEvent,
        lastEventSequence,
        loading,
        loadMessages: loadConversationMessages,
        markRead,
        outgoingRequests,
        refresh,
        respondToRequest,
        searchUsers,
        sendFriendRequest,
        sendMessage: sendConversationMessage,
      }}>
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  const value = useContext(SocialContext);
  if (!value) throw new Error('useSocial must be used within SocialProvider');
  return value;
}

function createClientMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
