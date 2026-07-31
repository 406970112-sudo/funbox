export type GameArtworkKind =
  | 'snake'
  | 'gomoku'
  | 'tetris'
  | 'brick-breaker'
  | 'fallback';

export function getGameArtworkKind(gameId: string): GameArtworkKind {
  switch (gameId) {
    case 'snake-brawl':
      return 'snake';
    case 'gomoku':
      return 'gomoku';
    case 'tetris':
      return 'tetris';
    case 'brick-breaker':
      return 'brick-breaker';
    default:
      return 'fallback';
  }
}
