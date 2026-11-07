import { BLOCKS, BlockId } from './blocks';
import type { World } from './world';

export type Cell = [number, number, number]; // Feet cell.

export function isStandable(world: World, [x, y, z]: Cell): boolean {
  // Support must be inside the world; World.get supplies air above its roof.
  return world.inBounds(x, y - 1, z)
    && BLOCKS[world.get(x, y - 1, z)].solid
    && !BLOCKS[world.get(x, y, z)].solid
    && !BLOCKS[world.get(x, y + 1, z)].solid
    && world.get(x, y, z) !== BlockId.Water;
}

/** Every step clears both bodies and the lower ceiling; diagonals also clear both flanks. */
export function canStep(world: World, from: Cell, to: Cell, allowed: (cell: Cell) => boolean = () => true): boolean {
  return checkStep(world, from, to, allowed, cell => isStandable(world, cell));
}

function checkStep(
  world: World, from: Cell, to: Cell, allowed: (cell: Cell) => boolean,
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

export function nearestStandable(world: World, x: number, z: number): Cell | null {
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
  world: World, from: Cell, to: Cell, maxNodes = 4000,
  allowed: (cell: Cell) => boolean = () => true,
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
    }
  }
  return null;
}

/** Circle-versus-block clearance at a world-space feet position. */
function bodyClear(world: World, x: number, y: number, z: number, radius: number): boolean {
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

function lineClear(world: World, from: Cell, to: Cell, allowed: (cell: Cell) => boolean): boolean {
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
export function smoothPath(
  world: World, path: Cell[], from?: Cell, allowed: (cell: Cell) => boolean = () => true,
): Cell[] {
  if (path.length === 0) return [];
  const points = from ? [from, ...path] : path;
  const result: Cell[] = from ? [] : [[...points[0]]];
  for (let anchor = 0; anchor < points.length - 1;) {
    let end = anchor + 1;
    if (points[anchor][1] === points[end][1]) {
      let last = end;
      while (last + 1 < points.length && points[last + 1][1] === points[anchor][1]) last++;
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

/**
 * One four-neighbour breadth-first flood from the player, using cardinal canStep rules.
 * Picks the reachable standable cell nearest the goal (goalDistance); ties go to the
 * cell fewest steps from the player, which BFS order gives for free. Stops early once
 * the goal itself is reached. `allowed` keeps the flood inside the soft wall.
 * Returns null when `from` is not standable.
 */
export function pathTowards(
  world: World, from: Cell, goal: Cell,
  allowed: (cell: Cell) => boolean = () => true, maxNodes = 8000,
): Approach | null {
  if (!isStandable(world, from)) return null;
  const sx = world.sizeX;
  const sxz = sx * world.sizeZ;
  const key = ([x, y, z]: Cell): number => x + sx * z + sxz * y;
  const decode = (k: number): Cell => [k % sx, Math.floor(k / sxz), Math.floor((k % sxz) / sx)];
  // Typed arrays keep one flood well under a millisecond or two on the tablet.
  const parent = new Int32Array(sxz * world.sizeY).fill(-2); // -2 unseen, -1 start
  const queue = new Int32Array(Math.min(parent.length, maxNodes));
  const start = key(from);
  parent[start] = -1;
  queue[0] = start;
  let tail = 1;
  let best = start;
  let bestDistance = goalDistance(from, goal);
  const startDistance = bestDistance;
  // Standability is asked up to 12 times per cell, so remember it (0 unknown, 1 yes, 2 no).
  const standCache = new Uint8Array(parent.length);
  const cell: Cell = [0, 0, 0];
  const standable = (k: number): boolean => {
    if (standCache[k] === 0) {
      cell[0] = k % sx; cell[1] = Math.floor(k / sxz); cell[2] = Math.floor((k % sxz) / sx);
      standCache[k] = isStandable(world, cell) && allowed(cell) ? 1 : 2;
    }
    return standCache[k] === 1;
  };
  for (let head = 0; head < tail && bestDistance > 0; head++) {
    const k = queue[head];
    const x = k % sx;
    const y = Math.floor(k / sxz);
    const z = Math.floor((k % sxz) / sx);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= sx || nz >= world.sizeZ) continue;
      for (const dy of [0, 1, -1]) {
        const ny = y + dy;
        if (ny < 0 || ny >= world.sizeY) continue;
        const nk = nx + sx * nz + sxz * ny;
        if (parent[nk] !== -2 || tail >= queue.length || !standable(nk)) continue;
        // Same rule as canStep: a height change needs headroom over the lower end.
        if (dy === 1 && BLOCKS[world.get(x, y + 2, z)].solid) continue;
        if (dy === -1 && BLOCKS[world.get(nx, ny + 2, nz)].solid) continue;
        parent[nk] = k;
        queue[tail++] = nk;
        const d = Math.max(Math.abs(nx - goal[0]), Math.abs(nz - goal[2])) + Math.abs(ny - goal[1]);
        if (d < bestDistance) {
          best = nk;
          bestDistance = d;
        }
      }
    }
  }
  const path: Cell[] = [];
  for (let k = best; k !== start; k = parent[k]) path.push(decode(k));
  path.reverse();
  return {
    path,
    end: decode(best),
    distance: bestDistance,
    startDistance,
    visited: tail,
    reached: cell => world.inBounds(...cell) && parent[key(cell)] !== -2,
  };
}
