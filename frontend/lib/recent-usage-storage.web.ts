import { createRecentUsageStore } from '@/lib/recent-usage-store';
import type { RecentUsageItem } from '@/lib/recent-usage';

const recentUsageStorageKey = 'funbox.recent-usage.v1';

const recentUsageStore = createRecentUsageStore(
  async () =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(recentUsageStorageKey),
  async (value) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(recentUsageStorageKey, value);
    }
  },
);

export function getStoredRecentUsage() {
  return recentUsageStore.get();
}

export function recordStoredRecentUsage(item: RecentUsageItem) {
  return recentUsageStore.record(item);
}
