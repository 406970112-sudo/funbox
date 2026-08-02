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
import { useSocial } from '@/features/social/social-provider';
import {
  getMomentUnreadCount,
  listMomentNotifications,
  markMomentNotificationsRead,
} from '@/lib/moments-api';
import type { MomentNotification } from '@/types/moments';

type MomentsContextValue = {
  error: string;
  loading: boolean;
  notifications: MomentNotification[];
  refreshUnread: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  unreadCount: number;
  markRead: (momentId?: string) => Promise<void>;
};

const MomentsContext = createContext<MomentsContextValue | undefined>(undefined);

export function MomentsProvider({ children }: PropsWithChildren) {
  const { accessToken } = useAuth();
  const { lastEvent, lastEventSequence } = useSocial();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<MomentNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const refreshRef = useRef(false);

  const refreshUnread = useCallback(async () => {
    if (!accessToken) {
      setUnreadCount(0);
      return;
    }
    try {
      const count = await getMomentUnreadCount(accessToken);
      startTransition(() => setUnreadCount(count));
    } catch {
      // The tab badge stays at the last known real value on failure.
    }
  }, [accessToken]);

  const refreshNotifications = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const page = await listMomentNotifications(accessToken);
      startTransition(() => {
        setNotifications(page.items);
        setUnreadCount(page.unreadCount);
        setError('');
      });
    } catch {
      setError('互动通知暂时无法同步，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setUnreadCount(0);
      setNotifications([]);
      setError('');
      refreshRef.current = false;
      return;
    }
    void refreshUnread();
  }, [accessToken, refreshUnread]);

  useEffect(() => {
    if (!lastEvent || !lastEvent.type.startsWith('moment.')) return;
    if (refreshRef.current) return;
    refreshRef.current = true;
    void refreshUnread().finally(() => {
      refreshRef.current = false;
    });
  }, [lastEvent, lastEventSequence, refreshUnread]);

  const markRead = useCallback(
    async (momentId?: string) => {
      if (!accessToken) return;
      await markMomentNotificationsRead(accessToken, momentId);
      setUnreadCount(0);
      setNotifications((items) =>
        items.map((item) => (momentId && item.momentId !== momentId ? item : { ...item, read: true })),
      );
    },
    [accessToken],
  );

  return (
    <MomentsContext.Provider
      value={{
        error,
        loading,
        notifications,
        refreshUnread,
        refreshNotifications,
        unreadCount,
        markRead,
      }}>
      {children}
    </MomentsContext.Provider>
  );
}

export function useMoments() {
  const value = useContext(MomentsContext);
  if (!value) throw new Error('useMoments must be used within MomentsProvider');
  return value;
}
