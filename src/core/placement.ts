import { BLOCKS, BlockId } from './blocks';
import type { World } from './world';

type Cell = [number, number, number];

const FACE_OFFSETS: Cell[] = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

export function canPlace(world: World, cell: Cell, occupied: Cell[]): boolean {
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
