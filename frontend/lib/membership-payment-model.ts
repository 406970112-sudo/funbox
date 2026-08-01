import type { MembershipPlan, MembershipTier } from '@/types/membership';

export const DEFAULT_MEMBERSHIP_PLANS: MembershipPlan[] = [
  { period: 'month', priceCents: 200, tier: 'vip' },
  { period: 'month', priceCents: 500, tier: 'svip' },
];

export function membershipPlanName(tier: MembershipTier) {
  return tier === 'svip' ? 'SVIP 月卡' : 'VIP 月卡';
}

export function formatPriceCents(priceCents: number) {
  return (priceCents / 100).toFixed(2);
}

export function membershipPlanForTier(
  tier: MembershipTier,
  plans: MembershipPlan[],
): MembershipPlan {
  return (
    plans.find((plan) => plan.tier === tier) ??
    DEFAULT_MEMBERSHIP_PLANS.find((plan) => plan.tier === tier) ??
    DEFAULT_MEMBERSHIP_PLANS[1]
  );
}
