import * as SecureStore from 'expo-secure-store';

import type { SavedSSQBatch } from '@/types/double-color-ball';

const savedBatchKey = 'funbox.ssq.saved-batch.v1';

export async function getSavedSSQBatch(): Promise<SavedSSQBatch | null> {
  const value = await SecureStore.getItemAsync(savedBatchKey);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SavedSSQBatch;
    return isSavedBatch(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setSavedSSQBatch(value: SavedSSQBatch) {
  return SecureStore.setItemAsync(savedBatchKey, JSON.stringify(value));
}

export function removeSavedSSQBatch() {
  return SecureStore.deleteItemAsync(savedBatchKey);
}

function isSavedBatch(value: SavedSSQBatch) {
  return Boolean(
    value
    && typeof value.issue === 'string'
    && [30, 100, 300].includes(value.windowSize)
    && Number.isInteger(value.batchIndex)
    && value.batch?.generatedForIssue === value.issue
    && value.batch?.batchIndex === value.batchIndex
    && value.batch?.combinations.length === 5,
  );
}
