import { BlockId } from './blocks';
import { ORIGIN, V2_WORLD } from './bounds';
import { coneFloor, sq2 } from './exactMath';
import { mulberry32 } from './rng';
import type { World } from './world';
import { makeHeightAt } from './worldgen';

/** Hills and ponds keep this far (Chebyshev) outside the old rectangle. */
export const OUTER_MARGIN = 6;
/** Trees keep MORE than this far outside the old rectangle. */
const TREE_GAP = 4;
/** The rolling edge: within this many blocks of the world edge the ground rises gently. */
const EDGE_BAND = 7;
const EDGE_RISE = 3;
/** Highest outer ground (the edge hills); hill peaks stay at most HILL_TOP. */
const MAX_GROUND = 60;
const HILL_TOP = 59;

export interface OuterInfo {
  hills: Array<{ x: number; z: number; r: number }>;
  ponds: Array<{ x: number; z: number; r: number }>;
  trees: Array<{ x: number; z: number }>;
}

const OLD = { x0: ORIGIN.x, z0: ORIGIN.z, x1: ORIGIN.x + V2_WORLD.x - 1, z1: ORIGIN.z + V2_WORLD.z - 1 };

/** Inside the old 96 x 96 rectangle (world coordinates), which this stage never touches. */
export function inOldRect(x: number, z: number): boolean {
  return x >= OLD.x0 && x <= OLD.x1 && z >= OLD.z0 && z <= OLD.z1;
}

/** Chebyshev distance from a column to the old rectangle (0 inside). */
function toOld(x: number, z: number): number {
  return Math.max(OLD.x0 - x, 0, x - OLD.x1, OLD.z0 - z, 0, z - OLD.z1);
}

interface Layout {
  hills: Array<{ x: number; z: number; r: number; peak: number }>;
  ponds: Array<{ x: number; z: number; r: number }>;
}

/** Hills and ponds, by rejection from their own stream (`seed ^ 0x0071e2`), at most 200 tries each. */
function layoutOf(seed: number, sizeX: number, sizeZ: number): Layout {
  const random = mulberry32((seed ^ 0x0071e2) >>> 0);
  const placed: Array<{ x: number; z: number; r: number }> = [];
  const fits = (x: number, z: number, r: number): boolean =>
    toOld(x, z) - r >= OUTER_MARGIN
    && x - r >= EDGE_BAND + 2 && z - r >= EDGE_BAND + 2 && x + r <= sizeX - EDGE_BAND - 3 && z + r <= sizeZ - EDGE_BAND - 3
    && placed.every(p => sq2(p.x - x, p.z - z) >= (p.r + r + OUTER_MARGIN) * (p.r + r + OUTER_MARGIN));
  const place = (count: number, rMin: number, rSpan: number): Array<{ x: number; z: number; r: number }> => {
    const out: Array<{ x: number; z: number; r: number }> = [];
    for (let tries = 0; tries < 200 && out.length < count; tries++) {
      const r = rMin + Math.floor(random() * rSpan);
      const x = Math.floor(random() * sizeX);
      const z = Math.floor(random() * sizeZ);
      if (!fits(x, z, r)) continue;
      const p = { x, z, r };
      out.push(p);
      placed.push(p);
    }
    return out;
  };
  const hillCount = 5 + Math.floor(random() * 3);
  const pondCount = 3 + Math.floor(random() * 2);
  // A hill's r is its foot: the cone (slope 0.75) reaches the meadow there.
  const hills = place(hillCount, 6, 4).map(h => ({ ...h, peak: HILL_TOP - Math.floor(random() * 3) }));
  const ponds = place(pondCount, 3, 3);
  return { hills, ponds };
}

/**
 * The natural outer ground (world y) before smoothing and ponds: the old height formula rolling on
 * outward (no seam), the extra hills, and the rolling edge.
 */
function naturalHeight(height: (x: number, z: number) => number, hills: Layout['hills'], sizeX: number, sizeZ: number, x: number, z: number): number {
  let h = height(x - ORIGIN.x, z - ORIGIN.z) + ORIGIN.y;
  for (const hill of hills) h = Math.max(h, coneFloor(hill.peak, 3, 4, sq2(x - hill.x, z - hill.z)));
  const d = Math.min(x, z, sizeX - 1 - x, sizeZ - 1 - z);
  if (d < EDGE_BAND) h += Math.round(EDGE_RISE * (1 - d / EDGE_BAND));
  return Math.min(h, MAX_GROUND);
}

/** World-coordinate outer ground before smoothing (exposed for tests): heightAt(seed, x - 48, z - 48) + 48 + extras. */
export function outerHeight(seed: number, x: number, z: number, sizeX = 192, sizeZ = 192): number {
  return naturalHeight(makeHeightAt(seed), layoutOf(seed, sizeX, sizeZ).hills, sizeX, sizeZ, x, z);
}

const TERRAIN_TOP = (id: BlockId): boolean => id !== BlockId.Air && id !== BlockId.Wood && id !== BlockId.Leaves && id !== BlockId.Water;

/**
 * Stages 2 and 3: the new land around the old rectangle. Writes only columns OUTSIDE the old
 * rectangle (so the old region is untouched): terrain (Grass, 2 Dirt, Stone down to the deep fill),
 * 3 to 4 still ponds, 5 to 7 hills, a rolling edge, then the edge ring and scatter of trees.
 * Every neighbouring pair of outer land columns differs by at most 1, and so does every outer
 * column next to the old edge. Call in bulk mode, after the old region is generated.
 */
export function generateOuter(world: World, seed: number): OuterInfo {
  const { sizeX, sizeZ } = world;
  const n = sizeX * sizeZ;
  const height = makeHeightAt(seed);
  const { hills, ponds } = layoutOf(seed, sizeX, sizeZ);

  // Fixed columns: the old rectangle's edge ring, at its real ground (trees ignored).
  const h = new Int16Array(n);
  const fixed = new Uint8Array(n); // 1 = old rectangle (never written)
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const k = x + sizeX * z;
      if (inOldRect(x, z)) {
        fixed[k] = 1;
        let y = world.sizeY - 1;
        while (y > 0 && !TERRAIN_TOP(world.get(x, y, z))) y--;
        h[k] = y;
      } else {
        h[k] = naturalHeight(height, hills, sizeX, sizeZ, x, z);
      }
    }
  }

  // Lower bound from the old edge (h >= edge - distance) and upper bound (h <= edge + distance):
  // Chebyshev distance transforms seeded by the old edge ring, so the seam steps at most 1.
  const lo = new Int16Array(n).fill(-32768);
  const hi = new Int16Array(n).fill(32767);
  for (let z = 0; z < sizeZ; z++) for (let x = 0; x < sizeX; x++) {
    const k = x + sizeX * z;
    if (fixed[k] && (x === OLD.x0 || x === OLD.x1 || z === OLD.z0 || z === OLD.z1)) { lo[k] = h[k]; hi[k] = h[k]; }
  }
  // 8-neighbour offsets (the caller skips the outermost ring of the world by bounds checks below).
  const OFFS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  /** Raster sweeps both ways until nothing changes (the old rectangle is a hole, so repeat). */
  const relax = (visit: (k: number, m: number) => boolean, skip: Uint8Array): void => {
    for (let iter = 0; iter < 16; iter++) {
      let changed = false;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const k = pass === 0 ? i : n - 1 - i;
          if (skip[k]) continue;
          const x = k % sizeX;
          const z = (k - x) / sizeX;
          for (let o = 0; o < 8; o++) {
            const nx = x + OFFS[o][0];
            const nz = z + OFFS[o][1];
            if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue;
            if (visit(k, nx + sizeX * nz)) changed = true;
          }
        }
      }
      if (!changed) break;
    }
  };
  relax((k, m) => {
    let c = false;
    if (lo[m] - 1 > lo[k]) { lo[k] = lo[m] - 1; c = true; }
    if (hi[m] + 1 < hi[k]) { hi[k] = hi[m] + 1; c = true; }
    return c;
  }, fixed);
  for (let k = 0; k < n; k++) if (!fixed[k]) h[k] = Math.max(lo[k], Math.min(hi[k], h[k]));

  // Ponds: the water top is the lowest ground on the shore ring; shore Sand at that level.
  const pondCell = new Uint8Array(n); // 1 = water, 2 = shore
  const pondTop: number[] = [];
  for (const p of ponds) {
    let top = 32767;
    for (let z = p.z - p.r - 1; z <= p.z + p.r + 1; z++) for (let x = p.x - p.r - 1; x <= p.x + p.r + 1; x++) {
      const d2 = sq2(x - p.x, z - p.z);
      if (d2 > p.r * p.r && d2 <= (p.r + 1) * (p.r + 1)) top = Math.min(top, h[x + sizeX * z]);
    }
    pondTop.push(top);
    for (let z = p.z - p.r - 1; z <= p.z + p.r + 1; z++) for (let x = p.x - p.r - 1; x <= p.x + p.r + 1; x++) {
      const k = x + sizeX * z;
      const d2 = sq2(x - p.x, z - p.z);
      if (d2 <= p.r * p.r) { pondCell[k] = 1; h[k] = top - 2; } else if (d2 <= (p.r + 1) * (p.r + 1)) { pondCell[k] = 2; h[k] = top; }
    }
  }

  // Walkable: every outer land column within 1 of each neighbour. Lowering only (h = min(h, h' + 1)),
  // which keeps h >= lo (lo is itself 1-steep) and never touches the old rectangle or pond water.
  const still = new Uint8Array(n); // never lowered: the old rectangle and pond water
  for (let k = 0; k < n; k++) still[k] = fixed[k] || pondCell[k] === 1 ? 1 : 0;
  relax((k, m) => {
    if (pondCell[m] === 1 || h[m] + 1 >= h[k]) return false;
    h[k] = h[m] + 1;
    return true;
  }, still);

  // Write the columns.
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const k = x + sizeX * z;
      if (fixed[k]) continue;
      const g = h[k];
      const sandy = pondCell[k] !== 0;
      for (let y = ORIGIN.y; y <= g; y++) {
        world.set(x, y, z, y === g ? (sandy ? BlockId.Sand : BlockId.Grass) : y >= g - 2 ? BlockId.Dirt : BlockId.Stone);
      }
    }
  }
  ponds.forEach((p, i) => {
    for (let z = p.z - p.r; z <= p.z + p.r; z++) for (let x = p.x - p.r; x <= p.x + p.r; x++) {
      if (pondCell[x + sizeX * z] !== 1) continue;
      for (let y = pondTop[i] - 1; y <= pondTop[i]; y++) world.set(x, y, z, BlockId.Water);
    }
  });

  // Trees: the edge ring (24 anchors a side) then a scatter of about 70, from their own stream.
  const random = mulberry32((seed ^ 0x7ee5) >>> 0);
  const trees: Array<{ x: number; z: number }> = [];
  const plant = (x: number, z: number): boolean => {
    if (x < 2 || z < 2 || x > sizeX - 3 || z > sizeZ - 3) return false; // canopy inside the soft wall
    if (toOld(x, z) <= TREE_GAP) return false;
    const k = x + sizeX * z;
    if (fixed[k] || pondCell[k] !== 0) return false;
    const g = h[k];
    if (world.get(x, g, z) !== BlockId.Grass || g + 6 >= world.sizeY) return false;
    // Not on a pond bank: no water within the canopy's reach.
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (pondCell[(x + dx) + sizeX * (z + dz)] !== 0) return false;
    if (trees.some(t => Math.max(Math.abs(x - t.x), Math.abs(z - t.z)) < 5)) return false;
    for (let y = g + 1; y <= g + 4; y++) world.set(x, y, z, BlockId.Wood);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = g + 5; y <= g + 6; y++) world.set(x + dx, y, z + dz, BlockId.Leaves);
    trees.push({ x, z });
    return true;
  };
  const last = sizeX - 1;
  const step = (sizeX - 8) / 24;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 24; i++) {
      const along = Math.round(4 + i * step) + Math.floor(random() * 3) - 1;
      const inset = 2 + Math.floor(random() * 3);
      if (side === 0) plant(along, inset);
      if (side === 1) plant(last - inset, along);
      if (side === 2) plant(along, last - inset);
      if (side === 3) plant(inset, along);
    }
  }
  const candidates: Array<[number, number]> = [];
  for (let z = 8; z < sizeZ - 8; z++) for (let x = 8; x < sizeX - 8; x++) if (toOld(x, z) > TREE_GAP) candidates.push([x, z]);
  const target = trees.length + 64 + Math.floor(random() * 13);
  for (let i = candidates.length - 1; i >= 0 && trees.length < target; i--) {
    const chosen = Math.floor(random() * (i + 1));
    const c = candidates[chosen];
    candidates[chosen] = candidates[i];
    plant(c[0], c[1]);
  }

  return { hills: hills.map(({ x, z, r }) => ({ x, z, r })), ponds: ponds.map(p => ({ ...p })), trees };
}
