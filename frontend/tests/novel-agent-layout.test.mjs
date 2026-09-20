import assert from 'node:assert/strict';
import test from 'node:test';

import { getNovelAgentLayout } from '../lib/novel-agent-layout.ts';

test('keeps a compact single column below the desktop breakpoint', () => {
  assert.deepEqual(getNovelAgentLayout(390), {
    isDesktop: false,
    contentMaxWidth: 430,
    pagePadding: 16,
    columnGap: 0,
  });
});

test('uses a centered two-column workspace on PC widths', () => {
  assert.deepEqual(getNovelAgentLayout(1440), {
    isDesktop: true,
    contentMaxWidth: 1120,
    pagePadding: 24,
    columnGap: 16,
  });
});
