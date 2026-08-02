export type RealCacheEntry<T> = {
  data: T;
  updatedAt: number;
};

export type CacheStorage = {
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
  setItem: (key: string, value: string) => Promise<void>;
};

export function createRealDataCache(storage: CacheStorage) {
  const memoryStore = new Map<string, RealCacheEntry<unknown>>();

  async function read<T>(key: string, ttlMs: number): Promise<RealCacheEntry<T> | null> {
    const memoryEntry = memoryStore.get(key) as RealCacheEntry<T> | undefined;
    if (memoryEntry && Date.now() - memoryEntry.updatedAt < ttlMs) {
      return memoryEntry;
    }

    try {
      const storedValue = await storage.getItem(key);
      if (!storedValue) return null;
      const entry = JSON.parse(storedValue) as RealCacheEntry<T>;
      if (!entry || typeof entry.updatedAt !== 'number' || Date.now() - entry.updatedAt >= ttlMs) {
        return null;
      }
      memoryStore.set(key, entry as RealCacheEntry<unknown>);
      return entry;
    } catch {
      return null;
    }
  }

  async function write<T>(key: string, data: T): Promise<void> {
    const entry: RealCacheEntry<T> = { data, updatedAt: Date.now() };
    memoryStore.set(key, entry as RealCacheEntry<unknown>);
    try {
      await storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Cache writes must never block the real request that produced the data.
    }
  }

  async function remove(key: string): Promise<void> {
    memoryStore.delete(key);
    try {
      await storage.removeItem(key);
    } catch {
      // Best effort removal.
    }
  }

  return { read, remove, write };
}
