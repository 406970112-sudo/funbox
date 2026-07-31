import * as SecureStore from 'expo-secure-store';

import { normalizeNewsPreferences } from '@/lib/news';
import type { NewsPreferences } from '@/types/news';

const preferencesKey = 'funbox.hot-news.preferences.v1';

export async function loadNewsPreferences() {
  try {
    const value = await SecureStore.getItemAsync(preferencesKey);
    return normalizeNewsPreferences(value ? JSON.parse(value) : null);
  } catch {
    return normalizeNewsPreferences(null);
  }
}

export function saveNewsPreferences(preferences: NewsPreferences) {
  return SecureStore.setItemAsync(preferencesKey, JSON.stringify(normalizeNewsPreferences(preferences)));
}
