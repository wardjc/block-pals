import { BlockId } from '../core/blocks';
import type { Cell } from '../core/pathfind';
import { canCollect, canPlace, withinReach } from '../core/placement';
import type { World } from '../core/world';

export type TapIntent =
  | { kind: 'walk'; to: Cell }
  | { kind: 'collect'; cell: Cell }
  | { kind: 'place'; cell: Cell }
  | { kind: 'none' };

/**
 * "Tap to go, tap next to you to dig" (Task 7 amendment, final review).
 * With the hand selected a hit is collected when it is
 *   - the top of a block right next to the feet (Chebyshev <= 1 from the feet column, one level down), or
 *   - a tree block (wood or leaves) within reach, or
 *   - a side or bottom face within reach;
 * every other hit walks. A walk goes to the cell in front of the tapped face; the
 * game then picks the reachable standable cell nearest to it (so trees, water and
 * walls still walk to a spot beside them).
 */
export function resolveTap(
  hit: { cell: Cell; normal: Cell } | null,
  selected: BlockId | 'hand',
  playerFeet: Cell,
  world: World,
  occupied: Cell[],
): TapIntent {
  if (!hit) return { kind: 'none' };
  const { cell: c, normal: n } = hit;
  const front: Cell = [c[0] + n[0], c[1] + n[1], c[2] + n[2]];
  const inReach = withinReach(playerFeet, c);
  if (selected === 'hand') {
    if (inReach && canCollect(world, c) && handCollects(hit, playerFeet, world)) return { kind: 'collect', cell: c };
  } else if (inReach && canPlace(world, front, occupied)) {
    return { kind: 'place', cell: front };
  }
  return { kind: 'walk', to: front };
}

function handCollects({ cell, normal }: { cell: Cell; normal: Cell }, feet: Cell, world: World): boolean {
  const id = world.get(...cell);
  if (id === BlockId.Wood || id === BlockId.Leaves) return true;
  const topFace = normal[0] === 0 && normal[1] === 1 && normal[2] === 0;
  if (!topFace) return true;
  return Math.max(Math.abs(cell[0] - feet[0]), Math.abs(cell[2] - feet[2])) <= 1 && cell[1] === feet[1] - 1;
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
