import assert from 'node:assert/strict';
import test from 'node:test';

import { getNextCarouselStep } from '../features/home/featured-carousel-sequence.ts';

function collectIndices(itemCount, transitions) {
  const indices = [0];
  let state = { index: 0, direction: 1 };

  for (let step = 0; step < transitions; step += 1) {
    state = getNextCarouselStep(state.index, state.direction, itemCount);
    indices.push(state.index);
  }

  return indices;
}

test('moves four slides forward and backward without repeating endpoints', () => {
  assert.deepEqual(collectIndices(4, 7), [0, 1, 2, 3, 2, 1, 0, 1]);
});

test('moves two slides back and forth', () => {
  assert.deepEqual(collectIndices(2, 3), [0, 1, 0, 1]);
});

test('keeps a safe index when fewer than two slides are available', () => {
  assert.deepEqual(getNextCarouselStep(0, 1, 0), { index: 0, direction: 1 });
  assert.deepEqual(getNextCarouselStep(0, -1, 1), { index: 0, direction: 1 });
});
