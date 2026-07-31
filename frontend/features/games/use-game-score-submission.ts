import { useEffect, useRef } from 'react';

import { useGameSocial } from '@/features/games/game-social-provider';

export function useGameScoreSubmission(gameId: string, score: number, finished: boolean) {
  const { submitScore } = useGameSocial();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!finished) {
      submittedRef.current = false;
      return;
    }
    if (submittedRef.current) return;
    submittedRef.current = true;
    void submitScore(gameId, score).catch(() => undefined);
  }, [finished, gameId, score, submitScore]);
}
