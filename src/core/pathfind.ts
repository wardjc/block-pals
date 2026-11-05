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
