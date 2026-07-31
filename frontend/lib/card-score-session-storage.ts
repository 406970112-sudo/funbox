import type { StoredScoreSession } from '@/types/card-score';

let memorySession: StoredScoreSession | null = null;

export async function getStoredScoreSession() {
  return memorySession;
}

export async function setStoredScoreSession(session: StoredScoreSession) {
  memorySession = session;
}

export async function removeStoredScoreSession() {
  memorySession = null;
}
