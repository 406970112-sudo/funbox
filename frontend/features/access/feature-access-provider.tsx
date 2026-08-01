import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { getVisibleFeatureIDs } from '@/lib/access-api';
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
  const { accessToken, status: authStatus, user } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<FeatureAccessStatus>('loading');
  const [visibleIDs, setVisibleIDs] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (authStatus === 'loading') return;
    let active = true;
    setStatus('loading');

    void getVisibleFeatureIDs(accessToken)
      .then((ids) => {
        if (!active) return;
        setVisibleIDs(new Set(ids));
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
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
      });

    return () => {
      active = false;
    };
  }, [accessToken, authStatus, reloadKey, user?.role]);

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
