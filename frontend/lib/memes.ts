export type MemeImage = {
  id: string;
  title: string;
  label: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  animated: boolean;
  bytes: number;
  format: string;
  categories: { id: string; title: string }[];
  favorite?: boolean;
  unavailable?: boolean;
  rank?: number;
  score?: number;
};
export type MemeCategory = {
  id: string;
  title: string;
  originalTitle?: string;
  count: number;
  coverUrl: string;
  group: string;
};
export type MemePage = {
  items: MemeImage[];
  nextCursor: string;
  total: number;
  version?: string;
  source?: { name: string; url: string; syncedAt: string };
};
export type MemeRanking = {
  items: MemeImage[];
  mode: "ranking" | "curated";
  period: string;
  date: string;
  updatedAt: string;
  algorithmVersion: string;
  dataSince: string;
  isFinal: boolean;
  notice?: string;
};
export type MemeQuery = {
  q?: string;
  category?: string;
  animated?: boolean;
  sort?: string;
  cursor?: string;
};
export type MemeLocal = {
  version: 1;
  favorites: string[];
  recent: string[];
  searches: string[];
  anonymousId: string;
  favoriteQueues: Record<string, Record<string, boolean>>;
};
export function buildMemeQuery(query: MemeQuery) {
  const params = new URLSearchParams();
  for (const key of ["q", "category", "animated", "sort", "cursor"] as const) {
    const value = query[key];
    if (value !== undefined && String(value).trim() !== "")
      params.set(key, String(value).trim());
  }
  params.set("limit", "36");
  return `?${params}`;
}
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ]
    : [];
export function newMemeId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}
export function parseMemeLocal(raw: string | null): MemeLocal {
  let value: Partial<MemeLocal> = {};
  try {
    const parsed = JSON.parse(raw || "null");
    if (parsed?.version === 1) value = parsed;
  } catch {}
  const favoriteQueues: Record<string, Record<string, boolean>> = {};
  if (value.favoriteQueues && typeof value.favoriteQueues === "object") {
    for (const [account, items] of Object.entries(value.favoriteQueues)) {
      if (!items || typeof items !== "object") continue;
      Object.defineProperty(favoriteQueues, account, {
        enumerable: true,
        writable: true,
        configurable: true,
        value: Object.fromEntries(
          Object.entries(items).filter(
            ([, desired]) => typeof desired === "boolean",
          ),
        ),
      });
    }
  }
  return {
    version: 1,
    favoriteQueues,
    favorites: strings(value.favorites),
    recent: strings(value.recent).slice(0, 60),
    searches: strings(value.searches).slice(0, 12),
    anonymousId:
      typeof value.anonymousId === "string" && value.anonymousId
        ? value.anonymousId
        : newMemeId(),
  };
}
export function addRecentMeme(ids: string[], id: string) {
  return [id, ...ids.filter((item) => item !== id)].slice(0, 60);
}
export function createMemeRequestGate() {
  let version = 0;
  return {
    start: () => ++version,
    current: (id: number) => id === version,
    cancel: () => {
      version++;
    },
  };
}
export async function performMemeSave(
  action: () => Promise<"saved" | "started" | "cancelled">,
  record: () => Promise<unknown>,
) {
  const outcome = await action();
  if (outcome === "saved") await record();
  return outcome;
}
