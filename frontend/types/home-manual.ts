export const HOME_MANUAL_SCHEMA_VERSION = 1;
export const HOME_MANUAL_MAX_DEVICES = 200;
export const HOME_MANUAL_MAX_NETWORKS = 20;
export const HOME_MANUAL_MAX_CONTACTS = 50;
export const HOME_MANUAL_MAX_REMINDERS = 200;
export const HOME_MANUAL_MAX_NAME_LENGTH = 30;
export const HOME_MANUAL_MAX_CONTACT_NAME_LENGTH = 20;
export const HOME_MANUAL_MAX_NOTE_LENGTH = 500;
export const HOME_MANUAL_MAX_MODEL_LENGTH = 80;
export const HOME_MANUAL_MAX_SSID_LENGTH = 64;
export const HOME_MANUAL_MAX_PHONE_LENGTH = 20;
export const HOME_MANUAL_MAX_WE_CHAT_LENGTH = 50;
export const HOME_MANUAL_MAX_ADDRESS_LENGTH = 100;
export const HOME_MANUAL_MAX_PHOTOS = 9;
export const HOME_MANUAL_REMINDER_TITLE_LENGTH = 40;

export type HomeDeviceCategory =
  | 'air-conditioner'
  | 'washing-machine'
  | 'water-purifier'
  | 'refrigerator'
  | 'water-heater'
  | 'tv'
  | 'kitchen'
  | 'security'
  | 'other';

export type HomeNetworkSecurity = 'WPA2' | 'WPA3' | 'WEP' | 'open';

export type HomeContactKind = 'property' | 'broadband' | 'landlord' | 'custom';

export type HomeReminderKind = 'warranty' | 'filter' | 'maintenance' | 'custom';

export type HomeManualSecurity = {
  enabled: boolean;
  updatedAt: number;
};

export type HomeDevice = {
  id: string;
  category: HomeDeviceCategory;
  name: string;
  brand: string;
  model: string;
  room: string;
  purchaseDate: string;
  warrantyEndDate: string;
  manualText: string;
  note: string;
  photoIds: string[];
  filterModel: string;
  filterQuantity: number;
  filterChangedAt: string;
  filterCycleDays: number;
  createdAt: number;
  updatedAt: number;
};

export type HomeNetwork = {
  id: string;
  name: string;
  ssid: string;
  securityType: HomeNetworkSecurity | '';
  wifiPassword: string;
  routerUrl: string;
  routerAccount: string;
  routerPassword: string;
  broadbandCarrier: string;
  broadbandAccount: string;
  broadbandPassword: string;
  note: string;
  createdAt: number;
  updatedAt: number;
};

export type HomeContact = {
  id: string;
  kind: HomeContactKind;
  name: string;
  phone: string;
  phoneAlt: string;
  wechat: string;
  address: string;
  serviceHours: string;
  serviceScope: string;
  note: string;
  createdAt: number;
  updatedAt: number;
};

export type HomeReminder = {
  id: string;
  kind: HomeReminderKind;
  title: string;
  targetDate: string;
  cycleDays: number;
  sourceDeviceId: string;
  note: string;
  status: 'pending' | 'done';
  doneAt: number;
  createdAt: number;
  updatedAt: number;
};

export type HomeManualState = {
  schemaVersion: number;
  security: HomeManualSecurity;
  devices: HomeDevice[];
  networks: HomeNetwork[];
  contacts: HomeContact[];
  reminders: HomeReminder[];
  updatedAt: number;
};

export type HomeManualUnlockResponse = {
  unlockToken: string;
  expiresInSeconds: number;
};

export function createEmptyHomeManualState(): HomeManualState {
  return {
    schemaVersion: HOME_MANUAL_SCHEMA_VERSION,
    security: { enabled: false, updatedAt: 0 },
    devices: [],
    networks: [],
    contacts: [],
    reminders: [],
    updatedAt: 0,
  };
}

export const HOME_DEVICE_CATEGORY_LABELS: Record<HomeDeviceCategory, string> = {
  'air-conditioner': '空调',
  'washing-machine': '洗衣机',
  'water-purifier': '净水器',
  refrigerator: '冰箱',
  'water-heater': '热水器',
  tv: '电视',
  kitchen: '厨房电器',
  security: '安防',
  other: '其他',
};

export const HOME_CONTACT_KIND_LABELS: Record<HomeContactKind, string> = {
  property: '物业',
  broadband: '宽带',
  landlord: '房东',
  custom: '自定义',
};

export const HOME_REMINDER_KIND_LABELS: Record<HomeReminderKind, string> = {
  warranty: '保修',
  filter: '滤芯',
  maintenance: '保养',
  custom: '自定义',
};
