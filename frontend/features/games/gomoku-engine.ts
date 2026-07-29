export const GOMOKU_BOARD_SIZE = 15;

export type Stone = 'black' | 'white';
export type Cell = Stone | null;
export type GomokuBoard = Cell[];
export type GomokuDifficulty = 'easy' | 'medium' | 'hard';
export type GomokuPosition = {
  col: number;
  row: number;
};
export type GomokuMove = GomokuPosition & {
  stone: Stone;
};

type DifficultyConfig = {
  candidateLimit: number;
  candidateRadius: number;
  randomPool: number;
  searchDepth: number;
  timeBudgetMs: number;
};

type AiOptions = {
  aiStone?: Stone;
  now?: () => number;
  random?: () => number;
};

type RankedMove = GomokuPosition & {
  score: number;
};

const WIN_SCORE = 100_000_000;
const DIRECTIONS = [
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: 1, row: 1 },
  { col: 1, row: -1 },
] as const;

const DIFFICULTY_CONFIG: Record<GomokuDifficulty, DifficultyConfig> = {
  easy: {
    candidateLimit: 12,
    candidateRadius: 1,
    randomPool: 8,
    searchDepth: 0,
    timeBudgetMs: 60,
  },
  medium: {
    candidateLimit: 12,
    candidateRadius: 2,
    randomPool: 3,
    searchDepth: 1,
    timeBudgetMs: 220,
  },
  hard: {
    candidateLimit: 10,
    candidateRadius: 2,
    randomPool: 1,
    searchDepth: 3,
    timeBudgetMs: 650,
  },
};

export function createEmptyGomokuBoard(): GomokuBoard {
  return Array<Cell>(GOMOKU_BOARD_SIZE * GOMOKU_BOARD_SIZE).fill(null);
}

export function getBoardIndex(row: number, col: number): number {
  return row * GOMOKU_BOARD_SIZE + col;
}

export function getBoardCell(board: GomokuBoard, row: number, col: number): Cell {
  if (!isInsideBoard(row, col)) {
    return null;
  }

  return board[getBoardIndex(row, col)];
}

export function placeStone(
  board: GomokuBoard,
  position: GomokuPosition,
  stone: Stone,
): GomokuBoard | null {
  if (!isInsideBoard(position.row, position.col)) {
    return null;
  }

  const index = getBoardIndex(position.row, position.col);

  if (board[index] !== null) {
    return null;
  }

  const nextBoard = [...board];
  nextBoard[index] = stone;
  return nextBoard;
}

export function buildBoardFromMoves(moves: GomokuMove[]): GomokuBoard {
  const board = createEmptyGomokuBoard();

  for (const move of moves) {
    board[getBoardIndex(move.row, move.col)] = move.stone;
  }

  return board;
}

export function getWinningLine(
  board: GomokuBoard,
  position: GomokuPosition,
): GomokuPosition[] {
  const stone = getBoardCell(board, position.row, position.col);

  if (!stone) {
    return [];
  }

  for (const direction of DIRECTIONS) {
    const before = collectDirection(board, position, stone, -direction.row, -direction.col);
    const after = collectDirection(board, position, stone, direction.row, direction.col);
    const line = [...before.reverse(), position, ...after];

    if (line.length >= 5) {
      return line;
    }
  }

  return [];
}

export function isBoardFull(board: GomokuBoard): boolean {
  return board.every((cell) => cell !== null);
}

export function chooseAiMove(
  board: GomokuBoard,
  difficulty: GomokuDifficulty,
  options: AiOptions = {},
): GomokuPosition | null {
  const aiStone = options.aiStone ?? 'white';
  const humanStone = getOpponent(aiStone);
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const config = DIFFICULTY_CONFIG[difficulty];
  const candidates = getCandidateMoves(board, config.candidateRadius);

  if (candidates.length === 0) {
    return null;
  }

  const winningMove = findImmediateMove(board, candidates, aiStone);

  if (winningMove) {
    return winningMove;
  }

  const blockingMove = findImmediateMove(board, candidates, humanStone);

  if (blockingMove && (difficulty !== 'easy' || random() < 0.72)) {
    return blockingMove;
  }

  const rankedMoves = rankMoves(
    board,
    aiStone,
    humanStone,
    candidates,
    config.candidateLimit,
  );

  if (difficulty === 'easy') {
    return chooseFromPool(rankedMoves, config.randomPool, random);
  }

  if (difficulty === 'medium') {
    if (random() < 0.82) {
      return toPosition(rankedMoves[0]);
    }

    return (
      chooseFromPool(rankedMoves.slice(1), config.randomPool - 1, random) ??
      toPosition(rankedMoves[0])
    );
  }

  return chooseHardMove(board, rankedMoves, aiStone, humanStone, config, now);
}

function chooseHardMove(
  board: GomokuBoard,
  rankedMoves: RankedMove[],
  aiStone: Stone,
  humanStone: Stone,
  config: DifficultyConfig,
  now: () => number,
): GomokuPosition | null {
  if (rankedMoves.length === 0) {
    return null;
  }

  const deadline = now() + config.timeBudgetMs;
  let alpha = Number.NEGATIVE_INFINITY;
  let bestMove: GomokuPosition = toPosition(rankedMoves[0])!;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const move of rankedMoves) {
    if (now() >= deadline) {
      break;
    }

    const nextBoard = placeStone(board, move, aiStone);

    if (!nextBoard) {
      continue;
    }

    const score = minimax(
      nextBoard,
      config.searchDepth - 1,
      false,
      alpha,
      Number.POSITIVE_INFINITY,
      aiStone,
      humanStone,
      deadline,
      now,
      move,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMove = toPosition(move)!;
    }

    alpha = Math.max(alpha, bestScore);
  }

  return bestMove;
}

function minimax(
  board: GomokuBoard,
  depth: number,
  maximizing: boolean,
  alphaValue: number,
  betaValue: number,
  aiStone: Stone,
  humanStone: Stone,
  deadline: number,
  now: () => number,
  lastMove: GomokuPosition,
): number {
  const winningLine = getWinningLine(board, lastMove);

  if (winningLine.length >= 5) {
    const winner = getBoardCell(board, lastMove.row, lastMove.col);
    return winner === aiStone ? WIN_SCORE + depth : -WIN_SCORE - depth;
  }

  if (depth <= 0 || isBoardFull(board) || now() >= deadline) {
    return evaluateBoard(board, aiStone, humanStone);
  }

  const currentStone = maximizing ? aiStone : humanStone;
  const opponentStone = maximizing ? humanStone : aiStone;
  const candidateLimit = depth >= 2 ? 8 : 6;
  const moves = rankMoves(
    board,
    currentStone,
    opponentStone,
    getCandidateMoves(board, 2),
    candidateLimit,
  );

  if (maximizing) {
    let value = Number.NEGATIVE_INFINITY;
    let alpha = alphaValue;

    for (const move of moves) {
      const nextBoard = placeStone(board, move, currentStone);

      if (!nextBoard) {
        continue;
      }

      value = Math.max(
        value,
        minimax(
          nextBoard,
          depth - 1,
          false,
          alpha,
          betaValue,
          aiStone,
          humanStone,
          deadline,
          now,
          move,
        ),
      );
      alpha = Math.max(alpha, value);

      if (alpha >= betaValue || now() >= deadline) {
        break;
      }
    }

    return value;
  }

  let value = Number.POSITIVE_INFINITY;
  let beta = betaValue;

  for (const move of moves) {
    const nextBoard = placeStone(board, move, currentStone);

    if (!nextBoard) {
      continue;
    }

    value = Math.min(
      value,
      minimax(
        nextBoard,
        depth - 1,
        true,
        alphaValue,
        beta,
        aiStone,
        humanStone,
        deadline,
        now,
        move,
      ),
    );
    beta = Math.min(beta, value);

    if (alphaValue >= beta || now() >= deadline) {
      break;
    }
  }

  return value;
}

function evaluateBoard(board: GomokuBoard, aiStone: Stone, humanStone: Stone): number {
  const candidates = getCandidateMoves(board, 2);
  const aiMoves = rankMoves(board, aiStone, humanStone, candidates, 2);
  const humanMoves = rankMoves(board, humanStone, aiStone, candidates, 2);
  const aiScore = aiMoves[0]?.score ?? 0;
  const humanScore = humanMoves[0]?.score ?? 0;

  return aiScore - humanScore * 1.06;
}

function rankMoves(
  board: GomokuBoard,
  stone: Stone,
  opponent: Stone,
  candidates: GomokuPosition[],
  limit: number,
): RankedMove[] {
  const center = (GOMOKU_BOARD_SIZE - 1) / 2;

  return candidates
    .map((position) => {
      const attackScore = evaluatePlacement(board, position, stone);
      const defenseScore = evaluatePlacement(board, position, opponent);
      const centerDistance = Math.abs(position.row - center) + Math.abs(position.col - center);

      return {
        ...position,
        score: attackScore + defenseScore * 1.08 + (GOMOKU_BOARD_SIZE - centerDistance),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function evaluatePlacement(
  board: GomokuBoard,
  position: GomokuPosition,
  stone: Stone,
): number {
  if (getBoardCell(board, position.row, position.col) !== null) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  for (const direction of DIRECTIONS) {
    const forward = inspectDirection(board, position, stone, direction.row, direction.col);
    const backward = inspectDirection(board, position, stone, -direction.row, -direction.col);
    const count = 1 + forward.count + backward.count;
    const openEnds = Number(forward.open) + Number(backward.open);

    score += scoreLine(count, openEnds);
  }

  return score;
}

function inspectDirection(
  board: GomokuBoard,
  position: GomokuPosition,
  stone: Stone,
  rowStep: number,
  colStep: number,
): { count: number; open: boolean } {
  let count = 0;
  let row = position.row + rowStep;
  let col = position.col + colStep;

  while (isInsideBoard(row, col) && getBoardCell(board, row, col) === stone) {
    count += 1;
    row += rowStep;
    col += colStep;
  }

  return {
    count,
    open: isInsideBoard(row, col) && getBoardCell(board, row, col) === null,
  };
}

function scoreLine(count: number, openEnds: number): number {
  if (count >= 5) {
    return WIN_SCORE;
  }

  if (count === 4) {
    return openEnds === 2 ? 5_000_000 : openEnds === 1 ? 700_000 : 0;
  }

  if (count === 3) {
    return openEnds === 2 ? 110_000 : openEnds === 1 ? 12_000 : 0;
  }

  if (count === 2) {
    return openEnds === 2 ? 4_000 : openEnds === 1 ? 450 : 0;
  }

  return openEnds === 2 ? 70 : openEnds === 1 ? 12 : 0;
}

function findImmediateMove(
  board: GomokuBoard,
  candidates: GomokuPosition[],
  stone: Stone,
): GomokuPosition | null {
  for (const candidate of candidates) {
    const nextBoard = placeStone(board, candidate, stone);

    if (nextBoard && getWinningLine(nextBoard, candidate).length >= 5) {
      return candidate;
    }
  }

  return null;
}

function getCandidateMoves(board: GomokuBoard, radius: number): GomokuPosition[] {
  const occupiedIndexes: number[] = [];

  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) {
      occupiedIndexes.push(index);
    }
  }

  if (occupiedIndexes.length === 0) {
    const center = Math.floor(GOMOKU_BOARD_SIZE / 2);
    return [{ col: center, row: center }];
  }

  const candidateIndexes = new Set<number>();

  for (const index of occupiedIndexes) {
    const row = Math.floor(index / GOMOKU_BOARD_SIZE);
    const col = index % GOMOKU_BOARD_SIZE;

    for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
      for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
        const candidateRow = row + rowOffset;
        const candidateCol = col + colOffset;

        if (
          isInsideBoard(candidateRow, candidateCol) &&
          getBoardCell(board, candidateRow, candidateCol) === null
        ) {
          candidateIndexes.add(getBoardIndex(candidateRow, candidateCol));
        }
      }
    }
  }

  return [...candidateIndexes].map((index) => ({
    col: index % GOMOKU_BOARD_SIZE,
    row: Math.floor(index / GOMOKU_BOARD_SIZE),
  }));
}

function collectDirection(
  board: GomokuBoard,
  position: GomokuPosition,
  stone: Stone,
  rowStep: number,
  colStep: number,
): GomokuPosition[] {
  const positions: GomokuPosition[] = [];
  let row = position.row + rowStep;
  let col = position.col + colStep;

  while (isInsideBoard(row, col) && getBoardCell(board, row, col) === stone) {
    positions.push({ col, row });
    row += rowStep;
    col += colStep;
  }

  return positions;
}

function chooseFromPool(
  moves: RankedMove[],
  poolSize: number,
  random: () => number,
): GomokuPosition | null {
  const availablePool = moves.slice(0, Math.max(1, poolSize));

  if (availablePool.length === 0) {
    return null;
  }

  const index = Math.min(availablePool.length - 1, Math.floor(random() * availablePool.length));
  return toPosition(availablePool[index]);
}

function toPosition(position: GomokuPosition | undefined): GomokuPosition | null {
  if (!position) {
    return null;
  }

  return {
    col: position.col,
    row: position.row,
  };
}

function getOpponent(stone: Stone): Stone {
  return stone === 'black' ? 'white' : 'black';
}

function isInsideBoard(row: number, col: number): boolean {
  return row >= 0 && row < GOMOKU_BOARD_SIZE && col >= 0 && col < GOMOKU_BOARD_SIZE;
}
