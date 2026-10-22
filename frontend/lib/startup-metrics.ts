type StartupMilestone =
  | 'js-entry'
  | 'layout-mounted'
  | 'fonts-ready'
  | 'auth-ready'
  | 'access-ready'
  | 'home-ready';

const METRIC_PREFIX = 'funbox:startup:';
const METRICS_ENABLED = process.env.EXPO_PUBLIC_STARTUP_METRICS === '1';
const milestones = new Set<StartupMilestone>();
const listeners = new Set<() => void>();

export function hasStartupMilestone(milestone: StartupMilestone) {
  return milestones.has(milestone);
}

export function subscribeStartupMilestones(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markStartupMilestone(milestone: StartupMilestone) {
  milestones.add(milestone);
  for (const listener of listeners) listener();

  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;

  const markName = `${METRIC_PREFIX}${milestone}`;

  try {
    performance.clearMarks(markName);
    performance.mark(markName);
  } catch {
    return;
  }

  if (!METRICS_ENABLED || milestone === 'js-entry') return;

  const entry = performance.getEntriesByName(markName).at(-1);
  if (entry) {
    console.info(`[startup] ${milestone}: ${Math.round(entry.startTime)} ms`);
  }
}

markStartupMilestone('js-entry');
