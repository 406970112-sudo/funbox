import type { SavedSSQBatch } from '@/types/double-color-ball';

const savedBatchKey = 'funbox.ssq.saved-batch.v1';

export async function getSavedSSQBatch(): Promise<SavedSSQBatch | null> {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(savedBatchKey);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SavedSSQBatch;
    return isSavedBatch(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setSavedSSQBatch(value: SavedSSQBatch) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(savedBatchKey, JSON.stringify(value));
  }
}

export async function removeSavedSSQBatch() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(savedBatchKey);
  }
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
