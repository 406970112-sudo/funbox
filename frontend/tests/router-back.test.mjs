import test from 'node:test';
import assert from 'node:assert/strict';

import { backFallbackForPathname } from '../lib/router-back-fallback.ts';

test('falls back to the tools tab for direct tool entries', () => {
  assert.equal(backFallbackForPathname('/tools/smart-translation'), '/tools');
  assert.equal(backFallbackForPathname('/tools/reading'), '/tools');
});

test('keeps profile, admin, and social parents stable', () => {
  assert.equal(backFallbackForPathname('/profile/edit'), '/profile');
  assert.equal(backFallbackForPathname('/admin/users'), '/admin');
  assert.equal(backFallbackForPathname('/admin'), '/profile');
  assert.equal(backFallbackForPathname('/social/chat/123'), '/messages');
});

test('maps reading screens to their reading home', () => {
  assert.equal(backFallbackForPathname('/reading/import'), '/tools/reading');
  assert.equal(backFallbackForPathname('/reading/books/42'), '/tools/reading');
  assert.equal(backFallbackForPathname('/reading/books/42/chapters/7'), '/reading/books/42');
});

test('falls back to the app root for games and unknown routes', () => {
  assert.equal(backFallbackForPathname('/games/snake'), '/');
  assert.equal(backFallbackForPathname('/'), '/');
  assert.equal(backFallbackForPathname('/auth'), '/');
});
