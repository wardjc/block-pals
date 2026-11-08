import { BLOCKS, BlockId, isCarriable } from './blocks';
import type { Cell } from './pathfind';
import type { World } from './world';

const FACE_OFFSETS: Cell[] = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

/** `placing`, when given, is the block being placed: plants and other world-only blocks are refused. */
export function canPlace(world: World, cell: Cell, occupied: Cell[], placing?: BlockId): boolean {
  if (placing !== undefined && !isCarriable(placing)) return false;
  const [x, y, z] = cell;
  if (!world.inBounds(x, y, z)) return false;
  const id = world.get(x, y, z);
  if (id !== BlockId.Air && id !== BlockId.Water) return false;
  if (occupied.some(([cx, cy, cz]) => cx === x && cy === y && cz === z)) return false;
  return FACE_OFFSETS.some(([dx, dy, dz]) => BLOCKS[world.get(x + dx, y + dy, z + dz)].solid);
}

export function canCollect(world: World, cell: Cell): boolean {
  return BLOCKS[world.get(...cell)].collectable;
}

export function withinReach(from: Cell, cell: Cell, reach = 3): boolean {
  return Math.max(
    Math.abs(from[0] - cell[0]),
    Math.abs(from[1] - cell[1]),
    Math.abs(from[2] - cell[2]),
  ) <= reach;
}

/**
 * Reach for picking (press and hold). Ripe apples hang four blocks up a full tree, so they are
 * picked from the ground: an apple counts from eye height (one block higher than the feet).
 */
export function withinPickReach(world: World, from: Cell, cell: Cell): boolean {
  if (world.get(...cell) === BlockId.AppleLeaves) return withinReach([from[0], from[1] + 1, from[2]], cell);
  return withinReach(from, cell);
}
