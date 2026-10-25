type ScoreValue = {
  deltaPoints: number;
  submitted: boolean;
};

type RankableParticipant = {
  id: string;
  joinedAt: string;
  totalPoints: number;
};

type ProgressEntry = {
  confirmed: boolean;
  submitted: boolean;
};

export function formatScore(value: number) {
  const integer = Math.trunc(value);
  return integer > 0 ? `+${integer}` : String(integer);
}

export function formatCNY(amountCents: number) {
  const integer = Math.trunc(amountCents);
  const sign = integer < 0 ? '-' : '';
  const absolute = Math.abs(integer);
  return `${sign}¥${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function parseYuanToCents(value: string) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1_000_000) return null;
  return cents;
}

export function formatRateInput(amountCents: number) {
  const cents = Math.max(0, Math.trunc(amountCents));
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0+$/, '')}`;
}

export function buildScoreGiftAllocations(recipientIds: string[], drafts: Record<string, string>) {
  let totalPoints = 0;
  let invalid = false;
  let hasEnteredPoints = false;
  const allocations: { toParticipantId: string; points: number }[] = [];
  for (const recipientId of recipientIds) {
    const raw = String(drafts[recipientId] ?? '').trim();
    if (!raw) continue;
    hasEnteredPoints = true;
    if (!/^\d+$/.test(raw)) {
      invalid = true;
      continue;
    }
    const points = Number(raw);
    if (!Number.isSafeInteger(points) || points <= 0 || points > 2_147_483_647 || totalPoints > 2_147_483_647 - points) {
      invalid = true;
      continue;
    }
    totalPoints += points;
    allocations.push({ toParticipantId: recipientId, points });
  }
  return { allocations, hasEnteredPoints, invalid, totalPoints };
}

export function scoreDifference(entries: ScoreValue[]) {
  let total = 0;
  for (const entry of entries) {
    if (entry.submitted) total += Math.trunc(entry.deltaPoints);
  }
  return -total;
}

export function sortedParticipants<T extends RankableParticipant>(participants: T[]) {
  return [...participants].sort((left, right) => {
    if (left.totalPoints !== right.totalPoints) return right.totalPoints - left.totalPoints;
    const joined = left.joinedAt.localeCompare(right.joinedAt);
    return joined === 0 ? left.id.localeCompare(right.id) : joined;
  });
}

export function roundProgress(entries: ProgressEntry[]) {
  let submitted = 0;
  let confirmed = 0;
  for (const entry of entries) {
    if (entry.submitted) submitted += 1;
    if (entry.confirmed) confirmed += 1;
  }
  return { confirmed, submitted, total: entries.length };
}

export function extractScoreInviteToken(value: string) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const queryMatch = text.match(/[?&]invite=([^&#]+)/i);
  if (queryMatch) {
    try {
      return decodeURIComponent(queryMatch[1]);
    } catch {
      return queryMatch[1];
    }
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) return text;
  return null;
}
