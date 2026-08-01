export const HOME_COMMON_TOOL_LIMIT = 6;
export const FEATURED_TOOL_LIMIT = 4;

export const DEFAULT_COMMON_TOOL_IDS = [
  'free-reading',
  'card-score',
  'hot-news',
  'ai-navigation',
  'market-radar',
  'double-color-ball-hub',
] as const;

export const FEATURED_CANDIDATE_TOOL_IDS = [
  'text-to-speech',
  'image-compressor',
  'qr-code',
  'smart-translation',
] as const;

export function getFeaturedToolIds(
  eligibleToolIds: readonly string[],
  commonToolIds: readonly string[],
  candidateToolIds: readonly string[] = FEATURED_CANDIDATE_TOOL_IDS,
  limit = FEATURED_TOOL_LIMIT,
): string[] {
  if (limit <= 0) return [];

  const eligibleIds = Array.from(new Set(eligibleToolIds));
  const eligibleIdSet = new Set(eligibleIds);
  const commonIdSet = new Set(commonToolIds);
  const result: string[] = [];

  function append(toolId: string) {
    if (
      result.length >= limit ||
      !eligibleIdSet.has(toolId) ||
      commonIdSet.has(toolId) ||
      result.includes(toolId)
    ) {
      return;
    }
    result.push(toolId);
  }

  candidateToolIds.forEach(append);
  eligibleIds.forEach(append);

  return result;
}
