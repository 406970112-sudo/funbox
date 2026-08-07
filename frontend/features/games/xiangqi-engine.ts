export const XIANGQI_COLS = 9;
export const XIANGQI_ROWS = 10;

export type XiangqiColor = 'red' | 'black';
export type XiangqiPieceType = 'R' | 'H' | 'E' | 'A' | 'K' | 'C' | 'P';
export type XiangqiDifficulty = 'easy' | 'medium' | 'hard';

export type XiangqiPiece = {
  color: XiangqiColor;
  type: XiangqiPieceType;
};

export type XiangqiBoard = (XiangqiPiece | null)[];

export type XiangqiPosition = {
  col: number;
  row: number;
};

export type XiangqiMove = XiangqiPosition & {
  from: XiangqiPosition;
};

export type XiangqiState = {
  board: XiangqiBoard;
  sideToMove: XiangqiColor;
  lastMove: XiangqiMove | null;
  winner: XiangqiColor | null;
  draw: boolean;
};

export type XiangqiAiOptions = {
  now?: () => number;
  random?: () => number;
};

type RankedMove = XiangqiMove & {
  score: number;
};

type AiConfig = {
  searchDepth: number;
  timeBudgetMs: number;
  randomChance: number;
};

const WIN_SCORE = 1_000_000;
const MATERIAL: Record<XiangqiPieceType, number> = {
  R: 900,
  H: 400,
  E: 200,
  A: 200,
  K: 100_000,
  C: 450,
  P: 100,
};

const PIECE_SQUARE: Record<XiangqiPieceType, number[]> = {
  R: [
    0, 12, 20, 24, 26, 24, 20, 12, 0,
    12, 20, 24, 30, 32, 30, 24, 20, 12,
    8, 12, 16, 20, 22, 20, 16, 12, 8,
    4, 8, 12, 16, 18, 16, 12, 8, 4,
    0, 4, 8, 12, 14, 12, 8, 4, 0,
    0, 4, 8, 12, 14, 12, 8, 4, 0,
    4, 8, 12, 16, 18, 16, 12, 8, 4,
    8, 12, 16, 20, 22, 20, 16, 12, 8,
    12, 20, 24, 30, 32, 30, 24, 20, 12,
    0, 12, 20, 24, 26, 24, 20, 12, 0,
  ],
  H: [
    0, 2, 4, 4, 4, 4, 4, 2, 0,
    2, 6, 8, 10, 10, 10, 8, 6, 2,
    4, 8, 12, 14, 16, 14, 12, 8, 4,
    4, 10, 14, 18, 20, 18, 14, 10, 4,
    4, 10, 16, 20, 22, 20, 16, 10, 4,
    4, 10, 16, 20, 22, 20, 16, 10, 4,
    4, 10, 14, 18, 20, 18, 14, 10, 4,
    4, 8, 12, 14, 16, 14, 12, 8, 4,
    2, 6, 8, 10, 10, 10, 8, 6, 2,
    0, 2, 4, 4, 4, 4, 4, 2, 0,
  ],
  E: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 6, 0, 0, 0, 6, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 6, 0, 0, 0, 6, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  A: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 3, 0, 3, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 3, 0, 3, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  K: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 6, 0, 6, 0, 0, 0,
    0, 0, 0, 8, 0, 8, 0, 0, 0,
    0, 0, 0, 6, 0, 6, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  C: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 4, 0, 0, 0, 4, 0, 0,
    0, 0, 6, 6, 6, 6, 6, 0, 0,
    0, 0, 8, 10, 10, 10, 8, 0, 0,
    0, 0, 8, 10, 12, 10, 8, 0, 0,
    0, 0, 8, 10, 12, 10, 8, 0, 0,
    0, 0, 8, 10, 10, 10, 8, 0, 0,
    0, 0, 6, 6, 6, 6, 6, 0, 0,
    0, 0, 4, 0, 0, 0, 4, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  P: [
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 6, 6, 8, 10, 8, 6, 6, 0,
    0, 6, 6, 8, 10, 8, 6, 6, 0,
    0, 10, 10, 12, 14, 12, 10, 10, 0,
    0, 12, 12, 16, 18, 16, 12, 12, 0,
    0, 14, 14, 18, 20, 18, 14, 14, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
};

const AI_CONFIG: Record<XiangqiDifficulty, AiConfig> = {
  easy: { randomChance: 0.75, searchDepth: 0, timeBudgetMs: 80 },
  medium: { randomChance: 0.18, searchDepth: 1, timeBudgetMs: 240 },
  hard: { randomChance: 0, searchDepth: 3, timeBudgetMs: 900 },
};

export function createInitialXiangqiBoard(): XiangqiBoard {
  const board = Array<XiangqiPiece | null>(XIANGQI_COLS * XIANGQI_ROWS).fill(null);
  const blackBack: XiangqiPieceType[] = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];

  blackBack.forEach((type, col) => {
    board[indexOf(col, 0)] = { color: 'black', type };
  });
  board[indexOf(1, 2)] = { color: 'black', type: 'C' };
  board[indexOf(7, 2)] = { color: 'black', type: 'C' };
  for (let col = 0; col < 9; col += 2) {
    board[indexOf(col, 3)] = { color: 'black', type: 'P' };
  }

  blackBack.forEach((type, col) => {
    board[indexOf(col, 9)] = { color: 'red', type };
  });
  board[indexOf(1, 7)] = { color: 'red', type: 'C' };
  board[indexOf(7, 7)] = { color: 'red', type: 'C' };
  for (let col = 0; col < 9; col += 2) {
    board[indexOf(col, 6)] = { color: 'red', type: 'P' };
  }

  return board;
}

export function createXiangqiState(): XiangqiState {
  return {
    board: createInitialXiangqiBoard(),
    draw: false,
    lastMove: null,
    sideToMove: 'red',
    winner: null,
  };
}

export function getXiangqiPiece(
  board: XiangqiBoard,
  position: XiangqiPosition,
): XiangqiPiece | null {
  if (!isInside(position.col, position.row)) {
    return null;
  }
  return board[indexOf(position.col, position.row)] ?? null;
}

export function getXiangqiKing(board: XiangqiBoard, color: XiangqiColor): XiangqiPosition | null {
  for (let row = 0; row < XIANGQI_ROWS; row += 1) {
    for (let col = 0; col < XIANGQI_COLS; col += 1) {
      const piece = board[indexOf(col, row)];
      if (piece?.color === color && piece.type === 'K') {
        return { col, row };
      }
    }
  }
  return null;
}

export function generateXiangqiPseudoMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
): XiangqiMove[] {
  const piece = getXiangqiPiece(board, from);
  if (!piece) {
    return [];
  }

  const moves: XiangqiMove[] = [];
  const destinations: XiangqiPosition[] = [];

  switch (piece.type) {
    case 'R':
      collectLineMoves(board, from, 1, 0, piece.color, destinations);
      collectLineMoves(board, from, -1, 0, piece.color, destinations);
      collectLineMoves(board, from, 0, 1, piece.color, destinations);
      collectLineMoves(board, from, 0, -1, piece.color, destinations);
      break;
    case 'C':
      collectCannonMoves(board, from, 1, 0, piece.color, destinations);
      collectCannonMoves(board, from, -1, 0, piece.color, destinations);
      collectCannonMoves(board, from, 0, 1, piece.color, destinations);
      collectCannonMoves(board, from, 0, -1, piece.color, destinations);
      break;
    case 'H':
      collectHorseMoves(board, from, piece.color, destinations);
      break;
    case 'E':
      collectElephantMoves(board, from, piece.color, destinations);
      break;
    case 'A':
      collectAdvisorMoves(from, piece.color, destinations);
      break;
    case 'K':
      collectKingMoves(board, from, piece.color, destinations);
      break;
    case 'P':
      collectPawnMoves(board, from, piece.color, destinations);
      break;
  }

  for (const destination of destinations) {
    if (canMoveTo(board, from, destination)) {
      moves.push({ col: destination.col, from: { ...from }, row: destination.row });
    }
  }

  return moves;
}

export function generateXiangqiLegalMoves(board: XiangqiBoard, color: XiangqiColor): XiangqiMove[] {
  const moves: XiangqiMove[] = [];

  for (let row = 0; row < XIANGQI_ROWS; row += 1) {
    for (let col = 0; col < XIANGQI_COLS; col += 1) {
      const piece = board[indexOf(col, row)];
      if (!piece || piece.color !== color) {
        continue;
      }
      for (const move of generateXiangqiPseudoMoves(board, { col, row })) {
        const nextBoard = applyXiangqiMove(board, move);
        if (!isXiangqiInCheck(nextBoard, color)) {
          moves.push(move);
        }
      }
    }
  }

  return moves;
}

export function applyXiangqiMove(board: XiangqiBoard, move: XiangqiMove): XiangqiBoard {
  const nextBoard = [...board];
  nextBoard[indexOf(move.col, move.row)] = nextBoard[indexOf(move.from.col, move.from.row)];
  nextBoard[indexOf(move.from.col, move.from.row)] = null;
  return nextBoard;
}

export function isXiangqiInCheck(board: XiangqiBoard, color: XiangqiColor): boolean {
  const king = getXiangqiKing(board, color);
  if (!king) {
    return false;
  }
  return isSquareAttacked(board, king.col, king.row, opponent(color));
}

export function isSquareAttacked(
  board: XiangqiBoard,
  col: number,
  row: number,
  byColor: XiangqiColor,
): boolean {
  if (findRookAttack(board, col, row, byColor, 'R')) {
    return true;
  }
  if (findCannonAttack(board, col, row, byColor)) {
    return true;
  }
  if (findHorseAttack(board, col, row, byColor)) {
    return true;
  }
  if (findPawnAttack(board, col, row, byColor)) {
    return true;
  }
  return findKingAttack(board, col, row, byColor);
}

export function getXiangqiGameResult(state: XiangqiState): {
  draw: boolean;
  winner: XiangqiColor | null;
} {
  if (state.winner) {
    return { draw: false, winner: state.winner };
  }
  if (state.draw) {
    return { draw: true, winner: null };
  }
  const legalMoves = generateXiangqiLegalMoves(state.board, state.sideToMove);
  if (legalMoves.length > 0) {
    return { draw: false, winner: null };
  }
  return {
    draw: false,
    winner: opponent(state.sideToMove),
  };
}

export function chooseXiangqiAiMove(
  board: XiangqiBoard,
  color: XiangqiColor,
  difficulty: XiangqiDifficulty,
  options: XiangqiAiOptions = {},
): XiangqiMove | null {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const legalMoves = generateXiangqiLegalMoves(board, color);

  if (legalMoves.length === 0) {
    return null;
  }

  const config = AI_CONFIG[difficulty];
  const ranked = rankMoves(board, legalMoves, color);
  const best = ranked[0];

  if (!best) {
    return null;
  }

  if (difficulty === 'easy') {
    const pool = ranked.slice(0, Math.min(4, ranked.length));
    if (random() < config.randomChance) {
      return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    }
    return best;
  }

  if (difficulty === 'medium' && config.searchDepth <= 1) {
    if (random() < config.randomChance) {
      const pool = ranked.slice(0, Math.min(3, ranked.length));
      return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
    }
    return best;
  }

  return searchXiangqiMove(board, ranked, color, config, now);
}

export function getXiangqiHint(
  board: XiangqiBoard,
  color: XiangqiColor,
  options: XiangqiAiOptions = {},
): XiangqiMove | null {
  return chooseXiangqiAiMove(board, color, 'medium', options);
}

export function getXiangqiMoveNotation(
  board: XiangqiBoard,
  move: XiangqiMove,
): string {
  const piece = getXiangqiPiece(board, move.from);
  if (!piece) {
    return '走子';
  }
  const labels: Record<XiangqiPieceType, string> = {
    A: piece.color === 'red' ? '仕' : '士',
    C: piece.color === 'red' ? '炮' : '砲',
    E: piece.color === 'red' ? '相' : '象',
    H: piece.color === 'red' ? '馬' : '馬',
    K: piece.color === 'red' ? '帥' : '將',
    P: piece.color === 'red' ? '兵' : '卒',
    R: piece.color === 'red' ? '車' : '車',
  };
  const file = piece.color === 'red' ? 9 - move.from.col : move.from.col + 1;
  const toFile = piece.color === 'red' ? 9 - move.col : move.col + 1;
  const backward = piece.color === 'red' ? move.row > move.from.row : move.row < move.from.row;
  const forward = piece.color === 'red' ? move.row < move.from.row : move.row > move.from.row;
  const direction = backward ? '退' : forward ? '進' : '平';
  return `${labels[piece.type]}${toChineseNumber(file)}${direction}${toChineseNumber(toFile)}`;
}

function searchXiangqiMove(
  board: XiangqiBoard,
  ranked: RankedMove[],
  color: XiangqiColor,
  config: AiConfig,
  now: () => number,
): XiangqiMove | null {
  const deadline = now() + config.timeBudgetMs;
  let alpha = Number.NEGATIVE_INFINITY;
  let best: RankedMove = ranked[0];

  for (const move of ranked.slice(0, 24)) {
    const nextBoard = applyXiangqiMove(board, move);
    const score = negamax(
      nextBoard,
      config.searchDepth - 1,
      opponent(color),
      -Number.POSITIVE_INFINITY,
      -alpha,
      deadline,
      now,
    );
    const rankedScore = -score;
    if (rankedScore > alpha) {
      alpha = rankedScore;
      best = move;
    }
    if (now() >= deadline) {
      break;
    }
  }

  return best;
}

function negamax(
  board: XiangqiBoard,
  depth: number,
  color: XiangqiColor,
  alphaValue: number,
  betaValue: number,
  deadline: number,
  now: () => number,
): number {
  const moves = generateXiangqiLegalMoves(board, color);

  if (moves.length === 0) {
    return isXiangqiInCheck(board, color) ? -WIN_SCORE - depth * 10 : 0;
  }

  if (depth <= 0 || now() >= deadline) {
    return evaluateXiangqiBoard(board, color);
  }

  const ordered = rankMoves(board, moves, color).slice(0, 18);
  let alpha = alphaValue;
  let value = Number.NEGATIVE_INFINITY;

  for (const move of ordered) {
    const nextBoard = applyXiangqiMove(board, move);
    const score = -negamax(
      nextBoard,
      depth - 1,
      opponent(color),
      -betaValue,
      -alpha,
      deadline,
      now,
    );
    value = Math.max(value, score);
    alpha = Math.max(alpha, score);
    if (alpha >= betaValue || now() >= deadline) {
      break;
    }
  }

  return value;
}

function evaluateXiangqiBoard(board: XiangqiBoard, side: XiangqiColor): number {
  let score = 0;

  for (let row = 0; row < XIANGQI_ROWS; row += 1) {
    for (let col = 0; col < XIANGQI_COLS; col += 1) {
      const piece = board[indexOf(col, row)];
      if (!piece) {
        continue;
      }
      const value = MATERIAL[piece.type] + PIECE_SQUARE[piece.type][indexOf(col, row)];
      score += piece.color === side ? value : -value;
    }
  }

  return score;
}

function rankMoves(
  board: XiangqiBoard,
  moves: XiangqiMove[],
  color: XiangqiColor,
): RankedMove[] {
  const opponentColor = opponent(color);

  return moves
    .map((move) => {
      const captured = getXiangqiPiece(board, move);
      const captureScore = captured ? MATERIAL[captured.type] : 0;
      const nextBoard = applyXiangqiMove(board, move);
      const moveScore = evaluateXiangqiBoard(nextBoard, color) - evaluateXiangqiBoard(board, color);
      return {
        ...move,
        score: captureScore * 3 + moveScore + (isSquareAttacked(nextBoard, move.col, move.row, opponentColor) ? -30 : 0),
      };
    })
    .sort((left, right) => right.score - left.score);
}

function collectLineMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
  rowStep: number,
  colStep: number,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  let row = from.row + rowStep;
  let col = from.col + colStep;

  while (isInside(col, row)) {
    const piece = board[indexOf(col, row)];
    if (!piece) {
      destinations.push({ col, row });
    } else {
      if (piece.color !== color) {
        destinations.push({ col, row });
      }
      break;
    }
    row += rowStep;
    col += colStep;
  }
}

function collectCannonMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
  rowStep: number,
  colStep: number,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  let row = from.row + rowStep;
  let col = from.col + colStep;
  let screen = 0;

  while (isInside(col, row)) {
    const piece = board[indexOf(col, row)];
    if (!piece) {
      if (screen === 0) {
        destinations.push({ col, row });
      }
    } else {
      screen += 1;
      if (screen === 1) {
        row += rowStep;
        col += colStep;
        continue;
      }
      if (piece.color !== color) {
        destinations.push({ col, row });
      }
      break;
    }
    row += rowStep;
    col += colStep;
  }
}

function collectHorseMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  const { col, row } = from;
  const steps: [number, number, number, number][] = [
    [2, 1, 1, 0],
    [2, -1, 1, 0],
    [-2, 1, -1, 0],
    [-2, -1, -1, 0],
    [1, 2, 0, 1],
    [-1, 2, 0, 1],
    [1, -2, 0, -1],
    [-1, -2, 0, -1],
  ];

  for (const [colStep, rowStep, legColStep, legRowStep] of steps) {
    const legCol = col + legColStep;
    const legRow = row + legRowStep;
    if (!isInside(legCol, legRow) || board[indexOf(legCol, legRow)]) {
      continue;
    }
    const targetCol = col + colStep;
    const targetRow = row + rowStep;
    if (isInside(targetCol, targetRow)) {
      const target = board[indexOf(targetCol, targetRow)];
      if (!target || target.color !== color) {
        destinations.push({ col: targetCol, row: targetRow });
      }
    }
  }
}

function collectElephantMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  const { col, row } = from;
  const eye = color === 'red' ? 5 : 4;
  const steps: [number, number][] = [
    [2, 2],
    [2, -2],
    [-2, 2],
    [-2, -2],
  ];

  for (const [colStep, rowStep] of steps) {
    const targetCol = col + colStep;
    const targetRow = row + rowStep;
    const eyeCol = col + colStep / 2;
    const eyeRow = row + rowStep / 2;
    if (
      isInside(targetCol, targetRow) &&
      isInside(eyeCol, eyeRow) &&
      !board[indexOf(eyeCol, eyeRow)]
    ) {
      const target = board[indexOf(targetCol, targetRow)];
      if (!target || target.color !== color) {
        if (color === 'red' ? targetRow >= eye : targetRow <= eye) {
          destinations.push({ col: targetCol, row: targetRow });
        }
      }
    }
  }
}

function collectAdvisorMoves(
  from: XiangqiPosition,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  const { col, row } = from;
  const steps: [number, number][] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (const [colStep, rowStep] of steps) {
    const targetCol = col + colStep;
    const targetRow = row + rowStep;
    if (isInsidePalace(targetCol, targetRow, color)) {
      destinations.push({ col: targetCol, row: targetRow });
    }
  }
}

function collectKingMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  const { col, row } = from;
  const steps: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const [colStep, rowStep] of steps) {
    const targetCol = col + colStep;
    const targetRow = row + rowStep;
    if (isInsidePalace(targetCol, targetRow, color)) {
      destinations.push({ col: targetCol, row: targetRow });
    }
  }
}

function collectPawnMoves(
  board: XiangqiBoard,
  from: XiangqiPosition,
  color: XiangqiColor,
  destinations: XiangqiPosition[],
) {
  const { col, row } = from;
  const forwardStep = color === 'red' ? -1 : 1;
  const crossed = color === 'red' ? row < 5 : row > 4;
  const forwardRow = row + forwardStep;

  if (isInside(col, forwardRow)) {
    destinations.push({ col, row: forwardRow });
  }
  if (crossed) {
    if (col > 0) {
      destinations.push({ col: col - 1, row });
    }
    if (col < XIANGQI_COLS - 1) {
      destinations.push({ col: col + 1, row });
    }
  }
}

function canMoveTo(board: XiangqiBoard, from: XiangqiPosition, to: XiangqiPosition): boolean {
  const piece = getXiangqiPiece(board, from);
  if (!piece) {
    return false;
  }
  const target = getXiangqiPiece(board, to);
  return !target || target.color !== piece.color;
}

function findRookAttack(
  board: XiangqiBoard,
  col: number,
  row: number,
  byColor: XiangqiColor,
  type: XiangqiPieceType,
): boolean {
  const directions: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const [rowStep, colStep] of directions) {
    let nextRow = row + rowStep;
    let nextCol = col + colStep;
    let seen = 0;
    while (isInside(nextCol, nextRow)) {
      const piece = board[indexOf(nextCol, nextRow)];
      if (piece) {
        seen += 1;
        if (seen === 1) {
          if (piece.color === byColor && piece.type === type) {
            return true;
          }
          nextRow += rowStep;
          nextCol += colStep;
          continue;
        }
        if (piece.color === byColor && piece.type === type) {
          return true;
        }
        break;
      }
      nextRow += rowStep;
      nextCol += colStep;
    }
  }
  return false;
}

function findCannonAttack(
  board: XiangqiBoard,
  col: number,
  row: number,
  byColor: XiangqiColor,
): boolean {
  const directions: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (const [rowStep, colStep] of directions) {
    let nextRow = row + rowStep;
    let nextCol = col + colStep;
    let screen = 0;
    while (isInside(nextCol, nextRow)) {
      if (nextCol === col && nextRow === row) {
        nextRow += rowStep;
        nextCol += colStep;
        continue;
      }
      const piece = board[indexOf(nextCol, nextRow)];
      if (piece) {
        screen += 1;
        if (screen === 1) {
          nextRow += rowStep;
          nextCol += colStep;
          continue;
        }
        if (piece.color === byColor && piece.type === 'C') {
          return true;
        }
        break;
      }
      nextRow += rowStep;
      nextCol += colStep;
    }
  }
  return false;
}

function findHorseAttack(
  board: XiangqiBoard,
  col: number,
  row: number,
  byColor: XiangqiColor,
): boolean {
  const steps: [number, number, number, number][] = [
    [2, 1, 1, 0],
    [2, -1, 1, 0],
    [-2, 1, -1, 0],
    [-2, -1, -1, 0],
    [1, 2, 0, 1],
    [-1, 2, 0, 1],
    [1, -2, 0, -1],
    [-1, -2, 0, -1],
  ];

  for (const [colStep, rowStep, legColStep, legRowStep] of steps) {
    const legCol = col + legColStep;
    const legRow = row + legRowStep;
    if (!isInside(legCol, legRow) || board[indexOf(legCol, legRow)]) {
      continue;
    }
    const horseCol = col + colStep;
    const horseRow = row + rowStep;
    const horse = isInside(horseCol, horseRow)
      ? board[indexOf(horseCol, horseRow)]
      : null;
    if (horse?.color === byColor && horse.type === 'H') {
      return true;
    }
  }
  return false;
}

function findPawnAttack(
  board: XiangqiBoard,
  col: number,
  row: number,
  byColor: XiangqiColor,
): boolean {
  const forwardRow = byColor === 'red' ? row + 1 : row - 1;
  const candidate: XiangqiPosition[] = [{ col, row: forwardRow }];

  if (byColor === 'red' ? row >= 5 : row <= 4) {
    candidate.push({ col: col - 1, row }, { col: col + 1, row });
  }

  return candidate.some((position) => {
    if (!isInside(position.col, position.row)) {
      return false;
    }
    const piece = board[indexOf(position.col, position.row)];
    return piece?.color === byColor && piece.type === 'P';
  });
}

function findKingAttack(
  board: XiangqiBoard,
  col: number,
  row: number,
  byColor: XiangqiColor,
): boolean {
  for (let nextRow = row + 1; nextRow < XIANGQI_ROWS; nextRow += 1) {
    const piece = board[indexOf(col, nextRow)];
    if (piece) {
      if (piece.color === byColor && piece.type === 'K') {
        return true;
      }
      break;
    }
  }
  for (let nextRow = row - 1; nextRow >= 0; nextRow -= 1) {
    const piece = board[indexOf(col, nextRow)];
    if (piece) {
      if (piece.color === byColor && piece.type === 'K') {
        return true;
      }
      break;
    }
  }
  return false;
}

function isInsidePalace(col: number, row: number, color: XiangqiColor): boolean {
  if (col < 3 || col > 5) {
    return false;
  }
  return color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

function opponent(color: XiangqiColor): XiangqiColor {
  return color === 'red' ? 'black' : 'red';
}

function isInside(col: number, row: number): boolean {
  return col >= 0 && col < XIANGQI_COLS && row >= 0 && row < XIANGQI_ROWS;
}

function indexOf(col: number, row: number): number {
  return row * XIANGQI_COLS + col;
}

function toChineseNumber(value: number): string {
  return ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][value] ?? String(value);
}
