export const BORROW_LEDGER_MAX_RECORDS = 1000;
export const BORROW_LEDGER_MAX_COUNTERPARTY_NAME = 20;
export const BORROW_LEDGER_MAX_TITLE = 60;
export const BORROW_LEDGER_MAX_PLATFORM = 30;
export const BORROW_LEDGER_MAX_ACCOUNT_NAME = 80;
export const BORROW_LEDGER_MAX_NOTE = 500;

export type BorrowKind = 'lend_out' | 'borrow_in' | 'paid_for';
export type BorrowSubjectType = 'item' | 'money' | 'account';
export type BorrowRemindRule =
  | 'none'
  | 'before_1d'
  | 'before_3d'
  | 'before_7d'
  | 'on_due'
  | 'daily_overdue';
export type BorrowRecordStatus = 'active' | 'overdue' | 'done';

export type BorrowCounterparty = {
  friendId?: string;
  name: string;
  avatarUrl?: string;
};

export type BorrowRecord = {
  id: string;
  kind: BorrowKind;
  subjectType: BorrowSubjectType;
  title: string;
  amount?: number;
  currency?: string;
  platform?: string;
  accountName?: string;
  counterparty: BorrowCounterparty;
  lentAt: string;
  dueAt?: string;
  remindRule: BorrowRemindRule;
  returnedAt?: string;
  settledAt?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type BorrowLedgerState = {
  schemaVersion: 1;
  records: BorrowRecord[];
  updatedAt: number;
};

export function createEmptyBorrowLedgerState(): BorrowLedgerState {
  return {
    schemaVersion: 1,
    records: [],
    updatedAt: 0,
  };
}
