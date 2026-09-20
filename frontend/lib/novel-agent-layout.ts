export const NOVEL_AGENT_DESKTOP_BREAKPOINT = 900;

export function getNovelAgentLayout(windowWidth: number) {
  const isDesktop = windowWidth >= NOVEL_AGENT_DESKTOP_BREAKPOINT;

  return {
    isDesktop,
    contentMaxWidth: isDesktop ? 1120 : 430,
    pagePadding: isDesktop ? 24 : 16,
    columnGap: isDesktop ? 16 : 0,
  } as const;
}
