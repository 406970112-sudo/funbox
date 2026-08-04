import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_MAX_TITLE,
  feedbackLayoutForWidth,
  feedbackStatusLabel,
  mergeFeedbackPages,
  resolveFeedbackSelection,
  shouldShowFeedbackEntry,
  validateFeedback,
  validateFeatureFeedback,
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

test('validates feature request title, category and description', () => {
  const valid = validateFeatureFeedback('发票识别工具', 'tool', '希望增加发票识别工具，自动识别发票金额', []);
  assert.equal(valid.error, undefined);
  assert.equal(valid.title, '发票识别工具');
  assert.equal(valid.category, 'tool');

  assert.equal(
    validateFeatureFeedback('短', 'tool', '希望增加发票识别工具，自动识别发票金额', []).error,
    'feedback_title_invalid',
  );
  assert.equal(
    validateFeatureFeedback(
      'x'.repeat(FEEDBACK_MAX_TITLE + 1),
      'tool',
      '希望增加发票识别工具，自动识别发票金额',
      [],
    ).error,
    'feedback_title_invalid',
  );
  assert.equal(
    validateFeatureFeedback(
      '发票识别工具',
      'unknown',
      '希望增加发票识别工具，自动识别发票金额',
      [],
    ).error,
    'feedback_category_invalid',
  );
  assert.equal(
    validateFeatureFeedback('发票识别工具', 'tool', '太短', []).error,
    'description_invalid',
  );
});

test('maps feedback status labels', () => {
  assert.equal(feedbackStatusLabel('pending'), '待处理');
  assert.equal(feedbackStatusLabel('processing'), '处理中');
  assert.equal(feedbackStatusLabel('resolved'), '已处理');
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
