export type ShoppingZoneType =
  | 'produce'
  | 'dairy'
  | 'frozen'
  | 'meat'
  | 'grain'
  | 'household'
  | 'personal'
  | 'snacks'
  | 'bakery'
  | 'other';

export type ShoppingProductMeta = {
  name: string;
  brand: string;
  category: string;
  imageUrl: string;
  source: string;
  fetchedAt: number;
};

export type ShoppingItem = {
  id: string;
  listId: string;
  userId: string;
  name: string;
  normalizedName: string;
  quantity: string;
  unit: string;
  barcode: string;
  note: string;
  source: string;
  productMeta?: ShoppingProductMeta;
  createdAt: number;
  updatedAt: number;
};

export type ShoppingList = {
  id: string;
  userId: string;
  name: string;
  items: ShoppingItem[];
  createdAt: number;
  updatedAt: number;
};

export type ShoppingZone = {
  id: string;
  userId: string;
  storeId: string;
  name: string;
  zoneType: ShoppingZoneType;
  position: number;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type ShoppingStore = {
  id: string;
  userId: string;
  name: string;
  address: string;
  lat: string;
  lon: string;
  note: string;
  entryZoneId: string;
  checkoutZoneId: string;
  zones: ShoppingZone[];
  createdAt: number;
  updatedAt: number;
};

export type ShoppingMapping = {
  id: string;
  userId: string;
  itemKey: string;
  zoneType: ShoppingZoneType;
  storeId: string;
  zoneId: string;
  source: string;
  sourceRef: string;
  confirmedAt: number;
  updatedAt: number;
};

export type ShoppingRouteItem = {
  item: ShoppingItem;
  zoneId: string;
  zoneType: ShoppingZoneType;
  mapped: boolean;
  source: string;
  completed: boolean;
};

export type ShoppingRouteZone = {
  zone: ShoppingZone;
  items: ShoppingRouteItem[];
  completed: number;
  total: number;
};

export type ShoppingRoute = {
  id: string;
  userId: string;
  listId: string;
  storeId: string;
  status: 'active' | 'complete';
  entryZoneId: string;
  checkoutZoneId: string;
  zones: ShoppingRouteZone[];
  unmapped: ShoppingRouteItem[];
  mappedCount: number;
  totalCount: number;
  unmappedCount: number;
  completeness: number;
  createdAt: number;
  completedAt: number;
};

export type ShoppingRouteHome = {
  lists: ShoppingList[];
  stores: ShoppingStore[];
  activeRoute?: ShoppingRoute;
  totalItems: number;
  mappedItems: number;
  unmappedItems: number;
  verifiedMappingCount: number;
  userMappingCount: number;
  updatedAt: number;
};

export type ShoppingMappingSuggestion = {
  itemId: string;
  name: string;
  zoneType: ShoppingZoneType;
  zoneName: string;
  zoneId: string;
  source: string;
  sourceRef: string;
  reviewedAt: string;
};
