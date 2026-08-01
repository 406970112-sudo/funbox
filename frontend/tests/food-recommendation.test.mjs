import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFoodRequest,
  countActiveFilters,
  CUISINE_OPTIONS,
  emptyFoodFilter,
  filterFoodItems,
  formatDistance,
  formatPrice,
  sortFoodItems,
  summarizeFoodRequest,
} from '../lib/food-recommendation.ts';

test('CUISINE_OPTIONS includes local food categories', () => {
  assert.equal(CUISINE_OPTIONS.find((option) => option.id === '甜品')?.label, '甜品');
});

test('buildFoodRequest maps address and preferences to API payload', () => {
  const request = buildFoodRequest({
    query: '成都市武侯区玉林西路',
    city: '成都',
    district: '武侯区',
    cuisines: ['火锅'],
    spiciness: ['重辣'],
    priceMin: 30,
    priceMax: 100,
    distanceMaxKm: 3,
    dietary: ['不吃内脏'],
    scenarios: ['朋友聚餐'],
  });
  assert.equal(request.city, '成都');
  assert.equal(request.district, '武侯区');
  assert.deepEqual(request.cuisines, ['火锅']);
  assert.deepEqual(request.spiciness, ['重辣']);
  assert.equal(request.priceMax, 100);
  assert.equal(request.distanceMaxKm, 3);
  assert.deepEqual(request.dietary, ['不吃内脏']);
  assert.deepEqual(request.scenarios, ['朋友聚餐']);
});

test('formatPrice and formatDistance render Chinese labels', () => {
  assert.equal(formatPrice(88), '¥88');
  assert.equal(formatDistance(0.65), '650m');
  assert.equal(formatDistance(1.2), '1.2km');
});

test('summarizeFoodRequest prefers natural language address', () => {
  const request = buildFoodRequest({
    query: '成都武侯区，不要辣',
    cuisines: [],
    spiciness: [],
    dietary: [],
    scenarios: [],
  });
  assert.equal(summarizeFoodRequest(request), '成都武侯区，不要辣');
});

function baseItem(overrides = {}) {
  return {
    dishId: 'cd-hotpot',
    name: '牛油九宫格火锅',
    cuisine: '火锅',
    city: '成都',
    district: '武侯区',
    image: { url: 'https://example.com/hotpot.jpg', source: 'test' },
    ingredients: ['牛油', '毛肚', '鸭肠'],
    flavorProfile: ['麻辣'],
    spiciness: '重辣',
    avgPrice: 88,
    rating: 4.7,
    distanceKm: 1.2,
    restaurant: { name: '玉林老灶火锅', address: '玉林西路', openHours: '11:00-02:00', distanceKm: 1.2, rating: 4.7 },
    bestTime: '晚上',
    suitableFor: ['朋友聚餐', '夜宵'],
    reasons: [{ label: '本地味', text: '牛油锅底本地认可度高' }],
    fitScore: 92,
    source: 'curated',
    updatedAt: '2026-08-01',
    ...overrides,
  };
}

test('filterFoodItems applies cuisine, spiciness, price, distance, dietary and scenario', () => {
  const items = [
    baseItem(),
    baseItem({
      dishId: 'cd-bingfen',
      name: '冰粉',
      cuisine: '甜品',
      spiciness: '不辣',
      avgPrice: 10,
      distanceKm: 0.8,
      ingredients: ['冰粉籽', '红糖'],
      suitableFor: ['一人食', '解辣'],
    }),
  ];
  const filtered = filterFoodItems(items, {
    cuisines: ['甜品'],
    spiciness: ['不辣'],
    priceRange: { max: 30, label: '30以内' },
    distanceRange: { max: 1, label: '1km内' },
    dietary: ['不吃辣'],
    scenarios: ['一人食'],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].dishId, 'cd-bingfen');
});

test('filterFoodItems respects dietary restrictions', () => {
  const items = [baseItem()];
  assert.equal(
    filterFoodItems(items, emptyFoodFilter()).length,
    1,
  );
  assert.equal(
    filterFoodItems(items, { ...emptyFoodFilter(), dietary: ['不吃内脏'] }).length,
    0,
  );
});

test('sortFoodItems sorts by distance, price, rating or fit score', () => {
  const far = baseItem({ dishId: 'far', avgPrice: 50, rating: 4.5, distanceKm: 3.2, fitScore: 70 });
  const near = baseItem({ dishId: 'near', avgPrice: 30, rating: 4.9, distanceKm: 0.6, fitScore: 95 });
  const items = [far, near];
  assert.equal(sortFoodItems(items, 'distance')[0].dishId, 'near');
  assert.equal(sortFoodItems(items, 'price-asc')[0].dishId, 'near');
  assert.equal(sortFoodItems(items, 'rating')[0].dishId, 'near');
  assert.equal(sortFoodItems(items, 'fit')[0].dishId, 'near');
});

test('countActiveFilters counts selected conditions', () => {
  assert.equal(countActiveFilters(emptyFoodFilter()), 0);
  assert.equal(
    countActiveFilters({
      cuisines: ['火锅'],
      spiciness: ['重辣'],
      priceRange: { max: 100, label: '60-100' },
      distanceRange: { max: 3, label: '3km内' },
      dietary: [],
      scenarios: ['朋友聚餐'],
    }),
    5,
  );
});
