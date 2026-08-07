import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createXiangqiBoardGeometry,
  getXiangqiBoardPoint,
  XIANGQI_GRID_LINES,
} from '../features/games/xiangqi-board-geometry.ts';

test('board uses nine columns of intersections and ten rows of intersections', () => {
  const geometry = createXiangqiBoardGeometry(390);
  const topLeft = getXiangqiBoardPoint(geometry, { col: 0, row: 0 });
  const bottomRight = getXiangqiBoardPoint(geometry, { col: 8, row: 9 });

  assert.equal(bottomRight.x - topLeft.x, geometry.cellSize * 8);
  assert.equal(bottomRight.y - topLeft.y, geometry.cellSize * 9);
  assert.equal(geometry.playableHeight, geometry.cellSize * 9);
});

test('black perspective rotates logical positions around the board center', () => {
  const geometry = createXiangqiBoardGeometry(430);
  const redPoint = getXiangqiBoardPoint(geometry, { col: 1, row: 2 }, 'red');
  const blackPoint = getXiangqiBoardPoint(geometry, { col: 7, row: 7 }, 'black');

  assert.deepEqual(blackPoint, redPoint);
});

test('grid keeps horizontal banks complete and splits internal files at the river', () => {
  const horizontals = XIANGQI_GRID_LINES.filter((line) => line.role === 'horizontal');
  const verticals = XIANGQI_GRID_LINES.filter((line) => line.role === 'vertical');
  const palaces = XIANGQI_GRID_LINES.filter((line) => line.role === 'palace');

  assert.equal(horizontals.length, 10);
  assert.ok(horizontals.every((line) => line.x1 === 0 && line.x2 === 8));
  assert.equal(verticals.length, 16);
  assert.equal(verticals.filter((line) => line.y1 === 0 && line.y2 === 9).length, 2);
  assert.equal(verticals.filter((line) => line.y1 === 0 && line.y2 === 4).length, 7);
  assert.equal(verticals.filter((line) => line.y1 === 5 && line.y2 === 9).length, 7);
  assert.equal(palaces.length, 4);
});
