import { createEmptyWhoDoesItState } from '../types/who-does-it.ts';
import type { WhoDoesItState } from '../types/who-does-it.ts';

let memoryValue: string | null = null;

export async function getWhoDoesItState(): Promise<WhoDoesItState> {
  const parsed = parseState(memoryValue);
  return parsed ?? createEmptyWhoDoesItState();
}

export async function setWhoDoesItState(state: WhoDoesItState) {
  memoryValue = JSON.stringify(state);
}

export async function clearWhoDoesItState() {
  memoryValue = null;
}

function parseState(value: string | null): WhoDoesItState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as WhoDoesItState;
    return isWhoDoesItState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isWhoDoesItState(value: WhoDoesItState) {
  return Boolean(
    value
    && Array.isArray(value.participants)
    && Array.isArray(value.records)
    && value.settings
    && ['person-only', 'custom', 'recent'].includes(value.settings.taskMode),
  );
}
