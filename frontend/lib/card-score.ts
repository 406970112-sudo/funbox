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
