import assert from 'node:assert/strict';
import test from 'node:test';

import {
  displayDishName,
  emptyContribution,
  filterCookingDishes,
  formatFetchedAt,
  sortCookingDishes,
  summarizeCookingSearch,
  validateContribution,
} from '../lib/cooking-guide.ts';

function baseDish(overrides = {}) {
  return {
    id: '52947',
    name: 'Ma Po Tofu',
    nameZh: '麻婆豆腐',
    area: 'Chinese',
    areaZh: '中式',
    category: 'Beef',
    tags: ['Tofu'],
    image: { url: 'https://example.com/mapo.jpg', source: 'themealdb' },
    ingredientCount: 16,
    stepCount: 9,
    ...overrides,
  };
}

test('displayDishName prefers the curated Chinese name', () => {
  assert.equal(displayDishName({ name: 'Ma Po Tofu', nameZh: '麻婆豆腐' }), '麻婆豆腐');
  assert.equal(displayDishName({ name: 'Pizza', nameZh: '' }), 'Pizza');
});

test('filterCookingDishes applies area, category and tag', () => {
  const dishes = [
    baseDish(),
    baseDish({
      id: '52945',
      name: 'Kung Pao Chicken',
      nameZh: '宫保鸡丁',
      category: 'Chicken',
      tags: ['Spicy'],
    }),
  ];
  assert.equal(filterCookingDishes(dishes, { area: 'Chinese' }).length, 2);
  assert.equal(filterCookingDishes(dishes, { category: 'Chicken' }).length, 1);
  assert.equal(filterCookingDishes(dishes, { tag: 'Spicy' }).length, 1);
  assert.equal(filterCookingDishes(dishes, { category: 'Missing' }).length, 0);
});

test('sortCookingDishes sorts by ingredient and step counts', () => {
  const many = baseDish({ id: 'many', ingredientCount: 20, stepCount: 14 });
  const few = baseDish({ id: 'few', ingredientCount: 5, stepCount: 3 });
  assert.deepEqual(
    sortCookingDishes([many, few], 'ingredients-asc').map((dish) => dish.id),
    ['few', 'many'],
  );
  assert.deepEqual(
    sortCookingDishes([many, few], 'steps-asc').map((dish) => dish.id),
    ['few', 'many'],
  );
  assert.deepEqual(
    sortCookingDishes([many, few], 'default').map((dish) => dish.id),
    ['many', 'few'],
  );
});

test('summarizeCookingSearch keeps the real result count', () => {
  assert.equal(summarizeCookingSearch('kung', undefined, 2), '搜索“kung”找到 2 道真实菜谱');
  assert.equal(summarizeCookingSearch('', '中式', 27), '菜系“中式”找到 27 道真实菜谱');
});

test('validateContribution requires name, area, ingredients and steps', () => {
  assert.equal(validateContribution(emptyContribution()), '菜名不能为空');
  assert.equal(
    validateContribution({
      ...emptyContribution(),
      name: '红烧肉',
      area: '中式',
      ingredients: ['五花肉'],
      steps: [],
    }),
    '至少填写一个步骤',
  );
  assert.equal(
    validateContribution({
      ...emptyContribution(),
      name: '红烧肉',
      area: '中式',
      ingredients: ['五花肉'],
      steps: ['炖煮'],
    }),
    null,
  );
});

test('formatFetchedAt renders a stable date', () => {
  assert.equal(formatFetchedAt('2026-08-02T02:54:17.745Z'), '2026-08-02');
  assert.equal(formatFetchedAt('not-a-date'), 'not-a-date');
});
