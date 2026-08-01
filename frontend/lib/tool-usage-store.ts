import { addToolUsage, parseToolUsage, type ToolUsageStat } from './tool-usage.ts';

type ReadStoredValue = () => Promise<string | null>;
type WriteStoredValue = (value: string) => Promise<void>;

export function createToolUsageStore(
  readStoredValue: ReadStoredValue,
  writeStoredValue: WriteStoredValue,
) {
  let writeQueue: Promise<void> = Promise.resolve();

  async function get(): Promise<ToolUsageStat[]> {
    try {
      const storedValue = await readStoredValue();
      return storedValue ? parseToolUsage(JSON.parse(storedValue)) : [];
    } catch {
      return [];
    }
  }

  function record(toolId: string, clickedAt: number): Promise<ToolUsageStat[]> {
    const operation = writeQueue.then(async () => {
      const nextItems = addToolUsage(await get(), toolId, clickedAt);

      try {
        await writeStoredValue(JSON.stringify(nextItems));
      } catch {
        // Usage ranking should never block the tool that the user opened.
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
