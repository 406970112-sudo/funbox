export const WHO_DOES_IT_MIN_PARTICIPANTS = 2;
export const WHO_DOES_IT_MAX_PARTICIPANTS = 36;
export const WHO_DOES_IT_MAX_NAME_LENGTH = 12;
export const WHO_DOES_IT_MAX_TASK_LENGTH = 20;
export const WHO_DOES_IT_MAX_RECORDS = 1000;

export type WhoDoesItTaskMode = 'person-only' | 'custom' | 'recent';

export type WhoDoesItParticipant = {
  id: string;
  name: string;
  createdAt: number;
};

export type WhoDoesItSettings = {
  taskMode: WhoDoesItTaskMode;
  customTask: string;
  selectedRecentTaskId: string | null;
};

export type WhoDoesItRecord = {
  id: string;
  createdAt: number;
  participantNames: string[];
  winnerName: string;
  taskText: string;
  taskMode: WhoDoesItTaskMode;
  participantCount: number;
};

export type WhoDoesItState = {
  participants: WhoDoesItParticipant[];
  settings: WhoDoesItSettings;
  records: WhoDoesItRecord[];
  updatedAt: number;
};

export type WhoDoesItRecentTask = {
  id: string;
  text: string;
  lastUsedAt: number;
};

export type WhoDoesItWheelSector = {
  id: string;
  name: string;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  color: string;
};

export type WhoDoesItSpinResult = {
  record: WhoDoesItRecord;
  winner: WhoDoesItParticipant;
  targetRotation: number;
};

export function createEmptyWhoDoesItState(): WhoDoesItState {
  return {
    participants: [],
    settings: {
      taskMode: 'person-only',
      customTask: '',
      selectedRecentTaskId: null,
    },
    records: [],
    updatedAt: 0,
  };
}
