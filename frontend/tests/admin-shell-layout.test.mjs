import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellSource = readFileSync(
  new URL('../features/admin/admin-shell.tsx', import.meta.url),
  'utf8',
);

test('stacks the admin content and navigation vertically on mobile', () => {
  assert.match(
    shellSource,
    /style=\{\[styles\.frame, !isDesktop && styles\.frameMobile\]\}/,
  );
  assert.match(shellSource, /frameMobile:\s*\{\s*flexDirection: 'column'/);
  assert.match(shellSource, /bottomNav:\s*\{[\s\S]*?width: '100%'/);
  assert.match(shellSource, /content:\s*\{[\s\S]*?overflow: 'hidden'/);
});

test('keeps the mobile admin navigation to five primary destinations', () => {
  const mobileNavSource = shellSource.match(
    /const MOBILE_NAV_ITEMS:[\s\S]*?= \[([\s\S]*?)\n\];/,
  )?.[1];

  assert.ok(mobileNavSource, 'mobile navigation definition is missing');
  const keys = [...mobileNavSource.matchAll(/key: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(keys, ['index', 'users', 'permissions', 'feedback', 'reading']);
});
