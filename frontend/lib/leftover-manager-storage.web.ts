import { createEmptyLeftoverLocalState } from '@/types/leftover-manager';
import type { LeftoverLocalState } from '@/types/leftover-manager';
import { normalizeLeftoverLocalState } from '@/lib/leftover-manager';

const stateKey = 'funbox.leftover-manager.state.v1';

export async function getLeftoverLocalState(): Promise<LeftoverLocalState> {
  if (typeof window === 'undefined') return createEmptyLeftoverLocalState();
  const parsed = parseState(window.localStorage.getItem(stateKey));
  return parsed ?? createEmptyLeftoverLocalState();
}

export async function setLeftoverLocalState(state: LeftoverLocalState) {
  if (typeof window !== 'undefined') window.localStorage.setItem(stateKey, JSON.stringify(state));
}

export async function clearLeftoverLocalState() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(stateKey);
}

function parseState(value: string | null): LeftoverLocalState | null {
  if (!value) return null;
  try {
    return normalizeLeftoverLocalState(JSON.parse(value) as LeftoverLocalState);
  } catch {
    return null;
  }
}
