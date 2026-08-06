import { createEmptyLeftoverLocalState } from '../types/leftover-manager.ts';
import type { LeftoverLocalState } from '../types/leftover-manager.ts';
import { normalizeLeftoverLocalState } from './leftover-manager.ts';

let memoryValue: string | null = null;

export async function getLeftoverLocalState(): Promise<LeftoverLocalState> {
  const parsed = parseState(memoryValue);
  return parsed ?? createEmptyLeftoverLocalState();
}

export async function setLeftoverLocalState(state: LeftoverLocalState) {
  memoryValue = JSON.stringify(state);
}

export async function clearLeftoverLocalState() {
  memoryValue = null;
}

function parseState(value: string | null): LeftoverLocalState | null {
  if (!value) return null;
  try {
    return normalizeLeftoverLocalState(JSON.parse(value) as LeftoverLocalState);
  } catch {
    return null;
  }
}
