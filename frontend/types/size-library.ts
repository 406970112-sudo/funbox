export const SIZE_LIBRARY_SCHEMA_VERSION = 1;
export const SIZE_LIBRARY_MAX_PERSON_PROFILES = 30;
export const SIZE_LIBRARY_MAX_ROOM_PROFILES = 30;
export const SIZE_LIBRARY_MAX_SPACE_ITEM_PROFILES = 60;
export const SIZE_LIBRARY_MAX_PROFILES = 120;
export const SIZE_LIBRARY_MAX_MEASUREMENTS = 400;
export const SIZE_LIBRARY_MAX_PERSON_NAME_LENGTH = 12;
export const SIZE_LIBRARY_MAX_SPACE_NAME_LENGTH = 20;
export const SIZE_LIBRARY_MAX_RELATION_LENGTH = 12;
export const SIZE_LIBRARY_MAX_NOTE_LENGTH = 60;
export const SIZE_LIBRARY_MAX_CUSTOM_MEASUREMENTS = 10;

export type SizeProfileKind = 'person' | 'room' | 'desk' | 'curtain';

export type SizeShoppingScenario =
  | 'clothes'
  | 'shoes'
  | 'ring'
  | 'desk'
  | 'curtain'
  | 'room';

export type SizeProfile = {
  id: string;
  kind: SizeProfileKind;
  name: string;
  relation: string;
  roomId: string | null;
  color: string;
  createdAt: number;
  updatedAt: number;
};

export type SizeMeasurement = {
  id: string;
  profileId: string;
  dimensionKey: string;
  label: string;
  value: string;
  unit: string;
  note: string;
  updatedAt: number;
};

export type SizeLibraryState = {
  schemaVersion: number;
  profiles: SizeProfile[];
  measurements: SizeMeasurement[];
  updatedAt: number;
};

export function createEmptySizeLibraryState(): SizeLibraryState {
  return {
    schemaVersion: SIZE_LIBRARY_SCHEMA_VERSION,
    profiles: [],
    measurements: [],
    updatedAt: 0,
  };
}
