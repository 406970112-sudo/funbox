import { createEmptyParkingLocationState } from '@/types/parking-location';
import type { ParkingLocationState } from '@/types/parking-location';
import { normalizeParkingLocationState } from '@/lib/parking-location';

const stateKey = 'funbox.parking-location.state.v1';

export async function getParkingLocationState(): Promise<ParkingLocationState> {
  if (typeof window === 'undefined') return createEmptyParkingLocationState();
  const value = window.localStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptyParkingLocationState();
}

export async function setParkingLocationState(state: ParkingLocationState) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(stateKey, JSON.stringify(normalizeParkingLocationState(state)));
  }
}

export async function clearParkingLocationState() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(stateKey);
  }
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
