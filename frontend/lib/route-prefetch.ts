import { router } from 'expo-router';
import type { Href } from 'expo-router';

export function prefetchFeatureRoutes(routes: readonly string[]) {
  if (typeof router.prefetch !== 'function') return;

  for (const route of routes) {
    try {
      router.prefetch(route as Href);
    } catch {
      // Prefetch is an optimization; a missing route must never block the home page.
    }
  }
}
