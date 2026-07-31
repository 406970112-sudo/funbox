import type { StoredScoreSession } from '@/types/card-score';

const sessionKey = 'funbox.card-score.session.v1';

export async function getStoredScoreSession(): Promise<StoredScoreSession | null> {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(sessionKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredScoreSession>;
    if (!parsed.roomId || !parsed.guestToken || !parsed.participantId || !parsed.savedAt) return null;
    return parsed as StoredScoreSession;
  } catch {
    return null;
  }
}

export async function setStoredScoreSession(session: StoredScoreSession) {
  if (typeof window !== 'undefined') window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

export async function removeStoredScoreSession() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(sessionKey);
}
