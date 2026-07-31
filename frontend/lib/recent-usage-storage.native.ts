import * as SecureStore from 'expo-secure-store';

import { createRecentUsageStore } from '@/lib/recent-usage-store';
import type { RecentUsageItem } from '@/lib/recent-usage';

const recentUsageStorageKey = 'funbox.recent-usage.v1';

const recentUsageStore = createRecentUsageStore(
  () => SecureStore.getItemAsync(recentUsageStorageKey),
  (value) => SecureStore.setItemAsync(recentUsageStorageKey, value),
);

export function getStoredRecentUsage() {
  return recentUsageStore.get();
}

export function recordStoredRecentUsage(item: RecentUsageItem) {
  return recentUsageStore.record(item);
}
