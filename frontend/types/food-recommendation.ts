export type FoodRequest = {
  query: string;
  city?: string;
  district?: string;
  cuisines?: string[];
  spiciness?: string[];
  priceMin?: number;
  priceMax?: number;
  distanceMaxKm?: number;
  dietary?: string[];
  scenarios?: string[];
  previousQueryId?: string;
};

export type FoodImage = {
  url: string;
  source: string;
  credit?: string;
};

export type FoodRestaurant = {
  name: string;
  address: string;
  openHours: string;
  distanceKm: number;
  rating: number;
};

export type FoodReason = {
  label: string;
  text: string;
};

export type FoodItem = {
  dishId: string;
  name: string;
  cuisine: string;
  city: string;
  district: string;
  image: FoodImage;
  ingredients: string[];
  flavorProfile: string[];
  spiciness: string;
  avgPrice: number;
  rating: number;
  distanceKm: number;
  restaurant: FoodRestaurant;
  bestTime: string;
  suitableFor: string[];
  reasons: FoodReason[];
  fitScore: number;
  source: string;
  updatedAt: string;
};

export type FoodFilterOption = {
  min?: number;
  max?: number;
  label: string;
};

export type FoodAvailableFilters = {
  cuisines: string[];
  spiciness: string[];
  priceRanges: FoodFilterOption[];
  distanceRanges: FoodFilterOption[];
  dietary: string[];
  scenarios: string[];
};

export type FoodResponse = {
  queryId: string;
  city: string;
  district: string;
  summary: string;
  items: FoodItem[];
  availableFilters: FoodAvailableFilters;
  ai: 'deepseek' | 'fallback';
  disclaimer: string;
  generatedAt: string;
};

export type FoodCatalogItem = FoodItem;

export type FoodHistoryItem = {
  queryId: string;
  query: string;
  city: string;
  district: string;
  summary: string;
  dishCount: number;
  createdAt: string;
};
