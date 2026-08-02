export const RESOURCE_SEARCH_HISTORY_LIMIT = 8;

const historyKey = 'funbox.resource-search.history.v1';

export async function loadResourceSearchHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(historyKey) ?? '[]');
    return normalizeHistory(Array.isArray(value) ? value : []);
  } catch {
    return [];
  }
}

export async function saveResourceSearchHistory(items: string[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(historyKey, JSON.stringify(normalizeHistory(items)));
  }
}

export async function addResourceSearchHistory(query: string) {
  const current = await loadResourceSearchHistory();
  const next = normalizeHistory([query, ...current]);
  await saveResourceSearchHistory(next);
  return next;
}

function normalizeHistory(items: readonly string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    RESOURCE_SEARCH_HISTORY_LIMIT,
  );
}
