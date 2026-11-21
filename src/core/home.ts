import { BLOCKS, BlockId } from './blocks';
import { insideWall } from './bounds';
import { canStep, isStandable, settleCell, type Cell } from './pathfind';
import type { WorldCells } from './shifted';
import type { Rect, VillageLayout } from './village';

/** The Home button shows from this many blocks below the ground and goes away again at DEEP_EXIT. */
export const DEEP_ENTER = 7;
export const DEEP_EXIT = 5;
/** The ground is read this far out from his column (so a roof over him, a tower or a dug shaft never counts as ground). */
export const GROUND_RING = 4;
/** How far the Home lift looks for open ground around his column. */
export const HOME_RADIUS = 24;

/** All the Home lift and the way home need of the caves: the mouths' outer (surface) cells. */
export interface HomeCaves { mouths: ReadonlyArray<{ cell: Cell }> }

const RING: ReadonlyArray<readonly [number, number]> = [
  [GROUND_RING, 0], [-GROUND_RING, 0], [0, GROUND_RING], [0, -GROUND_RING],
  [GROUND_RING, GROUND_RING], [GROUND_RING, -GROUND_RING], [-GROUND_RING, GROUND_RING], [-GROUND_RING, -GROUND_RING],
];

/**
 * The standing height of the open ground around a column: the lowest top-of-column among eight
 * points GROUND_RING blocks out. Lowest, so a hillside beside him or a house he stands in never
 * makes the ground seem higher than it is; ringed, so the shaft he dug (or a tower he stands in)
 * still reads the meadow round it. NaN when every ring point is outside the world.
 */
export function groundLevel(world: WorldCells, x: number, z: number): number {
  let best = Infinity;
  for (const [dx, dz] of RING) {
    const top = world.topSolidY(x + dx, z + dz);
    if (top >= 0) best = Math.min(best, top + 1);
  }
  return best === Infinity ? NaN : best;
}

/** Blocks between his feet and the ground around him (0 or less on the surface). */
export function depthBelowGround(world: WorldCells, feet: Cell): number {
  const g = groundLevel(world, feet[0], feet[2]);
  return Number.isFinite(g) ? g - feet[1] : 0;
}

/** Deep from DEEP_ENTER blocks below the ground, and stays deep until he is back within DEEP_EXIT. */
export function isDeep(world: WorldCells, feet: Cell, wasDeep: boolean): boolean {
  const d = depthBelowGround(world, feet);
  return wasDeep ? d > DEEP_EXIT : d >= DEEP_ENTER;
}

const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Ground he must never be lifted onto: tree tops, roofs, crops and water. */
const NOT_GROUND: ReadonlySet<BlockId> = new Set([
  BlockId.Wood, BlockId.Leaves, BlockId.AppleLeaves, BlockId.RoofTile, BlockId.Water, BlockId.Farmland, BlockId.Fence,
]);

/** Open, standable, sky-above ground at the top of a column, or null. */
function openTop(world: WorldCells, x: number, z: number, avoid: readonly Rect[]): Cell | null {
  if (!insideWall(world, x, z) || avoid.some(r => inRect(r, x, z))) return null;
  const top = world.topSolidY(x, z);
  if (top < 0) return null;
  const ground = world.get(x, top, z);
  if (NOT_GROUND.has(ground) || !BLOCKS[ground].solid) return null;
  const cell: Cell = [x, top + 1, z];
  // The floor of a shaft is "open to the sky" too: a spot that would still count as deep is not home.
  return isStandable(world, cell) && depthBelowGround(world, cell) <= DEEP_EXIT ? cell : null;
}

/**
 * Where the Home lift puts him: the nearest open surface cell (sky above, standable, not a tree top,
 * roof, crop bed or water, not inside a house or the farm beds, nor any extra rectangle such as the
 * tower) within HOME_RADIUS of his column; ties go to the smaller height change. If there is none,
 * the nearest cave mouth's outer cell; if there is none, `fallback` (the spawn).
 */
export function homeSpot(
  world: WorldCells, feet: Cell, caves: HomeCaves, village: VillageLayout | null,
  fallback: Cell, extraAvoid: readonly Rect[] = [],
): Cell {
  const [px, py, pz] = feet;
  const avoid: Rect[] = [...extraAvoid];
  if (village) avoid.push(...village.houses.map(h => h.rect), ...village.farm.beds);
  let best: Cell | null = null;
  let bestDist = Infinity;
  let bestDy = Infinity;
  for (let r = 0; r <= HOME_RADIUS; r++) {
    // Every cell of ring r is at least r away, so stop once nothing can beat the best.
    if (best && r > bestDist) break;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cell = openTop(world, px + dx, pz + dz, avoid);
        if (!cell) continue;
        const dist = Math.hypot(dx, dz);
        const dy = Math.abs(cell[1] - py);
        if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && dy < bestDy)) {
          best = cell;
          bestDist = dist;
          bestDy = dy;
        }
      }
    }
  }
  if (best) return best;
  // Every way out must be safe: standable (free body, solid floor) and not deep.
  const safe = (c: Cell): boolean => isStandable(world, c) && depthBelowGround(world, c) <= DEEP_EXIT;
  let mouth: Cell | null = null;
  let mouthDist = Infinity;
  for (const { cell: m } of caves.mouths) {
    const d = Math.hypot(m[0] - px, m[2] - pz);
    if (d < mouthDist && safe(m)) { mouth = m; mouthDist = d; }
  }
  if (mouth) return [...mouth];
  if (safe(fallback)) return [...fallback];
  // The spawn is blocked (he built there): the nearest safe cell to it, first on its own top, then settled.
  const top: Cell = [fallback[0], world.topSolidY(fallback[0], fallback[2]) + 1, fallback[2]];
  if (safe(top)) return top;
  const settled = settleCell(world, fallback);
  if (safe(settled)) return settled;
  // Last resort: the nearest column top anywhere that is standable and not deep (rings out from the spawn).
  const maxR = Math.max(world.sizeX, world.sizeZ);
  for (let r = 1; r <= maxR; r++) {
    let pick: Cell | null = null;
    let pickD = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = fallback[0] + dx, z = fallback[2] + dz;
        if (!world.inBounds(x, 0, z)) continue;
        const c: Cell = [x, world.topSolidY(x, z) + 1, z];
        const d = Math.hypot(dx, dz);
        if (d < pickD && safe(c)) { pick = c; pickD = d; }
      }
    }
    if (pick) return pick;
  }
  return settled; // a world with no open, standable ground at all: the safest body cell there is
}

/**
 * The way home on foot: a breadth-first walk with ordinary steps only (no drops, so every step can
 * be walked back) from `from` to the nearest cave mouth. null when there is no mouth or no way.
 * The cave tasks give it the trail to follow; with no caves it simply finds the nearest mouth.
 */
export function routeHome(world: WorldCells, from: Cell, caves: HomeCaves, maxNodes = 60_000): Cell[] | null {
  if (caves.mouths.length === 0 || !isStandable(world, from)) return null;
  const sx = world.sizeX, sxz = world.sizeX * world.sizeZ;
  const key = (c: Cell): number => c[0] + sx * c[2] + sxz * c[1];
  const goals = new Set(caves.mouths.map(m => key(m.cell)));
  const parent = new Map<number, number>([[key(from), -1]]);
  const cells = new Map<number, Cell>([[key(from), [...from]]]);
  const queue: number[] = [key(from)];
  const allowed = (c: Cell): boolean => insideWall(world, c[0], c[2]);
  for (let head = 0; head < queue.length && queue.length < maxNodes; head++) {
    const k = queue[head];
    const cur = cells.get(k)!;
    if (goals.has(k)) {
      const path: Cell[] = [];
      for (let at = k; at !== key(from); at = parent.get(at)!) path.push(cells.get(at)!);
      return path.reverse();
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1, -1]) {
        const next: Cell = [cur[0] + dx, cur[1] + dy, cur[2] + dz];
        const nk = key(next);
        if (parent.has(nk) || !canStep(world, cur, next, allowed)) continue;
        parent.set(nk, k);
        cells.set(nk, next);
        queue.push(nk);
      }
    }
  }
  return null;
}
