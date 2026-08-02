export type CookingArea = {
  name: string;
  zh: string;
  count: number;
};

export type CookingAreasResponse = {
  items: CookingArea[];
  fetchedAt: string;
  source: string;
};

export type CookingImage = {
  url: string;
  source: string;
  credit?: string;
  checkedAt?: string;
};

export type CookingIngredient = {
  name: string;
  measure: string;
};

export type CookingDishSummary = {
  id: string;
  name: string;
  nameZh: string;
  area: string;
  areaZh: string;
  category: string;
  tags: string[];
  image: CookingImage;
  ingredientCount: number;
  stepCount: number;
};

export type CookingDishListResponse = {
  items: CookingDishSummary[];
  total: number;
  fetchedAt: string;
  source: string;
};

export type CookingDishDetail = {
  id: string;
  name: string;
  nameZh: string;
  area: string;
  areaZh: string;
  category: string;
  tags: string[];
  image: CookingImage;
  ingredients: CookingIngredient[];
  steps: string[];
  recipeSource: string;
  videoUrl: string;
  license: string;
  fetchedAt: string;
};

export type CookingShoppingListResponse = {
  dishId: string;
  items: CookingIngredient[];
};

export type CookingSessionInput = {
  dishId: string;
  stepIndex: number;
  completed?: boolean;
};

export type CookingSession = {
  dishId: string;
  name: string;
  nameZh: string;
  stepIndex: number;
  totalSteps: number;
  completed: boolean;
  updatedAt: string;
};

export type CookingHistoryItem = {
  dishId: string;
  name: string;
  nameZh: string;
  kind: 'view' | 'session' | 'favorite';
  createdAt: string;
};

export type CookingFeedbackInput = {
  dishId: string;
  helpful: boolean;
  note?: string;
};

export type CookingContributionInput = {
  name: string;
  nameZh?: string;
  area: string;
  category?: string;
  imageUrl?: string;
  recipeSource?: string;
  ingredients: string[];
  steps: string[];
};

export type CookingContribution = {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  name: string;
  nameZh: string;
  area: string;
  category: string;
  imageUrl: string;
  recipeSource: string;
  ingredients: string[];
  steps: string[];
  createdAt: string;
  reviewedAt?: string;
  reviewNote?: string;
};
