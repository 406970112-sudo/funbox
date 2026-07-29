import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseAiMove,
  createEmptyGomokuBoard,
  getBoardCell,
  getWinningLine,
  placeStone,
} from '../features/games/gomoku-engine.ts';

function boardWithMoves(moves) {
  let board = createEmptyGomokuBoard();

  for (const [row, col, stone] of moves) {
    board = placeStone(board, { row, col }, stone);
    assert.ok(board);
  }

  return board;
}

test('places a stone only on an empty position', () => {
  const empty = createEmptyGomokuBoard();
  const board = placeStone(empty, { row: 7, col: 7 }, 'black');

  assert.ok(board);
  assert.equal(getBoardCell(board, 7, 7), 'black');
  assert.equal(placeStone(board, { row: 7, col: 7 }, 'white'), null);
  assert.equal(getBoardCell(empty, 7, 7), null);
});

test('detects horizontal, vertical, and diagonal wins', () => {
  const lines = [
    Array.from({ length: 5 }, (_, index) => [7, index + 4, 'black']),
    Array.from({ length: 5 }, (_, index) => [index + 2, 8, 'white']),
    Array.from({ length: 5 }, (_, index) => [index + 3, index + 5, 'black']),
    Array.from({ length: 5 }, (_, index) => [index + 3, 10 - index, 'white']),
  ];

  for (const moves of lines) {
    const board = boardWithMoves(moves);
    const [row, col] = moves[2];
    assert.equal(getWinningLine(board, { row, col }).length, 5);
  }
});

test('AI opens at the center', () => {
  const move = chooseAiMove(createEmptyGomokuBoard(), 'hard', {
    now: () => 0,
    random: () => 0,
  });

  assert.deepEqual(move, { row: 7, col: 7 });
});

test('AI takes an immediate winning move', () => {
  const board = boardWithMoves([
    [7, 4, 'white'],
    [7, 5, 'white'],
    [7, 6, 'white'],
    [7, 7, 'white'],
    [6, 6, 'black'],
  ]);
  const move = chooseAiMove(board, 'medium', { random: () => 0 });

  assert.ok(move);
  assert.equal(move.row, 7);
  assert.ok(move.col === 3 || move.col === 8);
});

test('medium and hard AI block an immediate human win', () => {
  const board = boardWithMoves([
    [9, 4, 'black'],
    [9, 5, 'black'],
    [9, 6, 'black'],
    [9, 7, 'black'],
    [8, 6, 'white'],
  ]);

  for (const difficulty of ['medium', 'hard']) {
    const move = chooseAiMove(board, difficulty, {
      now: () => 0,
      random: () => 0,
    });

    assert.ok(move);
    assert.equal(move.row, 9);
    assert.ok(move.col === 3 || move.col === 8);
  }
});
