import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screenSource = readFileSync(
  new URL('../features/tools/requirement-prompt-screen.tsx', import.meta.url),
  'utf8',
);

const copyMarker = 'testID="requirement-prompt-copy"';

test('renders exactly one copy button', () => {
  const occurrences = screenSource.split(copyMarker).length - 1;
  assert.equal(occurrences, 1);
});

test('keeps the copy button in the result header row above the template body', () => {
  const outputCardIndex = screenSource.indexOf('styles.outputCard');
  const headerIndex = screenSource.indexOf('styles.cardHeader', outputCardIndex);
  const copyIndex = screenSource.indexOf(copyMarker);
  const outputBoxIndex = screenSource.indexOf('styles.outputBox');

  assert.notEqual(outputCardIndex, -1, 'output card is missing');
  assert.notEqual(headerIndex, -1, 'output card header is missing');
  assert.notEqual(copyIndex, -1, 'copy button is missing');
  assert.notEqual(outputBoxIndex, -1, 'template body is missing');
  assert.ok(copyIndex > headerIndex, 'copy button must live in the result header row');
  assert.ok(copyIndex < outputBoxIndex, 'copy button must be rendered before the template body');
});
