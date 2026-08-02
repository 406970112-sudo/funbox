import type {
  HomeRecommendationItem,
  HomeRecommendationRegistryFeature,
} from '@/types/home-recommendation';

export const DEFAULT_RECOMMENDATION_FEATURE_ID = 'card-score';
export const MAX_HOME_RECOMMENDATIONS = 3;

export function filterRecommendationsByVisibility(
  items: HomeRecommendationItem[],
  visibleFeatureIDs: ReadonlySet<string>,
) {
  return items.filter((item) => visibleFeatureIDs.has(item.featureId));
}

export function buildPreviewRecommendation(
  feature: HomeRecommendationRegistryFeature,
  overrides: {
    ctaLabelOverride?: string;
    descriptionOverride?: string;
    titleOverride?: string;
  },
): HomeRecommendationItem {
  const kind = feature.route.startsWith('/games/') ? 'game' : 'tool';
  const title = overrides.titleOverride?.trim() || feature.name;
  const description = overrides.descriptionOverride?.trim() || feature.tagline;
  const ctaLabel =
    overrides.ctaLabelOverride?.trim() ||
    (kind === 'game' ? '开始游戏' : feature.usageLabel);
  return {
    accentColor: feature.accentColor,
    ctaLabel,
    description,
    featureId: feature.id,
    icon: feature.icon,
    kind,
    name: feature.name,
    route: feature.route,
    slotId: '',
    sortOrder: 0,
    tagline: feature.tagline,
    title,
  };
}

export function takeRecommendations(items: HomeRecommendationItem[]) {
  return items.slice(0, MAX_HOME_RECOMMENDATIONS);
}
