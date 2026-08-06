import { createEmptyHomeManualState } from '../types/home-manual.ts';
import type { HomeManualState } from '../types/home-manual.ts';

let memoryValue: string | null = null;
let memoryUnlockToken: string | null = null;

export async function getHomeManualState(): Promise<HomeManualState> {
  const parsed = parseState(memoryValue);
  return parsed ?? createEmptyHomeManualState();
}

export async function setHomeManualState(state: HomeManualState) {
  memoryValue = JSON.stringify(state);
}

export async function clearHomeManualState() {
  memoryValue = null;
}

export async function getHomeManualUnlockToken() {
  return memoryUnlockToken;
}

export async function setHomeManualUnlockToken(token: string) {
  memoryUnlockToken = token;
}

export async function removeHomeManualUnlockToken() {
  memoryUnlockToken = null;
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
