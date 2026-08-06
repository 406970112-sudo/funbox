import { getAPIBaseUrl } from '@/lib/auth-api';
import type {
  PartyAgainVote,
  PartyAgainVoteInput,
  PartyCard,
  PartyCardDetail,
  PartyCardInput,
  PartyCardsResponse,
  PartyDish,
  PartyDishInput,
  PartyDishVote,
  PartyDishVoteInput,
  PartyNextPrep,
  PartyParticipant,
  PartyParticipantInput,
  PartyParticipantUpdateInput,
  PartyPhoto,
  PartySummary,
  PartyVenueNote,
  PartyVenueNoteInput,
} from '@/types/party-memory-card';

type ErrorPayload = { error?: string };

export class PartyMemoryCardAPIError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'PartyMemoryCardAPIError';
    this.code = code;
    this.status = status;
  }
}

export function fetchPartyMemoryCardSummary(token: string) {
  return requestJSON<PartySummary>('/api/v1/party-memory-card/summary', token);
}

export async function fetchPartyMemoryCards(
  token: string,
  params: {
    q?: string;
    hostType?: string;
    hasPhoto?: string;
    again?: string;
    sort?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.hostType) query.set('hostType', params.hostType);
  if (params.hasPhoto) query.set('hasPhoto', params.hasPhoto);
  if (params.again) query.set('again', params.again);
  if (params.sort) query.set('sort', params.sort);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const payload = await requestJSON<PartyCardsResponse>(
    `/api/v1/party-memory-card/cards${suffix}`,
    token,
  );
  return payload.cards;
}

export function fetchPartyMemoryCard(token: string, cardId: string) {
  return requestJSON<PartyCardDetail>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}`,
    token,
  );
}

export function createPartyMemoryCard(token: string, input: PartyCardInput) {
  return requestJSON<PartyCard>('/api/v1/party-memory-card/cards', token, {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function updatePartyMemoryCard(token: string, cardId: string, input: PartyCardInput) {
  return requestJSON<PartyCard>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deletePartyMemoryCard(token: string, cardId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function addPartyParticipant(
  token: string,
  cardId: string,
  input: PartyParticipantInput,
) {
  return requestJSON<PartyParticipant>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/participants`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function updatePartyParticipant(
  token: string,
  cardId: string,
  participantId: string,
  input: PartyParticipantUpdateInput,
) {
  return requestJSON<PartyParticipant>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/participants/${encodeURIComponent(participantId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function removePartyParticipant(token: string, cardId: string, participantId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/participants/${encodeURIComponent(participantId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function uploadPartyMemoryCardPhoto(
  token: string,
  cardId: string,
  file: { uri: string; name?: string; type?: string },
  options: { cover?: boolean; kind?: string; takenAt?: string } = {},
) {
  const form = new FormData();
  form.append('kind', options.kind ?? 'photo');
  if (options.takenAt) form.append('takenAt', options.takenAt);
  if (options.cover) form.append('cover', 'true');
  form.append(
    'file',
    {
      uri: file.uri,
      name: file.name ?? 'photo.jpg',
      type: file.type ?? 'image/jpeg',
    } as unknown as Blob,
  );
  return requestJSON<PartyPhoto>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/photos`,
    token,
    {
      body: form,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
    },
  );
}

export function deletePartyMemoryCardPhoto(token: string, cardId: string, photoId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/photos/${encodeURIComponent(photoId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function createPartyDish(token: string, cardId: string, input: PartyDishInput) {
  return requestJSON<PartyDish>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/dishes`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function updatePartyDish(
  token: string,
  cardId: string,
  dishId: string,
  input: PartyDishInput,
) {
  return requestJSON<PartyDish>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/dishes/${encodeURIComponent(dishId)}`,
    token,
    {
      body: JSON.stringify(input),
      method: 'PATCH',
    },
  );
}

export function deletePartyDish(token: string, cardId: string, dishId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/dishes/${encodeURIComponent(dishId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function votePartyDish(
  token: string,
  cardId: string,
  dishId: string,
  input: PartyDishVoteInput,
) {
  return requestJSON<PartyDishVote>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/dishes/${encodeURIComponent(dishId)}/vote`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function addPartyVenueNote(
  token: string,
  cardId: string,
  input: PartyVenueNoteInput,
) {
  return requestJSON<PartyVenueNote>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/venue-notes`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function deletePartyVenueNote(token: string, cardId: string, noteId: string) {
  return requestJSON<{ success: boolean }>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/venue-notes/${encodeURIComponent(noteId)}`,
    token,
    { method: 'DELETE' },
  );
}

export function addPartyAgainVote(
  token: string,
  cardId: string,
  input: PartyAgainVoteInput,
) {
  return requestJSON<PartyAgainVote>(
    `/api/v1/party-memory-card/cards/${encodeURIComponent(cardId)}/again-vote`,
    token,
    {
      body: JSON.stringify(input),
      method: 'POST',
    },
  );
}

export function fetchPartyNextPrep(token: string) {
  return requestJSON<PartyNextPrep>('/api/v1/party-memory-card/next-prep', token);
}

export async function downloadPartyMemoryCardExport(token: string, format: 'csv' | 'json') {
  const response = await fetch(
    `${getAPIBaseUrl()}/api/v1/party-memory-card/export?format=${format}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
  if (!response.ok) {
    throw new PartyMemoryCardAPIError(payload.error || 'request_failed', response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = format === 'csv' ? 'party-memory-card-export.csv' : 'party-memory-card-export.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function partyMemoryCardImageSource(token: string, imageUrl: string) {
  return {
    headers: { Authorization: `Bearer ${token}` },
    uri: partyMemoryCardMediaURL(imageUrl),
  };
}

export function partyMemoryCardMediaURL(imageUrl: string) {
  if (!imageUrl) return '';
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `${getAPIBaseUrl()}${imageUrl}`;
}

export function getPartyMemoryCardErrorMessage(error: unknown) {
  if (!(error instanceof PartyMemoryCardAPIError)) {
    return '聚会记忆卡服务暂时不可用，请稍后重试。';
  }
  const messages: Record<string, string> = {
    party_memory_card_invalid_input: '请检查必填信息是否完整，并确认至少有 2 位真实参与人。',
    party_memory_card_not_found: '记忆卡不存在或已被删除。',
    party_memory_card_forbidden: '你没有权限修改这张记忆卡。',
    party_memory_card_participant_limit: '参与人已达到上限。',
    unsupported_file_type: '图片仅支持 JPG、PNG、WebP 或 HEIC 格式。',
    file_too_large: '单张图片不能超过 5 MB。',
    missing_file: '请选择要上传的真实照片。',
    unauthorized: '登录状态已失效，请重新登录。',
    rate_limited: '请求过于频繁，请稍后再试。',
  };
  return messages[error.code] ?? '聚会记忆卡操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as Partial<T> & ErrorPayload;
  if (!response.ok) {
    throw new PartyMemoryCardAPIError(payload.error || 'request_failed', response.status);
  }
  return payload as T;
}
