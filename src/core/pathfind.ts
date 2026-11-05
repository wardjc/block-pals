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

/** A cardinal step needs clearance over the lower end as well as at both feet cells. */
export function canStep(world: World, from: Cell, to: Cell): boolean {
  if (Math.abs(from[0] - to[0]) + Math.abs(from[2] - to[2]) !== 1
    || Math.abs(from[1] - to[1]) > 1
    || !isStandable(world, from) || !isStandable(world, to)) return false;
  if (from[1] === to[1]) return true;
  const lower = from[1] < to[1] ? from : to;
  return !BLOCKS[world.get(lower[0], lower[1] + 2, lower[2])].solid;
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

export function findPath(world: World, from: Cell, to: Cell, maxNodes = 4000): Cell[] | null {
  if (!isStandable(world, from) || !isStandable(world, to)) return null;
  const key = ([x, y, z]: Cell): number => x + world.sizeX * (z + world.sizeZ * y);
  const heuristic = ([x, y, z]: Cell): number => Math.max(
    Math.abs(x - to[0]) + Math.abs(z - to[2]), Math.abs(y - to[1]),
  );
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
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1, -1]) {
        const cell: Cell = [x + dx, y + dy, z + dz];
        if (!canStep(world, current.cell, cell)) continue;
        const g = current.g + 1;
        if (g >= (costs.get(key(cell)) ?? Infinity)) continue;
        costs.set(key(cell), g);
        frontier.push({ cell, g, f: g + heuristic(cell), parent: current });
      }
    }
  }
  return null;
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
 * One breadth-first flood from the player, using the same steps as findPath.
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
