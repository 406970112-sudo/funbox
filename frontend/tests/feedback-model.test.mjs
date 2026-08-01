import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEEDBACK_MAX_IMAGE_BYTES,
  feedbackLayoutForWidth,
  mergeFeedbackPages,
  resolveFeedbackSelection,
  shouldShowFeedbackEntry,
  validateFeedback,
} from '../lib/feedback-model.ts';

function makeAsset(overrides = {}) {
  return {
    fileName: 'feedback.png',
    fileSize: 1024,
    mimeType: 'image/png',
    uri: 'file:///feedback.png',
    ...overrides,
  };
}

test('validates normalized description and image constraints', () => {
  assert.equal(validateFeedback(' 1234567890 ', []).description, '1234567890');
  assert.equal(validateFeedback('太短', []).error, 'description_invalid');
  assert.equal(
    validateFeedback('这是一个有效的问题描述文本', Array.from({ length: 4 }, makeAsset)).error,
    'feedback_images_too_many',
  );
  assert.equal(
    validateFeedback('这是一个有效的问题描述文本', [makeAsset({ fileSize: FEEDBACK_MAX_IMAGE_BYTES + 1 })])
      .error,
    'feedback_image_too_large',
  );
  assert.equal(
    validateFeedback('这是一个有效的问题描述文本', [makeAsset({ mimeType: 'image/gif' })]).error,
    'feedback_image_type_invalid',
  );
});

test('selects responsive layout at 768px', () => {
  assert.equal(feedbackLayoutForWidth(767), 'mobile');
  assert.equal(feedbackLayoutForWidth(768), 'desktop');
});

test('merges paged feedback without duplicate ids', () => {
  assert.deepEqual(
    mergeFeedbackPages([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]).map((item) => item.id),
    ['a', 'b'],
  );
});

test('shows feedback entry only for authenticated users', () => {
  assert.equal(shouldShowFeedbackEntry('authenticated'), true);
  assert.equal(shouldShowFeedbackEntry('anonymous'), false);
  assert.equal(shouldShowFeedbackEntry('loading'), false);
});

test('keeps a valid selection and falls back to the first feedback item', () => {
  assert.equal(resolveFeedbackSelection([{ id: 'a' }, { id: 'b' }], 'b'), 'b');
  assert.equal(resolveFeedbackSelection([{ id: 'a' }], 'missing'), 'a');
  assert.equal(resolveFeedbackSelection([], 'a'), null);
});
