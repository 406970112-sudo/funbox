import assert from 'node:assert/strict';
import test from 'node:test';

import { getGameArtworkKind } from '../features/home/game-artwork-kind.ts';

test('maps every playable homepage game to distinct artwork', () => {
  const ids = ['snake-brawl', 'gomoku', 'tetris', 'brick-breaker'];
  const kinds = ids.map(getGameArtworkKind);

  assert.deepEqual(kinds, ['snake', 'gomoku', 'tetris', 'brick-breaker']);
  assert.equal(new Set(kinds).size, ids.length);
});

test('uses a neutral fallback for unknown games', () => {
  assert.equal(getGameArtworkKind('future-game'), 'fallback');
});
