import type {
  WhoDoesItParticipant,
  WhoDoesItRecentTask,
  WhoDoesItRecord,
  WhoDoesItSettings,
  WhoDoesItSpinResult,
  WhoDoesItState,
  WhoDoesItWheelSector,
  WhoDoesItTaskMode,
} from '../types/who-does-it.ts';
import {
  WHO_DOES_IT_MAX_NAME_LENGTH,
  WHO_DOES_IT_MAX_PARTICIPANTS,
  WHO_DOES_IT_MAX_RECORDS,
  WHO_DOES_IT_MAX_TASK_LENGTH,
  WHO_DOES_IT_MIN_PARTICIPANTS,
} from '../types/who-does-it.ts';

const WHEEL_PALETTE = [
  '#4b6bff',
  '#ff6b8f',
  '#1db991',
  '#f1a33b',
  '#8b5cf6',
  '#18a78f',
  '#e85d4a',
  '#5f7bd9',
  '#ff8a5b',
  '#2a9d8f',
  '#7e5bef',
  '#e0526f',
  '#3f8cff',
  '#d99a2b',
  '#20ad78',
  '#f26d7d',
  '#6a8cff',
  '#34b3a1',
  '#c46a42',
  '#8d7ae8',
  '#ef6b4a',
  '#58b8c4',
  '#c95f8b',
  '#5678e0',
  '#3fb67f',
  '#e2a63a',
  '#5b7bd5',
  '#c1575f',
  '#46a0a2',
  '#9a6ae0',
  '#d98457',
  '#6f8ecf',
  '#2c8f7b',
  '#e06f6f',
  '#8a6fb5',
  '#4f9ed8',
] as const;

export function newWhoDoesItID(prefix: string) {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${randomPart}_${Date.now().toString(36)}`;
}

export function parseParticipantNames(raw: string) {
  return raw
    .split(/[\n\r,，、;；\t ]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function addParticipants(
  state: WhoDoesItState,
  raw: string,
): { added: WhoDoesItParticipant[]; errors: string[]; state: WhoDoesItState } {
  const parsed = parseParticipantNames(raw);
  const existing = new Set(state.participants.map((participant) => participant.name));
  const added: WhoDoesItParticipant[] = [];
  const errors: string[] = [];

  for (const name of parsed) {
    if (state.participants.length + added.length >= WHO_DOES_IT_MAX_PARTICIPANTS) {
      errors.push(`最多只能添加 ${WHO_DOES_IT_MAX_PARTICIPANTS} 人`);
      break;
    }
    if (existing.has(name)) {
      errors.push(`${name} 已存在`);
      continue;
    }
    if (Array.from(name).length > WHO_DOES_IT_MAX_NAME_LENGTH) {
      errors.push(`${name} 超过 ${WHO_DOES_IT_MAX_NAME_LENGTH} 个字`);
      continue;
    }
    existing.add(name);
    added.push({
      id: newWhoDoesItID('person'),
      name,
      createdAt: Date.now(),
    });
  }

  if (added.length === 0 && errors.length === 0) {
    errors.push('请输入真实姓名，支持换行、逗号、顿号或空格分隔');
  }

  return {
    added,
    errors,
    state: {
      ...state,
      participants: [...state.participants, ...added],
      updatedAt: Date.now(),
    },
  };
}

export function updateParticipantName(
  state: WhoDoesItState,
  participantID: string,
  rawName: string,
): { error: string | null; state: WhoDoesItState } {
  const name = rawName.trim();
  if (!name) return { error: '姓名不能为空', state };
  if (Array.from(name).length > WHO_DOES_IT_MAX_NAME_LENGTH) {
    return { error: `姓名不能超过 ${WHO_DOES_IT_MAX_NAME_LENGTH} 个字`, state };
  }
  const duplicate = state.participants.some(
    (participant) => participant.id !== participantID && participant.name === name,
  );
  if (duplicate) return { error: `${name} 已存在`, state };
  return {
    error: null,
    state: {
      ...state,
      participants: state.participants.map((participant) =>
        participant.id === participantID ? { ...participant, name } : participant,
      ),
      updatedAt: Date.now(),
    },
  };
}

export function removeParticipant(state: WhoDoesItState, participantID: string): WhoDoesItState {
  return {
    ...state,
    participants: state.participants.filter((participant) => participant.id !== participantID),
    updatedAt: Date.now(),
  };
}

export function clearParticipants(state: WhoDoesItState): WhoDoesItState {
  return {
    ...state,
    participants: [],
    updatedAt: Date.now(),
  };
}

export function updateSettings(
  state: WhoDoesItState,
  patch: Partial<WhoDoesItSettings>,
): WhoDoesItState {
  return {
    ...state,
    settings: {
      ...state.settings,
      ...patch,
    },
    updatedAt: Date.now(),
  };
}

export function buildRecentTasks(
  records: readonly WhoDoesItRecord[],
  limit = 8,
): WhoDoesItRecentTask[] {
  const seen = new Set<string>();
  const result: WhoDoesItRecentTask[] = [];
  for (const record of [...records].sort((left, right) => right.createdAt - left.createdAt)) {
    const text = record.taskText.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push({ id: `recent_${record.id}`, text, lastUsedAt: record.createdAt });
    if (result.length >= limit) break;
  }
  return result;
}

export function resolveRecordTaskText(
  settings: WhoDoesItSettings,
  records: readonly WhoDoesItRecord[],
) {
  if (settings.taskMode === 'custom') return (settings.customTask ?? '').trim();
  if (settings.taskMode === 'recent' && settings.selectedRecentTaskId) {
    return buildRecentTasks(records).find((task) => task.id === settings.selectedRecentTaskId)?.text ?? '';
  }
  return '';
}

export function runSpin(state: WhoDoesItState, random: () => number): WhoDoesItSpinResult {
  if (state.participants.length < WHO_DOES_IT_MIN_PARTICIPANTS) {
    throw new Error(`至少需要 ${WHO_DOES_IT_MIN_PARTICIPANTS} 人才能抽签`);
  }
  const winnerIndex = Math.min(
    state.participants.length - 1,
    Math.max(0, Math.floor(random() * state.participants.length)),
  );
  const winner = state.participants[winnerIndex];
  const taskText = resolveRecordTaskText(state.settings, state.records);
  const record: WhoDoesItRecord = {
    id: newWhoDoesItID('record'),
    createdAt: Date.now(),
    participantNames: state.participants.map((participant) => participant.name),
    winnerName: winner.name,
    taskText,
    taskMode: state.settings.taskMode,
    participantCount: state.participants.length,
  };
  const targetRotation = resolveSpinTarget(state.participants.length, winnerIndex, random);
  return { record, winner, targetRotation };
}

export function appendRecord(state: WhoDoesItState, record: WhoDoesItRecord): WhoDoesItState {
  const records = [record, ...state.records].slice(0, WHO_DOES_IT_MAX_RECORDS);
  return { ...state, records, updatedAt: Date.now() };
}

export function removeRecord(state: WhoDoesItState, recordID: string): WhoDoesItState {
  return {
    ...state,
    records: state.records.filter((record) => record.id !== recordID),
    updatedAt: Date.now(),
  };
}

export function clearRecords(state: WhoDoesItState): WhoDoesItState {
  return { ...state, records: [], updatedAt: Date.now() };
}

export function resolveSpinTarget(
  participantCount: number,
  winnerIndex: number,
  random: () => number,
) {
  const offset = 360 - ((winnerIndex + 0.5) * 360) / participantCount;
  const fullTurns = 3 + random() * 2;
  return fullTurns * 360 + offset;
}

export function buildWheelSectors(
  participants: readonly WhoDoesItParticipant[],
): WhoDoesItWheelSector[] {
  const count = Math.max(1, participants.length);
  const sectorSize = 360 / count;
  return participants.map((participant, index) => {
    const startAngle = -90 + index * sectorSize;
    return {
      id: participant.id,
      name: participant.name,
      startAngle,
      endAngle: startAngle + sectorSize,
      midAngle: startAngle + sectorSize / 2,
      color: WHEEL_PALETTE[index % WHEEL_PALETTE.length],
    };
  });
}

export function taskModeLabel(mode: WhoDoesItTaskMode) {
  const labels: Record<WhoDoesItTaskMode, string> = {
    'person-only': '只抽人',
    custom: '自定义',
    recent: '常用',
  };
  return labels[mode];
}

export function formatRecordTime(createdAt: number) {
  const date = new Date(createdAt);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function dateKey(createdAt: number) {
  const date = new Date(createdAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function dayLabel(createdAt: number, now = Date.now()) {
  const today = dateKey(now);
  const yesterday = dateKey(now - 24 * 60 * 60 * 1000);
  const key = dateKey(createdAt);
  if (key === today) return '今天';
  if (key === yesterday) return '昨天';
  const date = new Date(createdAt);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function groupRecordsByDay(records: readonly WhoDoesItRecord[], now = Date.now()) {
  const groups: { key: string; label: string; records: WhoDoesItRecord[] }[] = [];
  for (const record of [...records].sort((left, right) => right.createdAt - left.createdAt)) {
    const key = dateKey(record.createdAt);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, label: dayLabel(record.createdAt, now), records: [] };
      groups.push(group);
    }
    group.records.push(record);
  }
  return groups;
}

export function recordStats(records: readonly WhoDoesItRecord[], now = Date.now()) {
  const today = dateKey(now);
  return {
    today: records.filter((record) => dateKey(record.createdAt) === today).length,
    total: records.length,
  };
}
