import type { XiangqiColor, XiangqiPosition } from '@/features/games/xiangqi-engine';

export const XIANGQI_COLUMN_INTERVALS = 8;
export const XIANGQI_ROW_INTERVALS = 9;

const BOARD_HORIZONTAL_GUTTER = 96;
const MAX_PLAYABLE_WIDTH = 360;
const PADDING_CELL_RATIO = 0.56;

export type XiangqiBoardGeometry = {
  boardHeight: number;
  boardPadding: number;
  boardWidth: number;
  cellSize: number;
  playableHeight: number;
  playableWidth: number;
};

export type XiangqiGridLine = {
  emphasized?: boolean;
  id: string;
  role: 'horizontal' | 'palace' | 'vertical';
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

export const XIANGQI_GRID_LINES: readonly XiangqiGridLine[] = [
  ...Array.from({ length: XIANGQI_ROW_INTERVALS + 1 }, (_, row) => ({
    emphasized: row === 0 || row === XIANGQI_ROW_INTERVALS,
    id: `horizontal-${row}`,
    role: 'horizontal' as const,
    x1: 0,
    x2: XIANGQI_COLUMN_INTERVALS,
    y1: row,
    y2: row,
  })),
  {
    emphasized: true,
    id: 'vertical-left',
    role: 'vertical',
    x1: 0,
    x2: 0,
    y1: 0,
    y2: XIANGQI_ROW_INTERVALS,
  },
  {
    emphasized: true,
    id: 'vertical-right',
    role: 'vertical',
    x1: XIANGQI_COLUMN_INTERVALS,
    x2: XIANGQI_COLUMN_INTERVALS,
    y1: 0,
    y2: XIANGQI_ROW_INTERVALS,
  },
  ...Array.from({ length: XIANGQI_COLUMN_INTERVALS - 1 }, (_, index) => index + 1).flatMap((col) => [
    {
      id: `vertical-${col}-top`,
      role: 'vertical' as const,
      x1: col,
      x2: col,
      y1: 0,
      y2: 4,
    },
    {
      id: `vertical-${col}-bottom`,
      role: 'vertical' as const,
      x1: col,
      x2: col,
      y1: 5,
      y2: XIANGQI_ROW_INTERVALS,
    },
  ]),
  { id: 'palace-top-down', role: 'palace', x1: 3, x2: 5, y1: 0, y2: 2 },
  { id: 'palace-top-up', role: 'palace', x1: 5, x2: 3, y1: 0, y2: 2 },
  { id: 'palace-bottom-down', role: 'palace', x1: 3, x2: 5, y1: 7, y2: 9 },
  { id: 'palace-bottom-up', role: 'palace', x1: 5, x2: 3, y1: 7, y2: 9 },
];

export function createXiangqiBoardGeometry(viewportWidth: number): XiangqiBoardGeometry {
  const playableWidth = Math.min(Math.max(viewportWidth - BOARD_HORIZONTAL_GUTTER, 0), MAX_PLAYABLE_WIDTH);
  const cellSize = playableWidth / XIANGQI_COLUMN_INTERVALS;
  const boardPadding = cellSize * PADDING_CELL_RATIO;
  const playableHeight = cellSize * XIANGQI_ROW_INTERVALS;

  return {
    boardHeight: playableHeight + boardPadding * 2,
    boardPadding,
    boardWidth: playableWidth + boardPadding * 2,
    cellSize,
    playableHeight,
    playableWidth,
  };
}

export function getXiangqiBoardPoint(
  geometry: XiangqiBoardGeometry,
  position: XiangqiPosition,
  perspective: XiangqiColor = 'red',
): { x: number; y: number } {
  const col = perspective === 'black' ? XIANGQI_COLUMN_INTERVALS - position.col : position.col;
  const row = perspective === 'black' ? XIANGQI_ROW_INTERVALS - position.row : position.row;

  return {
    x: geometry.boardPadding + col * geometry.cellSize,
    y: geometry.boardPadding + row * geometry.cellSize,
  };
}
