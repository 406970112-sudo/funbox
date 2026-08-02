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
  getBlogUnreadCount,
  listBlogNotifications,
  markBlogNotificationsRead,
} from '@/lib/blog-api';
import type { BlogNotification } from '@/types/blog';

type BlogContextValue = {
  error: string;
  loading: boolean;
  markRead: (postId?: string) => Promise<void>;
  notifications: BlogNotification[];
  refreshNotifications: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  unreadCount: number;
};

const BlogContext = createContext<BlogContextValue | undefined>(undefined);

export function BlogProvider({ children }: PropsWithChildren) {
  const { accessToken } = useAuth();
  const { lastEvent, lastEventSequence } = useSocial();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<BlogNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const refreshRef = useRef(false);

  const refreshUnread = useCallback(async () => {
    if (!accessToken) {
      setUnreadCount(0);
      return;
    }
    try {
      const count = await getBlogUnreadCount(accessToken);
      startTransition(() => setUnreadCount(count));
    } catch {
      // Keep the last known real value on failure.
    }
  }, [accessToken]);

  const refreshNotifications = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const page = await listBlogNotifications(accessToken);
      startTransition(() => {
        setNotifications(page.items);
        setUnreadCount(page.unreadCount);
        setError('');
      });
    } catch {
      setError('博客互动通知暂时无法同步，请稍后重试。');
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
    if (!lastEvent || !lastEvent.type.startsWith('blog.')) return;
    if (refreshRef.current) return;
    refreshRef.current = true;
    void refreshUnread().finally(() => {
      refreshRef.current = false;
    });
  }, [lastEvent, lastEventSequence, refreshUnread]);

  const markRead = useCallback(
    async (postId?: string) => {
      if (!accessToken) return;
      await markBlogNotificationsRead(accessToken, postId);
      setUnreadCount(0);
      setNotifications((items) =>
        items.map((item) => (postId && item.postId !== postId ? item : { ...item, read: true })),
      );
    },
    [accessToken],
  );

  return (
    <BlogContext.Provider
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
    </BlogContext.Provider>
  );
}

export function useBlog() {
  const value = useContext(BlogContext);
  if (!value) throw new Error('useBlog must be used within BlogProvider');
  return value;
}
