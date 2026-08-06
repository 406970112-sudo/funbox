import { createEmptyHomeManualState } from '@/types/home-manual';
import type { HomeManualState } from '@/types/home-manual';

const stateKey = 'funbox.home-manual.state.v1';
const unlockTokenKey = 'funbox.home-manual.unlock-token.v1';

export async function getHomeManualState(): Promise<HomeManualState> {
  if (typeof window === 'undefined') return createEmptyHomeManualState();
  const value = window.localStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptyHomeManualState();
}

export async function setHomeManualState(state: HomeManualState) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(stateKey, JSON.stringify(state));
  }
}

export async function clearHomeManualState() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(stateKey);
  }
}

export async function getHomeManualUnlockToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(unlockTokenKey);
}

export async function setHomeManualUnlockToken(token: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(unlockTokenKey, token);
  }
}

export async function removeHomeManualUnlockToken() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(unlockTokenKey);
  }
}

function parseState(value: string | null): HomeManualState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as HomeManualState;
    return isHomeManualState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isHomeManualState(value: HomeManualState) {
  return Boolean(
    value &&
      value.schemaVersion === 1 &&
      Array.isArray(value.devices) &&
      Array.isArray(value.networks) &&
      Array.isArray(value.contacts) &&
      Array.isArray(value.reminders),
  );
}
