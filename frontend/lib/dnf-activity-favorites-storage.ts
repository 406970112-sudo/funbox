import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = 'funbox.dnf-activity.favorites';
const MAX_FAVORITES = 30;

export async function loadDnfActivityFavoriteIds(): Promise<string[]> {
  const raw = await getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export async function saveDnfActivityFavoriteIds(ids: readonly string[]) {
  await setItem(STORAGE_KEY, JSON.stringify(Array.from(new Set(ids)).slice(0, MAX_FAVORITES)));
}

export function canAddDnfActivityFavorite(currentCount: number) {
  return currentCount < MAX_FAVORITES;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  }
  return AsyncStorage.getItem(key);
}

async function setItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
    return;
  }
  await AsyncStorage.setItem(key, value);
}
