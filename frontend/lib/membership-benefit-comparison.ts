import type { MembershipFeatureMatrix } from '@/lib/access-api';

export const MEMBERSHIP_COMPARISON_COLLAPSED_LIMIT = 5;

const MEMBER_ROLES = ['normal', 'vip', 'svip'] as const;

export function getMembershipComparisonFeatures(features: MembershipFeatureMatrix[]) {
  return features.filter((feature) => {
    const access = MEMBER_ROLES.map((role) => feature.roles.includes(role));
    return new Set(access).size > 1;
  });
}

export function buildMembershipComparison(
  features: MembershipFeatureMatrix[],
  expanded: boolean,
) {
  const differences = getMembershipComparisonFeatures(features);
  const hiddenCount = Math.max(0, differences.length - MEMBERSHIP_COMPARISON_COLLAPSED_LIMIT);

  return {
    canExpand: hiddenCount > 0,
    differences,
    hiddenCount,
    total: differences.length,
    visible: expanded
      ? differences
      : differences.slice(0, MEMBERSHIP_COMPARISON_COLLAPSED_LIMIT),
  };
}
