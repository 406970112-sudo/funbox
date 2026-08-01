import { createToolUsageStore } from '@/lib/tool-usage-store';

const toolUsageStorageKey = 'funbox.tool-usage.v1';

const toolUsageStore = createToolUsageStore(
  async () =>
    typeof window === 'undefined' ? null : window.localStorage.getItem(toolUsageStorageKey),
  async (value) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(toolUsageStorageKey, value);
    }
  },
);

export function getStoredToolUsage() {
  return toolUsageStore.get();
}

export function recordStoredToolUsage(toolId: string, clickedAt: number) {
  return toolUsageStore.record(toolId, clickedAt);
}
