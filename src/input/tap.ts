import { BlockId } from '../core/blocks';
import { nearestStandable, type Cell } from '../core/pathfind';
import { canCollect, canPlace, withinReach } from '../core/placement';
import type { World } from '../core/world';

export type TapIntent =
  | { kind: 'walk'; to: Cell }
  | { kind: 'collect'; cell: Cell }
  | { kind: 'place'; cell: Cell }
  | { kind: 'none' };

export function resolveTap(
  hit: { cell: Cell; normal: Cell } | null,
  selected: BlockId | 'hand',
  playerFeet: Cell,
  world: World,
  occupied: Cell[],
): TapIntent {
  if (!hit) return { kind: 'none' };
  const isWater = world.get(hit.cell[0], hit.cell[1], hit.cell[2]) === BlockId.Water;
  if (!isWater && withinReach(playerFeet, hit.cell)) {
    if (selected === 'hand') {
      if (canCollect(world, hit.cell)) return { kind: 'collect', cell: hit.cell };
    } else {
      const cell: Cell = [
        hit.cell[0] + hit.normal[0],
        hit.cell[1] + hit.normal[1],
        hit.cell[2] + hit.normal[2],
      ];
      if (canPlace(world, cell, occupied)) return { kind: 'place', cell };
    }
  }
  // Trees and water have no standable top: still walk, and let the game find a cell beside it.
  const [x, , z] = hit.cell;
  const to = nearestStandable(world, x, z) ?? [x, world.topSolidY(x, z) + 1, z] as Cell;
  return { kind: 'walk', to };
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
