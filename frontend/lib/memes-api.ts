import { getAPIBaseUrl } from "./api-base-url.ts";
import { buildMemeQuery } from "./memes.ts";
import type {
  MemeCategory,
  MemeImage,
  MemePage,
  MemeQuery,
  MemeRanking,
} from "./memes.ts";
export class MemeAPIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function memeMediaURL(path: string) {
  return path.startsWith("/") ? `${getAPIBaseUrl()}${path}` : path;
}
export async function memeRequest<T>(
  path: string,
  token?: string | null,
  options: RequestInit = {},
  base = getAPIBaseUrl(),
): Promise<T> {
  const response = await fetch(`${base}/api/v1/memes${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new MemeAPIError(
      body.detail || body.error || "请求失败，请重试",
      response.status,
    );
  return body as T;
}
export const fetchMemes = (query: MemeQuery, token?: string | null) =>
  memeRequest<MemePage>(buildMemeQuery(query), token);
export const fetchMemeCategories = () =>
  memeRequest<{ items: MemeCategory[]; total: number }>("/categories");
export const fetchMeme = (id: string, token?: string | null) =>
  memeRequest<{ image: MemeImage; related: MemeImage[] }>(
    `/${encodeURIComponent(id)}`,
    token,
  );
export const fetchMemeRankings = (period: string, date: string) =>
  memeRequest<MemeRanking>(
    `/rankings?${new URLSearchParams({ period, ...(date ? { date } : {}) })}`,
  );
export const fetchMemeRankingDates = (cursor = "") =>
  memeRequest<{ dates: string[]; nextCursor: string }>(
    `/ranking-dates?${new URLSearchParams({ cursor })}`,
  );
export const fetchMemeFavorites = (cursor: string, token: string) =>
  memeRequest<MemePage>(`/favorites${buildMemeQuery({ cursor })}`, token);
export const setMemeFavorite = (id: string, favorite: boolean, token: string) =>
  memeRequest<{ favorite: boolean }>(
    `/${encodeURIComponent(id)}/favorite`,
    token,
    { method: favorite ? "PUT" : "DELETE" },
  );
export const recordMemeEvent = (
  imageId: string,
  type: "view" | "save",
  eventId: string,
  anonymousId: string,
  token?: string | null,
) =>
  memeRequest("/events", token, {
    method: "POST",
    body: JSON.stringify({ imageId, type, eventId, anonymousId }),
  });
