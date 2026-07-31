import { DEFAULT_NEWS_PREFERENCES, normalizeNewsPreferences } from './news';
import type { NewsPreferences } from '../types/news';

let memoryPreferences: NewsPreferences = normalizeNewsPreferences(DEFAULT_NEWS_PREFERENCES);

export async function loadNewsPreferences() {
  return normalizeNewsPreferences(memoryPreferences);
}

export async function saveNewsPreferences(preferences: NewsPreferences) {
  memoryPreferences = normalizeNewsPreferences(preferences);
}
