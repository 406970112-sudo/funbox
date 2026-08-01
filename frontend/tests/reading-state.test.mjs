import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampChapterProgress,
  createReaderSettings,
  readerSettingsReducer,
  shouldReplaceReadingProgress,
} from '../lib/reading-state.ts';

test('clamps chapter progress to the supported range', () => {
  assert.equal(clampChapterProgress(-0.2), 0);
  assert.equal(clampChapterProgress(0.42), 0.42);
  assert.equal(clampChapterProgress(2), 1);
});

test('an older client update cannot replace newer reading progress', () => {
  const current = { chapterId: 'two', chapterProgress: 0.7, updatedAt: '2026-07-31T12:00:00.000Z' };
  assert.equal(shouldReplaceReadingProgress(current, { ...current, chapterProgress: 0.2, updatedAt: '2026-07-31T11:59:00.000Z' }), false);
  assert.equal(shouldReplaceReadingProgress(current, { ...current, chapterProgress: 0.8, updatedAt: '2026-07-31T12:01:00.000Z' }), true);
});

test('reader settings reducer respects typography boundaries', () => {
  let settings = createReaderSettings();
  for (let index = 0; index < 30; index += 1) settings = readerSettingsReducer(settings, { type: 'increase-font' });
  assert.equal(settings.fontSize, 28);
  for (let index = 0; index < 30; index += 1) settings = readerSettingsReducer(settings, { type: 'decrease-font' });
  assert.equal(settings.fontSize, 15);
  settings = readerSettingsReducer(settings, { type: 'set-theme', theme: 'night' });
  settings = readerSettingsReducer(settings, { type: 'set-line-height', lineHeight: 4 });
  assert.equal(settings.theme, 'night');
  assert.equal(settings.lineHeight, 2.2);
});
