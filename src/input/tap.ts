import type { BlockId } from '../core/blocks';
import type { Cell } from '../core/pathfind';
import { canCollect, canPlace, withinReach } from '../core/placement';
import type { World } from '../core/world';

/** What a quick tap does (spec §7a): walk or build. A tap never digs. */
export type TapIntent =
  | { kind: 'walk'; to: Cell }
  | { kind: 'place'; cell: Cell }
  | { kind: 'none' };

/** What a press and hold does (spec §7a): dig it, walk next to it, or nothing. */
export type HoldIntent =
  | { kind: 'dig'; cell: Cell }
  /** Too far: the game walks to a standable cell beside `block` (never on top of it). */
  | { kind: 'walkNear'; block: Cell }
  | { kind: 'none' };

const frontOf = ({ cell: c, normal: n }: { cell: Cell; normal: Cell }): Cell => [c[0] + n[0], c[1] + n[1], c[2] + n[2]];

/**
 * Quick tap. With the hand: walk to the cell in front of the tapped face (the game then
 * picks the reachable standable cell nearest it, so trees, water and walls walk to a spot
 * beside them). With a block: build on the tapped face if it is within reach and there is
 * room, otherwise walk there.
 */
export function resolveTap(
  hit: { cell: Cell; normal: Cell } | null,
  selected: BlockId | 'hand',
  playerFeet: Cell,
  world: World,
  occupied: Cell[],
): TapIntent {
  if (!hit) return { kind: 'none' };
  const front = frontOf(hit);
  if (selected !== 'hand' && withinReach(playerFeet, hit.cell) && canPlace(world, front, occupied)) {
    return { kind: 'place', cell: front };
  }
  return { kind: 'walk', to: front };
}

/**
 * Press and hold, whichever slot is selected. Blocks that can't be dug (air, water, bedrock,
 * the block under his or Pip's feet) give none, so the ring never starts. A diggable block
 * within reach (3, Chebyshev from the feet cell) digs; one further away walks beside it.
 */
export function resolveHold(
  hit: { cell: Cell; normal: Cell } | null,
  playerFeet: Cell,
  world: World,
  occupied: Cell[],
): HoldIntent {
  if (!hit) return { kind: 'none' };
  const [x, y, z] = hit.cell;
  if (!world.inBounds(x, y, z) || !canCollect(world, hit.cell)) return { kind: 'none' };
  const standers = [playerFeet, ...occupied];
  if (standers.some(([sx, sy, sz]) => sx === x && sy === y + 1 && sz === z)) return { kind: 'none' };
  if (!withinReach(playerFeet, hit.cell)) return { kind: 'walkNear', block: hit.cell };
  return { kind: 'dig', cell: hit.cell };
}

export function createDebouncer(ms = 150): (key: string, now: number) => boolean {
  const lastAllowed = new Map<string, number>();
  return (key, now) => {
    const last = lastAllowed.get(key);
    if (last !== undefined && now - last < ms) return false;
    lastAllowed.set(key, now);
    return true;
  };
}
