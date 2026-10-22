export const STARTUP_SOCIAL_REFRESH_DEDUPE_MS = 1_500;

export function shouldRefreshAfterSocketOpen(
  lastRefreshFinishedAt: number,
  now = Date.now(),
) {
  if (lastRefreshFinishedAt <= 0) return true;
  return now - lastRefreshFinishedAt >= STARTUP_SOCIAL_REFRESH_DEDUPE_MS;
}
