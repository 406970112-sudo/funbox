import {
  addRecentUsage,
  parseRecentUsage,
  type RecentUsageItem,
} from './recent-usage.ts';

type ReadStoredValue = () => Promise<string | null>;
type WriteStoredValue = (value: string) => Promise<void>;

export function createRecentUsageStore(
  readStoredValue: ReadStoredValue,
  writeStoredValue: WriteStoredValue,
) {
  let writeQueue: Promise<void> = Promise.resolve();

  async function get(): Promise<RecentUsageItem[]> {
    try {
      const storedValue = await readStoredValue();
      return storedValue ? parseRecentUsage(JSON.parse(storedValue)) : [];
    } catch {
      return [];
    }
  }

  function record(item: RecentUsageItem): Promise<RecentUsageItem[]> {
    const operation = writeQueue.then(async () => {
      const nextItems = addRecentUsage(await get(), item);

      try {
        await writeStoredValue(JSON.stringify(nextItems));
      } catch {
        // Recent usage should never block the navigation that produced it.
      }

      return nextItems;
    });

    writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  return { get, record };
}
