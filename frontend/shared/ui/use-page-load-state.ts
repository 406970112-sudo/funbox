import { useCallback, useEffect, useRef, useState } from 'react';

import {
  classifyPageLoadResult,
  getMinLoadingDelayMs,
  isPageLoadTimeout,
  type PageLoadState,
} from '@/lib/page-load-state';

type UsePageLoadStateOptions = {
  minLoadingMs?: number;
  timeoutMs?: number;
};

type LoadResult<T> = T | null | undefined;

const DEFAULT_MIN_LOADING_MS = 350;
const DEFAULT_TIMEOUT_MS = 8000;

export function usePageLoadState<T>(options: UsePageLoadStateOptions = {}) {
  const { minLoadingMs = DEFAULT_MIN_LOADING_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const [state, setState] = useState<PageLoadState>('opening');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const runIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const run = useCallback(
    async (loader: () => Promise<LoadResult<T>>) => {
      const runId = ++runIdRef.current;
      const startedAt = Date.now();
      setState('loading');
      setError('');

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (runIdRef.current === runId && isPageLoadTimeout(Date.now(), startedAt, timeoutMs)) {
          setState('error');
          setError('加载超时，请检查网络后重试。');
        }
      }, timeoutMs);

      try {
        const result = await loader();
        if (runIdRef.current !== runId) return;

        const elapsed = Date.now() - startedAt;
        const delayMs = getMinLoadingDelayMs(elapsed, minLoadingMs);
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (runIdRef.current !== runId) return;

        if (timerRef.current) clearTimeout(timerRef.current);
        const outcome = classifyPageLoadResult(result);
        setData(outcome.data);
        setState(outcome.state);
      } catch (loadError) {
        if (runIdRef.current !== runId) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        setData(null);
        setError(loadError instanceof Error ? loadError.message : '加载失败，请稍后重试。');
        setState('error');
      }
    },
    [minLoadingMs, timeoutMs],
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    setState('opening');
    setData(null);
    setError('');
  }, []);

  return {
    data,
    error,
    reset,
    run,
    state,
  };
}
