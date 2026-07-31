import * as SecureStore from 'expo-secure-store';

import type { StoredScoreSession } from '@/types/card-score';

const sessionKey = 'funbox.card-score.session.v1';

export async function getStoredScoreSession(): Promise<StoredScoreSession | null> {
  try {
    const value = await SecureStore.getItemAsync(sessionKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredScoreSession>;
    if (!parsed.roomId || !parsed.guestToken || !parsed.participantId || !parsed.savedAt) return null;
    return parsed as StoredScoreSession;
  } catch {
    return null;
  }
}

export function setStoredScoreSession(session: StoredScoreSession) {
  return SecureStore.setItemAsync(sessionKey, JSON.stringify(session));
}

export function removeStoredScoreSession() {
  return SecureStore.deleteItemAsync(sessionKey);
}
