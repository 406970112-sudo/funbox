import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { AI_PRODUCTS, type AiProductId } from '@/lib/ai-navigation';

const favoritesKey = 'funbox.ai-navigation.favorites.v1';
const validProductIds = new Set<AiProductId>(AI_PRODUCTS.map((product) => product.id));

export async function getStoredAiFavorites(): Promise<AiProductId[]> {
  let value: string | null;

  try {
    value =
      Platform.OS === 'web'
        ? typeof window === 'undefined'
          ? null
          : window.localStorage.getItem(favoritesKey)
        : await SecureStore.getItemAsync(favoritesKey);
  } catch {
    return [];
  }

  if (!value) return [];

  try {
    const storedValue: unknown = JSON.parse(value);

    if (!Array.isArray(storedValue)) return [];

    return [...new Set(storedValue.filter(isAiProductId))];
  } catch {
    return [];
  }
}

export async function setStoredAiFavorites(favoriteIds: readonly AiProductId[]) {
  const value = JSON.stringify(favoriteIds);

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(favoritesKey, value);
    }

    return;
  }

  await SecureStore.setItemAsync(favoritesKey, value);
}

function isAiProductId(value: unknown): value is AiProductId {
  return typeof value === 'string' && validProductIds.has(value as AiProductId);
}
