import {
  createEmptyParkingLocationState,
  createEmptyParkingSettings,
  PARKING_MAX_FEE_RULES,
  PARKING_MAX_LANDMARK_NOTE,
  PARKING_MAX_NOTE,
  PARKING_MAX_PARKING_LOT_NAME,
  PARKING_MAX_PHOTOS,
  PARKING_MAX_POSITION_LABEL,
  PARKING_MAX_RECORDS,
  PARKING_MAX_SEARCH_HISTORY,
  PARKING_MAX_SOURCE_NOTE,
} from '../types/parking-location.ts';
import type {
  ParkingFeeRule,
  ParkingFeeRuleInput,
  ParkingLocationState,
  ParkingPhoto,
  ParkingRecord,
  ParkingRecordInput,
  ParkingReminderMode,
  ParkingSettings,
} from '../types/parking-location.ts';

export function newParkingID(prefix: string) {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${randomPart}_${Date.now().toString(36)}`;
}

export function normalizeParkingLocationState(value: ParkingLocationState): ParkingLocationState {
  return {
    ...createEmptyParkingLocationState(),
    ...value,
    records: Array.isArray(value.records) ? value.records : [],
    feeRules: Array.isArray(value.feeRules) ? value.feeRules : [],
    searchHistory: Array.isArray(value.searchHistory) ? value.searchHistory : [],
    settings: {
      ...createEmptyParkingSettings(),
      ...(value.settings ?? {}),
    },
  };
}

export function parkingPositionLabel(record: ParkingRecord) {
  const parts = [record.floorLabel, record.zoneLabel, record.spotLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '未填写地下位置';
}

export function parkingLocationSummary(record: ParkingRecord) {
  const position = parkingPositionLabel(record);
  const landmark = record.landmarkNote ? ` · ${record.landmarkNote}` : '';
  return `${position}${landmark}`;
}

export function formatParkingTime(timestamp: number) {
  if (!timestamp) return '未填写';
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatParkingDuration(record: ParkingRecord, now = Date.now()) {
  const endAt = record.leaveAt ?? now;
  if (endAt < record.parkedAt) return '0 分钟';
  const minutes = Math.max(1, Math.floor((endAt - record.parkedAt) / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

export function feeRuleLabel(rule: ParkingFeeRule | undefined) {
  if (!rule) return '未设置收费规则';
  const parts: string[] = [];
  if (rule.freeMinutes) parts.push(`免费${rule.freeMinutes}分钟`);
  if (rule.firstRuleMinutes && rule.firstRuleAmountCents != null) {
    parts.push(`${rule.firstRuleMinutes / 60}小时${formatCents(rule.firstRuleAmountCents)}`);
  }
  if (rule.subsequentMinutes && rule.subsequentAmountCents != null) {
    parts.push(`之后${formatCents(rule.subsequentAmountCents)}/${rule.subsequentMinutes}分钟`);
  }
  if (rule.maxDayAmountCents != null) parts.push(`单日封顶${formatCents(rule.maxDayAmountCents)}`);
  return parts.length > 0 ? parts.join('，') : rule.parkingLotName;
}

export function formatCents(cents: number) {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function reminderLabel(record: ParkingRecord, rule?: ParkingFeeRule) {
  if (record.reminderMode === 'none') return '不提醒';
  if (record.reminderMode === 'rule_boundary') {
    return rule?.firstRuleMinutes ? `首段结束前15分钟提醒` : '规则节点提醒';
  }
  if (record.reminderMinutes > 0) return `${record.reminderMinutes}分钟后提醒`;
  return '不提醒';
}

export function calculateEstimatedFeeCents(
  state: ParkingLocationState,
  recordId: string,
  endAt = Date.now(),
): number | null {
  const record = state.records.find((item) => item.id === recordId);
  if (!record || !record.feeRuleId) return null;
  const rule = state.feeRules.find((item) => item.id === record.feeRuleId);
  if (!rule) return null;
  const durationMinutes = Math.max(0, Math.floor((endAt - record.parkedAt) / 60000));
  if (durationMinutes <= 0) return rule.firstRuleAmountCents ?? 0;
  let cents = 0;
  let remaining = durationMinutes;
  if (rule.freeMinutes) {
    remaining = Math.max(0, remaining - rule.freeMinutes);
  }
  if (rule.firstRuleMinutes && rule.firstRuleAmountCents != null) {
    if (remaining <= rule.firstRuleMinutes) return rule.firstRuleAmountCents;
    cents += rule.firstRuleAmountCents;
    remaining -= rule.firstRuleMinutes;
  }
  if (rule.subsequentMinutes && rule.subsequentAmountCents != null) {
    cents += Math.ceil(remaining / rule.subsequentMinutes) * rule.subsequentAmountCents;
  }
  if (rule.maxDayAmountCents != null) {
    cents = Math.min(cents, rule.maxDayAmountCents);
  }
  return cents;
}

export function validateParkingRecordInput(state: ParkingLocationState, input: ParkingRecordInput) {
  const name = input.parkingLotName.trim();
  if (!name) return '停车场名称不能为空';
  if (Array.from(name).length > PARKING_MAX_PARKING_LOT_NAME) {
    return `停车场名称不能超过 ${PARKING_MAX_PARKING_LOT_NAME} 个字符`;
  }
  if (!input.floorLabel?.trim() && !input.zoneLabel?.trim() && !input.spotLabel?.trim()) {
    return '楼层、区域或车位至少填写一项';
  }
  for (const label of [input.floorLabel, input.zoneLabel, input.spotLabel]) {
    if (label && Array.from(label.trim()).length > PARKING_MAX_POSITION_LABEL) {
      return '楼层、区域和车位不能超过 20 个字符';
    }
  }
  if (input.landmarkNote && Array.from(input.landmarkNote.trim()).length > PARKING_MAX_LANDMARK_NOTE) {
    return '附近标志物不能超过 40 个字符';
  }
  if (input.note && Array.from(input.note.trim()).length > PARKING_MAX_NOTE) {
    return '备注不能超过 300 个字符';
  }
  if (input.parkedAt <= 0) return '停车时间不能为空';
  if (input.parkedAt > Date.now() + 24 * 60 * 60 * 1000) {
    return '停车时间不能晚于当前时间 24 小时';
  }
  if (input.feeRuleId && !state.feeRules.some((rule) => rule.id === input.feeRuleId)) {
    return '请选择真实存在的收费规则';
  }
  return null;
}

export function addParkingRecord(
  state: ParkingLocationState,
  input: ParkingRecordInput,
): { error: string | null; record: ParkingRecord | null; state: ParkingLocationState } {
  const error = validateParkingRecordInput(state, input);
  if (error) return { error, record: null, state };
  if (state.records.length >= PARKING_MAX_RECORDS) {
    return { error: `最多只能保存 ${PARKING_MAX_RECORDS} 条停车记录`, record: null, state };
  }
  const now = Date.now();
  const record: ParkingRecord = {
    id: newParkingID('parking'),
    parkingLotName: input.parkingLotName.trim(),
    mapPoiId: input.mapPoiId?.trim() ?? '',
    mapPoiName: input.mapPoiName?.trim() ?? '',
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyM: input.accuracyM ?? null,
    floorLabel: input.floorLabel?.trim() ?? '',
    zoneLabel: input.zoneLabel?.trim() ?? '',
    spotLabel: input.spotLabel?.trim() ?? '',
    landmarkNote: input.landmarkNote?.trim() ?? '',
    note: input.note?.trim() ?? '',
    parkedAt: input.parkedAt,
    leaveAt: null,
    status: 'active',
    feeRuleId: input.feeRuleId?.trim() ?? '',
    reminderMinutes: Math.min(1440, Math.max(0, input.reminderMinutes ?? state.settings.defaultReminderMinutes)),
    reminderMode: input.reminderMode ?? 'fixed',
    estimatedFeeCents: null,
    actualFeeCents: null,
    photoCount: 0,
    coverPhotoUri: '',
    photos: [],
    createdAt: now,
    updatedAt: now,
  };
  record.estimatedFeeCents = calculateEstimatedFeeCents(
    { ...state, records: [...state.records, record] },
    record.id,
    now,
  );
  return {
    error: null,
    record,
    state: {
      ...state,
      records: [...state.records, record],
      updatedAt: now,
    },
  };
}

export function updateParkingRecord(
  state: ParkingLocationState,
  recordId: string,
  patch: Partial<ParkingRecordInput>,
): { error: string | null; state: ParkingLocationState } {
  const current = state.records.find((item) => item.id === recordId);
  if (!current) return { error: '停车记录不存在', state };
  const next: ParkingRecord = {
    ...current,
    parkingLotName: patch.parkingLotName?.trim() ?? current.parkingLotName,
    mapPoiId: patch.mapPoiId?.trim() ?? current.mapPoiId,
    mapPoiName: patch.mapPoiName?.trim() ?? current.mapPoiName,
    latitude: patch.latitude === undefined ? current.latitude : patch.latitude,
    longitude: patch.longitude === undefined ? current.longitude : patch.longitude,
    accuracyM: patch.accuracyM === undefined ? current.accuracyM : patch.accuracyM,
    floorLabel: patch.floorLabel?.trim() ?? current.floorLabel,
    zoneLabel: patch.zoneLabel?.trim() ?? current.zoneLabel,
    spotLabel: patch.spotLabel?.trim() ?? current.spotLabel,
    landmarkNote: patch.landmarkNote?.trim() ?? current.landmarkNote,
    note: patch.note?.trim() ?? current.note,
    parkedAt: patch.parkedAt ?? current.parkedAt,
    feeRuleId: patch.feeRuleId?.trim() ?? current.feeRuleId,
    reminderMinutes: patch.reminderMinutes ?? current.reminderMinutes,
    reminderMode: patch.reminderMode ?? current.reminderMode,
    updatedAt: Date.now(),
  };
  const input: ParkingRecordInput = {
    parkingLotName: next.parkingLotName,
    floorLabel: next.floorLabel,
    zoneLabel: next.zoneLabel,
    spotLabel: next.spotLabel,
    landmarkNote: next.landmarkNote,
    note: next.note,
    parkedAt: next.parkedAt,
    feeRuleId: next.feeRuleId,
    reminderMinutes: next.reminderMinutes,
    reminderMode: next.reminderMode,
  };
  const error = validateParkingRecordInput(state, input);
  if (error) return { error, state };
  const records = state.records.map((item) => (item.id === recordId ? next : item));
  next.estimatedFeeCents = calculateEstimatedFeeCents({ ...state, records }, recordId, next.leaveAt ?? Date.now());
  return {
    error: null,
    state: {
      ...state,
      records,
      updatedAt: Date.now(),
    },
  };
}

export function deleteParkingRecord(state: ParkingLocationState, recordId: string) {
  return {
    state: {
      ...state,
      records: state.records.filter((item) => item.id !== recordId),
      updatedAt: Date.now(),
    },
  };
}

export function leaveParkingRecord(
  state: ParkingLocationState,
  recordId: string,
  leaveAt = Date.now(),
  actualFeeCents: number | null = null,
): { error: string | null; state: ParkingLocationState } {
  const current = state.records.find((item) => item.id === recordId);
  if (!current) return { error: '停车记录不存在', state };
  if (leaveAt < current.parkedAt) return { error: '取车时间不能早于停车时间', state };
  if (actualFeeCents != null && actualFeeCents < 0) return { error: '实际缴费不能为负数', state };
  const updated: ParkingRecord = {
    ...current,
    leaveAt,
    actualFeeCents,
    status: 'left',
    updatedAt: Date.now(),
  };
  updated.estimatedFeeCents = calculateEstimatedFeeCents(state, recordId, leaveAt);
  return {
    error: null,
    state: {
      ...state,
      records: state.records.map((item) => (item.id === recordId ? updated : item)),
      updatedAt: Date.now(),
    },
  };
}

export function addParkingPhoto(
  state: ParkingLocationState,
  recordId: string,
  photo: Pick<ParkingPhoto, 'uri' | 'takenAt'>,
): { error: string | null; state: ParkingLocationState } {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return { error: '停车记录不存在', state };
  if (record.photos.length >= PARKING_MAX_PHOTOS) {
    return { error: `每条记录最多 ${PARKING_MAX_PHOTOS} 张照片`, state };
  }
  const now = Date.now();
  const nextPhoto: ParkingPhoto = {
    id: newParkingID('photo'),
    uri: photo.uri,
    takenAt: photo.takenAt || now,
    isCover: record.photos.length === 0,
    sortOrder: record.photos.length,
  };
  const photos = [...record.photos, nextPhoto];
  const updated: ParkingRecord = {
    ...record,
    photos,
    photoCount: photos.length,
    coverPhotoUri: photos.find((item) => item.isCover)?.uri ?? photos[0]?.uri ?? '',
    updatedAt: now,
  };
  return {
    error: null,
    state: {
      ...state,
      records: state.records.map((item) => (item.id === recordId ? updated : item)),
      updatedAt: now,
    },
  };
}

export function removeParkingPhoto(state: ParkingLocationState, recordId: string, photoId: string) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return { error: '停车记录不存在', state };
  const photos = record.photos.filter((item) => item.id !== photoId);
  const updated: ParkingRecord = {
    ...record,
    photos,
    photoCount: photos.length,
    coverPhotoUri: photos.find((item) => item.isCover)?.uri ?? photos[0]?.uri ?? '',
    updatedAt: Date.now(),
  };
  return {
    error: null,
    state: {
      ...state,
      records: state.records.map((item) => (item.id === recordId ? updated : item)),
      updatedAt: Date.now(),
    },
  };
}

export function validateParkingFeeRuleInput(input: ParkingFeeRuleInput) {
  const name = input.parkingLotName.trim();
  if (!name) return '收费规则需要关联停车场名称';
  if (Array.from(name).length > PARKING_MAX_PARKING_LOT_NAME) {
    return '停车场名称不能超过 40 个字符';
  }
  if (input.sourceNote && Array.from(input.sourceNote.trim()).length > PARKING_MAX_SOURCE_NOTE) {
    return '来源备注不能超过 100 个字符';
  }
  return null;
}

export function upsertParkingFeeRule(
  state: ParkingLocationState,
  input: ParkingFeeRuleInput,
  ruleId = '',
): { error: string | null; rule: ParkingFeeRule | null; state: ParkingLocationState } {
  const error = validateParkingFeeRuleInput(input);
  if (error) return { error, rule: null, state };
  if (!ruleId && state.feeRules.length >= PARKING_MAX_FEE_RULES) {
    return { error: `最多保存 ${PARKING_MAX_FEE_RULES} 条收费规则`, rule: null, state };
  }
  const now = Date.now();
  const rule: ParkingFeeRule = {
    id: ruleId || newParkingID('fee-rule'),
    parkingLotName: input.parkingLotName.trim(),
    freeMinutes: input.freeMinutes ?? null,
    firstRuleMinutes: input.firstRuleMinutes ?? null,
    firstRuleAmountCents: input.firstRuleAmountCents ?? null,
    subsequentMinutes: input.subsequentMinutes ?? null,
    subsequentAmountCents: input.subsequentAmountCents ?? null,
    maxDayAmountCents: input.maxDayAmountCents ?? null,
    sourceNote: input.sourceNote?.trim() ?? '',
    createdAt: ruleId ? state.feeRules.find((item) => item.id === ruleId)?.createdAt ?? now : now,
    updatedAt: now,
  };
  const rules = ruleId
    ? state.feeRules.map((item) => (item.id === ruleId ? rule : item))
    : [...state.feeRules, rule];
  return {
    error: null,
    rule,
    state: {
      ...state,
      feeRules: rules,
      updatedAt: now,
    },
  };
}

export function deleteParkingFeeRule(state: ParkingLocationState, ruleId: string) {
  return {
    state: {
      ...state,
      feeRules: state.feeRules.filter((item) => item.id !== ruleId),
      records: state.records.map((item) =>
        item.feeRuleId === ruleId ? { ...item, feeRuleId: '', estimatedFeeCents: null } : item,
      ),
      updatedAt: Date.now(),
    },
  };
}

export function updateParkingSettings(state: ParkingLocationState, patch: Partial<ParkingSettings>) {
  const settings: ParkingSettings = {
    ...state.settings,
    ...patch,
    updatedAt: Date.now(),
  };
  if (settings.defaultReminderMinutes < 1 || settings.defaultReminderMinutes > 1440) {
    settings.defaultReminderMinutes = 30;
  }
  return {
    state: {
      ...state,
      settings,
      updatedAt: Date.now(),
    },
  };
}

export function filterParkingRecords(
  state: ParkingLocationState,
  query = '',
  status: 'all' | ParkingRecord['status'] = 'all',
  sort: 'recent' | 'duration' = 'recent',
) {
  const q = query.trim().toLowerCase();
  const records = state.records.filter((record) => {
    const haystack = [
      record.parkingLotName,
      record.floorLabel,
      record.zoneLabel,
      record.spotLabel,
      record.landmarkNote,
      record.note,
      record.mapPoiName,
    ]
      .join(' ')
      .toLowerCase();
    const statusMatch = status === 'all' || record.status === status;
    return statusMatch && (!q || haystack.includes(q));
  });
  if (sort === 'duration') {
    return records.sort((a, b) => {
      const aDuration = (a.leaveAt ?? Date.now()) - a.parkedAt;
      const bDuration = (b.leaveAt ?? Date.now()) - b.parkedAt;
      return bDuration - aDuration;
    });
  }
  return records.sort((a, b) => b.parkedAt - a.parkedAt);
}

export function recordParkingSearchHistory(state: ParkingLocationState, query: string) {
  const q = query.trim();
  if (!q) return state;
  const next = [q, ...state.searchHistory.filter((item) => item !== q)].slice(
    0,
    PARKING_MAX_SEARCH_HISTORY,
  );
  return {
    ...state,
    searchHistory: next,
    updatedAt: Date.now(),
  };
}

export function clearParkingSearchHistory(state: ParkingLocationState) {
  return {
    ...state,
    searchHistory: [],
    updatedAt: Date.now(),
  };
}

export function parkingReminderModeOptions(): Array<{
  value: ParkingReminderMode;
  label: string;
}> {
  return [
    { value: 'fixed', label: '固定提醒' },
    { value: 'rule_boundary', label: '规则节点' },
    { value: 'none', label: '不提醒' },
  ];
}
