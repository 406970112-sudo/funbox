import * as SecureStore from 'expo-secure-store';

import { createToolUsageStore } from '@/lib/tool-usage-store';

const toolUsageStorageKey = 'funbox.tool-usage.v1';

const toolUsageStore = createToolUsageStore(
  () => SecureStore.getItemAsync(toolUsageStorageKey),
  (value) => SecureStore.setItemAsync(toolUsageStorageKey, value),
);

export function getStoredToolUsage() {
  return toolUsageStore.get();
}

export function recordStoredToolUsage(toolId: string, clickedAt: number) {
  return toolUsageStore.record(toolId, clickedAt);
}
