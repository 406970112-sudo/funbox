import {
  createContext,
  type PropsWithChildren,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { useSocial } from '@/features/social/social-provider';
import {
  getFeedbackUnreadCount,
  listFeedbackNotifications,
  markFeedbackNotificationsRead,
} from '@/lib/feedback-api';
import type { FeedbackSubmission } from '@/types/feedback';

type FeedbackContextValue = {
  error: string;
  loading: boolean;
  markRead: (feedbackId?: string) => Promise<void>;
  notifications: FeedbackSubmission[];
  refreshNotifications: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  unreadCount: number;
};

const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

export function FeedbackProvider({ children }: PropsWithChildren) {
  const { accessToken } = useAuth();
  const { lastEvent, lastEventSequence } = useSocial();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<FeedbackSubmission[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnread = useCallback(async () => {
    if (!accessToken) {
      setUnreadCount(0);
      return;
    }
    try {
      const page = await getFeedbackUnreadCount(accessToken);
      startTransition(() => setUnreadCount(page.unreadCount));
    } catch {
      // The tab badge stays at the last known real value on failure.
    }
  }, [accessToken]);

  const refreshNotifications = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const page = await listFeedbackNotifications(accessToken, 30, 0);
      startTransition(() => {
        setNotifications(page.items);
        setUnreadCount(page.unreadCount);
        setError('');
      });
    } catch {
      setError('系统通知暂时无法同步，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setUnreadCount(0);
      setNotifications([]);
      setError('');
      return;
    }
    void refreshUnread();
  }, [accessToken, refreshUnread]);

  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'feedback.resolved') return;
    void refreshNotifications();
  }, [lastEvent, lastEventSequence, refreshNotifications]);

  const markRead = useCallback(
    async (feedbackId?: string) => {
      if (!accessToken) return;
      await markFeedbackNotificationsRead(accessToken, feedbackId ? [feedbackId] : []);
      setUnreadCount(0);
      setNotifications((items) =>
        items.map((item) =>
          feedbackId && item.id !== feedbackId ? item : { ...item, read: true },
        ),
      );
    },
    [accessToken],
  );

  return (
    <FeedbackContext.Provider
      value={{
        error,
        loading,
        markRead,
        notifications,
        refreshNotifications,
        refreshUnread,
        unreadCount,
      }}>
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('useFeedback must be used within FeedbackProvider');
  return value;
}
