import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEmptyWhoDoesItState } from '@/types/who-does-it';
import type { WhoDoesItState } from '@/types/who-does-it';

const stateKey = 'funbox.who-does-it.state.v1';

export async function getWhoDoesItState(): Promise<WhoDoesItState> {
  const value = await AsyncStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptyWhoDoesItState();
}

export async function setWhoDoesItState(state: WhoDoesItState) {
  await AsyncStorage.setItem(stateKey, JSON.stringify(state));
}

export async function clearWhoDoesItState() {
  await AsyncStorage.removeItem(stateKey);
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
