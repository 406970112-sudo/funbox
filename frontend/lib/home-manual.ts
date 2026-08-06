import {
  createEmptyHomeManualState,
  HOME_MANUAL_MAX_ADDRESS_LENGTH,
  HOME_MANUAL_MAX_CONTACTS,
  HOME_MANUAL_MAX_CONTACT_NAME_LENGTH,
  HOME_MANUAL_MAX_DEVICES,
  HOME_MANUAL_MAX_MODEL_LENGTH,
  HOME_MANUAL_MAX_NAME_LENGTH,
  HOME_MANUAL_MAX_NETWORKS,
  HOME_MANUAL_MAX_NOTE_LENGTH,
  HOME_MANUAL_MAX_PHONE_LENGTH,
  HOME_MANUAL_MAX_REMINDERS,
  HOME_MANUAL_MAX_SSID_LENGTH,
  HOME_MANUAL_MAX_WE_CHAT_LENGTH,
} from '../types/home-manual.ts';
import type {
  HomeContact,
  HomeContactKind,
  HomeDevice,
  HomeDeviceCategory,
  HomeManualState,
  HomeNetwork,
  HomeReminder,
  HomeReminderKind,
} from '../types/home-manual.ts';

export function newHomeManualID(prefix: string) {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${randomPart}_${Date.now().toString(36)}`;
}

export function normalizeHomeManualState(value: HomeManualState): HomeManualState {
  return {
    ...createEmptyHomeManualState(),
    ...value,
    devices: Array.isArray(value.devices) ? value.devices : [],
    networks: Array.isArray(value.networks) ? value.networks : [],
    contacts: Array.isArray(value.contacts) ? value.contacts : [],
    reminders: Array.isArray(value.reminders) ? value.reminders : [],
  };
}

export function validateHomeManualName(value: string, max = HOME_MANUAL_MAX_NAME_LENGTH) {
  const name = value.trim();
  if (!name) return '名称不能为空';
  if (Array.from(name).length > max) return `名称不能超过 ${max} 个字符`;
  return null;
}

export function validateDateValue(value: string, label = '日期') {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label}格式应为 YYYY-MM-DD`;
  return null;
}

export function validateOptionalLength(value: string, max: number, label: string) {
  if (value && Array.from(value).length > max) return `${label}不能超过 ${max} 个字符`;
  return null;
}

export function validateDevice(
  device: Pick<HomeDevice, 'name' | 'brand' | 'model' | 'room' | 'manualText' | 'note'>,
) {
  const nameError = validateHomeManualName(device.name);
  if (nameError) return nameError;
  const checks = [
    validateOptionalLength(device.brand, HOME_MANUAL_MAX_NAME_LENGTH, '品牌'),
    validateOptionalLength(device.model, HOME_MANUAL_MAX_MODEL_LENGTH, '型号'),
    validateOptionalLength(device.room, HOME_MANUAL_MAX_NAME_LENGTH, '房间'),
    validateOptionalLength(device.manualText, 2000, '操作方法'),
    validateOptionalLength(device.note, HOME_MANUAL_MAX_NOTE_LENGTH, '备注'),
  ];
  return checks.find(Boolean) ?? null;
}

export function validateNetwork(
  network: Pick<
    HomeNetwork,
    'name' | 'ssid' | 'wifiPassword' | 'routerAccount' | 'routerPassword' | 'broadbandAccount' | 'broadbandPassword' | 'note'
  >,
) {
  const nameError = validateHomeManualName(network.name);
  if (nameError) return nameError;
  const checks = [
    validateOptionalLength(network.ssid, HOME_MANUAL_MAX_SSID_LENGTH, 'Wi-Fi 名称'),
    validateOptionalLength(network.wifiPassword, 128, 'Wi-Fi 密码'),
    validateOptionalLength(network.routerAccount, 100, '路由器账号'),
    validateOptionalLength(network.routerPassword, 128, '路由器密码'),
    validateOptionalLength(network.broadbandAccount, 100, '宽带账号'),
    validateOptionalLength(network.broadbandPassword, 128, '宽带密码'),
    validateOptionalLength(network.note, HOME_MANUAL_MAX_NOTE_LENGTH, '备注'),
  ];
  return checks.find(Boolean) ?? null;
}

export function validateContact(
  contact: Pick<
    HomeContact,
    'name' | 'phone' | 'phoneAlt' | 'wechat' | 'address' | 'serviceHours' | 'serviceScope' | 'note'
  >,
) {
  const nameError = validateHomeManualName(contact.name, HOME_MANUAL_MAX_CONTACT_NAME_LENGTH);
  if (nameError) return nameError;
  const checks = [
    validateOptionalLength(contact.phone, HOME_MANUAL_MAX_PHONE_LENGTH, '电话'),
    validateOptionalLength(contact.phoneAlt, HOME_MANUAL_MAX_PHONE_LENGTH, '备用电话'),
    validateOptionalLength(contact.wechat, HOME_MANUAL_MAX_WE_CHAT_LENGTH, '微信号'),
    validateOptionalLength(contact.address, HOME_MANUAL_MAX_ADDRESS_LENGTH, '地址'),
    validateOptionalLength(contact.serviceHours, 100, '服务时间'),
    validateOptionalLength(contact.serviceScope, 100, '服务范围'),
    validateOptionalLength(contact.note, HOME_MANUAL_MAX_NOTE_LENGTH, '备注'),
  ];
  return checks.find(Boolean) ?? null;
}

export function validateReminder(
  reminder: Pick<HomeReminder, 'title' | 'targetDate' | 'note'>,
) {
  const titleError = validateHomeManualName(reminder.title, 40);
  if (titleError) return titleError;
  const dateError = validateDateValue(reminder.targetDate, '提醒日期');
  if (dateError) return dateError;
  if (!reminder.targetDate) return '提醒日期不能为空';
  return validateOptionalLength(reminder.note, HOME_MANUAL_MAX_NOTE_LENGTH, '备注');
}

export function addHomeDevice(state: HomeManualState, draft: HomeDevice) {
  const error = validateDevice(draft);
  if (error) return { error, state };
  if (state.devices.length >= HOME_MANUAL_MAX_DEVICES) return { error: `最多保存 ${HOME_MANUAL_MAX_DEVICES} 台设备`, state };
  if (state.devices.some((item) => item.name.trim() === draft.name.trim() && item.category === draft.category)) {
    return { error: `${draft.name} 已存在`, state };
  }
  const now = Date.now();
  const item: HomeDevice = { ...draft, name: draft.name.trim(), updatedAt: now, createdAt: draft.createdAt || now };
  return { error: null, state: { ...state, devices: [...state.devices, item], updatedAt: now } };
}

export function updateHomeDevice(state: HomeManualState, device: HomeDevice) {
  const error = validateDevice(device);
  if (error) return { error, state };
  const now = Date.now();
  return {
    error: null,
    state: {
      ...state,
      devices: state.devices.map((item) => (item.id === device.id ? { ...device, updatedAt: now } : item)),
      updatedAt: now,
    },
  };
}

export function removeHomeDevice(state: HomeManualState, deviceId: string) {
  return {
    ...state,
    devices: state.devices.filter((item) => item.id !== deviceId),
    reminders: state.reminders.map((item) =>
      item.sourceDeviceId === deviceId ? { ...item, sourceDeviceId: '' } : item,
    ),
    updatedAt: Date.now(),
  };
}

export function addHomeNetwork(state: HomeManualState, draft: HomeNetwork) {
  const error = validateNetwork(draft);
  if (error) return { error, state };
  if (state.networks.length >= HOME_MANUAL_MAX_NETWORKS) return { error: `最多保存 ${HOME_MANUAL_MAX_NETWORKS} 条网络`, state };
  if (state.networks.some((item) => item.name.trim() === draft.name.trim())) {
    return { error: `${draft.name} 已存在`, state };
  }
  const now = Date.now();
  const item: HomeNetwork = { ...draft, name: draft.name.trim(), updatedAt: now, createdAt: draft.createdAt || now };
  return { error: null, state: { ...state, networks: [...state.networks, item], updatedAt: now } };
}

export function updateHomeNetwork(state: HomeManualState, network: HomeNetwork) {
  const error = validateNetwork(network);
  if (error) return { error, state };
  const now = Date.now();
  return {
    error: null,
    state: {
      ...state,
      networks: state.networks.map((item) => (item.id === network.id ? { ...network, updatedAt: now } : item)),
      updatedAt: now,
    },
  };
}

export function removeHomeNetwork(state: HomeManualState, networkId: string) {
  return {
    ...state,
    networks: state.networks.filter((item) => item.id !== networkId),
    updatedAt: Date.now(),
  };
}

export function addHomeContact(state: HomeManualState, draft: HomeContact) {
  const error = validateContact(draft);
  if (error) return { error, state };
  if (state.contacts.length >= HOME_MANUAL_MAX_CONTACTS) return { error: `最多保存 ${HOME_MANUAL_MAX_CONTACTS} 位联系人`, state };
  if (state.contacts.some((item) => item.name.trim() === draft.name.trim() && item.kind === draft.kind)) {
    return { error: `${draft.name} 已存在`, state };
  }
  const now = Date.now();
  const item: HomeContact = { ...draft, name: draft.name.trim(), updatedAt: now, createdAt: draft.createdAt || now };
  return { error: null, state: { ...state, contacts: [...state.contacts, item], updatedAt: now } };
}

export function updateHomeContact(state: HomeManualState, contact: HomeContact) {
  const error = validateContact(contact);
  if (error) return { error, state };
  const now = Date.now();
  return {
    error: null,
    state: {
      ...state,
      contacts: state.contacts.map((item) => (item.id === contact.id ? { ...contact, updatedAt: now } : item)),
      updatedAt: now,
    },
  };
}

export function removeHomeContact(state: HomeManualState, contactId: string) {
  return {
    ...state,
    contacts: state.contacts.filter((item) => item.id !== contactId),
    updatedAt: Date.now(),
  };
}

export function addHomeReminder(state: HomeManualState, draft: HomeReminder) {
  const error = validateReminder(draft);
  if (error) return { error, state };
  if (state.reminders.length >= HOME_MANUAL_MAX_REMINDERS) return { error: `最多保存 ${HOME_MANUAL_MAX_REMINDERS} 条提醒`, state };
  const now = Date.now();
  const item: HomeReminder = { ...draft, title: draft.title.trim(), updatedAt: now, createdAt: draft.createdAt || now };
  return { error: null, state: { ...state, reminders: [...state.reminders, item], updatedAt: now } };
}

export function updateHomeReminder(state: HomeManualState, reminder: HomeReminder) {
  const error = validateReminder(reminder);
  if (error) return { error, state };
  const now = Date.now();
  return {
    error: null,
    state: {
      ...state,
      reminders: state.reminders.map((item) => (item.id === reminder.id ? { ...reminder, updatedAt: now } : item)),
      updatedAt: now,
    },
  };
}

export function removeHomeReminder(state: HomeManualState, reminderId: string) {
  return {
    ...state,
    reminders: state.reminders.filter((item) => item.id !== reminderId),
    updatedAt: Date.now(),
  };
}

export function getFilterDueDate(device: HomeDevice) {
  if (!device.filterChangedAt || device.filterCycleDays <= 0) return null;
  const changed = new Date(`${device.filterChangedAt}T00:00:00`);
  if (Number.isNaN(changed.getTime())) return null;
  const due = new Date(changed.getTime() + device.filterCycleDays * 86400000);
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
    due.getDate(),
  ).padStart(2, '0')}`;
}

export function searchHomeManual(state: HomeManualState, query: string, unlocked: boolean) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { devices: state.devices, networks: state.networks, contacts: state.contacts };
  const devices = state.devices.filter((item) =>
    [item.name, item.category, item.brand, item.model, item.room, item.note].join(' ').toLowerCase().includes(needle),
  );
  const networks = state.networks.filter((item) => {
    const haystack = [item.name, item.ssid, item.routerUrl, item.broadbandCarrier, item.note].join(' ').toLowerCase();
    const secretHaystack = unlocked
      ? [item.wifiPassword, item.routerAccount, item.routerPassword, item.broadbandAccount, item.broadbandPassword]
          .join(' ')
          .toLowerCase()
      : '';
    return haystack.includes(needle) || secretHaystack.includes(needle);
  });
  const contacts = state.contacts.filter((item) => {
    const haystack = [item.name, item.kind, item.serviceHours, item.serviceScope, item.note].join(' ').toLowerCase();
    const secretHaystack = unlocked
      ? [item.phone, item.phoneAlt, item.wechat, item.address].join(' ').toLowerCase()
      : '';
    return haystack.includes(needle) || secretHaystack.includes(needle);
  });
  return { devices, networks, contacts };
}

export function hasSecretFields(state: HomeManualState) {
  return state.networks.some(
    (item) =>
      item.wifiPassword ||
      item.routerAccount ||
      item.routerPassword ||
      item.broadbandAccount ||
      item.broadbandPassword,
  ) ||
    state.contacts.some(
      (item) => item.phone || item.phoneAlt || item.wechat || item.address,
    );
}
