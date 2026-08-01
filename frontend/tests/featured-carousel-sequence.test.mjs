import assert from 'node:assert/strict';
import test from 'node:test';

import { getNextCarouselIndex } from '../features/home/featured-carousel-sequence.ts';

function collectIndices(itemCount, transitions) {
  const indices = [0];
  let index = 0;

  for (let step = 0; step < transitions; step += 1) {
    index = getNextCarouselIndex(index, itemCount);
    indices.push(index);
  }

  return indices;
}

test('loops four slides forward without reversing direction', () => {
  assert.deepEqual(collectIndices(4, 7), [0, 1, 2, 3, 0, 1, 2, 3]);
});

test('loops two slides forward', () => {
  assert.deepEqual(collectIndices(2, 3), [0, 1, 0, 1]);
});

test('keeps a safe index when fewer than two slides are available', () => {
  assert.equal(getNextCarouselIndex(0, 0), 0);
  assert.equal(getNextCarouselIndex(0, 1), 0);
});
