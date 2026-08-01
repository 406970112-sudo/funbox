import { createToolUsageStore } from '@/lib/tool-usage-store';

let memoryValue: string | null = null;

const toolUsageStore = createToolUsageStore(
  async () => memoryValue,
  async (value) => {
    memoryValue = value;
  },
);

export function getStoredToolUsage() {
  return toolUsageStore.get();
}

export function recordStoredToolUsage(toolId: string, clickedAt: number) {
  return toolUsageStore.record(toolId, clickedAt);
}
