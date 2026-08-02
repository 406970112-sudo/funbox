export const RESOURCE_SEARCH_HISTORY_LIMIT = 8;

let memoryHistory: string[] = [];

export async function loadResourceSearchHistory() {
  return [...memoryHistory];
}

export async function saveResourceSearchHistory(items: string[]) {
  memoryHistory = normalizeHistory(items);
}

export async function addResourceSearchHistory(query: string) {
  memoryHistory = normalizeHistory([query, ...memoryHistory]);
  return [...memoryHistory];
}

function normalizeHistory(items: readonly string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    RESOURCE_SEARCH_HISTORY_LIMIT,
  );
}
