import { normalizeMarketRadarWatchIds } from './market-radar-watch';

let memoryWatchIds: string[] = [];

export async function loadMarketRadarWatchIds() {
  return normalizeMarketRadarWatchIds(memoryWatchIds);
}

export async function saveMarketRadarWatchIds(ids: string[]) {
  memoryWatchIds = normalizeMarketRadarWatchIds(ids);
}
