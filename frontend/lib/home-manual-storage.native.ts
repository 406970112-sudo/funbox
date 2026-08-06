import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { createEmptyHomeManualState } from '@/types/home-manual';
import type { HomeManualState } from '@/types/home-manual';

const stateKey = 'funbox.home-manual.state.v1';
const unlockTokenKey = 'funbox.home-manual.unlock-token.v1';

export async function getHomeManualState(): Promise<HomeManualState> {
  const value = await AsyncStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptyHomeManualState();
}

export async function setHomeManualState(state: HomeManualState) {
  await AsyncStorage.setItem(stateKey, JSON.stringify(state));
}

export async function clearHomeManualState() {
  await AsyncStorage.removeItem(stateKey);
}

export function getHomeManualUnlockToken() {
  return SecureStore.getItemAsync(unlockTokenKey);
}

export function setHomeManualUnlockToken(token: string) {
  return SecureStore.setItemAsync(unlockTokenKey, token);
}

export function removeHomeManualUnlockToken() {
  return SecureStore.deleteItemAsync(unlockTokenKey);
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
