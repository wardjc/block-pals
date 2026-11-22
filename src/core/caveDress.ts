import { BLOCKS, BlockId } from './blocks';
import { CARVE_MAX_Y } from './bounds';
import { caveStream, cellIndex, cellOf, inOld } from './caves';
import type { Cell } from './pathfind';
import type { Rect } from './village';
import type { World } from './world';

/**
 * Cave dressing (spec 7h, plan Task 14): the lights that keep every cave bright, and the gems in
 * the walls. Pure and seeded.
 *
 * The rule: every carved cell is within LIGHT_RADIUS blocks (straight line) of a glowing block.
 * A first pass puts glowing blocks on the walls and ceilings on a coarse grid (shallow caves get
 * glowing mushrooms; deep caves clusters of blue, pink and green crystals); a repair pass then
 * lights every cell still farther than 5 from any light (a margin under the rule's 6). Glow is a
 * bright tile, never a real light, so it costs nothing to draw.
 */
export const LIGHT_RADIUS = 6;
/** The repair pass lights anything farther than this. */
const REPAIR_RADIUS = 5;
/** Above this height a cell is in the shallow layer (mushrooms); below it, the deep layer (crystals). */
const SHALLOW_FROM = 30;

export interface DressInfo { lights: Cell[]; ore: Cell[]; airCells: Int32Array }

/** Blocks that glow (the five cave lights, the wizard's three and the Lamp). */
export const GLOWS: ReadonlySet<BlockId> = new Set(
  [BlockId.Lamp, ...Object.values(BLOCKS).filter(d => d.light).map(d => d.id)],
);

/** Plain rock a light or a gem may replace (never a path, a house block, a lamp or a furnishing). */
const ROCK: ReadonlySet<BlockId> = new Set([BlockId.Stone, BlockId.Dirt, BlockId.Grass]);

const N6: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

/** The world of carved air: which cells the caves made, and what may hold a light or a gem. */
interface Ctx {
  world: World;
  carved: Uint8Array;
  /** May a light or gem go in this cell (above y 48 in the old region only inside a stamped mouth)? */
  allowed: (x: number, y: number, z: number) => boolean;
}

/** A rock cell next to carved air, and how: 'side' (a wall), 'below' (a ceiling: air under it), 'above' (a floor). */
function exposure(c: Ctx, x: number, y: number, z: number): { side: boolean; below: boolean; above: boolean } | null {
  const { world, carved } = c;
  if (!world.inBounds(x, y, z) || y < 1 || !ROCK.has(world.get(x, y, z)) || !c.allowed(x, y, z)) return null;
  let side = false, below = false, above = false;
  for (const [dx, dy, dz] of N6) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (!world.inBounds(nx, ny, nz)) continue;
    const i = cellIndex(world, nx, ny, nz);
    if (!carved[i] || world.buffer[i] !== BlockId.Air) continue;
    if (dy === 0) side = true; else if (dy < 0) below = true; else above = true;
  }
  return side || below || above ? { side, below, above } : null;
}

/** A coverage map: 1 where a cell is within `radius` of a glowing block. */
class Coverage {
  readonly lit: Uint8Array;
  private readonly offsets: Array<[number, number, number]> = [];
  constructor(private readonly world: World, radius: number) {
    this.lit = new Uint8Array(world.sizeX * world.sizeY * world.sizeZ);
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy + dz * dz <= radius * radius + 1e-9) this.offsets.push([dx, dy, dz]);
    }
  }
  mark(x: number, y: number, z: number): void {
    const w = this.world;
    for (const [dx, dy, dz] of this.offsets) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= w.sizeX || ny >= w.sizeY || nz >= w.sizeZ) continue;
      this.lit[nx + w.sizeX * (nz + w.sizeZ * ny)] = 1;
    }
  }
}

const offsetCache = new Map<number, Array<[number, number, number]>>();
/** Every offset within r, nearest first (ties in a fixed order), so a search stops at the first hit. */
function sortedOffsets(r: number): Array<[number, number, number]> {
  let list = offsetCache.get(r);
  if (!list) {
    list = [];
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy + dz * dz <= r * r) list.push([dx, dy, dz]);
    }
    list.sort((a, b) => (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) - (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]) || a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
    offsetCache.set(r, list);
  }
  return list;
}

const CRYSTALS = [BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen];

/**
 * Lights the caves and sets gems in the walls. `carved` marks every cell the caves turned to air;
 * `stamped` are the old-region rectangles (mouths) where cells above y 48 may change.
 */
export function dressCaves(world: World, seed: number, carved: Uint8Array, stamped: readonly Rect[]): DressInfo {
  const allowed = (x: number, y: number, z: number): boolean =>
    y <= CARVE_MAX_Y || !inOld(x, z) || stamped.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const c: Ctx = { world, carved, allowed };
  const rng = caveStream(seed, 8);
  const lights: Cell[] = [];
  const cover = new Coverage(world, REPAIR_RADIUS);
  const cells = world.buffer;

  // Carved cells are never on the world's faces (rooms keep 12 from the edge, nothing is carved
  // below y 3), so their six neighbours are plain index steps.
  const dX = 1, dZ = world.sizeX, dY = world.sizeX * world.sizeZ;
  const STEP6 = [dX, -dX, dZ, -dZ, dY, -dY];

  // Lights already there (lamps of the ruin, treasure rooms, trail and mouths; glowing furnishings).
  const air: number[] = [];
  for (let i = 0; i < carved.length; i++) if (carved[i] && cells[i] === BlockId.Air) air.push(i);
  const seenGlow = new Uint8Array(cells.length);
  for (const i of air) {
    for (const d of STEP6) {
      const k = i + d;
      if (seenGlow[k] || !GLOWS.has(cells[k] as BlockId)) continue;
      seenGlow[k] = 1;
      const [x, y, z] = cellOf(world, k);
      cover.mark(x, y, z);
    }
  }

  const place = (x: number, y: number, z: number, id: BlockId): void => {
    world.set(x, y, z, id);
    lights.push([x, y, z]);
    cover.mark(x, y, z);
  };
  const kindAt = (y: number): BlockId => y >= SHALLOW_FROM ? BlockId.GlowMushroom : CRYSTALS[Math.floor(rng() * 3)];

  /** The nearest wall or ceiling (or, if `floors`, any) rock cell next to carved air within `r` (offsets nearest first). */
  const nearest = (x: number, y: number, z: number, r: number, floors: boolean): Cell | null => {
    for (const [dx, dy, dz] of sortedOffsets(r)) {
      const e = exposure(c, x + dx, y + dy, z + dz);
      if (!e || (!floors && !e.side && !e.below)) continue;
      return [x + dx, y + dy, z + dz];
    }
    return null;
  };

  const isAir = (x: number, y: number, z: number): boolean => world.inBounds(x, y, z) && world.get(x, y, z) === BlockId.Air;
  /**
   * The fallback when no rock that may hold a light is near (the cave's ceiling is the meadow's
   * floor, which never changes): a light hanging from the ceiling into the carved air, where nobody
   * can stand or walk (three cells of open air under it, so no head is ever in it). The nearest such
   * spot within 5; failing that, the highest open cell in this column; failing that, the cell itself.
   */
  const hanging = (x: number, y: number, z: number): Cell => {
    const free = (hx: number, hy: number, hz: number, below: number): boolean => {
      if (!isAir(hx, hy, hz) || !carved[cellIndex(world, hx, hy, hz)] || !allowed(hx, hy, hz)) return false;
      if (!BLOCKS[world.get(hx, hy + 1, hz)].solid) return false;
      for (let k = 1; k <= below; k++) if (!isAir(hx, hy - k, hz)) return false;
      return true;
    };
    for (const [dx, dy, dz] of sortedOffsets(REPAIR_RADIUS)) {
      if (free(x + dx, y + dy, z + dz, 3)) return [x + dx, y + dy, z + dz];
    }
    let top = y;
    while (isAir(x, top + 1, z) && allowed(x, top + 1, z)) top++;
    if (free(x, top, z, 2)) return [x, top, z];
    return [x, y, z];
  };

  // Pass 1: a coarse grid over the cave floors, each lighting the nearest wall or ceiling, in clusters.
  for (const i of air) {
    const [x, y, z] = cellOf(world, i);
    if (x % 4 !== 0 || z % 4 !== 0) continue;
    const below = cellIndex(world, x, y - 1, z);
    if (carved[below] && cells[below] === BlockId.Air) continue; // feet cells only
    if (cover.lit[i]) continue;
    const at = nearest(x, y + 1, z, 4, false);
    if (!at) continue;
    const id = kindAt(at[1]);
    place(at[0], at[1], at[2], id);
    // A cluster of 1 to 3 touching blocks.
    const extra = Math.floor(rng() * 3);
    for (let n = 0, tries = 0; n < extra && tries < 6; tries++) {
      const [dx, dy, dz] = N6[Math.floor(rng() * 6)];
      const nx = at[0] + dx, ny = at[1] + dy, nz = at[2] + dz;
      if ((ny >= SHALLOW_FROM) !== (at[1] >= SHALLOW_FROM)) continue; // a cluster stays in its own layer's kind
      if (exposure(c, nx, ny, nz)?.side || exposure(c, nx, ny, nz)?.below) { place(nx, ny, nz, id); n++; }
    }
  }

  // Pass 2: repair. Any carved cell still farther than 5 from every light gets the nearest rock lit.
  for (const i of air) {
    if (cover.lit[i] || cells[i] !== BlockId.Air) continue;
    const [x, y, z] = cellOf(world, i);
    const at = nearest(x, y, z, REPAIR_RADIUS, false) ?? nearest(x, y, z, REPAIR_RADIUS, true) ?? hanging(x, y, z);
    // hanging() never gives up (it ends with the cell itself), so the rule holds on every seed.
    place(at[0], at[1], at[2], kindAt(at[1]));
  }

  // Gems: of the rock cells on walls and ceilings (never floors, never above the old meadow),
  // shallow 1 in 60 and deep 1 in 25, no two touching, raised to the minimums and capped.
  const ore = placeOre(c, seed, air);

  const airCells = Int32Array.from(air.filter(i => cells[i] === BlockId.Air));
  return { lights, ore, airCells };
}

export const ORE_MIN = { shallow: 14, deep: 36 } as const;
export const ORE_MAX = { shallow: 40, deep: 80 } as const;

function placeOre(c: Ctx, seed: number, air: readonly number[]): Cell[] {
  const { world, carved } = c;
  const rng = caveStream(seed, 9);
  const cells = world.buffer;
  const dX = 1, dZ = world.sizeX, dY = world.sizeX * world.sizeZ;
  const STEP6 = [dX, -dX, dZ, -dZ, dY, -dY];
  const isAir = (k: number): boolean => carved[k] === 1 && cells[k] === BlockId.Air;
  // Every candidate: Stone beside carved air (a wall) or above it (a ceiling), never a floor, at most y 47.
  const cand: { shallow: Array<{ i: number; score: number }>; deep: Array<{ i: number; score: number }> } = { shallow: [], deep: [] };
  const seen = new Uint8Array(cells.length);
  for (const i of air) {
    for (const d of [dX, -dX, dZ, -dZ, dY]) {
      const k = i + d;
      if (seen[k] || cells[k] !== BlockId.Stone) continue;
      seen[k] = 1;
      const y = Math.floor(k / dY);
      if (y > CARVE_MAX_Y - 1) continue;
      const x = k % dZ, z = Math.floor((k - y * dY) / dZ);
      if (!c.allowed(x, y, z)) continue;
      let open = 0;
      for (const e of STEP6) if (isAir(k + e)) open++;
      (y >= SHALLOW_FROM ? cand.shallow : cand.deep).push({ i: k, score: open });
    }
  }
  const out: Cell[] = [];
  const touches = (k: number): boolean => STEP6.some(e => cells[k + e] === BlockId.GemOre);
  for (const layer of ['shallow', 'deep'] as const) {
    const list = cand[layer];
    // A seeded shuffle, so the gems are spread through the whole layer, not bunched by height.
    for (let n = list.length - 1; n > 0; n--) { const m = Math.floor(rng() * (n + 1)); [list[n], list[m]] = [list[m], list[n]]; }
    const odds = layer === 'shallow' ? 1 / 60 : 1 / 25;
    let n = 0;
    const set = (k: number): void => { cells[k] = BlockId.GemOre; out.push(cellOf(world, k)); n++; };
    for (const { i } of list) {
      if (n >= ORE_MAX[layer]) break;
      if (rng() < odds && cells[i] === BlockId.Stone && !touches(i)) set(i);
    }
    // Raised to the minimum on the most exposed cells (most open faces first, then by index).
    if (n < ORE_MIN[layer]) {
      const sorted = [...list].sort((a, b) => b.score - a.score || a.i - b.i);
      for (const { i } of sorted) {
        if (n >= ORE_MIN[layer]) break;
        if (cells[i] === BlockId.Stone && !touches(i)) set(i);
      }
    }
  }
  return out;
}

/**
 * Distance from each cell in `airCells` to the nearest glowing block (capped at `cap`), using a
 * coarse grid of the glowing blocks near the caves.
 */
export function lightDistances(world: World, airCells: Int32Array, cap = 12): Float32Array {
  const B = 8;
  const grid = new Map<number, Cell[]>();
  const cells = world.buffer;
  const key = (x: number, y: number, z: number): number => Math.floor(x / B) + 64 * (Math.floor(z / B) + 64 * Math.floor(y / B));
  // Glowing blocks anywhere in the world (a full scan is a few milliseconds).
  for (let i = 0; i < cells.length; i++) {
    if (!GLOWS.has(cells[i] as BlockId)) continue;
    const c = cellOf(world, i);
    const k = key(c[0], c[1], c[2]);
    let list = grid.get(k);
    if (!list) grid.set(k, list = []);
    list.push(c);
  }
  const out = new Float32Array(airCells.length);
  const reach = Math.ceil(cap / B);
  for (let n = 0; n < airCells.length; n++) {
    const [x, y, z] = cellOf(world, airCells[n]);
    let best = cap * cap;
    const gx = Math.floor(x / B), gy = Math.floor(y / B), gz = Math.floor(z / B);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (let d = -reach; d <= reach; d++) {
      const list = grid.get((gx + a) + 64 * ((gz + b) + 64 * (gy + d)));
      if (!list) continue;
      for (const [lx, ly, lz] of list) {
        const d2 = (lx - x) * (lx - x) + (ly - y) * (ly - y) + (lz - z) * (lz - z);
        if (d2 < best) best = d2;
      }
    }
    out[n] = Math.sqrt(best); // exact-math: a reported distance for tests and debug, never a decision
  }
  return out;
}

/** Cave air cells farther than `radius` from every glowing block (empty means no dark stretch). */
export function darkStretches(world: World, info: Pick<DressInfo, 'airCells'>, radius = LIGHT_RADIUS): Cell[] {
  const d = lightDistances(world, info.airCells, radius + 1);
  const out: Cell[] = [];
  for (let n = 0; n < d.length; n++) if (d[n] > radius + 1e-9) out.push(cellOf(world, info.airCells[n]));
  return out;
}
