import { router, type Href } from 'expo-router';

import { backFallbackForPathname } from './router-back-fallback';

let installed = false;
let hasNavigatedInApp = false;
let currentPathname = '/';

export function trackBackContext(pathname: string) {
  currentPathname = pathname;
}

export function installSafeRouterBack() {
  if (installed) return;
  installed = true;

  const originalBack = router.back;
  const originalPush = router.push;
  const originalReplace = router.replace;
  const originalNavigate = router.navigate;

  router.push = ((...args: Parameters<typeof router.push>) => {
    hasNavigatedInApp = true;
    originalPush(...args);
  }) as typeof router.push;

  router.replace = ((...args: Parameters<typeof router.replace>) => {
    hasNavigatedInApp = true;
    originalReplace(...args);
  }) as typeof router.replace;

  router.navigate = ((...args: Parameters<typeof router.navigate>) => {
    hasNavigatedInApp = true;
    originalNavigate(...args);
  }) as typeof router.navigate;

  router.back = () => {
    try {
      if (hasNavigatedInApp && router.canGoBack()) {
        originalBack();
        return;
      }
    } catch {
      // Router is not ready yet; fall back to a deterministic destination.
    }
    router.replace(backFallbackForPathname(currentPathname) as Href);
  };
}
