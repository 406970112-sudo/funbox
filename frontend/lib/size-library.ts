import type {
  SizeLibraryState,
  SizeMeasurement,
  SizeProfile,
  SizeProfileKind,
  SizeShoppingScenario,
} from '../types/size-library.ts';
import {
  createEmptySizeLibraryState,
  SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS,
  SIZE_LIBRARY_MAX_MEASUREMENTS,
  SIZE_LIBRARY_MAX_NOTE_LENGTH,
  SIZE_LIBRARY_MAX_PERSON_NAME_LENGTH,
  SIZE_LIBRARY_MAX_PERSON_PROFILES,
  SIZE_LIBRARY_MAX_PROFILES,
  SIZE_LIBRARY_MAX_ROOM_PROFILES,
  SIZE_LIBRARY_MAX_SPACE_ITEM_PROFILES,
  SIZE_LIBRARY_MAX_SPACE_NAME_LENGTH,
  SIZE_LIBRARY_MAX_RELATION_LENGTH,
} from '../types/size-library.ts';

export type SizeDimensionMeta = {
  key: string;
  label: string;
  kind: SizeProfileKind;
  group: string;
  unit: string;
  numeric: boolean;
  scenarios: SizeShoppingScenario[];
  min?: number;
  max?: number;
};

export type ShoppingCheckRow = {
  dimensionKey: string;
  label: string;
  value: string;
  unit: string;
  note: string;
  filled: boolean;
};

const PROFILE_PALETTE = [
  '#4b6bff',
  '#18a78f',
  '#e8667a',
  '#e8a33d',
  '#8b5cf6',
  '#e85d4a',
  '#2a9d8f',
  '#5f7bd9',
  '#d9822b',
  '#20ad78',
] as const;

export const SIZE_DIMENSION_META: SizeDimensionMeta[] = [
  { key: 'height', label: '身高', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 30, max: 250 },
  { key: 'weight', label: '体重', kind: 'person', group: '身体尺寸', unit: 'kg', numeric: true, scenarios: ['clothes'], min: 2, max: 300 },
  { key: 'chest', label: '胸围', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 20, max: 200 },
  { key: 'waist', label: '腰围', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 20, max: 200 },
  { key: 'hip', label: '臀围', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 20, max: 200 },
  { key: 'shoulder', label: '肩宽', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 10, max: 120 },
  { key: 'sleeve', label: '臂长', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 10, max: 120 },
  { key: 'inseam', label: '裤内长', kind: 'person', group: '身体尺寸', unit: 'cm', numeric: true, scenarios: ['clothes'], min: 10, max: 160 },
  { key: 'clothingSize', label: '衣服尺码', kind: 'person', group: '衣物与鞋饰', unit: '', numeric: false, scenarios: ['clothes'] },
  { key: 'shoeSize', label: '鞋码', kind: 'person', group: '衣物与鞋饰', unit: '', numeric: false, scenarios: ['shoes'] },
  { key: 'footLength', label: '脚长', kind: 'person', group: '衣物与鞋饰', unit: 'cm', numeric: true, scenarios: ['shoes'], min: 5, max: 40 },
  { key: 'ringSize', label: '戒指圈号', kind: 'person', group: '衣物与鞋饰', unit: '', numeric: false, scenarios: ['ring'] },
  { key: 'ringDiameter', label: '戒指内径', kind: 'person', group: '衣物与鞋饰', unit: 'mm', numeric: true, scenarios: ['ring'], min: 8, max: 30 },
  { key: 'roomLength', label: '房间长', kind: 'room', group: '房间尺寸', unit: 'cm', numeric: true, scenarios: ['room'], min: 10, max: 10000 },
  { key: 'roomWidth', label: '房间宽', kind: 'room', group: '房间尺寸', unit: 'cm', numeric: true, scenarios: ['room'], min: 10, max: 10000 },
  { key: 'roomHeight', label: '房间高', kind: 'room', group: '房间尺寸', unit: 'cm', numeric: true, scenarios: ['room'], min: 10, max: 10000 },
  { key: 'deskLength', label: '桌面长', kind: 'desk', group: '书桌尺寸', unit: 'cm', numeric: true, scenarios: ['desk'], min: 10, max: 1000 },
  { key: 'deskWidth', label: '桌面宽', kind: 'desk', group: '书桌尺寸', unit: 'cm', numeric: true, scenarios: ['desk'], min: 10, max: 1000 },
  { key: 'deskHeight', label: '桌面高', kind: 'desk', group: '书桌尺寸', unit: 'cm', numeric: true, scenarios: ['desk'], min: 10, max: 1000 },
  { key: 'windowWidth', label: '窗户宽', kind: 'curtain', group: '窗帘尺寸', unit: 'cm', numeric: true, scenarios: ['curtain'], min: 10, max: 1000 },
  { key: 'windowHeight', label: '窗户高', kind: 'curtain', group: '窗帘尺寸', unit: 'cm', numeric: true, scenarios: ['curtain'], min: 10, max: 1000 },
  { key: 'curtainWidth', label: '窗帘宽', kind: 'curtain', group: '窗帘尺寸', unit: 'cm', numeric: true, scenarios: ['curtain'], min: 10, max: 1000 },
  { key: 'curtainHeight', label: '窗帘高', kind: 'curtain', group: '窗帘尺寸', unit: 'cm', numeric: true, scenarios: ['curtain'], min: 10, max: 1000 },
  { key: 'railLength', label: '轨道长', kind: 'curtain', group: '窗帘尺寸', unit: 'cm', numeric: true, scenarios: ['curtain'], min: 10, max: 1000 },
  { key: 'dropHeight', label: '落地高度', kind: 'curtain', group: '窗帘尺寸', unit: 'cm', numeric: true, scenarios: ['curtain'], min: 10, max: 1000 },
] as const;

export function newSizeLibraryID(prefix: string) {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${randomPart}_${Date.now().toString(36)}`;
}

export function normalizeSizeLibraryState(value: SizeLibraryState): SizeLibraryState {
  return {
    ...createEmptySizeLibraryState(),
    ...value,
    profiles: Array.isArray(value.profiles) ? value.profiles : [],
    measurements: Array.isArray(value.measurements) ? value.measurements : [],
  };
}

export function profileKindLabel(kind: SizeProfileKind) {
  const labels: Record<SizeProfileKind, string> = {
    person: '家人',
    room: '房间',
    desk: '书桌',
    curtain: '窗帘',
  };
  return labels[kind];
}

export function shoppingScenarioLabel(scenario: SizeShoppingScenario) {
  const labels: Record<SizeShoppingScenario, string> = {
    clothes: '买衣服',
    shoes: '买鞋',
    ring: '买戒指',
    desk: '买书桌',
    curtain: '买窗帘',
    room: '房间软装',
  };
  return labels[scenario];
}

export function profileCounts(state: SizeLibraryState) {
  const counts: Record<SizeProfileKind, number> = {
    person: 0,
    room: 0,
    desk: 0,
    curtain: 0,
  };
  for (const profile of state.profiles) {
    counts[profile.kind] += 1;
  }
  return counts;
}

export function canAddSizeProfile(
  state: SizeLibraryState,
  kind: SizeProfileKind,
): string | null {
  const counts = profileCounts(state);
  if (state.profiles.length >= SIZE_LIBRARY_MAX_PROFILES) {
    return `最多只能保存 ${SIZE_LIBRARY_MAX_PROFILES} 个档案`;
  }
  if (kind === 'person' && counts.person >= SIZE_LIBRARY_MAX_PERSON_PROFILES) {
    return `最多只能添加 ${SIZE_LIBRARY_MAX_PERSON_PROFILES} 位家人`;
  }
  if (kind === 'room' && counts.room >= SIZE_LIBRARY_MAX_ROOM_PROFILES) {
    return `最多只能添加 ${SIZE_LIBRARY_MAX_ROOM_PROFILES} 个房间`;
  }
  if (
    (kind === 'desk' || kind === 'curtain') &&
    counts.desk + counts.curtain >= SIZE_LIBRARY_MAX_SPACE_ITEM_PROFILES
  ) {
    return `书桌和窗帘合计最多 ${SIZE_LIBRARY_MAX_SPACE_ITEM_PROFILES} 个`;
  }
  return null;
}

export function validateProfileName(kind: SizeProfileKind, rawName: string) {
  const name = rawName.trim();
  if (!name) return `${profileKindLabel(kind)}名称不能为空`;
  const maxLength =
    kind === 'person' ? SIZE_LIBRARY_MAX_PERSON_NAME_LENGTH : SIZE_LIBRARY_MAX_SPACE_NAME_LENGTH;
  if (Array.from(name).length > maxLength) {
    return `${profileKindLabel(kind)}名称不能超过 ${maxLength} 个字符`;
  }
  return null;
}

export function addSizeProfile(
  state: SizeLibraryState,
  kind: SizeProfileKind,
  rawName: string,
  relation = '',
  roomId: string | null = null,
): { error: string | null; profile: SizeProfile | null; state: SizeLibraryState } {
  const limitError = canAddSizeProfile(state, kind);
  if (limitError) return { error: limitError, profile: null, state };
  const nameError = validateProfileName(kind, rawName);
  if (nameError) return { error: nameError, profile: null, state };
  const name = rawName.trim();
  if (state.profiles.some((profile) => profile.kind === kind && profile.name === name)) {
    return { error: `${name} 已存在`, profile: null, state };
  }
  const relationError = validateRelation(relation);
  if (relationError) return { error: relationError, profile: null, state };
  if (roomId) {
    const room = state.profiles.find((profile) => profile.id === roomId);
    if (!room || room.kind !== 'room') {
      return { error: '请选择真实存在的房间', profile: null, state };
    }
  }
  const now = Date.now();
  const counts = profileCounts(state);
  const index = counts.person + counts.room + counts.desk + counts.curtain;
  const profile: SizeProfile = {
    id: newSizeLibraryID('profile'),
    kind,
    name,
    relation: relation.trim(),
    roomId: kind === 'desk' || kind === 'curtain' ? roomId : null,
    color: PROFILE_PALETTE[index % PROFILE_PALETTE.length],
    createdAt: now,
    updatedAt: now,
  };
  return {
    error: null,
    profile,
    state: {
      ...state,
      profiles: [...state.profiles, profile],
      updatedAt: now,
    },
  };
}

export function updateSizeProfile(
  state: SizeLibraryState,
  profileId: string,
  patch: Partial<Pick<SizeProfile, 'name' | 'relation' | 'roomId'>>,
): { error: string | null; state: SizeLibraryState } {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return { error: '档案不存在', state };
  const nextName = patch.name === undefined ? profile.name : patch.name.trim();
  if (patch.name !== undefined) {
    const nameError = validateProfileName(profile.kind, nextName);
    if (nameError) return { error: nameError, state };
    if (state.profiles.some((item) => item.id !== profileId && item.kind === profile.kind && item.name === nextName)) {
      return { error: `${nextName} 已存在`, state };
    }
  }
  const nextRelation = patch.relation === undefined ? profile.relation : patch.relation.trim();
  const relationError = validateRelation(nextRelation);
  if (relationError) return { error: relationError, state };
  const nextRoomId = patch.roomId === undefined ? profile.roomId : patch.roomId;
  if (nextRoomId) {
    const room = state.profiles.find((item) => item.id === nextRoomId);
    if (!room || room.kind !== 'room') {
      return { error: '请选择真实存在的房间', state };
    }
  }
  return {
    error: null,
    state: {
      ...state,
      profiles: state.profiles.map((item) =>
        item.id === profileId
          ? {
              ...item,
              name: nextName,
              relation: profile.kind === 'person' ? nextRelation : '',
              roomId: profile.kind === 'desk' || profile.kind === 'curtain' ? nextRoomId : null,
              updatedAt: Date.now(),
            }
          : item,
      ),
      updatedAt: Date.now(),
    },
  };
}

export function removeSizeProfile(state: SizeLibraryState, profileId: string): SizeLibraryState {
  const profile = state.profiles.find((item) => item.id === profileId);
  return {
    ...state,
    profiles: state.profiles
      .filter((item) => item.id !== profileId)
      .map((item) =>
        profile?.kind === 'room' && item.roomId === profileId
          ? { ...item, roomId: null, updatedAt: Date.now() }
          : item,
      ),
    measurements: state.measurements.filter((item) => item.profileId !== profileId),
    updatedAt: Date.now(),
  };
}

export function clearSizeLibraryState(): SizeLibraryState {
  return createEmptySizeLibraryState();
}

export function validateRelation(relation: string) {
  const value = relation.trim();
  if (Array.from(value).length > SIZE_LIBRARY_MAX_RELATION_LENGTH) {
    return `关系不能超过 ${SIZE_LIBRARY_MAX_RELATION_LENGTH} 个字符`;
  }
  return null;
}

export function validateMeasurement(
  state: SizeLibraryState,
  profileId: string,
  dimensionKey: string,
  label: string,
  rawValue: string,
  unit: string,
  note: string,
): string | null {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return '档案不存在';
  const value = rawValue.trim();
  if (!value) return `${label || '尺寸'}不能为空`;
  const meta = SIZE_DIMENSION_META.find(
    (item) => item.key === dimensionKey && item.kind === profile.kind,
  );
  if (!meta && !dimensionKey.startsWith('custom_')) {
    return '不支持的尺寸类型';
  }
  const labelText = label.trim();
  if (!labelText || Array.from(labelText).length > 20) {
    return '尺寸名称需为 1-20 个字符';
  }
  if (unit && !['cm', 'm', 'mm', 'kg'].includes(unit)) {
    return '单位只支持 cm、m、mm 或 kg';
  }
  if (Array.from(note.trim()).length > SIZE_LIBRARY_MAX_NOTE_LENGTH) {
    return `备注不能超过 ${SIZE_LIBRARY_MAX_NOTE_LENGTH} 个字符`;
  }
  if (meta?.numeric) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return `${labelText}必须是数字`;
    }
    if (meta.min !== undefined && numericValue < meta.min) {
      return `${labelText}不能小于 ${meta.min}`;
    }
    if (meta.max !== undefined && numericValue > meta.max) {
      return `${labelText}不能大于 ${meta.max}`;
    }
  } else if (Array.from(value).length > 40) {
    return `${labelText}不能超过 40 个字符`;
  }
  if (dimensionKey.startsWith('custom_')) {
    const customCount = state.measurements.filter(
      (item) =>
        item.profileId === profileId &&
        item.dimensionKey.startsWith('custom_') &&
        item.dimensionKey !== dimensionKey,
    ).length;
    if (customCount >= SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS) {
      return `每个档案最多 ${SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS} 条其他尺寸`;
    }
  }
  return null;
}

export function upsertSizeMeasurement(
  state: SizeLibraryState,
  profileId: string,
  dimensionKey: string,
  label: string,
  rawValue: string,
  unit: string,
  note: string,
): { error: string | null; state: SizeLibraryState } {
  const validationError = validateMeasurement(
    state,
    profileId,
    dimensionKey,
    label,
    rawValue,
    unit,
    note,
  );
  if (validationError) return { error: validationError, state };
  const value = rawValue.trim();
  const existing = state.measurements.find(
    (item) => item.profileId === profileId && item.dimensionKey === dimensionKey,
  );
  if (state.measurements.length >= SIZE_LIBRARY_MAX_MEASUREMENTS && !existing) {
    return { error: `最多保存 ${SIZE_LIBRARY_MAX_MEASUREMENTS} 条尺寸`, state };
  }
  const now = Date.now();
  const nextMeasurement: SizeMeasurement = {
    id: existing?.id ?? newSizeLibraryID('measurement'),
    profileId,
    dimensionKey,
    label: label.trim(),
    value,
    unit: unit.trim(),
    note: note.trim(),
    updatedAt: now,
  };
  const measurements = existing
    ? state.measurements.map((item) =>
        item.profileId === profileId && item.dimensionKey === dimensionKey
          ? nextMeasurement
          : item,
      )
    : [...state.measurements, nextMeasurement];
  return {
    error: null,
    state: {
      ...state,
      measurements,
      updatedAt: now,
    },
  };
}

export function removeSizeMeasurement(
  state: SizeLibraryState,
  profileId: string,
  dimensionKey: string,
): SizeLibraryState {
  return {
    ...state,
    measurements: state.measurements.filter(
      (item) => !(item.profileId === profileId && item.dimensionKey === dimensionKey),
    ),
    updatedAt: Date.now(),
  };
}

export function getMeasurementMap(
  state: SizeLibraryState,
  profileId: string,
): Record<string, SizeMeasurement> {
  const result: Record<string, SizeMeasurement> = {};
  for (const item of state.measurements) {
    if (item.profileId === profileId) {
      result[item.dimensionKey] = item;
    }
  }
  return result;
}

export function getProfileMeasurements(
  state: SizeLibraryState,
  profileId: string,
): SizeMeasurement[] {
  const map = getMeasurementMap(state, profileId);
  const ordered = SIZE_DIMENSION_META.filter((meta) => meta.kind === profileKindById(state, profileId))
    .map((meta) => map[meta.key])
    .filter((item): item is SizeMeasurement => Boolean(item));
  const custom = state.measurements
    .filter((item) => item.profileId === profileId && item.dimensionKey.startsWith('custom_'))
    .sort((left, right) => left.updatedAt - right.updatedAt);
  return [...ordered, ...custom];
}

function profileKindById(state: SizeLibraryState, profileId: string): SizeProfileKind | null {
  return state.profiles.find((profile) => profile.id === profileId)?.kind ?? null;
}

export function scenarioProfileKind(scenario: SizeShoppingScenario): SizeProfileKind | null {
  const kinds: Record<SizeShoppingScenario, SizeProfileKind> = {
    clothes: 'person',
    shoes: 'person',
    ring: 'person',
    desk: 'desk',
    curtain: 'curtain',
    room: 'room',
  };
  return kinds[scenario];
}

export function buildShoppingCheck(
  state: SizeLibraryState,
  scenario: SizeShoppingScenario,
  profileId: string,
): { error: string | null; rows: ShoppingCheckRow[]; profile: SizeProfile | null } {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return { error: '档案不存在', rows: [], profile: null };
  const expectedKind = scenarioProfileKind(scenario);
  if (!expectedKind || profile.kind !== expectedKind) {
    return { error: '当前场景与档案类型不匹配', rows: [], profile };
  }
  const map = getMeasurementMap(state, profileId);
  const rows = SIZE_DIMENSION_META.filter(
    (meta) => meta.kind === expectedKind && meta.scenarios.includes(scenario),
  ).map((meta) => {
    const measurement = map[meta.key];
    return {
      dimensionKey: meta.key,
      label: meta.label,
      value: measurement?.value ?? '',
      unit: measurement?.unit ?? meta.unit,
      note: measurement?.note ?? '',
      filled: Boolean(measurement),
    };
  });
  return { error: null, rows, profile };
}

export function buildCopyText(
  state: SizeLibraryState,
  scenario: SizeShoppingScenario,
  profileId: string,
) {
  const result = buildShoppingCheck(state, scenario, profileId);
  if (result.error || !result.profile) return '';
  const lines = [`${result.profile.name} · ${shoppingScenarioLabel(scenario)}`];
  for (const row of result.rows) {
    if (!row.filled) continue;
    lines.push(`${row.label} ${row.value}${row.unit}`);
    if (row.note) lines.push(`备注 ${row.note}`);
  }
  const latest = state.measurements
    .filter((item) => item.profileId === profileId)
    .reduce((max, item) => Math.max(max, item.updatedAt), result.profile.updatedAt);
  if (latest > 0) {
    const date = new Date(latest);
    const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`;
    lines.push(`最后更新 ${dateText}`);
  }
  return lines.join('\n');
}

export function roomArea(state: SizeLibraryState, roomId: string): number | null {
  const map = getMeasurementMap(state, roomId);
  const length = Number(map.roomLength?.value);
  const width = Number(map.roomWidth?.value);
  if (!Number.isFinite(length) || !Number.isFinite(width) || !map.roomLength || !map.roomWidth) {
    return null;
  }
  return length * width;
}

export function relatedProfiles(
  state: SizeLibraryState,
  roomId: string,
): SizeProfile[] {
  return state.profiles.filter(
    (profile) =>
      profile.roomId === roomId && (profile.kind === 'desk' || profile.kind === 'curtain'),
  );
}
