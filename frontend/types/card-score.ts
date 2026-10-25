export type ScoreRoomStatus = 'waiting' | 'active' | 'settled' | 'cancelled';
export type ScoreRoundStatus = 'collecting' | 'review' | 'confirmed' | 'cancelled';
export type ScoreRoundKind = 'normal' | 'reversal';
export type ScoreParticipantRole = 'host' | 'guest';
export type ScoreParticipantStatus = 'active' | 'removed' | 'left';
export type ScoreScene = 'generic' | 'zhajinhua';
export type ZhaJinHuaHandStatus = 'active' | 'finished' | 'cancelled';
export type ZhaJinHuaPlayerStatus = 'active' | 'folded';
export type ZhaJinHuaActionType = 'raise' | 'fold' | 'force_open';

export type ScoreParticipant = {
  id: string;
  userId?: string;
  displayName: string;
  role: ScoreParticipantRole;
  status: ScoreParticipantStatus;
  totalPoints: number;
  amountCents: number;
  joinedAt: string;
  lastSeenAt: string;
};

export type ScoreEntry = {
  participantId: string;
  deltaPoints: number;
  revision: number;
  submitted: boolean;
  confirmed: boolean;
  submittedAt?: string;
  updatedAt?: string;
};

export type ScoreRound = {
  id: string;
  roomId: string;
  number: number;
  kind: ScoreRoundKind;
  reversesRoundId?: string;
  status: ScoreRoundStatus;
  roster: string[];
  entries: ScoreEntry[];
  createdBy: string;
  createdAt: string;
  confirmedAt?: string;
  cancelledAt?: string;
  submittedCount: number;
  confirmedCount: number;
  totalDelta: number;
};

export type ScoreGiftItem = {
  fromParticipantId: string;
  toParticipantId: string;
  points: number;
};

export type ScoreGiftBatch = {
  id: string;
  roomId: string;
  number: number;
  kind: ScoreRoundKind;
  reversesBatchId?: string;
  createdBy: string;
  createdAt: string;
  gifts: ScoreGiftItem[];
};

export type ScoreTransfer = {
  fromParticipantId: string;
  toParticipantId: string;
  amountCents: number;
};

export type ScoreSettlementBalance = {
  participantId: string;
  totalPoints: number;
  amountCents: number;
};

export type ScoreSettlement = {
  balances: ScoreSettlementBalance[];
  transfers: ScoreTransfer[];
  createdAt: string;
};

export type ZhaJinHuaSettings = {
  forceOpenThreshold: number;
  forceOpenFeePoints: number;
};

export type ZhaJinHuaPlayer = {
  participantId: string;
  position: number;
  status: ZhaJinHuaPlayerStatus;
  contributionPoints: number;
  isWinner: boolean;
};

export type ZhaJinHuaAction = {
  sequence: number;
  actionType: ZhaJinHuaActionType;
  actorParticipantId: string;
  targetParticipantId?: string;
  winnerParticipantId?: string;
  points: number;
  createdAt: string;
};

export type ZhaJinHuaHand = {
  id: string;
  roomId: string;
  number: number;
  status: ZhaJinHuaHandStatus;
  potPoints: number;
  currentTurnParticipantId?: string;
  forceOpenThreshold: number;
  forceOpenFeePoints: number;
  winnerParticipantId?: string;
  createdBy: string;
  createdAt: string;
  finishedAt?: string;
  cancelledAt?: string;
  players: ZhaJinHuaPlayer[];
  actions: ZhaJinHuaAction[];
};

export type ScoreRoomSnapshot = {
  id: string;
  code: string;
  hostUserId: string;
  name: string;
  mode: 'generic';
  scene: ScoreScene;
  status: ScoreRoomStatus;
  maxPlayers: number;
  centsPerPoint: number;
  version: number;
  eventSequence: number;
  createdAt: string;
  startedAt?: string;
  settledAt?: string;
  cancelledAt?: string;
  expiresAt: string;
  participants: ScoreParticipant[];
  currentRound?: ScoreRound;
  rounds: ScoreRound[];
  giftBatches: ScoreGiftBatch[];
  zhaJinHuaSettings: ZhaJinHuaSettings;
  currentZhaJinHuaHand?: ZhaJinHuaHand;
  zhaJinHuaHands: ZhaJinHuaHand[];
  settlement?: ScoreSettlement;
  selfParticipantId?: string;
  inviteToken?: string;
};

export type ScoreActor = {
  participantId: string;
  userId?: string;
  roomId: string;
  role: ScoreParticipantRole;
};

export type ScoreCredential = {
  kind: 'account' | 'guest';
  token: string;
};

export type StoredScoreSession = {
  roomId: string;
  guestToken: string;
  participantId: string;
  savedAt: string;
};

export type CreateScoreRoomInput = {
  name: string;
  maxPlayers: number;
  centsPerPoint?: number;
  scene?: ScoreScene;
  forceOpenThreshold?: number;
  forceOpenFeePoints?: number;
};

export type UpdateZhaJinHuaSettingsInput = ZhaJinHuaSettings;

export type SubmitZhaJinHuaActionInput = {
  actionType: ZhaJinHuaActionType;
  points?: number;
  targetParticipantId?: string;
  winnerParticipantId?: string;
};

export type ScoreGiftAllocation = {
  toParticipantId: string;
  points: number;
};

export type CreateScoreRoomResult = {
  room: ScoreRoomSnapshot;
  actor: ScoreActor;
  inviteToken: string;
};

export type JoinScoreRoomInput = {
  code?: string;
  inviteToken?: string;
  displayName: string;
};

export type JoinScoreRoomResult = {
  room: ScoreRoomSnapshot;
  actor: ScoreActor;
  guestToken: string;
};

export type InvitePreviewResult = {
  room: ScoreRoomSnapshot;
  selfParticipantId?: string;
};

export type ScoreRealtimeStatus = 'connecting' | 'online' | 'offline';
