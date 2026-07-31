import type { SavedSSQBatch } from '../types/double-color-ball.ts';

let memoryValue: string | null = null;

export async function getSavedSSQBatch() {
  return parseSavedBatch(memoryValue);
}

export async function setSavedSSQBatch(value: SavedSSQBatch) {
  memoryValue = JSON.stringify(value);
}

export async function removeSavedSSQBatch() {
  memoryValue = null;
}

function parseSavedBatch(value: string | null): SavedSSQBatch | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SavedSSQBatch;
    return isSavedBatch(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSavedBatch(value: SavedSSQBatch) {
  return Boolean(
    value
    && typeof value.issue === 'string'
    && [30, 100, 300].includes(value.windowSize)
    && Number.isInteger(value.batchIndex)
    && value.batch
    && value.batch.batchIndex === value.batchIndex
    && value.batch.generatedForIssue === value.issue
    && Array.isArray(value.batch.combinations)
    && value.batch.combinations.length === 5,
  );
}
