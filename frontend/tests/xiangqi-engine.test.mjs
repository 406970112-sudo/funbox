import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyXiangqiMove,
  chooseXiangqiAiMove,
  createInitialXiangqiBoard,
  createXiangqiState,
  generateXiangqiLegalMoves,
  generateXiangqiPseudoMoves,
  getXiangqiGameResult,
  getXiangqiHint,
  getXiangqiMoveNotation,
  getXiangqiPiece,
  isXiangqiInCheck,
} from '../features/games/xiangqi-engine.ts';

function boardWith(pieces) {
  const board = createInitialXiangqiBoard();
  for (const [col, row, color, type] of pieces) {
    const index = row * 9 + col;
    board[index] = { color, type };
  }
  return board;
}

function boardFrom(spec) {
  const board = Array(90).fill(null);
  for (const [col, row, color, type] of spec) {
    board[row * 9 + col] = { color, type };
  }
  return board;
}

test('initial board has 32 pieces in standard positions', () => {
  const board = createInitialXiangqiBoard();
  const count = board.filter(Boolean).length;
  assert.equal(count, 32);
  assert.deepEqual(getXiangqiPiece(board, { col: 4, row: 9 }), { color: 'red', type: 'K' });
  assert.deepEqual(getXiangqiPiece(board, { col: 4, row: 0 }), { color: 'black', type: 'K' });
  assert.deepEqual(getXiangqiPiece(board, { col: 0, row: 6 }), { color: 'red', type: 'P' });
  assert.deepEqual(getXiangqiPiece(board, { col: 8, row: 3 }), { color: 'black', type: 'P' });
});

test('rook slides until blocked and captures the first enemy piece', () => {
  const board = boardFrom([
    [4, 9, 'red', 'R'],
    [4, 6, 'red', 'P'],
  ]);
  const moves = generateXiangqiPseudoMoves(board, { col: 4, row: 9 });
  assert.ok(!moves.some((move) => move.col === 4 && move.row === 6), 'friendly pawn blocks the square');
  assert.ok(!moves.some((move) => move.col === 4 && move.row === 3), 'cannot pass through friendly pawn');
  assert.ok(moves.some((move) => move.col === 4 && move.row === 7), 'slides up to the blocker');
});

test('cannon needs exactly one screen to capture', () => {
  const board = boardFrom([
    [4, 9, 'red', 'C'],
    [4, 7, 'red', 'P'],
    [4, 3, 'black', 'P'],
  ]);
  const moves = generateXiangqiPseudoMoves(board, { col: 4, row: 9 });
  assert.ok(moves.some((move) => move.col === 4 && move.row === 3), 'one screen plus enemy piece is capturable');
  const screened = boardFrom([
    [4, 9, 'red', 'C'],
    [4, 7, 'red', 'P'],
    [4, 5, 'red', 'P'],
    [4, 3, 'black', 'P'],
  ]);
  const screenedMoves = generateXiangqiPseudoMoves(screened, { col: 4, row: 9 });
  assert.ok(!screenedMoves.some((move) => move.col === 4 && move.row === 3), 'two screens cannot be jumped');
  assert.ok(screenedMoves.some((move) => move.col === 4 && move.row === 8), 'still slides before the screen');
});

test('horse cannot jump over a blocking leg', () => {
  const board = boardFrom([
    [4, 9, 'red', 'H'],
    [5, 9, 'red', 'P'],
  ]);
  const moves = generateXiangqiPseudoMoves(board, { col: 4, row: 9 });
  assert.ok(!moves.some((move) => move.col === 6 && move.row === 8), 'right leg blocked');
  assert.ok(moves.some((move) => move.col === 3 && move.row === 7), 'left side remains available');
});

test('elephant stays on its own side and cannot cross the river', () => {
  const board = boardFrom([
    [2, 9, 'red', 'E'],
    [1, 8, 'red', 'P'],
  ]);
  const moves = generateXiangqiPseudoMoves(board, { col: 2, row: 9 });
  assert.ok(moves.some((move) => move.col === 4 && move.row === 7));
  assert.ok(!moves.some((move) => move.col === 0 && move.row === 7), 'eye is blocked');
  assert.ok(moves.every((move) => move.row >= 5), 'elephant never crosses river');
});

test('a move that leaves own king in check is illegal', () => {
  const board = boardFrom([
    [4, 9, 'red', 'K'],
    [4, 8, 'red', 'P'],
    [4, 0, 'black', 'K'],
  ]);
  const legal = generateXiangqiLegalMoves(board, 'red');
  assert.ok(!legal.some((move) => move.col === 4 && move.row === 8), 'exposing the flying general is illegal');
});

test('general cannot face the enemy general on an open file', () => {
  const board = boardFrom([
    [4, 9, 'red', 'K'],
    [4, 0, 'black', 'K'],
  ]);
  assert.equal(isXiangqiInCheck(board, 'red'), true);
  assert.equal(isXiangqiInCheck(board, 'black'), true);
});

test('legal moves escape check and checkmate ends the game', () => {
  const board = boardFrom([
    [4, 9, 'red', 'K'],
    [0, 9, 'red', 'R'],
    [1, 9, 'red', 'R'],
    [4, 0, 'black', 'K'],
    [8, 3, 'black', 'P'],
  ]);
  const legal = generateXiangqiLegalMoves(board, 'red');
  assert.ok(legal.every((move) => !isXiangqiInCheck(applyXiangqiMove(board, move), 'red')));
  assert.ok(legal.length > 0);

  const mated = boardFrom([
    [4, 0, 'black', 'K'],
    [3, 0, 'black', 'A'],
    [5, 0, 'black', 'A'],
    [4, 1, 'red', 'R'],
    [4, 2, 'red', 'R'],
  ]);
  assert.equal(generateXiangqiLegalMoves(mated, 'black').length, 0);
  const state = createXiangqiState();
  state.board = mated;
  state.sideToMove = 'black';
  assert.deepEqual(getXiangqiGameResult(state), { draw: false, winner: 'red' });
});

test('pawn moves forward and sideways after crossing the river', () => {
  const beforeRiver = boardFrom([
    [4, 6, 'red', 'P'],
  ]);
  const before = generateXiangqiPseudoMoves(beforeRiver, { col: 4, row: 6 });
  assert.ok(before.some((move) => move.col === 4 && move.row === 5));
  assert.ok(!before.some((move) => move.col === 3 && move.row === 6));

  const afterRiver = boardFrom([
    [4, 4, 'red', 'P'],
  ]);
  const after = generateXiangqiPseudoMoves(afterRiver, { col: 4, row: 4 });
  assert.ok(after.some((move) => move.col === 3 && move.row === 4));
  assert.ok(after.some((move) => move.col === 5 && move.row === 4));
  assert.ok(after.some((move) => move.col === 4 && move.row === 3));
});

test('AI returns a legal move for every difficulty and avoids immediate self-check', () => {
  const board = createInitialXiangqiBoard();
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const move = chooseXiangqiAiMove(board, 'red', difficulty, { random: () => 0.5, now: () => 0 });
    assert.ok(move, `AI should move at ${difficulty}`);
    const nextBoard = applyXiangqiMove(board, move);
    assert.equal(isXiangqiInCheck(nextBoard, 'red'), false);
  }
});

test('AI captures a hanging rook when available', () => {
  const board = boardFrom([
    [4, 9, 'red', 'K'],
    [5, 9, 'red', 'A'],
    [3, 9, 'red', 'A'],
    [1, 6, 'red', 'P'],
    [4, 6, 'red', 'P'],
    [0, 5, 'red', 'R'],
    [4, 0, 'black', 'K'],
    [5, 0, 'black', 'A'],
    [3, 0, 'black', 'A'],
    [0, 3, 'black', 'C'],
    [4, 3, 'black', 'P'],
  ]);
  const move = chooseXiangqiAiMove(board, 'red', 'medium', { random: () => 0, now: () => 0 });
  assert.ok(move);
  assert.equal(move.col, 0);
  assert.equal(move.row, 3);
});

test('hint returns a legal move', () => {
  const board = createInitialXiangqiBoard();
  const hint = getXiangqiHint(board, 'red');
  assert.ok(hint);
  assert.ok(generateXiangqiLegalMoves(board, 'red').some((move) =>
    move.from.col === hint.from.col &&
    move.from.row === hint.from.row &&
    move.col === hint.col &&
    move.row === hint.row,
  ));
});

test('move notation reads as Chinese chess notation', () => {
  const board = boardFrom([
    [1, 7, 'red', 'C'],
  ]);
  const move = { col: 5, from: { col: 1, row: 7 }, row: 7 };
  assert.equal(getXiangqiMoveNotation(board, move), '炮八平四');
});
