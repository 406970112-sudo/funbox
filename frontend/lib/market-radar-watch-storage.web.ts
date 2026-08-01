import { normalizeMarketRadarWatchIds } from './market-radar-watch';

const watchKey = 'funbox.market-radar.watch.v1';

export async function loadMarketRadarWatchIds() {
  if (typeof window === 'undefined') return [];
  try {
    return normalizeMarketRadarWatchIds(JSON.parse(window.localStorage.getItem(watchKey) ?? 'null'));
  } catch {
    return [];
  }
}

export async function saveMarketRadarWatchIds(ids: string[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(watchKey, JSON.stringify(normalizeMarketRadarWatchIds(ids)));
  }
}
