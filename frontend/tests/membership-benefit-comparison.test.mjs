import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMembershipComparison,
  getMembershipComparisonFeatures,
  MEMBERSHIP_COMPARISON_COLLAPSED_LIMIT,
} from '../lib/membership-benefit-comparison.ts';

const allMemberRoles = ['normal', 'vip', 'svip', 'admin'];

function feature(index, roles) {
  return { id: `feature-${index}`, name: `功能 ${index}`, roles };
}

test('keeps only real permission differences and preserves backend order', () => {
  const features = [
    feature(1, allMemberRoles),
    feature(2, ['vip', 'svip', 'admin']),
    feature(3, ['admin']),
    feature(4, ['svip', 'admin']),
  ];

  assert.deepEqual(
    getMembershipComparisonFeatures(features).map((item) => item.id),
    ['feature-2', 'feature-4'],
  );
});

test('does not show an expand action for five or fewer differences', () => {
  const result = buildMembershipComparison(
    Array.from({ length: MEMBERSHIP_COMPARISON_COLLAPSED_LIMIT }, (_, index) =>
      feature(index + 1, ['vip', 'svip']),
    ),
    false,
  );

  assert.equal(result.total, 5);
  assert.equal(result.visible.length, 5);
  assert.equal(result.hiddenCount, 0);
  assert.equal(result.canExpand, false);
});

test('shows five differences and the exact remaining count when collapsed', () => {
  const result = buildMembershipComparison(
    Array.from({ length: 12 }, (_, index) => feature(index + 1, ['svip'])),
    false,
  );

  assert.equal(result.total, 12);
  assert.equal(result.visible.length, 5);
  assert.equal(result.hiddenCount, 7);
  assert.equal(result.canExpand, true);
});

test('shows all differences after expansion', () => {
  const result = buildMembershipComparison(
    Array.from({ length: 12 }, (_, index) => feature(index + 1, ['svip'])),
    true,
  );

  assert.equal(result.total, 12);
  assert.equal(result.visible.length, 12);
  assert.equal(result.hiddenCount, 7);
});

test('returns an empty comparison for no differences', () => {
  const result = buildMembershipComparison([feature(1, allMemberRoles), feature(2, ['admin'])], false);

  assert.equal(result.total, 0);
  assert.deepEqual(result.visible, []);
  assert.equal(result.canExpand, false);
});
