import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  ShoppingItem,
  ShoppingList,
  ShoppingMapping,
  ShoppingMappingSuggestion,
  ShoppingProductMeta,
  ShoppingRoute,
  ShoppingRouteHome,
  ShoppingStore,
  ShoppingZone,
  ShoppingZoneType,
} from '@/types/shopping-route';

type ErrorPayload = { error?: string };

export class ShoppingRouteAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ShoppingRouteAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchShoppingRouteHome(token: string) {
  return requestJSON<ShoppingRouteHome>('/api/v1/shopping-route/home', token);
}

export function fetchShoppingLists(token: string) {
  return requestJSON<{ items: ShoppingList[] }>('/api/v1/shopping-route/lists', token);
}

export function createShoppingList(token: string, name: string) {
  return requestJSON<ShoppingList>('/api/v1/shopping-route/lists', token, {
    body: JSON.stringify({ name }),
    method: 'POST',
  });
}

export function fetchShoppingList(token: string, listId: string) {
  return requestJSON<ShoppingList>(
    `/api/v1/shopping-route/lists/${encodeURIComponent(listId)}`,
    token,
  );
}

export function deleteShoppingList(token: string, listId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/shopping-route/lists/${encodeURIComponent(listId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function addShoppingItem(
  token: string,
  listId: string,
  input: {
    name: string;
    quantity: string;
    unit?: string;
    barcode?: string;
    note?: string;
  },
) {
  return requestJSON<ShoppingItem>(
    `/api/v1/shopping-route/lists/${encodeURIComponent(listId)}/items`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function updateShoppingItem(
  token: string,
  itemId: string,
  input: {
    name: string;
    quantity: string;
    unit?: string;
    barcode?: string;
    note?: string;
  },
) {
  return requestJSON<ShoppingItem>(
    `/api/v1/shopping-route/items/${encodeURIComponent(itemId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deleteShoppingItem(token: string, itemId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/shopping-route/items/${encodeURIComponent(itemId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function importCookingShoppingList(
  token: string,
  input: { dishId: string; listId?: string; listName?: string },
) {
  return requestJSON<ShoppingList>('/api/v1/shopping-route/imports/cooking-guide', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function fetchShoppingStores(token: string) {
  return requestJSON<{ items: ShoppingStore[] }>('/api/v1/shopping-route/stores', token);
}

export function fetchShoppingStore(token: string, storeId: string) {
  return requestJSON<ShoppingStore>(
    `/api/v1/shopping-route/stores/${encodeURIComponent(storeId)}`,
    token,
  );
}

export function createShoppingStore(
  token: string,
  input: { name: string; address?: string; note?: string },
) {
  return requestJSON<ShoppingStore>('/api/v1/shopping-route/stores', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updateShoppingStore(
  token: string,
  storeId: string,
  input: {
    name: string;
    address?: string;
    note?: string;
    entryZoneId?: string;
    checkoutZoneId?: string;
  },
) {
  return requestJSON<ShoppingStore>(
    `/api/v1/shopping-route/stores/${encodeURIComponent(storeId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PUT',
    },
  );
}

export function deleteShoppingStore(token: string, storeId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/shopping-route/stores/${encodeURIComponent(storeId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function setShoppingZones(
  token: string,
  storeId: string,
  zones: { name: string; zoneType: ShoppingZoneType }[],
) {
  return requestJSON<{ items: ShoppingZone[] }>(
    `/api/v1/shopping-route/stores/${encodeURIComponent(storeId)}/zones`,
    token,
    {
      body: JSON.stringify(zones),
      method: 'PUT',
    },
  );
}

export function fetchMappingSuggestions(token: string, listId: string, storeId?: string) {
  const query = new URLSearchParams({ listId });
  if (storeId) query.set('storeId', storeId);
  return requestJSON<{ items: ShoppingMappingSuggestion[] }>(
    `/api/v1/shopping-route/mapping-suggestions?${query.toString()}`,
    token,
  );
}

export function saveShoppingMapping(
  token: string,
  input: { itemId: string; storeId?: string; zoneId?: string; zoneType?: ShoppingZoneType },
) {
  return requestJSON<ShoppingMapping>('/api/v1/shopping-route/mappings', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function createShoppingRoute(token: string, listId: string, storeId: string) {
  return requestJSON<ShoppingRoute>('/api/v1/shopping-route/routes', token, {
    body: JSON.stringify({ listId, storeId }),
    method: 'POST',
  });
}

export function fetchShoppingRoute(token: string, routeId: string) {
  return requestJSON<ShoppingRoute>(
    `/api/v1/shopping-route/routes/${encodeURIComponent(routeId)}`,
    token,
  );
}

export function updateShoppingRouteItem(
  token: string,
  routeId: string,
  itemId: string,
  completed: boolean,
) {
  return requestJSON<ShoppingRoute>(
    `/api/v1/shopping-route/routes/${encodeURIComponent(routeId)}/items`,
    token,
    {
      body: JSON.stringify({ itemId, completed }),
      method: 'PATCH',
    },
  );
}

export function completeShoppingRoute(token: string, routeId: string) {
  return requestJSON<ShoppingRoute>(
    `/api/v1/shopping-route/routes/${encodeURIComponent(routeId)}/complete`,
    token,
    { method: 'POST' },
  );
}

export function fetchShoppingRouteHistory(token: string) {
  return requestJSON<{ items: ShoppingRoute[] }>('/api/v1/shopping-route/history', token);
}

export function fetchProductByBarcode(token: string, barcode: string) {
  return requestJSON<{ product: ShoppingProductMeta | null }>(
    `/api/v1/shopping-route/products/${encodeURIComponent(barcode)}`,
    token,
  );
}

export function getShoppingRouteErrorMessage(error: unknown) {
  if (!(error instanceof ShoppingRouteAPIError)) {
    return '暂时无法连接购物路线服务，请稍后重试。';
  }
  const messages: Record<string, string> = {
    shopping_route_invalid_input: '请检查清单、超市或归位内容是否完整。',
    shopping_route_not_found: '没有找到这条购物路线，可能已被删除。',
    cooking_guide_dish_not_found: '这道菜谱不存在，无法导入购物清单。',
    cooking_guide_unavailable: '跟做菜谱服务暂不可用，无法导入。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '操作过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '购物路线请求失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new ShoppingRouteAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
