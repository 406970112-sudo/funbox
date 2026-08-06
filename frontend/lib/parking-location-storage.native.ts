import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEmptyParkingLocationState } from '@/types/parking-location';
import type { ParkingLocationState } from '@/types/parking-location';
import { normalizeParkingLocationState } from '@/lib/parking-location';

const stateKey = 'funbox.parking-location.state.v1';

export async function getParkingLocationState(): Promise<ParkingLocationState> {
  const value = await AsyncStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptyParkingLocationState();
}

export async function setParkingLocationState(state: ParkingLocationState) {
  await AsyncStorage.setItem(stateKey, JSON.stringify(normalizeParkingLocationState(state)));
}

export async function clearParkingLocationState() {
  await AsyncStorage.removeItem(stateKey);
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
