import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEmptyLeftoverLocalState } from '@/types/leftover-manager';
import type { LeftoverLocalState } from '@/types/leftover-manager';
import { normalizeLeftoverLocalState } from '@/lib/leftover-manager';

const stateKey = 'funbox.leftover-manager.state.v1';

export async function getLeftoverLocalState(): Promise<LeftoverLocalState> {
  const parsed = parseState(await AsyncStorage.getItem(stateKey));
  return parsed ?? createEmptyLeftoverLocalState();
}

export async function setLeftoverLocalState(state: LeftoverLocalState) {
  await AsyncStorage.setItem(stateKey, JSON.stringify(state));
}

export async function clearLeftoverLocalState() {
  await AsyncStorage.removeItem(stateKey);
}

function parseState(value: string | null): LeftoverLocalState | null {
  if (!value) return null;
  try {
    return normalizeLeftoverLocalState(JSON.parse(value) as LeftoverLocalState);
  } catch {
    return null;
  }
}
