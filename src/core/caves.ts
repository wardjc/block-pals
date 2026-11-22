import type { Cell } from './pathfind';

/**
 * What the cave generator tells the rest of the game (world coordinates). Chunk B only needs the
 * mouths (the Home lift's fallback, the underground draw rule, the way home); the cave tasks
 * (13 to 18) extend this with rooms, tunnels, the trail, treasure rooms and the ruin.
 */
export interface CaveLayout {
  /** The outer (surface) cell of every cave mouth: a standable cell just outside the doorway. */
  mouths: Cell[];
}

/** The layout of a world with no caves yet. */
export const EMPTY_CAVES: CaveLayout = Object.freeze({ mouths: [] as Cell[] }) as CaveLayout;
