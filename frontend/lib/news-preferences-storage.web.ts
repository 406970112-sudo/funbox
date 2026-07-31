import { normalizeNewsPreferences } from '@/lib/news';
import type { NewsPreferences } from '@/types/news';

const preferencesKey = 'funbox.hot-news.preferences.v1';

export async function loadNewsPreferences() {
  if (typeof window === 'undefined') return normalizeNewsPreferences(null);
  try {
    return normalizeNewsPreferences(JSON.parse(window.localStorage.getItem(preferencesKey) ?? 'null'));
  } catch {
    return normalizeNewsPreferences(null);
  }
}

export async function saveNewsPreferences(preferences: NewsPreferences) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(preferencesKey, JSON.stringify(normalizeNewsPreferences(preferences)));
  }
}
