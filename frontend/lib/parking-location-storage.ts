import { createEmptyParkingLocationState } from '../types/parking-location.ts';
import type { ParkingLocationState } from '../types/parking-location.ts';
import { normalizeParkingLocationState } from './parking-location.ts';

let memoryValue: string | null = null;

export async function getParkingLocationState(): Promise<ParkingLocationState> {
  const parsed = parseState(memoryValue);
  return parsed ?? createEmptyParkingLocationState();
}

export async function setParkingLocationState(state: ParkingLocationState) {
  memoryValue = JSON.stringify(normalizeParkingLocationState(state));
}

export async function clearParkingLocationState() {
  memoryValue = null;
}

function parseState(value: string | null): ParkingLocationState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ParkingLocationState;
    return parsed?.schemaVersion === 1 && Array.isArray(parsed.records) && Array.isArray(parsed.feeRules)
      ? normalizeParkingLocationState(parsed)
      : null;
  } catch {
    return null;
  }
}
