import { createEmptySizeLibraryState } from '@/types/size-library';
import type { SizeLibraryState } from '@/types/size-library';

const stateKey = 'funbox.size-library.state.v1';

export async function getSizeLibraryState(): Promise<SizeLibraryState> {
  if (typeof window === 'undefined') return createEmptySizeLibraryState();
  const value = window.localStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptySizeLibraryState();
}

export async function setSizeLibraryState(state: SizeLibraryState) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(stateKey, JSON.stringify(state));
  }
}

export async function clearSizeLibraryState() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(stateKey);
  }
}

function parseState(value: string | null): SizeLibraryState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SizeLibraryState;
    return isSizeLibraryState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSizeLibraryState(value: SizeLibraryState) {
  return Boolean(
    value
    && value.schemaVersion === 1
    && Array.isArray(value.profiles)
    && Array.isArray(value.measurements),
  );
}
