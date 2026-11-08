import { BlockId } from './blocks';
import { stampHouse, type HouseInfo, type HouseSpec, type Rect } from './houses';
import type { Cell } from './pathfind';
import { World } from './world';

export type { Rect };

export const GROUND_Y = 5;

/** The farm and the fenced pasture (Village step 2). */
export interface FarmLayout {
  /** Three 2-wide Farmland beds. */
  beds: Rect[];
  /** Six Water source blocks, flush with the ground, walled in on every side. */
  pool: Rect;
  /** Reserved empty aisle of plain Dirt from the pool west to the beds (the water step makes it a ditch). */
  irrigation: Rect;
  /** Fenced; the fence stands on its outer ring. */
  pasture: Rect;
  /** The 2-wide gap in the north fence (feet-level cells). */
  gate: Cell[];
  fence: Cell[];
  /** Standable interior cells where animals start (at least 12). */
  herdSpawns: Cell[];
  /** 3-wide path from the plot to the gate. */
  path: Rect;
}

export interface VillageLayout {
  houses: HouseInfo[];
  /** Ordered centre line, spawn -> village gate -> square; each step walkable. */
  route: Cell[];
  /** All PathStone-covered standing cells of the route corridor and cottage link, as world indices. */
  routeCells: Set<number>;
  gate: Cell;
  square: Rect;
  /** The farm plot: beds, aisles and the small pool (step 2). */
  farmPlot: Rect;
  farm: FarmLayout;
  quarry: Rect;
  stampedRects: Rect[];
}

export const VILLAGE_PLAN: {
  pad: Rect; square: Rect; farmPlot: Rect; quarry: Rect;
  beds: Rect[]; pool: Rect; irrigation: Rect; pasture: Rect; gateX: [number, number]; path: Rect;
  waypoints: Array<[number, number]>; houses: HouseSpec[];
} = {
  pad: { x0: 58, z0: 6, x1: 92, z1: 44 },
  square: { x0: 68, z0: 22, x1: 80, z1: 30 },
  farmPlot: { x0: 72, z0: 35, x1: 83, z1: 43 },
  quarry: { x0: 86, z0: 8, x1: 92, z1: 14 },
  // Three 2-wide beds with 1-wide Dirt aisles between (z 37, 40, 43), so every bed cell is within reach of an aisle.
  beds: [
    { x0: 72, z0: 35, x1: 79, z1: 36 },
    { x0: 72, z0: 38, x1: 79, z1: 39 },
    { x0: 72, z0: 41, x1: 79, z1: 42 },
  ],
  pool: { x0: 81, z0: 35, x1: 83, z1: 36 },
  irrigation: { x0: 72, z0: 37, x1: 80, z1: 37 },
  // South of the plot, with its own level pad. The fence stands on its outer ring.
  pasture: { x0: 62, z0: 46, x1: 84, z1: 55 },
  gateX: [74, 75],
  path: { x0: 73, z0: 44, x1: 75, z1: 45 },
  // Spawn, the hill's shoulder, then the village gate.
  waypoints: [[24, 24], [30, 22], [37, 17], [41, 14], [48, 16], [56, 22], [67, 26]],
  houses: [
    { id: 'cottage', rect: { x0: 14, z0: 15, x1: 20, z1: 21 }, facing: 'east', wall: BlockId.Planks },
    { id: 'bakery', rect: { x0: 62, z0: 12, x1: 70, z1: 19 }, facing: 'south', wall: BlockId.Bricks, chimney: { dx: 2, dz: 1 } },
    { id: 'shop', rect: { x0: 76, z0: 12, x1: 84, z1: 20 }, facing: 'south', wall: BlockId.Planks },
    { id: 'farmhouse', rect: { x0: 62, z0: 32, x1: 70, z1: 39 }, facing: 'north', wall: BlockId.Planks },
    { id: 'granny', rect: { x0: 85, z0: 30, x1: 92, z1: 37 }, facing: 'west', wall: BlockId.Planks, chimney: { dx: 2, dz: 2 } },
  ],
};

/** Distance (Chebyshev) from a column to a rectangle; 0 inside. */
function distance(r: Rect, x: number, z: number): number {
  return Math.max(r.x0 - x, 0, x - r.x1, r.z0 - z, 0, z - r.z1);
}

const inRect = (r: Rect, x: number, z: number, margin = 0): boolean => distance(r, x, z) <= margin;
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });

const isTerrain = (id: BlockId): boolean => id !== BlockId.Air && id !== BlockId.Wood && id !== BlockId.Leaves;

/** Height of the topmost ground block, ignoring trees. */
function groundTop(world: World, x: number, z: number): number {
  for (let y = world.sizeY - 1; y >= 0; y--) if (isTerrain(world.get(x, y, z))) return y;
  return 0;
}

/** Removes the whole tree (trunk and 3x3 canopy) whose trunk stands at x, z. */
function removeTree(world: World, x: number, z: number): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let y = 1; y < world.sizeY; y++) {
        const id = world.get(x + dx, y, z + dz);
        if (id === BlockId.Leaves || (dx === 0 && dz === 0 && id === BlockId.Wood)) {
          world.set(x + dx, y, z + dz, BlockId.Air);
        }
      }
    }
  }
}

/** Removes every tree whose trunk or canopy touches any of the columns. */
function clearTreesTouching(world: World, columns: Iterable<number>): void {
  const sx = world.sizeX;
  for (const key of columns) {
    const x = key % sx;
    const z = Math.floor(key / sx);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const tx = x + dx;
        const tz = z + dz;
        if (!world.inBounds(tx, 1, tz)) continue;
        for (let y = 1; y < world.sizeY; y++) {
          if (world.get(tx, y, tz) === BlockId.Wood) { removeTree(world, tx, tz); break; }
        }
      }
    }
  }
}

function setColumn(world: World, x: number, z: number, h: number): void {
  for (let y = 1; y <= h; y++) {
    world.set(x, y, z, y === h ? BlockId.Grass : y >= h - 2 ? BlockId.Dirt : BlockId.Stone);
  }
  for (let y = h + 1; y < world.sizeY; y++) world.set(x, y, z, BlockId.Air);
}

interface Pin { rect: Rect; height: number }

/**
 * Eases the ground to each pinned height inside its rectangle; outside, a column's height is
 * its natural height clamped to within 1 block per column of every pin, so slopes stay gentle.
 * Neighbouring columns that are still more than 1 apart inside `region` are then fixed by
 * cutting the higher one. Trees touching a changed column (or `keepClear`) go whole.
 * Returns the final ground height of every column of the world.
 */
function reshape(world: World, pins: Pin[], region: Rect[], keepClear: Iterable<number> = []): Int16Array {
  const { sizeX, sizeZ } = world;
  const natural = new Int16Array(sizeX * sizeZ);
  const target = new Int16Array(sizeX * sizeZ);
  const pinned = new Uint8Array(sizeX * sizeZ);
  for (let z = 0; z < sizeZ; z++) {
    for (let x = 0; x < sizeX; x++) {
      const k = x + sizeX * z;
      const h = groundTop(world, x, z);
      natural[k] = h;
      let lo = -Infinity;
      let hi = Infinity;
      for (const pin of pins) {
        const d = distance(pin.rect, x, z);
        if (d === 0) pinned[k] = 1;
        lo = Math.max(lo, pin.height - d);
        hi = Math.min(hi, pin.height + d);
      }
      target[k] = pins.length === 0 ? h : Math.max(lo, Math.min(hi, h));
    }
  }
  // Natural terrain has a few 2-block steps. Smooth them inside the stamped region.
  const inRegion = (x: number, z: number): boolean => region.some(r => inRect(r, x, z));
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        if (!inRegion(x, z)) continue;
        const k = x + sizeX * z;
        for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= sizeX || nz < 0 || nz >= sizeZ || !inRegion(nx, nz)) continue;
          const n = nx + sizeX * nz;
          const diff = target[k] - target[n];
          if (Math.abs(diff) <= 1) continue;
          const [hiK, loK] = diff > 0 ? [k, n] : [n, k];
          if (!pinned[hiK]) target[hiK] = target[loK] + 1;
          else if (!pinned[loK]) target[loK] = target[hiK] - 1;
          else continue;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const changedColumns: number[] = [];
  for (let k = 0; k < target.length; k++) if (target[k] !== natural[k]) changedColumns.push(k);
  clearTreesTouching(world, changedColumns);
  clearTreesTouching(world, keepClear);
  for (const k of changedColumns) setColumn(world, k % sizeX, Math.floor(k / sizeX), target[k]);
  return target;
}

/** Manhattan line (x first, or z first) between two columns, inclusive. */
function line(a: [number, number], b: [number, number], xFirst = true): Array<[number, number]> {
  const cells: Array<[number, number]> = [[a[0], a[1]]];
  let [x, z] = a;
  const stepX = (): void => { while (x !== b[0]) { x += Math.sign(b[0] - x); cells.push([x, z]); } };
  const stepZ = (): void => { while (z !== b[1]) { z += Math.sign(b[1] - z); cells.push([x, z]); } };
  if (xFirst) { stepX(); stepZ(); } else { stepZ(); stepX(); }
  return cells;
}

const key = (world: World, x: number, z: number): number => x + world.sizeX * z;

/** Columns within `radius` (Chebyshev) of any centre cell. */
function widen(world: World, centre: Array<[number, number]>, radius: number, offset = -radius): Set<number> {
  const out = new Set<number>();
  for (const [cx, cz] of centre) {
    for (let dx = offset; dx <= offset + 2 * radius; dx++) {
      for (let dz = offset; dz <= offset + 2 * radius; dz++) {
        if (world.inBounds(cx + dx, 1, cz + dz)) out.add(key(world, cx + dx, cz + dz));
      }
    }
  }
  return out;
}

function polyline(waypoints: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) out.push(...line(waypoints[i - 1], waypoints[i]).slice(1));
  return out;
}

function boundsOf(points: Array<[number, number]>, margin: number): Rect {
  return {
    x0: Math.min(...points.map(p => p[0])) - margin, x1: Math.max(...points.map(p => p[0])) + margin,
    z0: Math.min(...points.map(p => p[1])) - margin, z1: Math.max(...points.map(p => p[1])) + margin,
  };
}

/** Paves columns with PathStone on top of the (already shaped) ground, with clear headroom. */
function pave(world: World, columns: Iterable<number>, skip: Rect[] = []): void {
  for (const k of columns) {
    const x = k % world.sizeX;
    const z = Math.floor(k / world.sizeX);
    if (skip.some(r => inRect(r, x, z))) continue;
    const h = groundTop(world, x, z);
    world.set(x, h, z, BlockId.PathStone);
    world.set(x, h + 1, z, BlockId.Air);
    world.set(x, h + 2, z, BlockId.Air);
  }
}

/** Eases the ground to groundY inside rect (see reshape). */
export function levelPad(world: World, rect: Rect, groundY: number): void {
  reshape(world, [{ rect, height: groundY }], [grow(rect, 6)]);
}

/**
 * Joins consecutive waypoints, 3 wide, PathStone on top, clears 2 blocks of headroom plus touching
 * trees, and smooths heights so neighbouring route cells differ by at most 1.
 * Returns the ordered centre line (feet cells).
 */
export function carveRoute(world: World, waypoints: Array<[number, number]>): Cell[] {
  const centre = polyline(waypoints);
  const corridor = widen(world, centre, 1);
  reshape(world, [], [grow(boundsOf(centre, 1), 5)], widen(world, centre, 2));
  pave(world, corridor);
  return centre.map(([x, z]) => [x, groundTop(world, x, z) + 1, z]);
}

/**
 * Farmland beds, the small walled pool, the pasture floor, its one-block fence with a 2-wide gate,
 * and the path from the plot to the gate. Ground is already level (pad and pasture pins).
 */
function stampFarm(world: World, plan: typeof VILLAGE_PLAN): FarmLayout {
  const cells = (r: Rect): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) out.push([x, z]);
    return out;
  };
  for (const bed of plan.beds) for (const [x, z] of cells(bed)) world.set(x, GROUND_Y, z, BlockId.Farmland);
  // The pool is flush with the ground; Dirt all round it (the plot is Dirt, and so is the pad edge) keeps it in.
  for (const [x, z] of cells(plan.pool)) world.set(x, GROUND_Y, z, BlockId.Water);

  const pa = plan.pasture;
  for (const [x, z] of cells(pa)) {
    world.set(x, GROUND_Y, z, BlockId.Grass);
    for (let y = GROUND_Y + 1; y < world.sizeY; y++) world.set(x, y, z, BlockId.Air);
  }
  for (const [x, z] of cells(plan.path)) {
    world.set(x, GROUND_Y, z, BlockId.PathStone);
    for (let y = GROUND_Y + 1; y < world.sizeY; y++) world.set(x, y, z, BlockId.Air);
  }
  const gate: Cell[] = plan.gateX.map(x => [x, GROUND_Y + 1, pa.z0] as Cell);
  const fence: Cell[] = [];
  for (const [x, z] of cells(pa)) {
    const ring = x === pa.x0 || x === pa.x1 || z === pa.z0 || z === pa.z1;
    if (!ring || gate.some(g => g[0] === x && g[2] === z)) continue;
    world.set(x, GROUND_Y + 1, z, BlockId.Fence);
    fence.push([x, GROUND_Y + 1, z]);
  }
  // 14 start places spread over the interior, away from the gate.
  const herdSpawns: Cell[] = [];
  for (const z of [49, 52]) for (const x of [65, 68, 71, 74, 77, 80, 83]) herdSpawns.push([x, GROUND_Y + 1, z]);
  return {
    beds: plan.beds, pool: plan.pool, irrigation: plan.irrigation, pasture: pa, gate, fence, herdSpawns, path: plan.path,
  };
}

export function buildVillage(world: World, spawn: { x: number; y: number; z: number }): VillageLayout {
  const plan = VILLAGE_PLAN;
  const spawnGround = Math.floor(spawn.y) - 1;
  const [cottageSpec, ...villageSpecs] = plan.houses;
  const cottagePad = grow(cottageSpec.rect, 2);

  const centre = polyline(plan.waypoints);
  const doorFronts = new Map<string, { x: number; z: number }>();
  // Door positions are needed before shaping, so compute the same cells stampHouse will report.
  const scratch = new World(world.sizeX, world.sizeY, world.sizeZ);
  for (const spec of plan.houses) {
    const info = stampHouse(scratch, spec, spec === cottageSpec ? spawnGround : GROUND_Y);
    doorFronts.set(spec.id, { x: info.doorFront[0], z: info.doorFront[2] });
  }

  // Cottage link: 2 wide from its door to the spawn corridor.
  const cf = doorFronts.get('cottage')!;
  const link = [...line([cf.x, cf.z], [24, 21])];
  const linkColumns = widen(world, link, 1, 0);
  const routeCorridor = widen(world, centre, 1);

  // Wide enough for the gentle skirt beside the path, narrow enough to stay clear of the pond.
  const legRects = [boundsOf(link, 1), ...centre.slice(1).map((_, i) => boundsOf([centre[i], centre[i + 1]], 1))]
    .map(r => grow(r, 3));
  const pasturePad = grow(plan.pasture, 1);
  const region = [grow(plan.pad, 6), grow(cottagePad, 2), grow(pasturePad, 5), ...legRects];

  const pins: Pin[] = [
    { rect: plan.pad, height: GROUND_Y },
    { rect: cottagePad, height: spawnGround },
    { rect: pasturePad, height: GROUND_Y },
  ];
  reshape(world, pins, region, new Set([...widen(world, centre, 2), ...widen(world, link, 2, -1)]));

  // Houses first so paving can skip their footprints.
  const houses: HouseInfo[] = [];
  for (const spec of plan.houses) houses.push(stampHouse(world, spec, spec === cottageSpec ? spawnGround : GROUND_Y));
  const footprints = houses.map(h => h.rect);

  // The spawn column stays Grass (it is where he starts); the path begins around it.
  const spawnColumn: Rect = { x0: Math.floor(spawn.x), z0: Math.floor(spawn.z), x1: Math.floor(spawn.x), z1: Math.floor(spawn.z) };
  pave(world, routeCorridor, [...footprints, spawnColumn]);
  pave(world, linkColumns, footprints);

  // Square, then 2 wide door strips (an L, outward first) from each village door to it.
  const sq = plan.square;
  const paved = new Set<number>();
  for (let x = sq.x0; x <= sq.x1; x++) for (let z = sq.z0; z <= sq.z1; z++) paved.add(key(world, x, z));
  for (const house of houses.slice(1)) {
    const [fx, , fz] = house.doorFront;
    const tx = Math.max(sq.x0, Math.min(sq.x1, fx));
    const tz = Math.max(sq.z0, Math.min(sq.z1, fz));
    const horizontal = fx - house.doorCells[0][0] !== 0;
    const strip = line([fx, fz], [tx, tz], horizontal);
    for (const k of widen(world, strip, 1, 0)) paved.add(k);
  }
  pave(world, paved, footprints);

  // Gate (centre line end) and route.
  const gate: Cell = [67, groundTop(world, 67, 26) + 1, 26];
  const route: Cell[] = [...centre, [68, 26]].map(([x, z]) => [x, groundTop(world, x, z) + 1, z] as Cell);

  // Farm plot: level Dirt, nothing above.
  const fp = plan.farmPlot;
  for (let x = fp.x0; x <= fp.x1; x++) {
    for (let z = fp.z0; z <= fp.z1; z++) {
      world.set(x, GROUND_Y, z, BlockId.Dirt);
      for (let y = GROUND_Y + 1; y < world.sizeY; y++) world.set(x, y, z, BlockId.Air);
    }
  }

  // Beds, pool and the reserved irrigation aisle (the plot is level Dirt with air above, from the loop above).
  const farm = stampFarm(world, plan);

  // Quarry: a pit 3 deep with a 3-step staircase along its west edge, Stone floor.
  const q = plan.quarry;
  for (let x = q.x0; x <= q.x1; x++) {
    const h = GROUND_Y - Math.min(3, x - q.x0 + 1);
    for (let z = q.z0; z <= q.z1; z++) {
      for (let y = h + 1; y < world.sizeY; y++) world.set(x, y, z, BlockId.Air);
      for (let y = Math.max(1, h - 2); y <= h; y++) world.set(x, y, z, BlockId.Stone);
    }
  }
  for (const [x, z] of [[89, 10], [90, 12], [88, 13], [91, 9]]) world.set(x, GROUND_Y - 2, z, BlockId.Stone);

  const routeCells = new Set<number>();
  for (const k of [...routeCorridor, ...linkColumns]) {
    const x = k % world.sizeX;
    const z = Math.floor(k / world.sizeX);
    if (footprints.some(r => inRect(r, x, z)) || (x === Math.floor(spawn.x) && z === Math.floor(spawn.z))) continue;
    routeCells.add(x + world.sizeX * (z + world.sizeZ * (groundTop(world, x, z) + 1)));
  }

  return {
    houses, route, routeCells, gate, square: sq, farmPlot: fp, farm, quarry: q,
    stampedRects: region,
  };
}

export function emptyVillage(): VillageLayout {
  return {
    houses: [], route: [], routeCells: new Set(), gate: [0, 0, 0],
    square: { x0: 0, z0: 0, x1: 0, z1: 0 }, farmPlot: { x0: 0, z0: 0, x1: 0, z1: 0 },
    farm: {
      beds: [], pool: { x0: 0, z0: 0, x1: 0, z1: 0 }, irrigation: { x0: 0, z0: 0, x1: 0, z1: 0 },
      pasture: { x0: 0, z0: 0, x1: 0, z1: 0 }, gate: [], fence: [], herdSpawns: [], path: { x0: 0, z0: 0, x1: 0, z1: 0 },
    },
    quarry: { x0: 0, z0: 0, x1: 0, z1: 0 }, stampedRects: [],
  };
}
