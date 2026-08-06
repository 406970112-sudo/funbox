import { createEmptyBorrowLedgerState } from '../types/borrow-ledger.ts';
import type { BorrowLedgerState } from '../types/borrow-ledger.ts';

let memoryValue: string | null = null;

export async function getBorrowLedgerState(): Promise<BorrowLedgerState> {
  const parsed = parseState(memoryValue);
  return parsed ?? createEmptyBorrowLedgerState();
}

export async function setBorrowLedgerState(state: BorrowLedgerState) {
  memoryValue = JSON.stringify(state);
}

export async function clearBorrowLedgerState() {
  memoryValue = null;
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
