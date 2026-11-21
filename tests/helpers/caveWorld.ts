import { BLOCKS } from '../../src/core/blocks';
import { cellIndex, cellOf, floodWalk, type CaveLayout, type Flood } from '../../src/core/caves';
import type { Cell } from '../../src/core/pathfind';
import type { World } from '../../src/core/world';
import { generateWorld, type GeneratedWorld } from '../../src/core/worldgen';

/** The four seeds every cave test runs on (plan Tasks 13 to 18). */
export const SEEDS = [2026, 1, 7, 99] as const;

const cache = new Map<number, { g: GeneratedWorld; ms: number }>();

/** The generated world for a seed, made once per test file. */
export function caveWorld(seed: number): GeneratedWorld {
  return timedCaveWorld(seed).g;
}

export function timedCaveWorld(seed: number): { g: GeneratedWorld; ms: number } {
  let hit = cache.get(seed);
  if (!hit) {
    const t0 = performance.now();
    const g = generateWorld(seed);
    hit = { g, ms: performance.now() - t0 };
    cache.set(seed, hit);
  }
  return hit;
}

/** 1 for every carved cell that is still air. */
export function airMask(world: World, caves: CaveLayout): Uint8Array {
  const m = new Uint8Array(world.sizeX * world.sizeY * world.sizeZ);
  for (const i of caves.airCells) m[i] = 1;
  return m;
}

const inRect = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): boolean =>
  x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * Walks on foot (ordinary steps, no drops) from `starts` through the caves: carved air, and the
 * mouths' own columns above the old ground (the open trench).
 */
export function walkCaves(world: World, caves: CaveLayout, starts: readonly Cell[], extra: (c: Cell) => boolean = () => false): Flood {
  const air = airMask(world, caves);
  return floodWalk(world, starts, i => {
    if (air[i]) return true;
    const c = cellOf(world, i);
    return caves.mouths.some(m => inRect(m.rect, c[0], c[2]) && c[1] >= m.ramp[m.ramp.length - 1][1]) || extra(c);
  }, 2_000_000);
}

export const reached = (world: World, flood: Flood, c: Cell): boolean => flood.parent.has(cellIndex(world, c[0], c[1], c[2]));

/** The feet floor of a column inside a y band: the lowest air cell with a solid block under it, or -1. */
export function floorIn(world: World, air: Uint8Array, x: number, z: number, y0: number, y1: number): number {
  for (let y = y0; y <= y1; y++) {
    const i = cellIndex(world, x, y, z);
    if (air[i] && BLOCKS[world.get(x, y - 1, z)].solid) return y;
  }
  return -1;
}
