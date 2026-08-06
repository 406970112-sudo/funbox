import type {
  BorrowKind,
  BorrowLedgerState,
  BorrowRecord,
  BorrowRecordStatus,
  BorrowRemindRule,
  BorrowSubjectType,
} from '../types/borrow-ledger.ts';
import {
  BORROW_LEDGER_MAX_ACCOUNT_NAME,
  BORROW_LEDGER_MAX_COUNTERPARTY_NAME,
  BORROW_LEDGER_MAX_NOTE,
  BORROW_LEDGER_MAX_PLATFORM,
  BORROW_LEDGER_MAX_RECORDS,
  BORROW_LEDGER_MAX_TITLE,
  createEmptyBorrowLedgerState,
} from '../types/borrow-ledger.ts';

export type BorrowReminderTone = 'casual' | 'short' | 'formal';

const REMIND_RULES: BorrowRemindRule[] = [
  'none',
  'before_1d',
  'before_3d',
  'before_7d',
  'on_due',
  'daily_overdue',
];

export function newBorrowLedgerID(prefix: string) {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${randomPart}_${Date.now().toString(36)}`;
}

export function normalizeBorrowLedgerState(value: BorrowLedgerState): BorrowLedgerState {
  return {
    ...createEmptyBorrowLedgerState(),
    ...value,
    records: Array.isArray(value.records) ? value.records : [],
  };
}

export function kindLabel(kind: BorrowKind) {
  const labels: Record<BorrowKind, string> = {
    lend_out: '我借出',
    borrow_in: '我借入',
    paid_for: '垫付费用',
  };
  return labels[kind];
}

export function subjectTypeLabel(subjectType: BorrowSubjectType) {
  const labels: Record<BorrowSubjectType, string> = {
    item: '物品',
    money: '金额',
    account: '会员账号',
  };
  return labels[subjectType];
}

export function remindRuleLabel(rule: BorrowRemindRule) {
  const labels: Record<BorrowRemindRule, string> = {
    none: '不提醒',
    before_1d: '提前 1 天',
    before_3d: '提前 3 天',
    before_7d: '提前 7 天',
    on_due: '到期当天',
    daily_overdue: '逾期后每天',
  };
  return labels[rule];
}

export function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && todayKey(date) === value;
}

export function daysBetween(from: string, to: string) {
  if (!isDateKey(from) || !isDateKey(to)) return 0;
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function formatDateKey(value: string) {
  if (!isDateKey(value)) return value || '未填写';
  const [, month, day] = value.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function isRecordDone(record: BorrowRecord) {
  return Boolean(record.returnedAt || record.settledAt);
}

export function recordStatus(record: BorrowRecord, now = new Date()): BorrowRecordStatus {
  if (isRecordDone(record)) return 'done';
  if (record.dueAt && daysBetween(todayKey(now), record.dueAt) < 0) return 'overdue';
  return 'active';
}

export function recordStatusLabel(status: BorrowRecordStatus) {
  const labels: Record<BorrowRecordStatus, string> = {
    active: '进行中',
    overdue: '已逾期',
    done: '已完成',
  };
  return labels[status];
}

export function formatAmount(amount?: number) {
  if (amount === undefined || !Number.isFinite(amount)) return '0';
  const text = amount.toFixed(2).replace(/\.00$/, '');
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function recordSubjectLabel(record: BorrowRecord) {
  if (record.subjectType === 'item') return record.title;
  if (record.subjectType === 'money') {
    return `${record.currency || 'CNY'} ${formatAmount(record.amount)}`;
  }
  const parts = [record.platform, record.accountName].filter(Boolean);
  return parts.join(' · ');
}

export function borrowStats(state: BorrowLedgerState, now = new Date()) {
  const stats = {
    active: 0,
    overdue: 0,
    done: 0,
    lendOut: 0,
    borrowIn: 0,
    paidFor: 0,
  };
  for (const record of state.records) {
    const status = recordStatus(record, now);
    if (status === 'active') stats.active += 1;
    if (status === 'overdue') stats.overdue += 1;
    if (status === 'done') stats.done += 1;
    if (record.kind === 'lend_out') stats.lendOut += 1;
    if (record.kind === 'borrow_in') stats.borrowIn += 1;
    if (record.kind === 'paid_for') stats.paidFor += 1;
  }
  return stats;
}

export function reminderCandidates(state: BorrowLedgerState, now = new Date()) {
  return state.records
    .filter(
      (record) =>
        !isRecordDone(record) &&
        record.remindRule !== 'none' &&
        Boolean(record.dueAt),
    )
    .sort((a, b) => {
      const aOverdue = recordStatus(a, now) === 'overdue' ? 1 : 0;
      const bOverdue = recordStatus(b, now) === 'overdue' ? 1 : 0;
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      return (a.dueAt ?? '').localeCompare(b.dueAt ?? '');
    });
}

export function validateBorrowRecord(record: BorrowRecord) {
  if (!['lend_out', 'borrow_in', 'paid_for'].includes(record.kind)) {
    return '请选择真实的记录方向';
  }
  if (!['item', 'money', 'account'].includes(record.subjectType)) {
    return '请选择标的物类型';
  }
  if (record.kind === 'paid_for' && record.subjectType !== 'money') {
    return '垫付费用必须填写金额';
  }
  const name = record.counterparty.name.trim();
  if (!name) return '请填写真实姓名或称呼';
  if (Array.from(name).length > BORROW_LEDGER_MAX_COUNTERPARTY_NAME) {
    return `姓名或称呼不能超过 ${BORROW_LEDGER_MAX_COUNTERPARTY_NAME} 个字符`;
  }
  if (record.subjectType === 'item' && !record.title.trim()) {
    return '请填写真实物品名称';
  }
  if (record.subjectType === 'item' && Array.from(record.title.trim()).length > BORROW_LEDGER_MAX_TITLE) {
    return `物品名称不能超过 ${BORROW_LEDGER_MAX_TITLE} 个字符`;
  }
  if (record.subjectType === 'money') {
    if (record.amount === undefined || !Number.isFinite(record.amount) || record.amount <= 0) {
      return '请填写大于 0 的真实金额';
    }
    if (!record.currency?.trim()) return '请选择币种';
  }
  if (record.subjectType === 'account') {
    if (!record.platform?.trim()) return '请填写会员平台';
    if (Array.from(record.platform.trim()).length > BORROW_LEDGER_MAX_PLATFORM) {
      return `平台不能超过 ${BORROW_LEDGER_MAX_PLATFORM} 个字符`;
    }
    if (!record.accountName?.trim()) return '请填写真实账号名或昵称';
    if (Array.from(record.accountName.trim()).length > BORROW_LEDGER_MAX_ACCOUNT_NAME) {
      return `账号名不能超过 ${BORROW_LEDGER_MAX_ACCOUNT_NAME} 个字符`;
    }
  }
  if (!isDateKey(record.lentAt)) return '请填写真实的借出/垫付日期';
  if (record.dueAt && !isDateKey(record.dueAt)) return '约定日期格式不正确';
  if (!REMIND_RULES.includes(record.remindRule)) return '提醒方式不正确';
  if (Array.from(record.note?.trim() ?? '').length > BORROW_LEDGER_MAX_NOTE) {
    return `备注不能超过 ${BORROW_LEDGER_MAX_NOTE} 个字符`;
  }
  return null;
}

export function addBorrowRecord(
  state: BorrowLedgerState,
  record: BorrowRecord,
): { error: string | null; state: BorrowLedgerState } {
  const validationError = validateBorrowRecord(record);
  if (validationError) return { error: validationError, state };
  if (state.records.length >= BORROW_LEDGER_MAX_RECORDS) {
    return { error: `最多只能保存 ${BORROW_LEDGER_MAX_RECORDS} 条真实记录`, state };
  }
  if (state.records.some((item) => item.id === record.id)) {
    return { error: '记录已存在，不能重复添加', state };
  }
  const now = Date.now();
  const nextRecord: BorrowRecord = {
    ...record,
    counterparty: {
      ...record.counterparty,
      name: record.counterparty.name.trim(),
      friendId: record.counterparty.friendId?.trim() || undefined,
      avatarUrl: record.counterparty.avatarUrl?.trim() || undefined,
    },
    title: record.title.trim(),
    platform: record.platform?.trim() || undefined,
    accountName: record.accountName?.trim() || undefined,
    lentAt: record.lentAt,
    dueAt: record.dueAt || undefined,
    note: record.note?.trim() || undefined,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  };
  return {
    error: null,
    state: {
      ...state,
      records: [...state.records, nextRecord],
      updatedAt: now,
    },
  };
}

export function updateBorrowRecord(
  state: BorrowLedgerState,
  record: BorrowRecord,
): { error: string | null; state: BorrowLedgerState } {
  const validationError = validateBorrowRecord(record);
  if (validationError) return { error: validationError, state };
  if (!state.records.some((item) => item.id === record.id)) {
    return { error: '记录不存在', state };
  }
  const now = Date.now();
  return {
    error: null,
    state: {
      ...state,
      records: state.records.map((item) => (item.id === record.id ? { ...record, updatedAt: now } : item)),
      updatedAt: now,
    },
  };
}

export function removeBorrowRecord(state: BorrowLedgerState, recordId: string): BorrowLedgerState {
  return {
    ...state,
    records: state.records.filter((record) => record.id !== recordId),
    updatedAt: Date.now(),
  };
}

export function completeBorrowRecord(
  state: BorrowLedgerState,
  recordId: string,
  now = new Date(),
): BorrowLedgerState {
  const record = state.records.find((item) => item.id === recordId);
  if (!record || isRecordDone(record)) return state;
  const completedKey = record.kind === 'paid_for' ? 'settledAt' : 'returnedAt';
  const timestamp = Date.now();
  return {
    ...state,
    records: state.records.map((item) =>
      item.id === recordId
        ? {
            ...item,
            [completedKey]: todayKey(now),
            updatedAt: timestamp,
          }
        : item,
    ),
    updatedAt: timestamp,
  };
}

export function reopenBorrowRecord(state: BorrowLedgerState, recordId: string): BorrowLedgerState {
  const timestamp = Date.now();
  return {
    ...state,
    records: state.records.map((item) =>
      item.id === recordId
        ? {
            ...item,
            returnedAt: undefined,
            settledAt: undefined,
            updatedAt: timestamp,
          }
        : item,
    ),
    updatedAt: timestamp,
  };
}

export function clearBorrowLedgerState(): BorrowLedgerState {
  return createEmptyBorrowLedgerState();
}

export function searchBorrowRecords(records: BorrowRecord[], query: string) {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return records;
  return records.filter((record) =>
    [
      record.counterparty.name,
      record.title,
      record.platform,
      record.accountName,
      record.note,
      record.currency,
      record.amount ? String(record.amount) : '',
    ]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(keyword)),
  );
}

export function buildReminderText(
  record: BorrowRecord,
  tone: BorrowReminderTone = 'casual',
  now = new Date(),
) {
  const days = Math.max(0, daysBetween(record.lentAt, todayKey(now)));
  const subject = recordSubjectLabel(record);
  const name = record.counterparty.name;
  let sentence = '';
  let closing = '';

  if (record.kind === 'lend_out') {
    sentence = `你在 ${days} 天前借走了我的「${subject}」`;
    if (tone === 'short') closing = '方便时给我就好。';
    else if (tone === 'formal') closing = '方便的时候归还即可，不用着急。';
    else closing = '方便的话这周带给我吧。';
  } else if (record.kind === 'borrow_in') {
    sentence = `我从 ${name} 借来的「${subject}」已经 ${days} 天`;
    if (tone === 'short') closing = '我会尽快归还。';
    else if (tone === 'formal') closing = '我会尽快归还，并确认好归还时间。';
    else closing = '我这边会尽快归还。';
  } else {
    sentence = `谢谢你上次帮我垫付的 ${subject}`;
    if (tone === 'short') closing = '方便时转给你。';
    else if (tone === 'formal') closing = '方便时结清即可。';
    else closing = '方便时转给你就好。';
  }

  const dateLabel = record.kind === 'paid_for' ? '垫付时间' : kindLabel(record.kind) === '我借出' ? '借出时间' : '借入时间';
  const dueText = record.dueAt ? ` · 约定 ${formatDateKey(record.dueAt)}` : '';
  const statusText = recordStatus(record, now) === 'overdue' ? '已超过约定时间' : `已 ${days} 天`;
  const meta = `${dateLabel}：${formatDateKey(record.lentAt)} · ${statusText}${dueText}`;
  return `${sentence}，${closing}\n${meta}`;
}
