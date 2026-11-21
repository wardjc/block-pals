import { BLOCKS, BlockId } from './blocks';
import { CARVE_MAX_Y, ORIGIN, V2_WORLD } from './bounds';
import { canStep, isStandable, type Cell } from './pathfind';
import { mulberry32 } from './rng';
import type { RuinInfo } from './ruin';
import type { TreasureRoom } from './treasure';
import type { Rect } from './village';
import type { World } from './world';

/**
 * The caves (spec 7h, plan Tasks 13 and 15), pure and seeded. Two layers of rooms joined by wide
 * tunnels, six walk-in mouths, three stair tunnels between the layers and a pale cobble trail home.
 *
 * How it stays walkable by construction: each layer is a 2.5D height field, one floor (feet y) and
 * one top (highest air y) per column. Rooms (flat floors, domed ceilings), tunnels (5 wide, 5 high,
 * floor changing at most 1 block per 2 cells) and the treasure rooms are drawn into their layer's
 * field (overlaps keep the lower floor and the higher top), then a repair pass raises any floor
 * that is 2 or more below a neighbour and gives every column at least 3 blocks of headroom. The
 * field is carved in one go. Mouth ramps and the stairs are their own small fields, carved in 3D,
 * and are planned first and kept clear of everything else by height-aware reservations, so no two
 * carved spaces ever cut into each other's floor.
 */

export interface CaveLayer {
  id: 'shallow' | 'deep';
  floorMin: number;
  floorMax: number;
  roomHeight: [number, number];
  rooms: number;
  radius: [number, number];
}

/** The two layers (feet y of the floors). Shallow: glowing mushrooms; deep: crystals and more gems. */
export const LAYERS: readonly [CaveLayer, CaveLayer] = [
  { id: 'shallow', floorMin: 38, floorMax: 42, roomHeight: [5, 8], rooms: 24, radius: [5, 9] },
  { id: 'deep', floorMin: 8, floorMax: 16, roomHeight: [7, 10], rooms: 18, radius: [6, 11] },
];

export const TUNNEL = { width: 5, height: 5, maxSlope: 0.5 } as const;
/** Rooms keep at least this far (centres) apart, and further if they are big. */
export const ROOM_SPACING = 16;
/** Rooms and every carved cell keep this far from the world's edge. */
export const EDGE_KEEP = 12;
/** A shallow room or tunnel never sits under ground lower than this (pond beds, the quarry floor). */
const THIN_GROUND = 53;
/** The top of the deep layer's band (its rooms reach at most 16 + 9). */
const DEEP_TOP = 26;
/** Where a mouth's ramp levels out (the top of the shallow band). */
export const RAMP_END_FLOOR = 42;
/** The stairs join a shallow floor of 38 to a deep floor of 16: 22 down at 1 per 2 cells. */
const STAIR_TOP = 38;
const STAIR_BOTTOM = 16;

export interface Room { id: number; layer: 'shallow' | 'deep'; cx: number; cz: number; floorY: number; rx: number; rz: number; h: number }

export interface Mouth {
  id: number;
  /** The outside cell in front of the doorway (standable surface, feet). */
  cell: Cell;
  /** Every column this mouth changed above y 48 (and the doorway posts), grown by 3. */
  rect: Rect;
  /** True for the two mouths stamped into the old (meadow) region. */
  stamped: boolean;
  /** The shallow room the ramp leads to. */
  room: number;
  kind: 'hill' | 'quarry' | 'north' | 'south' | 'west' | 'east';
  /** Unit step into the ramp. */
  dir: [number, number];
  /** Centre line of the ramp, feet cells, from the first step inside to the room's edge. */
  ramp: Cell[];
}

export interface Stairs { from: number; to: number; cells: Cell[] }

export interface CaveLayout {
  rooms: Room[];
  edges: Array<[number, number]>;
  mouths: Mouth[];
  stairs: Stairs[];
  /** World indices (x + sizeX * (z + sizeZ * y)) of the PathStone trail's floor cells. */
  trail: Set<number>;
  lights: Cell[];
  ore: Cell[];
  /** World indices of every carved cell that is still air. */
  airCells: Int32Array;
  treasure: TreasureRoom[];
  ruin: RuinInfo | null;
  /** Columns above y 48 in the old region that the caves changed (the two stamped mouths). */
  stampedRects: Rect[];
  /** Centre lines of the tunnels between rooms (feet cells as planned; floors may have been raised by the repair). */
  tunnels: Array<{ a: number; b: number; line: Cell[] }>;
  /** How long each part of the cave generation took (ms), for the budgets and the debug hooks. */
  timings: { plan: number; carve: number; stamp: number; trail: number; dress: number };
}

/** The layout of a world with no caves. */
export const EMPTY_CAVES: CaveLayout = Object.freeze({
  rooms: [], edges: [], mouths: [], stairs: [], trail: new Set<number>(), lights: [], ore: [],
  airCells: new Int32Array(0), treasure: [], ruin: null, stampedRects: [], tunnels: [],
  timings: { plan: 0, carve: 0, stamp: 0, trail: 0, dress: 0 },
}) as CaveLayout;

/** The outer (surface) cells of the mouths: what the draw rule, the Home lift and the way home need. */
export const mouthCells = (caves: Pick<CaveLayout, 'mouths'>): Cell[] => caves.mouths.map(m => m.cell);

/** A seeded sub-stream for one step of the cave generator (none consumes another's numbers). */
export function caveStream(seed: number, step: number): () => number {
  return mulberry32(((seed ^ 0xca7e5) + Math.imul(step + 1, 0x9e3779b9)) >>> 0);
}

// ---------------------------------------------------------------------------------------------
// Height fields
// ---------------------------------------------------------------------------------------------

/** One layer as a 2.5D field: feet floor F and top air T per column (-1: no cave). */
export class CaveField {
  readonly F: Int16Array;
  readonly T: Int16Array;
  /** The highest the top may go per column (CARVE_MAX_Y for the shallow layer, or open for ramps). */
  readonly cap: number;
  constructor(readonly sizeX: number, readonly sizeZ: number, cap: number) {
    this.F = new Int16Array(sizeX * sizeZ).fill(-1);
    this.T = new Int16Array(sizeX * sizeZ).fill(-1);
    this.cap = cap;
  }

  has(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.sizeX && z < this.sizeZ && this.F[x + this.sizeX * z] >= 0;
  }

  /** Adds air from f to t at a column; overlaps keep the lower floor and the higher top. */
  add(x: number, z: number, f: number, t: number): void {
    if (x < EDGE_KEEP - 6 || z < EDGE_KEEP - 6 || x >= this.sizeX - EDGE_KEEP + 6 || z >= this.sizeZ - EDGE_KEEP + 6) return;
    const k = x + this.sizeX * z;
    const top = Math.min(t, this.cap);
    if (this.F[k] < 0) { this.F[k] = f; this.T[k] = top; return; }
    if (f < this.F[k]) this.F[k] = f;
    if (top > this.T[k]) this.T[k] = top;
  }
}

/** Air a room adds: a flat floor and a soft dome (at least 3 blocks of headroom at the very edge). */
export function rasterRoom(field: CaveField, r: Room): void {
  for (let z = Math.floor(r.cz - r.rz); z <= Math.ceil(r.cz + r.rz); z++) {
    for (let x = Math.floor(r.cx - r.rx); x <= Math.ceil(r.cx + r.rx); x++) {
      const d2 = ((x - r.cx) / r.rx) ** 2 + ((z - r.cz) / r.rz) ** 2;
      if (d2 > 1) continue;
      const rise = Math.max(3, Math.round((r.h - 1) * Math.sqrt(1 - 0.75 * d2)));
      field.add(x, z, r.floorY, r.floorY + rise);
    }
  }
}

/** A sample on a tunnel's centre line: position (cell units, cell centres at +0.5) and its floor. */
export interface PathPoint { x: number; z: number; f: number }

/** Air a tunnel adds: a disc of radius `radius` round every sample, `height` blocks high. */
export function rasterPath(field: CaveField, points: readonly PathPoint[], radius = TUNNEL.width / 2, height = TUNNEL.height): void {
  const r2 = radius * radius + 1e-6;
  for (const p of points) {
    for (let z = Math.floor(p.z - radius - 1); z <= Math.ceil(p.z + radius); z++) {
      for (let x = Math.floor(p.x - radius - 1); x <= Math.ceil(p.x + radius); x++) {
        if ((x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2 <= r2) field.add(x, z, p.f, p.f + height - 1);
      }
    }
  }
}

/** Where the straight line from a's centre to b's centre leaves a's ellipse (0..1 along it). */
function exitAt(a: Room, dx: number, dz: number): number {
  const q = Math.sqrt((dx / a.rx) ** 2 + (dz / a.rz) ** 2);
  return q > 0 ? 1 / q : 0;
}

/**
 * The centre line of a tunnel from room a to room b: samples every half cell, a gentle sideways
 * wobble (at most 2, none at the ends) from its own stream, and a floor that is flat inside each
 * room and changes linearly between the room edges (never more than 1 block per 2 cells).
 */
export function tunnelLine(a: Room, b: Room, rng: () => number): PathPoint[] {
  const ax = a.cx + 0.5, az = a.cz + 0.5, bx = b.cx + 0.5, bz = b.cz + 0.5;
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const amp = (rng() * 2 - 1) * 2;
  const waves = 1 + Math.floor(rng() * 2);
  let t0 = exitAt(a, dx, dz);
  let t1 = 1 - exitAt(b, -dx, -dz);
  // Rooms too close for a gentle floor between their edges: slope over the whole line instead.
  if (t1 - t0 <= 0 || (t1 - t0) * len < 2 * Math.abs(b.floorY - a.floorY) + 1) { t0 = 0; t1 = 1; }
  const n = Math.max(2, Math.ceil(len * 2));
  const out: PathPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = t <= t0 ? 0 : t >= t1 ? 1 : (t - t0) / (t1 - t0);
    const w = amp * Math.sin(Math.PI * t * waves) * Math.sin(Math.PI * t);
    out.push({
      x: ax + dx * t - (dz / len) * w,
      z: az + dz * t + (dx / len) * w,
      f: Math.round(a.floorY + (b.floorY - a.floorY) * u),
    });
  }
  return out;
}

/**
 * Raises any floor that is 2 or more below a neighbour (so every step is at most 1 block) and
 * gives every column at least 3 blocks of headroom. Only ever raises floors (fills rock), so it
 * can never open a new hole. A worklist runs it to the exact fixed point.
 */
export function repairFloors(field: CaveField): void {
  const { F, T, sizeX, sizeZ } = field;
  const queue: number[] = [];
  for (let k = 0; k < F.length; k++) if (F[k] >= 0) queue.push(k);
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % sizeX, z = (k - x) / sizeX;
    const f = F[k];
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ) continue;
      const m = nx + sizeX * nz;
      if (F[m] >= 0 && F[m] < f - 1) { F[m] = f - 1; queue.push(m); }
    }
  }
  for (let k = 0; k < F.length; k++) if (F[k] >= 0 && T[k] < F[k] + 2) T[k] = F[k] + 2;
}

/** Index of a cell in World order. */
export const cellIndex = (world: { sizeX: number; sizeZ: number }, x: number, y: number, z: number): number =>
  x + world.sizeX * (z + world.sizeZ * y);

/** Carves a field into the world (bulk-friendly); every solid cell it turns to air is marked in `carved`. */
export function carveField(world: World, field: CaveField, carved: Uint8Array, walk?: Uint8Array): void {
  const { F, T } = field;
  const cells = world.buffer;
  const layer = world.sizeX * world.sizeZ;
  for (let k = 0; k < F.length; k++) {
    if (F[k] < 0) continue;
    for (let y = Math.max(3, F[k]); y <= T[k] && y < world.sizeY; y++) {
      const i = k + layer * y;
      if (walk) walk[i] = 1;
      if (cells[i] === BlockId.Air) continue;
      cells[i] = BlockId.Air;
      carved[i] = 1;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reservations: carved spaces that must not cut into each other
// ---------------------------------------------------------------------------------------------

/** A reserved disc of air from y0 (feet) to y1 (top). */
export interface Spot { x: number; z: number; r: number; y0: number; y1: number; owner: string; attach: number[]; layer?: 'shallow' | 'deep'; keepOut?: boolean }

/** Two air ranges clash unless at least two blocks of rock lie between them (one floor, one ceiling). */
export const clash = (a0: number, a1: number, b0: number, b1: number): boolean => !(a1 <= b0 - 2 || b1 <= a0 - 2);

/** A coarse grid of reserved spots for quick "is anything here?" checks. */
export class Reserved {
  private readonly cells = new Map<number, Spot[]>();
  private static readonly B = 8;
  readonly all: Spot[] = [];
  private maxR = 0;
  add(s: Spot): void {
    this.all.push(s);
    this.maxR = Math.max(this.maxR, s.r);
    const B = Reserved.B;
    for (let gz = Math.floor((s.z - s.r) / B); gz <= Math.floor((s.z + s.r) / B); gz++) {
      for (let gx = Math.floor((s.x - s.r) / B); gx <= Math.floor((s.x + s.r) / B); gx++) {
        const k = gx + 1000 * gz;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, list = []);
        list.push(s);
      }
    }
  }
  /** Spots within `r` of (x, z) (their own radius included). */
  near(x: number, z: number, r: number): Spot[] {
    const B = Reserved.B;
    const reach = r + this.maxR;
    const out = new Set<Spot>();
    for (let gz = Math.floor((z - reach) / B); gz <= Math.floor((z + reach) / B); gz++) {
      for (let gx = Math.floor((x - reach) / B); gx <= Math.floor((x + reach) / B); gx++) {
        for (const s of this.cells.get(gx + 1000 * gz) ?? []) if (Math.hypot(s.x - x, s.z - z) < s.r + r) out.add(s);
      }
    }
    return [...out];
  }
}

// ---------------------------------------------------------------------------------------------
// Terrain facts
// ---------------------------------------------------------------------------------------------

/** Blocks that are the land itself (a house, a tree or water is not ground). */
const GROUND_IDS: ReadonlySet<BlockId> = new Set([BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Sand, BlockId.PathStone, BlockId.Farmland, BlockId.Bedrock]);

/** The top of the land per column (houses, trees and water ignored), world y. */
export function groundTops(world: World): Int16Array {
  const out = new Int16Array(world.sizeX * world.sizeZ);
  for (let z = 0; z < world.sizeZ; z++) {
    for (let x = 0; x < world.sizeX; x++) {
      let y = world.sizeY - 1;
      while (y > 0 && !GROUND_IDS.has(world.get(x, y, z))) y--;
      out[x + world.sizeX * z] = y;
    }
  }
  return out;
}

const OLD = { x0: ORIGIN.x, z0: ORIGIN.z, x1: ORIGIN.x + V2_WORLD.x - 1, z1: ORIGIN.z + V2_WORLD.z - 1 };
export const inOld = (x: number, z: number): boolean => x >= OLD.x0 && x <= OLD.x1 && z >= OLD.z0 && z <= OLD.z1;
const toOldRect = (x: number, z: number): number => Math.max(OLD.x0 - x, 0, x - OLD.x1, OLD.z0 - z, 0, z - OLD.z1);
const rectDist = (r: Rect, x: number, z: number): number => Math.max(r.x0 - x, 0, x - r.x1, r.z0 - z, 0, z - r.z1);
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });

// ---------------------------------------------------------------------------------------------
// Mouths
// ---------------------------------------------------------------------------------------------

/** What a mouth must keep away from (world coordinates). */
export interface MouthContext {
  spawn: { x: number; y: number; z: number };
  /** Houses, the farm plot, the pasture, the tower: no mouth within 6. */
  keepOff: Rect[];
  /** Path cells (x, z) of the village route and the tower path: no mouth within 6. */
  pathColumns: Array<[number, number]>;
  quarry: Rect;
  /** The outer land's trees: a mouth in the new land may clear the few in its way. */
  outerTrees: Array<{ x: number; z: number }>;
}

export interface MouthPlan {
  kind: Mouth['kind'];
  o: Cell;
  /** The first step's direction (the doorway faces the other way). */
  dir: [number, number];
  /** Ramp steps 1..n: centre column, feet floor and direction of travel (a ramp may turn once). */
  steps: Array<{ x: number; z: number; f: number; dir: [number, number] }>;
  /** Every column the ramp carves: its floor and its top. */
  columns: Array<{ x: number; z: number; f: number; t: number }>;
  room: Room;
  clearTrees: Array<{ x: number; z: number }>;
}

const MOUTH_ROOM_R = 6;
const MOUTH_ROOM_H = 7;

type Dir = [number, number];

/**
 * A mouth's ramp from its outer cell: `first` cells straight on (Infinity: never turning), then a
 * quarter turn to `turn`; down 1 block every 2 cells to RAMP_END_FLOOR, then flat on into its
 * entrance room (whose edge starts 3 cells before the end).
 */
function rampSteps(o: Cell, dir: Dir, first = Infinity, turn: Dir = dir): MouthPlan['steps'] {
  const out: MouthPlan['steps'] = [];
  const drop = Math.max(0, o[1] - RAMP_END_FLOOR);
  const n = 2 * drop + 5;
  let x = o[0], z = o[2];
  for (let i = 1; i <= n; i++) {
    const d = i <= first ? dir : turn;
    x += d[0]; z += d[1];
    out.push({ x, z, f: Math.max(RAMP_END_FLOOR, o[1] - Math.floor(i / 2)), dir: d });
  }
  return out;
}

/** The columns across a step (lateral -half..half). */
const across = (s: { x: number; z: number }, dir: Dir, half = 2): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let l = -half; l <= half; l++) out.push([s.x - dir[1] * l, s.z + dir[0] * l]);
  return out;
};

/** Every column a ramp carves: 5 across each step, and a 5 x 5 square at the turn so the corner is full width. */
function rampColumns(steps: MouthPlan['steps']): MouthPlan['columns'] {
  const map = new Map<string, { x: number; z: number; f: number; t: number }>();
  const add = (x: number, z: number, f: number): void => {
    const k = `${x},${z}`;
    const c = map.get(k);
    if (!c) map.set(k, { x, z, f, t: f + TUNNEL.height - 1 });
    else { c.f = Math.min(c.f, f); c.t = Math.max(c.t, f + TUNNEL.height - 1); }
  };
  steps.forEach((s, i) => {
    for (const [x, z] of across(s, s.dir)) add(x, z, s.f);
    const next = steps[i + 1];
    if (next && (next.dir[0] !== s.dir[0] || next.dir[1] !== s.dir[1])) {
      // The square reaches 2 back along the way in: give it that step's (higher) floor, never a dip.
      const back = steps[Math.max(0, i - 2)].f;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) add(s.x + dx, s.z + dz, back);
    }
  });
  return [...map.values()];
}

const NATURAL: ReadonlySet<BlockId> = new Set([BlockId.Grass, BlockId.Dirt, BlockId.Stone]);

/**
 * Checks one mouth candidate: the outer cell is standable grass (or the quarry floor), every
 * column the ramp or its posts carve is plain land, the open parts (trench, doorway, posts) keep 6
 * from houses, the farm, the pasture, the tower and the paths, no thin roof runs under any of
 * them, no tree is in the way (in the new land those few may be cleared), the ramp never floats,
 * and its entrance room fits on solid ground. Returns the plan or null.
 */
function tryMouth(
  world: World, ground: Int16Array, thin: Uint8Array, kind: Mouth['kind'], o: Cell, dir: Dir, ctx: MouthContext,
  keepOff: Uint8Array, opts: { allowQuarry?: boolean; first?: number; turn?: Dir } = {},
): MouthPlan | null {
  const { sizeX, sizeZ } = world;
  if (!isStandable(world, o)) return null;
  const under = world.get(o[0], o[1] - 1, o[2]);
  if (!opts.allowQuarry && under !== BlockId.Grass) return null;
  const steps = rampSteps(o, dir, opts.first, opts.turn);
  const level = steps[steps.length - 4];
  const room: Room = {
    id: -1, layer: 'shallow', cx: level.x + level.dir[0] * (MOUTH_ROOM_R + 1), cz: level.z + level.dir[1] * (MOUTH_ROOM_R + 1),
    floorY: RAMP_END_FLOOR, rx: MOUTH_ROOM_R, rz: MOUTH_ROOM_R, h: MOUTH_ROOM_H,
  };
  const margin = EDGE_KEEP + MOUTH_ROOM_R;
  if (room.cx < margin || room.cz < margin || room.cx >= sizeX - margin || room.cz >= sizeZ - margin) return null;
  for (let z = room.cz - MOUTH_ROOM_R - 3; z <= room.cz + MOUTH_ROOM_R + 3; z++) {
    for (let x = room.cx - MOUTH_ROOM_R - 3; x <= room.cx + MOUTH_ROOM_R + 3; x++) if (thin[x + sizeX * z]) return null;
  }
  const surface: Array<[number, number]> = [[o[0], o[2]], ...across({ x: o[0], z: o[2] }, dir, 3)];
  for (const [x, z] of surface) if (keepOff[x + sizeX * z] || (!opts.allowQuarry && rectDist(ctx.quarry, x, z) < 3)) return null;
  const columns = rampColumns(steps);
  const all = [...columns, ...surface.map(([x, z]) => ({ x, z, f: o[1], t: o[1] + TUNNEL.height - 1 }))];
  const box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (const c of all) {
    if (c.x < EDGE_KEEP || c.z < EDGE_KEEP || c.x >= sizeX - EDGE_KEEP || c.z >= sizeZ - EDGE_KEEP) return null;
    const g = ground[c.x + sizeX * c.z];
    const nearSurface = g - c.t < 3;
    // Where it opens to the sky (the trench, the doorway, the posts) it keeps 6 from the village and
    // the paths; under a thin roof it never runs beneath a house, the farm or the tower.
    if (c.t >= g) {
      if (keepOff[c.x + sizeX * c.z]) return null;
      if (!opts.allowQuarry && rectDist(ctx.quarry, c.x, c.z) < 3) return null;
    } else if (nearSurface && ctx.keepOff.some(r => rectDist(r, c.x, c.z) === 0)) return null;
    if (nearSurface) {
      box.x0 = Math.min(box.x0, c.x); box.z0 = Math.min(box.z0, c.z); box.x1 = Math.max(box.x1, c.x); box.z1 = Math.max(box.z1, c.z);
    }
    // A ramp floor must stand on the land (at most one block of fill on flat ground).
    if (g < c.f - 2) return null;
  }
  // Then the slower checks, column by column.
  for (const c of all) {
    const g = ground[c.x + sizeX * c.z];
    const nearSurface = g - c.t < 3;
    // Only plain land where it is carved (and, near the surface, up to the sky: trees outside may be cleared).
    const upTo = nearSurface ? world.sizeY - 1 : c.t + 1;
    for (let y = Math.min(c.f - 1, g); y <= upTo; y++) {
      const id = world.get(c.x, y, c.z);
      if (id === BlockId.Air || NATURAL.has(id)) continue;
      if ((id === BlockId.Wood || id === BlockId.Leaves) && !inOld(c.x, c.z)) continue;
      return null;
    }
  }
  // Trees within 2 of the open part: none in the old region; in the new land they are cleared.
  if (box.x0 === Infinity) { box.x0 = box.x1 = o[0]; box.z0 = box.z1 = o[2]; }
  for (let z = box.z0 - 2; z <= box.z1 + 2; z++) {
    for (let x = box.x0 - 2; x <= box.x1 + 2; x++) {
      if (!inOld(x, z)) continue;
      for (let y = ground[x + sizeX * z] + 1; y < world.sizeY; y++) {
        const id = world.get(x, y, z);
        if (id === BlockId.Wood || id === BlockId.Leaves) return null;
      }
    }
  }
  const clearTrees = ctx.outerTrees.filter(t => t.x >= box.x0 - 3 && t.x <= box.x1 + 3 && t.z >= box.z0 - 3 && t.z <= box.z1 + 3);
  return { kind, o, dir, steps, columns, room, clearTrees };
}

function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

const DIRS: Dir[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Straight on, or a quarter turn (either way) after this many cells. */
const TURNS: ReadonlyArray<{ first: number; side: 1 | -1 } | null> = [null, { first: 6, side: 1 }, { first: 6, side: -1 }, { first: 9, side: 1 }, { first: 9, side: -1 }, { first: 4, side: 1 }, { first: 4, side: -1 }];

/** Ground rises by at least 2 within 4 cells going `dir` from (x, z): a hillside to walk into. */
function risesAhead(ground: Int16Array, sizeX: number, x: number, z: number, dir: Dir): boolean {
  const g = ground[x + sizeX * z];
  for (let i = 1; i <= 4; i++) if (ground[(x + dir[0] * i) + sizeX * (z + dir[1] * i)] - g >= 2) return true;
  return false;
}

/** At most this many ranked, valid candidates per mouth (the planner tries the next if one cannot be joined up). */
const MOUTH_CHOICES = 6;

/**
 * The candidates for the six mouths, best first: the hill one near spawn (14 to 26 blocks away,
 * into a hillside, the lowest first), the quarry one (from the quarry floor, at least 6 from the
 * shop), and one in the new land on each side (a hillside if one fits, else flat ground heading
 * inwards). Ramps may turn once, so a mouth can step round the village.
 */
export function mouthCandidates(world: World, seed: number, ground: Int16Array, thin: Uint8Array, ctx: MouthContext): MouthPlan[][] {
  const { sizeX, sizeZ } = world;
  // Columns within 6 of a house, the farm, the pasture, the tower or a path: no open ramp there.
  const keepOff = new Uint8Array(sizeX * sizeZ);
  const mark = (x0: number, z0: number, x1: number, z1: number): void => {
    for (let z = Math.max(0, z0 - 5); z <= Math.min(sizeZ - 1, z1 + 5); z++) {
      for (let x = Math.max(0, x0 - 5); x <= Math.min(sizeX - 1, x1 + 5); x++) keepOff[x + sizeX * z] = 1;
    }
  };
  for (const r of ctx.keepOff) mark(r.x0, r.z0, r.x1, r.z1);
  for (const [x, z] of ctx.pathColumns) mark(x, z, x, z);
  const sx = Math.floor(ctx.spawn.x), sz = Math.floor(ctx.spawn.z);
  const out: MouthPlan[][] = [];
  const collect = (kind: Mouth['kind'], cands: Array<{ x: number; z: number; dir: Dir; score: number }>, opts: { allowQuarry?: boolean } = {}): void => {
    cands.sort((a, b) => a.score - b.score || a.x - b.x || a.z - b.z || a.dir[0] - b.dir[0] || a.dir[1] - b.dir[1]);
    const list: MouthPlan[] = [];
    for (const c of cands) {
      if (list.length >= MOUTH_CHOICES) break;
      for (const t of TURNS) {
        const turn: Dir | undefined = t ? [-c.dir[1] * t.side, c.dir[0] * t.side] : undefined;
        const p = tryMouth(world, ground, thin, kind, [c.x, ground[c.x + sizeX * c.z] + 1, c.z], c.dir, ctx, keepOff,
          { ...opts, first: t?.first, turn });
        // Candidates far enough apart that a later one is a real alternative (the quarry has only a few spots).
        if (p && (opts.allowQuarry || list.every(q => Math.hypot(q.o[0] - p.o[0], q.o[2] - p.o[2]) >= 3 || q.dir[0] !== p.dir[0] || q.dir[1] !== p.dir[1]))) { list.push(p); break; }
      }
    }
    out.push(list);
  };

  // The hill mouth: candidates in the old region 14..26 from spawn; hillsides, the lowest first.
  {
    const cands: Array<{ x: number; z: number; dir: Dir; score: number }> = [];
    for (let z = sz - 26; z <= sz + 26; z++) {
      for (let x = sx - 26 + ((z - sz) & 1); x <= sx + 26; x += 2) {
        const d = Math.hypot(x - sx, z - sz);
        if (d < 14 || d > 26 || !inOld(x, z)) continue;
        for (const dir of DIRS) {
          // A hillside first (the lowest), then, if the village leaves no hillside free, flat meadow.
          const slope = risesAhead(ground, sizeX, x, z, dir);
          cands.push({ x, z, dir, score: (slope ? 0 : 100_000) + ground[x + sizeX * z] * 100 + d });
        }
      }
    }
    collect('hill', cands);
  }

  // The quarry mouth: on the quarry's deep floor, heading away from the shop (east).
  {
    const q = ctx.quarry;
    const cz = Math.floor((q.z0 + q.z1) / 2);
    const cands: Array<{ x: number; z: number; dir: Dir; score: number }> = [];
    for (const x of [q.x0 + 4, q.x0 + 5, q.x0 + 6]) for (const dz of [0, -1, 1]) cands.push({ x, z: cz + dz, dir: [1, 0], score: (x - q.x0) + Math.abs(dz) * 10 });
    collect('quarry', cands, { allowQuarry: true });
  }

  // One per side in the new land.
  const rng = caveStream(seed, 1);
  const sides: Array<{ kind: Mouth['kind']; band: (x: number, z: number) => boolean; mid: [number, number] }> = [
    { kind: 'north', band: (x, z) => z < OLD.z0 - 8 && x >= 24 && x < sizeX - 24, mid: [96, 26] },
    { kind: 'south', band: (x, z) => z > OLD.z1 + 8 && x >= 24 && x < sizeX - 24, mid: [96, 166] },
    { kind: 'west', band: (x, z) => x < OLD.x0 - 8 && z >= 24 && z < sizeZ - 24, mid: [26, 96] },
    { kind: 'east', band: (x, z) => x > OLD.x1 + 8 && z >= 24 && z < sizeZ - 24, mid: [166, 96] },
  ];
  for (const side of sides) {
    const cands: Array<{ x: number; z: number; dir: Dir; score: number }> = [];
    for (let z = EDGE_KEEP; z < sizeZ - EDGE_KEEP; z += 2) {
      for (let x = EDGE_KEEP; x < sizeX - EDGE_KEEP; x += 2) {
        if (!side.band(x, z) || toOldRect(x, z) < 8) continue;
        for (const dir of DIRS) {
          const slope = risesAhead(ground, sizeX, x, z, dir);
          // Flat ground: only heading inwards (towards the middle of the world).
          if (!slope && (dir[0] * (96 - x) + dir[1] * (96 - z)) <= 0) continue;
          cands.push({ x, z, dir, score: (slope ? 0 : 1000) + Math.hypot(x - side.mid[0], z - side.mid[1]) + rng() * 6 });
        }
      }
    }
    collect(side.kind, cands);
  }
  return out;
}

/** Two mouths keep 30 apart (outer cells), their ramps 10 apart and their rooms well apart. */
export function mouthsFit(a: MouthPlan, b: MouthPlan): boolean {
  if (Math.hypot(a.o[0] - b.o[0], a.o[2] - b.o[2]) < 30) return false;
  if (Math.hypot(a.room.cx - b.room.cx, a.room.cz - b.room.cz) < a.room.rx + b.room.rx + 10) return false;
  for (const s of a.steps) for (const t of b.steps) if (Math.hypot(s.x - t.x, s.z - t.z) < 10) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------------------------

export interface StairPlan { s: Room; d: Room; points: PathPoint[] }

const STAIR_S_R = 6;
const STAIR_D_R = 7;

/** The centre line of a stair from its shallow room's edge to its deep room's edge: 1 down per 2 cells. */
function stairLine(s: Room, d: Room): PathPoint[] {
  const ax = s.cx + 0.5, az = s.cz + 0.5;
  const dx = d.cx - s.cx, dz = d.cz - s.cz;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const start = s.rx - 1;
  const drop = s.floorY - d.floorY;
  const out: PathPoint[] = [];
  const run = 2 * drop + 2;
  for (let i = 0; i <= run * 2 + 4; i++) {
    const along = start + i / 2;
    const f = s.floorY - Math.max(0, Math.min(drop, Math.floor((i / 2 - 1) / 2)));
    out.push({ x: ax + ux * along, z: az + uz * along, f });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The whole cave plan
// ---------------------------------------------------------------------------------------------

/** The Old Hideout's carved hall (world coordinates): the ruin reserves it before any room. */
export const RUIN_HALL = { x0: 85, z0: 87, x1: 107, z1: 105, floorY: 12, height: 8 } as const;

export interface CavePlan {
  rooms: Room[];
  edges: Array<[number, number]>;
  mouths: MouthPlan[];
  stairs: StairPlan[];
  /** Per edge (and ruin and mouth links), the centre line. */
  lines: Array<{ a: number; b: number; points: PathPoint[] }>;
  ruinLinks: Array<{ room: number; points: PathPoint[] }>;
  shallow: CaveField;
  deep: CaveField;
  /** Columns where shallow caves may not go (thin ground and its surroundings). */
  thin: Uint8Array;
  reserved: Reserved;
}

/**
 * Plans every room and tunnel and draws the two layer fields (not repaired, not carved yet: the
 * treasure rooms are added to the fields first). Deterministic for a seed.
 */
export function planCaves(world: World, seed: number, ground: Int16Array, ctx: MouthContext): CavePlan {
  const { sizeX, sizeZ } = world;

  // Thin ground (pond beds, the quarry floor): no shallow cave within 3.
  const thin = new Uint8Array(sizeX * sizeZ);
  for (let z = 0; z < sizeZ; z++) for (let x = 0; x < sizeX; x++) {
    if (ground[x + sizeX * z] >= THIN_GROUND) continue;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < sizeX && nz < sizeZ) thin[nx + sizeX * nz] = 1;
    }
  }

  // The Old Hideout's hall, at the world centre in the deep layer.
  const hall = RUIN_HALL;
  const ruinRoom: Room = {
    id: -1, layer: 'deep', cx: (hall.x0 + hall.x1) / 2, cz: (hall.z0 + hall.z1) / 2, floorY: hall.floorY,
    rx: (hall.x1 - hall.x0) / 2, rz: (hall.z1 - hall.z0) / 2, h: hall.height,
  };

  // Mouths first (they only need the land): the best candidate of each kind that keeps clear of
  // the others. A mouth whose entrance room cannot be joined to the network is swapped for its
  // next candidate and the plan made again (at most 8 times).
  const candidates = mouthCandidates(world, seed, ground, thin, ctx);
  const start = candidates.map(() => 0);
  let best: CavePlan | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const picked: Array<{ kind: number; index: number; plan: MouthPlan }> = [];
    candidates.forEach((list, k) => {
      for (let i = start[k]; i < list.length; i++) {
        if (picked.every(p => mouthsFit(p.plan, list[i]))) { picked.push({ kind: k, index: i, plan: list[i] }); break; }
      }
    });
    const result = planWith(world, seed, thin, hall, ruinRoom, picked.map(p => ({ ...p.plan, room: { ...p.plan.room } })));
    if (!best || result.mouths.length + result.stairs.length > best.mouths.length + best.stairs.length) best = result;
    const lost = picked.filter(p => !result.mouths.some(m => m.kind === p.plan.kind));
    if (lost.length === 0 && result.mouths.length === candidates.filter(l => l.length > 0).length) break;
    if (lost.length === 0) break;
    for (const p of lost) start[p.kind] = p.index + 1;
  }
  return best!;
}

/** One go at the plan with these mouths. */
function planWith(
  world: World, seed: number, thin: Uint8Array, hall: typeof RUIN_HALL, ruinRoom: Room, mouths: MouthPlan[],
): CavePlan {
  const { sizeX, sizeZ } = world;
  const reserved = new Reserved();
  const rooms: Room[] = [];
  for (const m of mouths) {
    m.room.id = rooms.length;
    rooms.push(m.room);
    for (const s of m.steps) {
      reserved.add({ x: s.x + 0.5, z: s.z + 0.5, r: 2.5, y0: s.f, y1: s.f + TUNNEL.height - 1, owner: `mouth${m.room.id}`, attach: [m.room.id] });
    }
  }

  // Stairs: anchor rooms joined by a straight stair, spread over the map, the first near the centre.
  const stairs: StairPlan[] = [];
  const stairRng = caveStream(seed, 2);
  const clearOfAll = (pts: PathPoint[], skipOwner: string): boolean => pts.every(p => reserved.near(p.x, p.z, 2.5 + 3)
    .every(s => s.owner === skipOwner || !clash(p.f, p.f + TUNNEL.height - 1, s.y0, s.y1)));
  const roomClear = (r: Room, extra = 3): boolean => {
    const R = Math.max(r.rx, r.rz);
    const top = r.floorY + r.h - 1;
    if (reserved.near(r.cx + 0.5, r.cz + 0.5, R + extra).some(s => clash(r.floorY, top, s.y0, s.y1))) return false;
    if (rooms.some(o => o.layer === r.layer && Math.hypot(o.cx - r.cx, o.cz - r.cz) < Math.max(ROOM_SPACING, Math.max(o.rx, o.rz) + R + 4))) return false;
    if (r.layer === 'deep' && rectDist(grow(hall, R + 4), r.cx, r.cz) <= 0) return false;
    if (r.layer === 'shallow') {
      for (let z = Math.floor(r.cz - r.rz) - 1; z <= Math.ceil(r.cz + r.rz) + 1; z++) {
        for (let x = Math.floor(r.cx - r.rx) - 1; x <= Math.ceil(r.cx + r.rx) + 1; x++) if (thin[x + sizeX * z]) return false;
      }
    }
    return true;
  };
  for (let tries = 0; tries < 600 && stairs.length < 3; tries++) {
    const first = stairs.length === 0;
    const ang = stairRng() * Math.PI * 2;
    const dist = (STAIR_S_R - 1) + 2 * (STAIR_TOP - STAIR_BOTTOM) + 3 + (STAIR_D_R - 1);
    const dcx = first ? Math.round(96 + Math.cos(stairRng() * Math.PI * 2) * (22 + stairRng() * 10)) : Math.round(EDGE_KEEP + STAIR_D_R + stairRng() * (sizeX - 2 * (EDGE_KEEP + STAIR_D_R)));
    const dcz = first ? Math.round(96 + Math.sin(stairRng() * Math.PI * 2) * (22 + stairRng() * 10)) : Math.round(EDGE_KEEP + STAIR_D_R + stairRng() * (sizeZ - 2 * (EDGE_KEEP + STAIR_D_R)));
    const scx = Math.round(dcx + Math.cos(ang) * dist), scz = Math.round(dcz + Math.sin(ang) * dist);
    const mS = EDGE_KEEP + STAIR_S_R, mD = EDGE_KEEP + STAIR_D_R;
    if (scx < mS || scz < mS || scx >= sizeX - mS || scz >= sizeZ - mS) continue;
    if (dcx < mD || dcz < mD || dcx >= sizeX - mD || dcz >= sizeZ - mD) continue;
    if (first && Math.hypot(dcx - 96, dcz - 96) > 32) continue;
    if (!first && stairs.some(s => Math.hypot(s.s.cx - scx, s.s.cz - scz) < 50)) continue;
    const s: Room = { id: -1, layer: 'shallow', cx: scx, cz: scz, floorY: STAIR_TOP, rx: STAIR_S_R, rz: STAIR_S_R, h: 6 };
    const d: Room = { id: -1, layer: 'deep', cx: dcx, cz: dcz, floorY: STAIR_BOTTOM, rx: STAIR_D_R, rz: STAIR_D_R, h: 8 };
    if (!roomClear(s, 4) || !roomClear(d, 4)) continue;
    const points = stairLine(s, d);
    if (!clearOfAll(points, '')) continue;
    if (points.some(p => rectDist(grow(hall, 6), Math.floor(p.x), Math.floor(p.z)) <= 0)) continue;
    if (points.some(p => p.f >= 33 && thin[Math.floor(p.x) + sizeX * Math.floor(p.z)])) continue;
    // Not across another room either.
    if (points.some(p => rooms.some(o => Math.hypot(o.cx - p.x, o.cz - p.z) < Math.max(o.rx, o.rz) + 5 && clash(p.f, p.f + 4, o.floorY, o.floorY + o.h)))) continue;
    s.id = rooms.length; rooms.push(s);
    d.id = rooms.length; rooms.push(d);
    stairs.push({ s, d, points });
    for (const p of points) reserved.add({ x: p.x, z: p.z, r: 2.5, y0: p.f, y1: p.f + TUNNEL.height - 1, owner: `stair${stairs.length - 1}`, attach: [s.id, d.id] });
  }

  // The rest of the rooms, by rejection (at most 300 tries each).
  for (const L of LAYERS) {
    const rng = caveStream(seed, L.id === 'shallow' ? 3 : 4);
    const want = L.rooms;
    let have = rooms.filter(r => r.layer === L.id).length;
    for (let n = have; n < want; n++) {
      for (let t = 0; t < 300; t++) {
        const rx = L.radius[0] + Math.floor(rng() * (L.radius[1] - L.radius[0] + 1));
        const rz = L.radius[0] + Math.floor(rng() * (L.radius[1] - L.radius[0] + 1));
        const m = EDGE_KEEP + Math.max(rx, rz) + 1;
        const cx = m + Math.floor(rng() * (sizeX - 2 * m));
        const cz = m + Math.floor(rng() * (sizeZ - 2 * m));
        const floorY = L.floorMin + Math.floor(rng() * (L.floorMax - L.floorMin + 1));
        const h = L.roomHeight[0] + Math.floor(rng() * (L.roomHeight[1] - L.roomHeight[0] + 1));
        const r: Room = { id: rooms.length, layer: L.id, cx, cz, floorY, rx, rz, h };
        if (!roomClear(r)) continue;
        rooms.push(r);
        have++;
        break;
      }
    }
  }

  // Tunnels: a minimum spanning tree per layer plus 3 loops, over the pairs whose tunnel stays clear.
  const lines: CavePlan['lines'] = [];
  const edges: Array<[number, number]> = [];
  const tunnelRng = caveStream(seed, 5);
  const lineClear = (a: Room, b: Room, pts: PathPoint[]): boolean => {
    for (let n = 0; n < pts.length; n += 2) {
      const p = pts[n];
      const px = Math.floor(p.x), pz = Math.floor(p.z);
      if (px < EDGE_KEEP || pz < EDGE_KEEP || px >= sizeX - EDGE_KEEP || pz >= sizeZ - EDGE_KEEP) return false;
      if (a.layer === 'shallow' && thin[px + sizeX * pz]) return false;
      if (a.layer === 'deep' && (a.id !== -1 && b.id !== -1) && rectDist(grow(hall, 4), px, pz) <= 0) return false;
      for (const s of reserved.near(p.x, p.z, 2.5 + 2)) {
        if (s.attach.some(id => (id === a.id && Math.hypot(p.x - a.cx - 0.5, p.z - a.cz - 0.5) <= a.rx + 6)
          || (id === b.id && Math.hypot(p.x - b.cx - 0.5, p.z - b.cz - 0.5) <= b.rx + 6))) continue;
        if (clash(p.f, p.f + TUNNEL.height - 1, s.y0, s.y1)) return false;
      }
    }
    return true;
  };
  for (const L of LAYERS) {
    const layerRooms = rooms.filter(r => r.layer === L.id);
    const cand: Array<{ a: Room; b: Room; len: number; pts: PathPoint[] }> = [];
    // Each room's eight nearest neighbours in its layer (a spanning tree never needs a far one).
    const pairs = new Set<string>();
    for (const a of layerRooms) {
      const near = layerRooms.filter(b => b !== a).sort((p, q) => Math.hypot(p.cx - a.cx, p.cz - a.cz) - Math.hypot(q.cx - a.cx, q.cz - a.cz)).slice(0, 8);
      for (const b of near) pairs.add(a.id < b.id ? `${a.id},${b.id}` : `${b.id},${a.id}`);
    }
    const byId = new Map(layerRooms.map(r => [r.id, r]));
    for (const key of [...pairs].sort((p, q) => { const [a1, b1] = p.split(',').map(Number); const [a2, b2] = q.split(',').map(Number); return a1 - a2 || b1 - b2; })) {
      const [ia, ib] = key.split(',').map(Number);
      const a = byId.get(ia)!, b = byId.get(ib)!;
      const len = Math.hypot(a.cx - b.cx, a.cz - b.cz);
      if (len > 90) continue;
      const pts = tunnelLine(a, b, tunnelRng);
      if (lineClear(a, b, pts)) cand.push({ a, b, len, pts });
    }
    cand.sort((p, q) => p.len - q.len || p.a.id - q.a.id || p.b.id - q.b.id);
    const parent = new Map<number, number>(layerRooms.map(r => [r.id, r.id]));
    const find = (x: number): number => { while (parent.get(x) !== x) { const p = parent.get(parent.get(x)!)!; parent.set(x, p); x = p; } return x; };
    const spare: typeof cand = [];
    for (const c of cand) {
      const ra = find(c.a.id), rb = find(c.b.id);
      if (ra !== rb) { parent.set(ra, rb); edges.push([c.a.id, c.b.id]); lines.push({ a: c.a.id, b: c.b.id, points: c.pts }); }
      else spare.push(c);
    }
    // Three loops: the shortest spare tunnels that do not run alongside one already there.
    let loops = 0;
    for (const c of spare) {
      if (loops >= 3) break;
      edges.push([c.a.id, c.b.id]);
      lines.push({ a: c.a.id, b: c.b.id, points: c.pts });
      loops++;
    }
    // Rooms the tree could not reach are dropped (never a room with no way in).
    const main = find(layerRooms.find(r => stairs.some(s => s.s.id === r.id || s.d.id === r.id))?.id ?? layerRooms[0].id);
    for (const r of layerRooms) if (find(r.id) !== main) r.h = 0;
  }
  // Remove unreachable rooms (h 0) and the tunnels to them; keep ids dense.
  const keep = rooms.filter(r => r.h > 0);
  const remap = new Map<number, number>();
  keep.forEach((r, i) => { remap.set(r.id, i); });
  const liveLines = lines.filter(l => remap.has(l.a) && remap.has(l.b));
  for (const r of keep) r.id = remap.get(r.id)!;
  const liveEdges = liveLines.map(l => [remap.get(l.a)!, remap.get(l.b)!] as [number, number]);
  for (const l of liveLines) { l.a = remap.get(l.a)!; l.b = remap.get(l.b)!; }

  // The Old Hideout joins the deep network by two tunnels to its two nearest clear rooms.
  const ruinLinks: CavePlan['ruinLinks'] = [];
  const deepRooms = keep.filter(r => r.layer === 'deep').sort((a, b) =>
    Math.hypot(a.cx - ruinRoom.cx, a.cz - ruinRoom.cz) - Math.hypot(b.cx - ruinRoom.cx, b.cz - ruinRoom.cz));
  for (const r of deepRooms) {
    if (ruinLinks.length >= 2) break;
    const pts = tunnelLine(ruinRoom, r, tunnelRng);
    if (lineClear(ruinRoom, r, pts)) ruinLinks.push({ room: r.id, points: pts });
  }

  // Draw the two layer fields.
  const shallow = new CaveField(sizeX, sizeZ, CARVE_MAX_Y);
  const deep = new CaveField(sizeX, sizeZ, DEEP_TOP);
  for (const r of keep) rasterRoom(r.layer === 'shallow' ? shallow : deep, r);
  for (const l of liveLines) rasterPath(keep[l.a].layer === 'shallow' ? shallow : deep, l.points);
  // The hall is a flat-roofed rectangle, not a dome.
  for (let z = hall.z0; z <= hall.z1; z++) for (let x = hall.x0; x <= hall.x1; x++) deep.add(x, z, hall.floorY, hall.floorY + hall.height - 1);
  for (const l of ruinLinks) rasterPath(deep, l.points);

  const liveMouths = mouths.filter(m => m.room.h > 0);
  const liveStairs = stairs.filter(st => st.s.h > 0 && st.d.h > 0);
  return { rooms: keep, edges: liveEdges, mouths: liveMouths, stairs: liveStairs, lines: liveLines, ruinLinks, shallow, deep, thin, reserved };
}

/** Clears an outer-land tree (trunk and canopy) in the way of a mouth. */
function clearTree(world: World, ground: Int16Array, t: { x: number; z: number }): void {
  const g = ground[t.x + world.sizeX * t.z];
  for (let y = g + 1; y <= g + 7 && y < world.sizeY; y++) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const id = world.get(t.x + dx, y, t.z + dz);
      if (id === BlockId.Wood || id === BlockId.Leaves) world.set(t.x + dx, y, t.z + dz, BlockId.Air);
    }
  }
}

/**
 * Carves a mouth's ramp: 5 wide, 5 high, from the outer cell down to its room (an open trench
 * where the ground is low, a doorway where it rises), filling at most a block under the floor on
 * flat ground. Two DoorFrame posts with a Lamp on top stand either side of the way in.
 * Returns the mouth's changed-columns rectangle.
 */
export function carveMouth(world: World, ground: Int16Array, m: MouthPlan, carved: Uint8Array, walk: Uint8Array): Rect {
  for (const t of m.clearTrees) clearTree(world, ground, t);
  const box = { x0: m.o[0], z0: m.o[2], x1: m.o[0], z1: m.o[2] };
  const take = (x: number, z: number): void => {
    box.x0 = Math.min(box.x0, x); box.z0 = Math.min(box.z0, z); box.x1 = Math.max(box.x1, x); box.z1 = Math.max(box.z1, z);
  };
  const cells = world.buffer;
  for (const c of m.columns) {
    // A floor under every step (on flat ground the first steps may need one block of fill).
    if (!BLOCKS[world.get(c.x, c.f - 1, c.z)].solid) world.set(c.x, c.f - 1, c.z, BlockId.Dirt);
    for (let y = c.f; y <= c.t; y++) {
      const i = cellIndex(world, c.x, y, c.z);
      walk[i] = 1;
      if (cells[i] !== BlockId.Air) { cells[i] = BlockId.Air; carved[i] = 1; }
    }
    if (c.t >= CARVE_MAX_Y + 1) take(c.x, c.z);
  }
  // Posts: DoorFrame, two high, with a Lamp on top, either side of the outer cell.
  for (const l of [-3, 3]) {
    const x = m.o[0] - m.dir[1] * l, z = m.o[2] + m.dir[0] * l;
    const g = ground[x + world.sizeX * z];
    world.set(x, g + 1, z, BlockId.DoorFrame);
    world.set(x, g + 2, z, BlockId.DoorFrame);
    world.set(x, g + 3, z, BlockId.Lamp);
    take(x, z);
  }
  return grow(box, 3);
}

/** Carves a stair (its own small field, repaired so every step is at most 1). */
export function carveStairs(world: World, plan: StairPlan, carved: Uint8Array, walk?: Uint8Array): Stairs {
  const field = new CaveField(world.sizeX, world.sizeZ, CARVE_MAX_Y);
  rasterPath(field, plan.points);
  // Keep the stair's own columns only where they are not already its rooms (those are flat).
  repairFloors(field);
  carveField(world, field, carved, walk);
  const cells: Cell[] = [];
  const seen = new Set<number>();
  for (const p of plan.points) {
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const k = x + world.sizeX * z;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push([x, field.F[k], z]);
  }
  return { from: plan.s.id, to: plan.d.id, cells };
}

// ---------------------------------------------------------------------------------------------
// Walking the caves
// ---------------------------------------------------------------------------------------------

export interface Flood {
  /** Feet cells reached, in BFS order. */
  order: number[];
  /** Parent feet index per reached cell (-1 for a start). */
  parent: Map<number, number>;
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
];

/** Feet index back to a cell. */
export function cellOf(world: { sizeX: number; sizeZ: number }, i: number): Cell {
  const layer = world.sizeX * world.sizeZ;
  const y = Math.floor(i / layer);
  const r = i - y * layer;
  const z = Math.floor(r / world.sizeX);
  return [r - z * world.sizeX, y, z];
}

/**
 * Breadth-first walk on foot (ordinary steps only, the same canStep rule as everyone, no drops),
 * from every start, through cells that `inside` allows. Used for the trail and the way home.
 */
export function floodWalk(world: World, starts: readonly Cell[], inside: (i: number) => boolean, maxNodes = 400_000): Flood {
  const parent = new Map<number, number>();
  const order: number[] = [];
  for (const s of starts) {
    const k = cellIndex(world, s[0], s[1], s[2]);
    if (!parent.has(k) && isStandable(world, s)) { parent.set(k, -1); order.push(k); }
  }
  for (let head = 0; head < order.length && order.length < maxNodes; head++) {
    const k = order[head];
    const cur = cellOf(world, k);
    for (const [dx, dy, dz] of STEPS) {
      const nx = cur[0] + dx, ny = cur[1] + dy, nz = cur[2] + dz;
      if (!world.inBounds(nx, ny, nz)) continue;
      const nk = cellIndex(world, nx, ny, nz);
      if (parent.has(nk) || !inside(nk)) continue;
      if (!canStep(world, cur, [nx, ny, nz])) continue;
      parent.set(nk, k);
      order.push(nk);
    }
  }
  return { order, parent };
}

/** The floor cell (feet) at a room's centre, or the nearest standable cell to it on the room's floor. */
export function roomCentre(world: World, r: Room): Cell {
  for (let rad = 0; rad <= 4; rad++) {
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
      for (let y = r.floorY + 3; y >= r.floorY - 3; y--) {
        const c: Cell = [r.cx + dx, y, r.cz + dz];
        if (isStandable(world, c)) return c;
      }
    }
  }
  return [r.cx, r.floorY, r.cz];
}

// ---------------------------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------------------------

/** Rock the trail may pave (it never covers a rug, a Planks floor or a lamp). */
const PAVABLE: ReadonlySet<BlockId> = new Set([BlockId.Stone, BlockId.Dirt, BlockId.Grass]);
/** A Lamp is set into the floor beside the trail every this many cells. */
export const TRAIL_LAMP_EVERY = 6;

/**
 * The pale cobble trail home: from every room's centre, the shortest walk on foot (no drops) to
 * the nearest mouth, through the stairs where it must. Its floor becomes PathStone, 3 wide, with
 * a Lamp set into the floor beside it every 6 cells. Treasure rooms and the inside of the Old
 * Hideout are left as they are (`skip`). Returns the trail's floor cells (world indices).
 */
export function layTrail(
  world: World, rooms: readonly Room[], mouths: ReadonlyArray<{ cell: Cell }>, walk: Uint8Array, skip: readonly Rect[],
): { trail: Set<number>; lamps: Cell[]; paths: Cell[][] } {
  const inSkip = (x: number, z: number): boolean => skip.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const inside = (i: number): boolean => {
    if (!walk[i]) return false;
    const [x, , z] = cellOf(world, i);
    return !inSkip(x, z);
  };
  const flood = floodWalk(world, mouths.map(m => m.cell), inside);
  const trail = new Set<number>();
  const lamps: Cell[] = [];
  const paths: Cell[][] = [];
  const paveAt = (x: number, y: number, z: number): void => {
    if (!isStandable(world, [x, y, z]) || inSkip(x, z)) return;
    const feet = cellIndex(world, x, y, z);
    if (!walk[feet] && !mouths.some(m => m.cell[0] === x && m.cell[1] === y && m.cell[2] === z)) return;
    const k = cellIndex(world, x, y - 1, z);
    if (trail.has(k)) return;
    if (PAVABLE.has(world.get(x, y - 1, z))) world.set(x, y - 1, z, BlockId.PathStone);
    if (world.get(x, y - 1, z) === BlockId.PathStone) trail.add(k);
  };
  for (const r of rooms) {
    const c = roomCentre(world, r);
    let k = cellIndex(world, c[0], c[1], c[2]);
    if (!flood.parent.has(k)) continue;
    const path: Cell[] = [];
    while (k !== -1) { path.push(cellOf(world, k)); k = flood.parent.get(k)!; }
    paths.push(path);
  }
  for (const path of paths) {
    for (const [x, y, z] of path) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) paveAt(x + dx, y, z + dz);
  }
  // Lamps beside the trail.
  const lampNear = (x: number, y: number, z: number): boolean => lamps.some(l => Math.abs(l[0] - x) + Math.abs(l[1] - y) + Math.abs(l[2] - z) < 4);
  for (const path of paths) {
    for (let j = 3; j < path.length - 1; j += TRAIL_LAMP_EVERY) {
      const [x, y, z] = path[j];
      const [nx, , nz] = path[j + 1];
      const dx = nx - x, dz = nz - z;
      for (const side of [1, -1]) {
        const lx = x - dz * 2 * side, lz = z + dx * 2 * side;
        if (lampNear(lx, y - 1, lz)) break;
        const feet = cellIndex(world, lx, y, lz);
        if (!walk[feet] || inSkip(lx, lz) || !isStandable(world, [lx, y, lz])) continue;
        const floor = cellIndex(world, lx, y - 1, lz);
        if (trail.has(floor) || !PAVABLE.has(world.get(lx, y - 1, lz))) continue;
        world.set(lx, y - 1, lz, BlockId.Lamp);
        lamps.push([lx, y - 1, lz]);
        break;
      }
    }
  }
  return { trail, lamps, paths };
}
