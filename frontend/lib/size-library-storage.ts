import { createEmptySizeLibraryState } from '../types/size-library.ts';
import type { SizeLibraryState } from '../types/size-library.ts';

let memoryValue: string | null = null;

export async function getSizeLibraryState(): Promise<SizeLibraryState> {
  const parsed = parseState(memoryValue);
  return parsed ?? createEmptySizeLibraryState();
}

export async function setSizeLibraryState(state: SizeLibraryState) {
  memoryValue = JSON.stringify(state);
}

export async function clearSizeLibraryState() {
  memoryValue = null;
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
