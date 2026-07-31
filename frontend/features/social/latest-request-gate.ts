export function createLatestRequestGate() {
  let latestRequestId = 0;

  return {
    invalidate() {
      latestRequestId += 1;
    },
    async run<T>(load: () => Promise<T>): Promise<T | undefined> {
      const requestId = ++latestRequestId;
      try {
        const result = await load();
        return requestId === latestRequestId ? result : undefined;
      } catch (error) {
        if (requestId === latestRequestId) throw error;
        return undefined;
      }
    },
  };
}
