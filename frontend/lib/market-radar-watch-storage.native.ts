import * as SecureStore from 'expo-secure-store';

import { normalizeMarketRadarWatchIds } from './market-radar-watch';

const watchKey = 'funbox.market-radar.watch.v1';

export async function loadMarketRadarWatchIds() {
  try {
    const value = await SecureStore.getItemAsync(watchKey);
    return normalizeMarketRadarWatchIds(value ? JSON.parse(value) : null);
  } catch {
    return [];
  }
}

export function saveMarketRadarWatchIds(ids: string[]) {
  return SecureStore.setItemAsync(watchKey, JSON.stringify(normalizeMarketRadarWatchIds(ids)));
}
