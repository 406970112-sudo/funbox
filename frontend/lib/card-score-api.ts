import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  CreateScoreRoomInput,
  CreateScoreRoomResult,
  InvitePreviewResult,
  JoinScoreRoomInput,
  JoinScoreRoomResult,
  ScoreCredential,
  ScoreRealtimeStatus,
  ScoreRoomSnapshot,
} from '@/types/card-score';

type ErrorPayload = {
  error?: string;
  room?: ScoreRoomSnapshot;
};

type RoomResponse = { room: ScoreRoomSnapshot };
type HistoryResponse = { rooms: ScoreRoomSnapshot[] };
type RealtimeTicketResponse = { ticket: string; expiresAt: string };

export class CardScoreAPIError extends Error {
  code: string;
  status: number;
  snapshot?: ScoreRoomSnapshot;

  constructor(code: string, status: number, snapshot?: ScoreRoomSnapshot) {
    super(code);
    this.name = 'CardScoreAPIError';
    this.code = code;
    this.status = status;
    this.snapshot = snapshot;
  }
}

export function createScoreRoom(token: string, input: CreateScoreRoomInput) {
  return requestJSON<CreateScoreRoomResult>('/api/v1/score-rooms', { kind: 'account', token }, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function joinScoreRoom(input: JoinScoreRoomInput) {
  return requestJSON<JoinScoreRoomResult>('/api/v1/score-rooms/join', undefined, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function previewScoreInvite(inviteToken: string, accountToken?: string) {
  return requestJSON<InvitePreviewResult>(
    '/api/v1/score-rooms/invite-preview',
    accountToken ? { kind: 'account', token: accountToken } : undefined,
    {
      body: JSON.stringify({ inviteToken }),
      method: 'POST',
    },
  );
}

export async function getScoreRoom(credential: ScoreCredential, roomId: string) {
  const response = await requestJSON<RoomResponse>(roomPath(roomId), credential);
  return response.room;
}

export async function listScoreRoomHistory(token: string) {
  const response = await requestJSON<HistoryResponse>('/api/v1/score-rooms/history', { kind: 'account', token });
  return response.rooms;
}

export function startScoreRoom(credential: ScoreCredential, room: ScoreRoomSnapshot) {
  return mutateRoom(credential, room, '/start');
}

export function cancelScoreRoom(credential: ScoreCredential, room: ScoreRoomSnapshot) {
  return mutateRoom(credential, room, '/cancel');
}

export async function startScoreRound(credential: ScoreCredential, room: ScoreRoomSnapshot, reversesRoundId?: string) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}/rounds`, credential, {
    body: JSON.stringify({ ...command(room), reversesRoundId }),
    method: 'POST',
  });
  return response.room;
}

export async function submitScoreEntry(credential: ScoreCredential, room: ScoreRoomSnapshot, roundId: string, deltaPoints: number) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}/rounds/${encodeURIComponent(roundId)}/entry`, credential, {
    body: JSON.stringify({ ...command(room), deltaPoints: Math.trunc(deltaPoints) }),
    method: 'PUT',
  });
  return response.room;
}

export async function confirmScoreRound(credential: ScoreCredential, room: ScoreRoomSnapshot, roundId: string) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}/rounds/${encodeURIComponent(roundId)}/confirm`, credential, {
    body: JSON.stringify(command(room)),
    method: 'POST',
  });
  return response.room;
}

export async function cancelScoreRound(credential: ScoreCredential, room: ScoreRoomSnapshot, roundId: string) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}/rounds/${encodeURIComponent(roundId)}/cancel`, credential, {
    body: JSON.stringify(command(room)),
    method: 'POST',
  });
  return response.room;
}

export async function removeScoreParticipant(credential: ScoreCredential, room: ScoreRoomSnapshot, participantId: string) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}/participants/${encodeURIComponent(participantId)}/remove`, credential, {
    body: JSON.stringify(command(room)),
    method: 'POST',
  });
  return response.room;
}

export async function settleScoreRoom(credential: ScoreCredential, room: ScoreRoomSnapshot) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}/settle`, credential, {
    body: JSON.stringify(command(room)),
    method: 'POST',
  });
  return response.room;
}

export async function issueScoreInviteToken(credential: ScoreCredential, roomId: string) {
  const response = await requestJSON<{ inviteToken: string }>(`${roomPath(roomId)}/invite-token`, credential, {
    body: '{}',
    method: 'POST',
  });
  return response.inviteToken;
}

export function connectScoreRealtime(
  credential: ScoreCredential,
  roomId: string,
  onInvalidate: (version: number, sequence: number) => void,
  onStatus: (status: ScoreRealtimeStatus) => void,
) {
  let disposed = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;

  const connect = async () => {
    if (disposed) return;
    onStatus('connecting');
    try {
      const ticket = await requestJSON<RealtimeTicketResponse>(`${roomPath(roomId)}/realtime-ticket`, credential, {
        body: '{}',
        method: 'POST',
      });
      if (disposed) return;
      const base = getAPIBaseUrl().replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
      socket = new WebSocket(`${base}/api/v1/realtime/ws?ticket=${encodeURIComponent(ticket.ticket)}`);
      socket.onopen = () => {
        retryCount = 0;
        onStatus('online');
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as {
            type?: string;
            data?: { roomId?: string; roomVersion?: number; sequence?: number };
          };
          if (event.type === 'score.room.updated' && event.data?.roomId === roomId) {
            onInvalidate(event.data.roomVersion ?? 0, event.data.sequence ?? 0);
          }
        } catch {
          // A malformed event is ignored; the REST snapshot remains authoritative.
        }
      };
      socket.onerror = () => onStatus('offline');
      socket.onclose = () => {
        socket = null;
        if (disposed) return;
        onStatus('offline');
        const delay = Math.min(1000 * 2 ** retryCount, 15_000);
        retryCount += 1;
        retryTimer = setTimeout(() => void connect(), delay);
      };
    } catch {
      if (disposed) return;
      onStatus('offline');
      const delay = Math.min(1000 * 2 ** retryCount, 15_000);
      retryCount += 1;
      retryTimer = setTimeout(() => void connect(), delay);
    }
  };

  void connect();
  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    socket?.close();
  };
}

export function getCardScoreErrorMessage(error: unknown) {
  if (!(error instanceof CardScoreAPIError)) return '暂时无法连接记分服务，请稍后重试。';
  const messages: Record<string, string> = {
    score_action_forbidden: '当前身份不能执行这个操作。',
    score_action_id_reused: '操作标识已失效，请刷新后重试。',
    score_balances_not_zero: '所有玩家的本局分数合计必须为 0。',
    score_invite_invalid: '二维码不是有效的牌局邀请码，请让房主重新展示。',
    score_invalid_input: '请检查房间设置或分数输入。',
    score_invalid_state: '房间状态已经变化，请刷新后重试。',
    score_nickname_conflict: '这个昵称已被房间内其他玩家使用。',
    score_not_found: '房间或牌局不存在。',
    score_room_full: '房间人数已满。',
    score_version_conflict: '房间已有新操作，已为你刷新。',
    unauthorized: '身份已失效，请重新加入房间。',
  };
  return messages[error.code] ?? '记分操作失败，请稍后重试。';
}

async function mutateRoom(credential: ScoreCredential, room: ScoreRoomSnapshot, suffix: string) {
  const response = await requestJSON<RoomResponse>(`${roomPath(room.id)}${suffix}`, credential, {
    body: JSON.stringify(command(room)),
    method: 'POST',
  });
  return response.room;
}

function command(room: ScoreRoomSnapshot) {
  return { clientActionId: createClientActionId(), expectedRoomVersion: room.version };
}

function createClientActionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function roomPath(roomId: string) {
  return `/api/v1/score-rooms/${encodeURIComponent(roomId)}`;
}

async function requestJSON<T>(path: string, credential?: ScoreCredential, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (credential) headers.set('Authorization', `Bearer ${credential.token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) throw new CardScoreAPIError(payload.error ?? 'request_failed', response.status, payload.room);
  return payload;
}
