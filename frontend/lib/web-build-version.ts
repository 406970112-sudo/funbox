export type WebBuildInfo = {
  buildId: string;
  commit: string;
  builtAt: string;
};

export const WEB_BUILD_RELOAD_GUARD_MS = 30_000;

const VERSION_ENDPOINT = '/version.json';
const RELOAD_GUARD_KEY = 'funbox:web-build-reload';

export function parseWebBuildInfo(value: unknown): WebBuildInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const buildId = normaliseString(candidate.buildId);
  const commit = normaliseString(candidate.commit);
  const builtAt = normaliseString(candidate.builtAt);
  if (!buildId || !commit || !builtAt || !Number.isFinite(Date.parse(builtAt))) {
    return null;
  }

  return { buildId, commit, builtAt };
}

export function isNewerWebBuild(current: WebBuildInfo | null, latest: WebBuildInfo | null): boolean {
  if (!current || !latest) {
    return false;
  }
  if (current.buildId === latest.buildId && current.builtAt === latest.builtAt) {
    return false;
  }

  return Date.parse(latest.builtAt) > Date.parse(current.builtAt);
}

export function shouldAllowWebBuildReload(
  previousReload: { buildId: string; requestedAt: number } | null,
  latest: WebBuildInfo,
  now = Date.now(),
): boolean {
  if (!previousReload || previousReload.buildId !== latest.buildId) {
    return true;
  }

  return now - previousReload.requestedAt >= WEB_BUILD_RELOAD_GUARD_MS;
}

export function readLoadedWebBuildInfo(documentValue: Document | null = typeof document === 'undefined' ? null : document): WebBuildInfo | null {
  if (!documentValue) {
    return null;
  }

  const readMeta = (name: string) =>
    documentValue.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;

  return parseWebBuildInfo({
    buildId: readMeta('funbox-build-id'),
    commit: readMeta('funbox-build-commit'),
    builtAt: readMeta('funbox-build-time'),
  });
}

export async function fetchLatestWebBuildInfo(
  fetcher: typeof fetch = fetch,
): Promise<WebBuildInfo | null> {
  try {
    const response = await fetcher(`${VERSION_ENDPOINT}?__funbox_version_check=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }

    return parseWebBuildInfo(await response.json());
  } catch {
    return null;
  }
}

export function reloadForWebBuild(latest: WebBuildInfo, now = Date.now()): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  let previousReload: { buildId: string; requestedAt: number } | null = null;
  try {
    const rawValue = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (rawValue) {
      const parsed = JSON.parse(rawValue) as { buildId?: unknown; requestedAt?: unknown };
      if (typeof parsed.buildId === 'string' && typeof parsed.requestedAt === 'number') {
        previousReload = { buildId: parsed.buildId, requestedAt: parsed.requestedAt };
      }
    }
  } catch {
    // Storage can be unavailable in private or embedded web views.
  }

  if (!shouldAllowWebBuildReload(previousReload, latest, now)) {
    return false;
  }

  try {
    window.sessionStorage.setItem(
      RELOAD_GUARD_KEY,
      JSON.stringify({ buildId: latest.buildId, requestedAt: now }),
    );
  } catch {
    // The in-memory page will still reload once when storage is unavailable.
  }

  window.location.reload();
  return true;
}

function normaliseString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
