import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import {
  getApplicableFeatureSnapshot,
  type FeatureAccessSnapshot,
} from '@/features/access/feature-access-snapshot';
import { getVisibleFeatureIDs } from '@/lib/access-api';
import { markStartupMilestone } from '@/lib/startup-metrics';
import { appTools, initialGameRoles, initialToolRoles, popularGames } from '@/mocks/app-data';
import type { AppTool, GameItem } from '@/types/app';

type FeatureAccessStatus = 'error' | 'loading' | 'ready';

type FeatureAccessContextValue = {
  canAccessGame: (gameID: string) => boolean;
  canAccessTool: (toolID: string) => boolean;
  refresh: () => void;
  status: FeatureAccessStatus;
  visibleGames: GameItem[];
  visibleTools: AppTool[];
};

const FeatureAccessContext = createContext<FeatureAccessContextValue | undefined>(undefined);

export function FeatureAccessProvider({ children }: PropsWithChildren) {
  const {
    accessToken,
    bootstrapStatus,
    bootstrapToken,
    status: authStatus,
    user,
  } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<FeatureAccessStatus>('loading');
  const [snapshot, setSnapshot] = useState<FeatureAccessSnapshot | null>(null);
  const [visibleIDs, setVisibleIDs] = useState<ReadonlySet<string>>(() => new Set());
  const lastFeatureRoleRef = useRef<string | null>(null);

  useEffect(() => {
    if (bootstrapStatus !== 'ready') return;

    let active = true;
    setStatus('loading');

    void getVisibleFeatureIDs(bootstrapToken)
      .then((ids) => {
        if (!active) return;
        setSnapshot({ error: false, ids, token: bootstrapToken });
      })
      .catch(() => {
        if (!active) return;
        setSnapshot({ error: true, ids: [], token: bootstrapToken });
      });

    return () => {
      active = false;
    };
  }, [bootstrapStatus, bootstrapToken, reloadKey]);

  useEffect(() => {
    if (authStatus === 'anonymous') {
      lastFeatureRoleRef.current = null;
      return;
    }
    if (authStatus !== 'authenticated') return;

    const role = user?.role ?? 'normal';
    if (lastFeatureRoleRef.current === null) {
      lastFeatureRoleRef.current = role;
      return;
    }
    if (lastFeatureRoleRef.current !== role) {
      lastFeatureRoleRef.current = role;
      setReloadKey((key) => key + 1);
    }
  }, [authStatus, user?.role]);

  useEffect(() => {
    const applicableSnapshot = getApplicableFeatureSnapshot(snapshot, authStatus, accessToken);
    if (!applicableSnapshot) return;

    if (applicableSnapshot.error) {
      const fallbackRole = user?.role ?? 'normal';
      const fallbackIDs = [
        ...appTools.flatMap((tool) =>
          initialToolRoles.get(tool.id)?.includes(fallbackRole) ? [tool.id] : [],
        ),
        ...popularGames.flatMap((game) =>
          initialGameRoles.get(game.id)?.includes(fallbackRole) ? [game.id] : [],
        ),
      ];
      setVisibleIDs(new Set(fallbackIDs));
      setStatus('error');
    } else {
      setVisibleIDs(new Set(applicableSnapshot.ids));
      setStatus('ready');
    }
    markStartupMilestone('access-ready');
  }, [accessToken, authStatus, snapshot, user?.role]);

  const visibleTools = appTools.filter(
    (tool) => visibleIDs.has(tool.id) && !tool.hiddenFromList,
  );
  const visibleGames = popularGames.filter(
    (game) => visibleIDs.has(game.id) && game.status === 'playable',
  );

  return (
    <FeatureAccessContext.Provider
      value={{
        canAccessGame: (gameID) => visibleIDs.has(gameID),
        canAccessTool: (toolID) => visibleIDs.has(toolID),
        refresh: () => setReloadKey((key) => key + 1),
        status,
        visibleGames,
        visibleTools,
      }}>
      {children}
    </FeatureAccessContext.Provider>
  );
}

export function useFeatureAccess() {
  const value = useContext(FeatureAccessContext);
  if (!value) {
    throw new Error('useFeatureAccess must be used within FeatureAccessProvider');
  }
  return value;
}
