export const PARKING_LOCATION_SCHEMA_VERSION = 1;
export const PARKING_MAX_RECORDS = 200;
export const PARKING_MAX_FEE_RULES = 50;
export const PARKING_MAX_PHOTOS = 6;
export const PARKING_MAX_SEARCH_HISTORY = 10;
export const PARKING_MAX_PARKING_LOT_NAME = 40;
export const PARKING_MAX_POSITION_LABEL = 20;
export const PARKING_MAX_LANDMARK_NOTE = 40;
export const PARKING_MAX_NOTE = 300;
export const PARKING_MAX_SOURCE_NOTE = 100;

export type ParkingReminderMode = 'none' | 'fixed' | 'rule_boundary';
export type ParkingRecordStatus = 'active' | 'left';

export type ParkingPhoto = {
  id: string;
  uri: string;
  takenAt: number;
  isCover: boolean;
  sortOrder: number;
};

export type ParkingRecord = {
  id: string;
  parkingLotName: string;
  mapPoiId: string;
  mapPoiName: string;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  floorLabel: string;
  zoneLabel: string;
  spotLabel: string;
  landmarkNote: string;
  note: string;
  parkedAt: number;
  leaveAt: number | null;
  status: ParkingRecordStatus;
  feeRuleId: string;
  reminderMinutes: number;
  reminderMode: ParkingReminderMode;
  estimatedFeeCents: number | null;
  actualFeeCents: number | null;
  photoCount: number;
  coverPhotoUri: string;
  photos: ParkingPhoto[];
  createdAt: number;
  updatedAt: number;
};

export type ParkingFeeRule = {
  id: string;
  parkingLotName: string;
  freeMinutes: number | null;
  firstRuleMinutes: number | null;
  firstRuleAmountCents: number | null;
  subsequentMinutes: number | null;
  subsequentAmountCents: number | null;
  maxDayAmountCents: number | null;
  sourceNote: string;
  createdAt: number;
  updatedAt: number;
};

export type ParkingSettings = {
  defaultReminderMinutes: number;
  ruleBoundaryEnabled: boolean;
  cancelOnLeave: boolean;
  updatedAt: number;
};

export type ParkingLocationState = {
  schemaVersion: number;
  records: ParkingRecord[];
  feeRules: ParkingFeeRule[];
  settings: ParkingSettings;
  searchHistory: string[];
  updatedAt: number;
};

export type ParkingRecordInput = {
  parkingLotName: string;
  mapPoiId?: string;
  mapPoiName?: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
  floorLabel?: string;
  zoneLabel?: string;
  spotLabel?: string;
  landmarkNote?: string;
  note?: string;
  parkedAt: number;
  feeRuleId?: string;
  reminderMinutes?: number;
  reminderMode?: ParkingReminderMode;
};

export type ParkingFeeRuleInput = {
  parkingLotName: string;
  freeMinutes?: number | null;
  firstRuleMinutes?: number | null;
  firstRuleAmountCents?: number | null;
  subsequentMinutes?: number | null;
  subsequentAmountCents?: number | null;
  maxDayAmountCents?: number | null;
  sourceNote?: string;
};

export function createEmptyParkingSettings(): ParkingSettings {
  return {
    defaultReminderMinutes: 30,
    ruleBoundaryEnabled: true,
    cancelOnLeave: true,
    updatedAt: 0,
  };
}

export function createEmptyParkingLocationState(): ParkingLocationState {
  return {
    schemaVersion: PARKING_LOCATION_SCHEMA_VERSION,
    records: [],
    feeRules: [],
    settings: createEmptyParkingSettings(),
    searchHistory: [],
    updatedAt: 0,
  };
}
