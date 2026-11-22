import { BLOCKS, BlockId } from './blocks';
import type { WorldCells } from './shifted';
import { World } from './world';

/** 1 for a solid block id, 0 otherwise: one typed-array read in the hot loops. */
const SOLID = new Uint8Array(256);
for (const [id, def] of Object.entries(BLOCKS)) if (def.solid) SOLID[Number(id)] = 1;

export type Cell = [number, number, number]; // Feet cell.

export function isStandable(world: WorldCells, [x, y, z]: Cell): boolean {
  // Support must be inside the world; World.get supplies air above its roof.
  return world.inBounds(x, y - 1, z)
    && BLOCKS[world.get(x, y - 1, z)].solid
    && !BLOCKS[world.get(x, y, z)].solid
    && !BLOCKS[world.get(x, y + 1, z)].solid
    && world.get(x, y, z) !== BlockId.Water;
}

/**
 * How far he and Pip may walk off an edge and glide down, softly. Only the player, Pip and the
 * player's own route search pass it; animals, villagers and everything else keep the 1-block rule.
 */
export const GENTLE_DROP = 12;

/**
 * Every step clears both bodies and the lower ceiling; diagonals also clear both flanks. With
 * `maxDrop` above 1 an orthogonal step may also be a gentle drop of 2 to `maxDrop` blocks (see dropLanding).
 */
export function canStep(
  world: WorldCells, from: Cell, to: Cell, allowed: (cell: Cell) => boolean = () => true, maxDrop = 1,
): boolean {
  if (maxDrop > 1 && from[1] - to[1] >= 2) return dropStep(world, from, to, allowed, maxDrop, cell => isStandable(world, cell));
  return checkStep(world, from, to, allowed, cell => isStandable(world, cell));
}

/**
 * Where a walk off the edge from `from` into column (nx, nz) lands: the first floor below, when it is
 * 2 to `maxDrop` blocks down and the whole column from his head height down to the landing is clear
 * of solids and water (no drop through a roof or into water). null when there is no such drop.
 * The landing is never mid-air: he glides until his feet meet the ground.
 */
export function dropLanding(world: WorldCells, from: Cell, nx: number, nz: number, maxDrop: number): number | null {
  const y = from[1];
  if (!world.inBounds(nx, y, nz)) return null;
  if (world instanceof World) {
    // Same scan straight from the buffer (the route searches ask this for every step they consider).
    const cells = world.buffer;
    const layer = world.sizeX * world.sizeZ;
    const col = nx + world.sizeX * nz;
    for (let cy = y + 1; cy >= y - maxDrop - 1 && cy >= 0; cy--) {
      const id = cy < world.sizeY ? cells[col + layer * cy] : BlockId.Air;
      if (id === BlockId.Water) return null;
      if (SOLID[id] === 1) {
        const landing = cy + 1;
        return y - landing >= 2 && y - landing <= maxDrop ? landing : null;
      }
    }
    return null;
  }
  // From head height on the edge straight down the column.
  for (let cy = y + 1; cy >= y - maxDrop - 1 && cy >= 0; cy--) {
    const id = world.get(nx, cy, nz);
    if (id === BlockId.Water) return null;
    if (BLOCKS[id].solid) {
      const landing = cy + 1;
      // A solid at the edge's feet or head is a wall; 0 or 1 down is a normal step, not a drop.
      return y - landing >= 2 && y - landing <= maxDrop ? landing : null;
    }
  }
  return null;
}

function dropStep(
  world: WorldCells, from: Cell, to: Cell, allowed: (cell: Cell) => boolean, maxDrop: number,
  standable: (cell: Cell) => boolean,
): boolean {
  const dx = Math.abs(from[0] - to[0]);
  const dz = Math.abs(from[2] - to[2]);
  if (dx + dz !== 1 || !allowed(to) || !standable(from)) return false;
  return dropLanding(world, from, to[0], to[2], maxDrop) === to[1] && standable(to);
}

function checkStep(
  world: WorldCells, from: Cell, to: Cell, allowed: (cell: Cell) => boolean,
  standable: (cell: Cell) => boolean,
): boolean {
  const dx = Math.abs(from[0] - to[0]);
  const dz = Math.abs(from[2] - to[2]);
  if (Math.max(dx, dz) !== 1
    || Math.abs(from[1] - to[1]) > 1
    || !allowed(to) || !standable(from) || !standable(to)) return false;
  if (from[1] !== to[1]) {
    const lower = from[1] < to[1] ? from : to;
    if (BLOCKS[world.get(lower[0], lower[1] + 2, lower[2])].solid) return false;
  }
  if (dx === 0 || dz === 0) return true;
  return [[to[0], from[2]], [from[0], to[2]]].every(([x, z]) =>
    [0, 1, -1].some(dy => {
      const side: Cell = [x, from[1] + dy, z];
      return checkStep(world, from, side, allowed, standable) && checkStep(world, side, to, allowed, standable);
    }));
}

/**
 * A body (him, Pip, Orlo, a villager, an animal) placed at `cell` after his edits replayed: never
 * buried, never in the void, never inside a block. TOTAL: it always returns a cell whose two body
 * cells are not solid.
 *  - A standable cell is returned as it is.
 *  - Otherwise every column is scanned top to bottom (including the original height, and the cell
 *    on top of the world's highest block), ring by rings outwards, to the whole world if needed;
 *    the nearest standable cell wins (blocks moved sideways plus blocks moved up or down; a buried
 *    body prefers going up, one over a hole prefers going down).
 *  - Only if no standable cell exists anywhere: the cell above the highest solid block of its own
 *    column (two non-solid body cells, as the world's roof is open air).
 */
export function settleCell(world: WorldCells, cell: Cell): Cell {
  if (isStandable(world, cell)) return cell;
  const [x, y, z] = cell;
  const buried = BLOCKS[world.get(x, y, z)].solid || BLOCKS[world.get(x, y + 1, z)].solid;
  // Smaller is better: blocks moved sideways (ring) plus blocks moved up or down, then the preferred direction.
  const vert = (cy: number): number => Math.abs(cy - y) * 2 + ((buried ? cy < y : cy > y) ? 1 : 0);
  const bestIn = (cx: number, cz: number): Cell | null => {
    let best: Cell | null = null;
    for (let cy = 1; cy <= world.sizeY; cy++) {
      if (isStandable(world, [cx, cy, cz]) && (!best || vert(cy) < vert(best[1]))) best = [cx, cy, cz];
    }
    return best;
  };
  const maxR = Math.max(world.sizeX, world.sizeZ);
  let best: Cell | null = null;
  let bestCost = Infinity;
  for (let r = 0; r <= maxR && 2 * r <= bestCost; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !world.inBounds(x + dx, 0, z + dz)) continue;
        const c = bestIn(x + dx, z + dz);
        const cost = c ? 2 * r + vert(c[1]) : Infinity;
        if (c && cost < bestCost) { best = c; bestCost = cost; }
      }
    }
  }
  if (best) return best;
  const cx = world.inBounds(x, 0, z) ? x : 0;
  const cz = world.inBounds(x, 0, z) ? z : 0;
  return [cx, world.topSolidY(cx, cz) + 1, cz];
}

export function nearestStandable(world: WorldCells, x: number, z: number): Cell | null {
  const cell: Cell = [x, world.topSolidY(x, z) + 1, z];
  return isStandable(world, cell) ? cell : null;
}

type Node = { cell: Cell; g: number; f: number; parent: Node | null };

// A binary heap keeps the bounded A* search inexpensive on a tablet.
class Frontier {
  private nodes: Node[] = [];

  private before(a: Node, b: Node): boolean {
    return a.f < b.f || (a.f === b.f && a.g > b.g);
  }

  push(node: Node): void {
    let i = this.nodes.length;
    this.nodes.push(node);
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.before(node, this.nodes[parent])) break;
      this.nodes[i] = this.nodes[parent];
      i = parent;
    }
    this.nodes[i] = node;
  }

  pop(): Node | undefined {
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (!last || this.nodes.length === 0) return first;
    let i = 0;
    while (i * 2 + 1 < this.nodes.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.nodes.length && this.before(this.nodes[child + 1], this.nodes[child])) child++;
      if (!this.before(this.nodes[child], last)) break;
      this.nodes[i] = this.nodes[child];
      i = child;
    }
    this.nodes[i] = last;
    return first;
  }
}

export function findPath(
  world: WorldCells, from: Cell, to: Cell, maxNodes = 4000,
  allowed: (cell: Cell) => boolean = () => true, maxDrop = 1,
): Cell[] | null {
  if (!isStandable(world, from) || !isStandable(world, to) || !allowed(to)) return null;
  const key = ([x, y, z]: Cell): number => x + world.sizeX * (z + world.sizeZ * y);
  // Neighbours and diagonal flanks revisit the same columns many times per search.
  const standCache = new Map<number, boolean>();
  const standable = (cell: Cell): boolean => {
    if (!world.inBounds(cell[0], cell[1] - 1, cell[2])) return false;
    const k = key(cell);
    let value = standCache.get(k);
    if (value === undefined) {
      value = isStandable(world, cell);
      standCache.set(k, value);
    }
    return value;
  };
  const heuristic = ([x, y, z]: Cell): number => {
    const dx = Math.abs(x - to[0]);
    const dz = Math.abs(z - to[2]);
    // Height can change during a horizontal step, so adding dy would overestimate.
    return Math.max(Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz), Math.abs(y - to[1]));
  };
  const target = key(to);
  if (key(from) === target) return [];
  const frontier = new Frontier();
  const costs = new Map<number, number>([[key(from), 0]]);
  frontier.push({ cell: [...from], g: 0, f: heuristic(from), parent: null });

  // Count expanded nodes, not stale heap entries superseded by a shorter route.
  for (let expanded = 0; expanded < Math.floor(maxNodes);) {
    const current = frontier.pop();
    if (!current) break;
    if (costs.get(key(current.cell)) !== current.g) continue;
    expanded++;
    if (key(current.cell) === target) {
      const path: Cell[] = [];
      for (let node = current; node.parent; node = node.parent) path.push(node.cell);
      return path.reverse();
    }
    const [x, y, z] = current.cell;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (const dy of [0, 1, -1]) {
        const cell: Cell = [x + dx, y + dy, z + dz];
        if (!checkStep(world, current.cell, cell, allowed, standable)) continue;
        const g = current.g + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (g >= (costs.get(key(cell)) ?? Infinity)) continue;
        costs.set(key(cell), g);
        frontier.push({ cell, g, f: g + heuristic(cell), parent: current });
      }
      // A gentle drop (orthogonal only). It costs its height, so the heuristic stays admissible.
      if (maxDrop > 1 && (dx === 0 || dz === 0)) {
        const landing = dropLanding(world, current.cell, x + dx, z + dz, maxDrop);
        if (landing === null) continue;
        const cell: Cell = [x + dx, landing, z + dz];
        if (!allowed(cell) || !standable(cell)) continue;
        const g = current.g + (y - landing);
        if (g >= (costs.get(key(cell)) ?? Infinity)) continue;
        costs.set(key(cell), g);
        frontier.push({ cell, g, f: g + heuristic(cell), parent: current });
      }
    }
  }
  return null;
}

/** Circle-versus-block clearance at a world-space feet position. */
function bodyClear(world: WorldCells, x: number, y: number, z: number, radius: number): boolean {
  for (let bx = Math.floor(x - radius); bx <= Math.floor(x + radius); bx++) {
    for (let bz = Math.floor(z - radius); bz <= Math.floor(z + radius); bz++) {
      const dx = Math.max(bx - x, 0, x - bx - 1);
      const dz = Math.max(bz - z, 0, z - bz - 1);
      if (dx * dx + dz * dz >= radius * radius) continue;
      if (BLOCKS[world.get(bx, y, bz)].solid || BLOCKS[world.get(bx, y + 1, bz)].solid) return false;
    }
  }
  return true;
}

function lineClear(world: WorldCells, from: Cell, to: Cell, allowed: (cell: Cell) => boolean): boolean {
  if (from[1] !== to[1]) return false;
  const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
  const samples = Math.max(1, Math.ceil(length / 0.1));
  // Half a sampling interval of padding also protects the body between samples.
  const radius = 0.3 + length / samples / 2;
  let previous = from;
  for (let i = 0; i <= samples; i++) {
    const x = from[0] + 0.5 + (to[0] - from[0]) * i / samples;
    const z = from[2] + 0.5 + (to[2] - from[2]) * i / samples;
    const cell: Cell = [Math.floor(x), from[1], Math.floor(z)];
    if (!allowed(cell) || !isStandable(world, cell) || !bodyClear(world, x, cell[1], z, radius)) return false;
    if ((cell[0] !== previous[0] || cell[2] !== previous[2]) && !canStep(world, previous, cell, allowed)) return false;
    previous = cell;
  }
  return true;
}

/**
 * Shortcuts level runs only, preserving both sides of every height change.
 * Paths exclude the start: pass `from` to check and simplify the first segment.
 * Without it, the first path cell is kept as the starting endpoint. Inputs are untouched.
 */
const SMOOTH_LOOKAHEAD = 16;

export function smoothPath(
  world: WorldCells, path: Cell[], from?: Cell, allowed: (cell: Cell) => boolean = () => true,
): Cell[] {
  if (path.length === 0) return [];
  const points = from ? [from, ...path] : path;
  const result: Cell[] = from ? [] : [[...points[0]]];
  for (let anchor = 0; anchor < points.length - 1;) {
    let end = anchor + 1;
    if (points[anchor][1] === points[end][1]) {
      let last = end;
      // Bounded look-ahead keeps long routes linear rather than quadratic.
      while (last + 1 < points.length && last - end < SMOOTH_LOOKAHEAD && points[last + 1][1] === points[anchor][1]) last++;
      for (let candidate = last; candidate > end; candidate--) {
        if (lineClear(world, points[anchor], points[candidate], allowed)) {
          end = candidate;
          break;
        }
      }
    }
    result.push([...points[end]]);
    anchor = end;
  }
  return result;
}

export interface Approach {
  /** Steps from `from` (exclusive) to `end`; empty when the player is already the closest. */
  path: Cell[];
  end: Cell;
  /** goalDistance of `end`, and of the start cell. */
  distance: number;
  startDistance: number;
  /** Cells explored; the whole reachable region unless the goal itself was reached or the cap hit. */
  visited: number;
  reached(cell: Cell): boolean;
}

/**
 * How far a cell is from a tapped goal: Chebyshev distance in x/z plus the height
 * difference, so a spot beside a tree trunk beats one under a far branch.
 */
export function goalDistance([x, y, z]: Cell, goal: Cell): number {
  return Math.max(Math.abs(x - goal[0]), Math.abs(z - goal[2])) + Math.abs(y - goal[1]);
}

/*
 * Search scratch, shared by every pathTowards call and grown only when a bigger world appears. At
 * 192 x 68 x 192 a fresh pair of whole-world arrays per tap was 12.5 MB; these are made once (7.5 MB).
 * Each cell's tag holds the search stamp (a multiple of 8) plus three flags, so starting a search is
 * one increment instead of a fill. When the 16-bit stamp runs out the tags are cleared once and it restarts.
 */
const SEEN = 1, KNOWN = 2, STANDS = 4, FLAGS = 7, STAMP_STEP = 8;
const MAX_STAMP = 0x10000 - STAMP_STEP;
/** Parent links as a direction code: 4 directions x a height change of -32..+1. 255 is the start. */
const START_CODE = 255;
const MAX_DROP_CODED = 30;
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STEP_DYS = [0, 1, -1] as const;
let tags = new Uint16Array(0);
let links = new Uint8Array(0);
let queueBuf = new Int32Array(0);
let stamp = 0;
/** Bumped by every search; an Approach is "current" while nothing has searched since. */
let searchCount = 0;

function beginSearch(cells: number, maxNodes: number): void {
  if (tags.length < cells) {
    tags = new Uint16Array(cells);
    links = new Uint8Array(cells);
    stamp = 0;
  }
  if (queueBuf.length < Math.min(cells, maxNodes)) queueBuf = new Int32Array(Math.min(cells, maxNodes));
  stamp += STAMP_STEP;
  if (stamp > MAX_STAMP) {
    tags.fill(0);
    stamp = STAMP_STEP;
  }
  searchCount++;
}

/** Test hook: the scratch sizes, and a way to push the stamp near its limit. */
export function __pathScratch(): { cells: number; bytes: number; maxStamp: number; forceStamp(n: number): void } {
  return {
    cells: tags.length,
    bytes: tags.byteLength + links.byteLength + queueBuf.byteLength,
    maxStamp: MAX_STAMP,
    forceStamp: n => { stamp = Math.floor(n / STAMP_STEP) * STAMP_STEP; },
  };
}

/**
 * One four-neighbour breadth-first flood from the player, using cardinal canStep rules.
 * Picks the reachable standable cell nearest the goal (goalDistance); ties go to the
 * cell fewest steps from the player, which BFS order gives for free. Stops early once
 * the goal itself is reached. `allowed` keeps the flood inside the soft wall. With `maxDrop`
 * above 1 the flood also takes gentle drops (one way, orthogonal), like canStep.
 * Returns null when `from` is not standable. Allocates nothing per call but the result.
 */
export function pathTowards(
  world: WorldCells, from: Cell, goal: Cell,
  allowed: (cell: Cell) => boolean = () => true, maxNodes = 8000, maxDrop = 1,
): Approach | null {
  if (!isStandable(world, from)) return null;
  const drop = Math.min(MAX_DROP_CODED, Math.max(1, Math.floor(maxDrop)));
  const sx = world.sizeX;
  const sz = world.sizeZ;
  const sxz = sx * sz;
  const cells = sxz * world.sizeY;
  const cap = Math.max(1, Math.min(cells, Math.floor(maxNodes)));
  beginSearch(cells, cap);
  const id = searchCount;
  const s = stamp;
  const t = tags;
  const link = links;
  const queue = queueBuf;
  const key = ([x, y, z]: Cell): number => x + sx * z + sxz * y;
  const decode = (k: number): Cell => [k % sx, Math.floor(k / sxz), Math.floor((k % sxz) / sx)];
  const flags = (k: number): number => ((t[k] & ~FLAGS) === s ? t[k] & FLAGS : 0);
  const cell: Cell = [0, 0, 0];
  // A plain World is read straight from its buffer (same rule as isStandable, no bounds checks per read).
  const raw = world instanceof World ? world.buffer : null;
  const solid = SOLID;
  // Standability is asked up to 12 times per cell, so remember it.
  const standable = (k: number): boolean => {
    const f = flags(k);
    if (f & KNOWN) return (f & STANDS) !== 0;
    cell[0] = k % sx; cell[1] = Math.floor(k / sxz); cell[2] = Math.floor((k % sxz) / sx);
    let yes: boolean;
    if (raw && cell[1] >= 1) {
      const feet = raw[k];
      yes = solid[raw[k - sxz]] === 1 && solid[feet] === 0 && feet !== BlockId.Water
        && (k + sxz >= cells || solid[raw[k + sxz]] === 0);
    } else {
      yes = isStandable(world, cell);
    }
    yes = yes && allowed(cell);
    t[k] = s | f | KNOWN | (yes ? STANDS : 0);
    return yes;
  };
  const start = key(from);
  t[start] = s | flags(start) | SEEN;
  link[start] = START_CODE;
  queue[0] = start;
  let tail = 1;
  let best = start;
  let bestDistance = goalDistance(from, goal);
  const startDistance = bestDistance;
  const visit = (nk: number, d: number, dy: number, nx: number, ny: number, nz: number): void => {
    t[nk] = s | flags(nk) | SEEN;
    link[nk] = d + 4 * (dy + 32);
    queue[tail++] = nk;
    const dist = Math.max(Math.abs(nx - goal[0]), Math.abs(nz - goal[2])) + Math.abs(ny - goal[1]);
    if (dist < bestDistance) {
      best = nk;
      bestDistance = dist;
    }
  };
  const here: Cell = [0, 0, 0];
  for (let head = 0; head < tail && bestDistance > 0; head++) {
    const k = queue[head];
    const x = k % sx;
    const y = Math.floor(k / sxz);
    const z = Math.floor((k % sxz) / sx);
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0];
      const nz = z + DIRS[d][1];
      if (nx < 0 || nz < 0 || nx >= sx || nz >= sz) continue;
      for (let j = 0; j < 3; j++) {
        const dy = STEP_DYS[j];
        const ny = y + dy;
        if (ny < 0 || ny >= world.sizeY) continue;
        const nk = nx + sx * nz + sxz * ny;
        if ((flags(nk) & SEEN) !== 0 || tail >= cap || !standable(nk)) continue;
        // Same rule as canStep: a height change needs headroom over the lower end.
        if (dy !== 0) {
          const hk = dy === 1 ? k + 2 * sxz : nk + 2 * sxz;
          const roof = raw ? (hk < cells && solid[raw[hk]] === 1)
            : (dy === 1 ? BLOCKS[world.get(x, y + 2, z)].solid : BLOCKS[world.get(nx, ny + 2, nz)].solid);
          if (roof) continue;
        }
        visit(nk, d, dy, nx, ny, nz);
      }
      if (drop > 1) {
        here[0] = x; here[1] = y; here[2] = z;
        const landing = dropLanding(world, here, nx, nz, drop);
        if (landing === null) continue;
        const nk = nx + sx * nz + sxz * landing;
        if ((flags(nk) & SEEN) !== 0 || tail >= cap || !standable(nk)) continue;
        visit(nk, d, landing - y, nx, landing, nz);
      }
    }
  }
  const path: Cell[] = [];
  for (let k = best; k !== start;) {
    path.push(decode(k));
    const code = link[k];
    const [dx, dz] = DIRS[code & 3];
    k = k - dx - sx * dz - sxz * ((code >> 2) - 32);
  }
  path.reverse();
  const origin: Cell = [from[0], from[1], from[2]];
  const target: Cell = [goal[0], goal[1], goal[2]];
  let redo: Approach | null = null;
  let redoId = -1;
  return {
    path,
    end: decode(best),
    distance: bestDistance,
    startDistance,
    visited: tail,
    reached: c => {
      if (!world.inBounds(...c)) return false;
      if (id === searchCount) return (flags(key(c)) & SEEN) !== 0;
      // Another search has reused the scratch since: answer from a fresh flood (same inputs, same answer).
      if (!redo || redoId !== searchCount) {
        redo = pathTowards(world, origin, target, allowed, maxNodes, maxDrop);
        redoId = searchCount;
      }
      return redo?.reached(c) ?? false;
    },
  };
}

