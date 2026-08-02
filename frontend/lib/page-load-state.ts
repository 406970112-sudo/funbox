export type PageLoadState = 'opening' | 'loading' | 'ready' | 'error' | 'empty';

export function classifyPageLoadResult<T>(result: T | null | undefined): {
  data: T | null;
  state: Exclude<PageLoadState, 'opening' | 'loading' | 'error'>;
} {
  if (result == null) {
    return { data: null, state: 'empty' };
  }
  return { data: result, state: 'ready' };
}

export function getMinLoadingDelayMs(elapsedMs: number, minLoadingMs: number) {
  return Math.max(0, minLoadingMs - elapsedMs);
}

export function isPageLoadTimeout(nowMs: number, startedAtMs: number, timeoutMs: number) {
  return nowMs - startedAtMs >= timeoutMs;
}
