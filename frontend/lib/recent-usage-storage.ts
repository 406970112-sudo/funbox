import { createRecentUsageStore } from '@/lib/recent-usage-store';
import type { RecentUsageItem } from '@/lib/recent-usage';

let memoryValue: string | null = null;

const recentUsageStore = createRecentUsageStore(
  async () => memoryValue,
  async (value) => {
    memoryValue = value;
  },
);

export function getStoredRecentUsage() {
  return recentUsageStore.get();
}

export function recordStoredRecentUsage(item: RecentUsageItem) {
  return recentUsageStore.record(item);
}
