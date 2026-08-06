import type {
  PartyAgainVoteValue,
  PartyCard,
  PartyCardInput,
  PartyDish,
  PartyDishRating,
  PartyHostType,
  PartyVenueDimension,
} from '@/types/party-memory-card';

export function yuanToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.round(numeric * 100);
}

export function centsToYuan(cents?: number): string {
  if (cents == null) return '暂无账单';
  return (cents / 100).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

export function formatAmount(cents?: number): string {
  if (cents == null) return '暂无账单';
  return `¥${centsToYuan(cents)}`;
}

export function formatPartyDate(value?: string): string {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function hostLabel(card: Pick<PartyCard, 'hostType' | 'hostParticipantName'>): string {
  if (card.hostType === 'aa') return 'AA 分摊';
  if (card.hostType === 'other') return '其他垫付';
  return card.hostParticipantName || '暂未指定';
}

export function hostTypeLabel(type: PartyHostType): string {
  if (type === 'aa') return 'AA 分摊';
  if (type === 'other') return '其他垫付';
  return '成员请客';
}

export function venueDimensionLabel(dimension: PartyVenueDimension): string {
  const labels: Record<PartyVenueDimension, string> = {
    parking: '停车',
    taste: '口味',
    ambience: '环境',
    service: '服务',
    location: '位置',
    other: '其他',
  };
  return labels[dimension] ?? dimension;
}

export function dishRatingLabel(rating: PartyDishRating): string {
  const labels: Record<PartyDishRating, string> = {
    like: '好吃',
    ok: '一般',
    no: '不推荐',
  };
  return labels[rating] ?? rating;
}

export function againVoteLabel(vote: PartyAgainVoteValue): string {
  const labels: Record<PartyAgainVoteValue, string> = {
    want: '想去',
    neutral: '一般',
    not: '不想去',
  };
  return labels[vote] ?? vote;
}

export function activityActionLabel(action: string): string {
  const labels: Record<string, string> = {
    card_created: '创建记忆卡',
    card_updated: '更新记忆卡',
    participant_added: '添加参与人',
    participant_updated: '更新参与人',
    participant_removed: '移除参与人',
    photo_added: '上传照片',
    photo_removed: '删除照片',
    dish_added: '添加菜品',
    dish_removed: '删除菜品',
    dish_voted: '评价菜品',
    venue_note_added: '补充餐厅印象',
    venue_note_removed: '删除餐厅印象',
    again_voted: '投了下次意愿',
  };
  return labels[action] ?? action;
}

export function topDishes(dishes: PartyDish[], limit = 5): PartyDish[] {
  return [...dishes]
    .sort((left, right) => right.likeCount - left.likeCount || left.sortOrder - right.sortOrder)
    .slice(0, limit);
}

export function dishVoteSummary(dish: PartyDish): string {
  if (dish.likeCount > 0) return `${dish.likeCount} 人觉得好吃`;
  if (dish.okCount > 0) return `${dish.okCount} 人觉得一般`;
  if (dish.noCount > 0) return `${dish.noCount} 人不推荐`;
  return '暂无评价';
}

export function buildParticipantClientId(): string {
  return `participant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function participantInitial(name: string): string {
  return name.trim().slice(0, 1) || '?';
}

export function validateCardBasics(input: PartyCardInput): string | null {
  if (!input.venueName.trim()) return '请填写餐厅或地点名称。';
  if (!input.partyDate.trim()) return '请填写聚会日期。';
  const participants = input.participants.filter((participant) => participant.name.trim());
  if (participants.length < 2) return '至少需要 2 位真实参与人。';
  if (
    input.hostType === 'member' &&
    !participants.some((participant) => participant.clientId === input.hostParticipantId)
  ) {
    return '请选择本次谁请客。';
  }
  return null;
}

export function currentPartyDateValue(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
