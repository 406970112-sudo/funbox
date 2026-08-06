import AsyncStorage from '@react-native-async-storage/async-storage';

import { createEmptyBorrowLedgerState } from '@/types/borrow-ledger';
import type { BorrowLedgerState } from '@/types/borrow-ledger';

const stateKey = 'funbox.borrow-ledger.state.v1';

export async function getBorrowLedgerState(): Promise<BorrowLedgerState> {
  const value = await AsyncStorage.getItem(stateKey);
  const parsed = parseState(value);
  return parsed ?? createEmptyBorrowLedgerState();
}

export async function setBorrowLedgerState(state: BorrowLedgerState) {
  await AsyncStorage.setItem(stateKey, JSON.stringify(state));
}

export async function clearBorrowLedgerState() {
  await AsyncStorage.removeItem(stateKey);
}

function parseState(value: string | null): BorrowLedgerState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as BorrowLedgerState;
    return isBorrowLedgerState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isBorrowLedgerState(value: BorrowLedgerState) {
  return Boolean(value && Array.isArray(value.records) && value.schemaVersion === 1);
}
