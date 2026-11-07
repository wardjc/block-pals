import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { canStep, findPath, isStandable, nearestStandable, pathTowards, smoothPath, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';

function flatWorld(size = 9): World {
  const world = new World(size, 8, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) world.set(x, 0, z, BlockId.Grass);
  }
  return world;
}

describe('isStandable', () => {
  it('requires solid support, clear feet and head, and dry feet', () => {
    const world = flatWorld();
    expect(isStandable(world, [3, 1, 3])).toBe(true);
    for (const [y, id] of [[0, BlockId.Water], [1, BlockId.Water], [1, BlockId.Stone], [2, BlockId.Glass]] as const) {
      world.set(3, y, 3, id);
      expect(isStandable(world, [3, 1, 3])).toBe(false);
      world.set(3, y, 3, y === 0 ? BlockId.Grass : BlockId.Air);
    }
    world.set(3, 2, 3, BlockId.Water);
    expect(isStandable(world, [3, 1, 3])).toBe(true);
    for (const cell of [[-1, 1, 3], [9, 1, 3], [3, 0, 3], [3.5, 1, 3], [3, 1, 9]] as Cell[]) {
      expect(isStandable(world, cell)).toBe(false);
    }
  });
});

describe('findPath', () => {
  it('finds a straight path on flat ground, excluding the start', () => {
    expect(findPath(flatWorld(), [2, 1, 3], [5, 1, 3])).toEqual([
      [3, 1, 3], [4, 1, 3], [5, 1, 3],
    ]);
  });

  it('climbs a 1-block step but not 2, and steps back down', () => {
    const world = flatWorld();
    world.set(4, 1, 3, BlockId.Stone);
    expect(findPath(world, [3, 1, 3], [4, 2, 3])).toEqual([[4, 2, 3]]);
    expect(findPath(world, [4, 2, 3], [3, 1, 3])).toEqual([[3, 1, 3]]);
    world.set(4, 2, 3, BlockId.Stone);
    expect(findPath(world, [3, 1, 3], [4, 3, 3])).toBeNull();
  });

  it('returns null when enclosed and never targets or crosses water', () => {
    const world = flatWorld();
    for (const [x, z] of [[2, 3], [4, 3], [3, 2], [3, 4]]) {
      world.set(x, 1, z, BlockId.Water);
    }
    expect(findPath(world, [3, 1, 3], [6, 1, 3])).toBeNull();
    expect(findPath(world, [1, 1, 3], [2, 1, 3])).toBeNull();
    expect(findPath(world, [2, 1, 3], [1, 1, 3])).toBeNull();
    const path = findPath(world, [1, 1, 3], [5, 1, 3]);
    expect(path).not.toBeNull();
    let previous: Cell = [1, 1, 3];
    for (const cell of path!) {
      expect(isStandable(world, cell)).toBe(true);
      expect(canStep(world, previous, cell)).toBe(true);
      expect(Math.abs(cell[1] - previous[1])).toBeLessThanOrEqual(1);
      previous = cell;
    }
    expect(previous).toEqual([5, 1, 3]);
  });

  it('respects maxNodes', () => {
    const world = flatWorld();
    expect(findPath(world, [1, 1, 1], [7, 1, 7], 2)).toBeNull();
    expect(findPath(world, [1, 1, 1], [7, 1, 7], 100)).toHaveLength(6);
    expect(findPath(world, [1, 1, 1], [2, 1, 1], 0)).toBeNull();
  });

  it('returns an empty path only for an already reached standable cell', () => {
    const world = flatWorld();
    expect(findPath(world, [1, 1, 1], [1, 1, 1])).toEqual([]);
    expect(findPath(world, [1, 2, 1], [1, 2, 1])).toBeNull();
  });

  it('cannot step through a ceiling in either direction', () => {
    const world = new World(2, 6, 1);
    world.set(0, 0, 0, BlockId.Grass);
    world.set(1, 1, 0, BlockId.Stone);
    world.set(0, 3, 0, BlockId.Stone);
    expect(isStandable(world, [0, 1, 0])).toBe(true);
    expect(isStandable(world, [1, 2, 0])).toBe(true);
    expect(findPath(world, [0, 1, 0], [1, 2, 0])).toBeNull();
    expect(findPath(world, [1, 2, 0], [0, 1, 0])).toBeNull();
  });
});

describe('nearestStandable', () => {
  it('returns the top of the requested column', () => {
    const world = flatWorld();
    world.set(3, 3, 3, BlockId.Stone);
    expect(nearestStandable(world, 3, 3)).toEqual([3, 4, 3]);
  });

  it('returns null for water, empty or out-of-bounds columns', () => {
    const world = flatWorld();
    world.set(3, 1, 3, BlockId.Water);
    world.set(4, 0, 3, BlockId.Air);
    expect(nearestStandable(world, 3, 3)).toBeNull();
    expect(nearestStandable(world, 4, 3)).toBeNull();
    expect(nearestStandable(world, -1, 3)).toBeNull();
    expect(nearestStandable(world, 9, 3)).toBeNull();
  });
});

describe('pathTowards', () => {
  it('walks straight to a reachable goal', () => {
    const a = pathTowards(flatWorld(), [1, 1, 1], [4, 1, 1])!;
    expect(a.end).toEqual([4, 1, 1]);
    expect(a.distance).toBe(0);
    expect(a.path).toEqual([[2, 1, 1], [3, 1, 1], [4, 1, 1]]);
  });

  it('stops at the reachable cell nearest the goal, ties going to the one nearest the player', () => {
    const world = flatWorld();
    for (let x = 3; x <= 5; x++) for (let z = 3; z <= 5; z++) world.set(x, 1, z, BlockId.Water);
    const a = pathTowards(world, [4, 1, 0], [4, 1, 4])!;
    expect(a.end).toEqual([4, 1, 2]);
    expect(a.distance).toBe(2);
    expect(a.path).toHaveLength(2);
  });

  it('honours the allowed filter and reports the whole region when no nearer cell exists', () => {
    const world = flatWorld();
    const a = pathTowards(world, [1, 1, 1], [7, 1, 1], ([x]) => x <= 2)!;
    expect(a.end).toEqual([2, 1, 1]);
    expect(a.reached([2, 1, 5])).toBe(true);
    expect(a.reached([3, 1, 1])).toBe(false);
    expect(a.visited).toBe(27); // columns x 0..2, all nine z
  });

  it('returns null from a cell that cannot be stood on', () => {
    expect(pathTowards(flatWorld(), [1, 0, 1], [4, 1, 1])).toBeNull();
  });
});


describe('natural routes', () => {
  it('diagonal route is shorter than the old 4-neighbour route', () => {
    const world = flatWorld();
    const start: Cell = [1, 1, 1];
    const end: Cell = [7, 1, 5];
    const path = findPath(world, start, end)!;
    let cost = 0;
    let previous = start;
    for (const cell of path) {
      expect(canStep(world, previous, cell)).toBe(true);
      cost += Math.hypot(cell[0] - previous[0], cell[2] - previous[2]);
      previous = cell;
    }
    expect(cost).toBeCloseTo(2 + 4 * Math.SQRT2);
    expect(cost).toBeLessThan(pathTowards(world, start, end)!.path.length);
    expect(findPath(world, start, end)).toEqual(path);
  });

  it('no corner cutting between two diagonal solids', () => {
    const world = flatWorld();
    for (const [x, z] of [[3, 2], [2, 3]]) {
      for (const y of [1, 2]) world.set(x, y, z, BlockId.Stone);
    }
    expect(canStep(world, [2, 1, 2], [3, 1, 3])).toBe(false);
    const path = findPath(world, [2, 1, 2], [3, 1, 3])!;
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).not.toEqual([3, 1, 3]);
  });

  it('diagonal respects head room / step <=1, with flanks at either level', () => {
    const world = flatWorld();
    world.set(3, 1, 3, BlockId.Stone);
    world.set(3, 1, 2, BlockId.Stone);
    expect(canStep(world, [2, 1, 2], [3, 2, 3])).toBe(true);
    expect(canStep(world, [3, 2, 3], [2, 1, 2])).toBe(true);
    world.set(2, 3, 3, BlockId.Stone); // lower flank ceiling blocks ascent
    expect(canStep(world, [2, 1, 2], [3, 2, 3])).toBe(false);
    world.set(2, 3, 3, BlockId.Air);
    world.set(3, 2, 3, BlockId.Stone);
    expect(canStep(world, [2, 1, 2], [3, 3, 3])).toBe(false);
  });

  it('a single solid flank or a door-frame lintel blocks a diagonal', () => {
    const world = flatWorld();
    world.set(3, 1, 2, BlockId.Stone);
    world.set(3, 2, 2, BlockId.Stone); // one solid flank, the other open
    expect(canStep(world, [2, 1, 2], [3, 1, 3])).toBe(false);
    const door = flatWorld();
    door.set(3, 2, 2, BlockId.Planks); // lintel over one flank: no head room there
    expect(canStep(door, [2, 1, 2], [3, 1, 3])).toBe(false);
    expect(canStep(door, [2, 1, 3], [3, 1, 3])).toBe(true);
  });
});

describe('smoothPath', () => {
  it('checks the segment from the excluded start and reduces open ground to the goal', () => {
    const world = flatWorld();
    const from: Cell = [1, 1, 1];
    const path = findPath(world, from, [7, 1, 5])!;
    const original = structuredClone(path);
    expect(smoothPath(world, path, from)).toEqual([[7, 1, 5]]);
    const withoutStart = smoothPath(world, path);
    expect(withoutStart[0]).toEqual(path[0]);
    expect(withoutStart.at(-1)).toEqual(path.at(-1));
    expect(path).toEqual(original);
    expect(smoothPath(world, [], from)).toEqual([]);
  });

  it('smoothing keeps endpoints and never clips a solid (random worlds, seeded)', () => {
    let seed = 7391;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let routes = 0;
    for (let trial = 0; trial < 40; trial++) {
      const world = flatWorld();
      for (let x = 1; x < 8; x++) for (let z = 1; z < 8; z++) {
        if ((x === 1 && z === 1) || (x === 7 && z === 7)) continue;
        if (random() < 0.22) for (const y of [1, 2]) world.set(x, y, z, BlockId.Stone);
        else if (random() < 0.08) world.set(x, 0, z, BlockId.Air);
      }
      const from: Cell = [1, 1, 1];
      const path = findPath(world, from, [7, 1, 7]);
      if (!path) continue;
      routes++;
      const smooth = smoothPath(world, path, from);
      expect(smooth.at(-1)).toEqual(path.at(-1));
      expect(smooth.length).toBeLessThanOrEqual(path.length);
      let a = from;
      for (const b of smooth) {
        const count = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.025);
        for (let i = 0; i <= count; i++) {
          const x = a[0] + 0.5 + (b[0] - a[0]) * i / count;
          const z = a[2] + 0.5 + (b[2] - a[2]) * i / count;
          expect(isStandable(world, [Math.floor(x), 1, Math.floor(z)])).toBe(true);
          for (let bx = Math.floor(x - 0.3); bx <= Math.floor(x + 0.3); bx++) {
            for (let bz = Math.floor(z - 0.3); bz <= Math.floor(z + 0.3); bz++) {
              const gap = Math.hypot(Math.max(bx - x, 0, x - bx - 1), Math.max(bz - z, 0, z - bz - 1));
              if (gap < 0.3 - 1e-8) {
                expect(BLOCKS[world.get(bx, 1, bz)].solid).toBe(false);
                expect(BLOCKS[world.get(bx, 2, bz)].solid).toBe(false);
              }
            }
          }
        }
        a = b;
      }
    }
    expect(routes).toBeGreaterThan(20);
  });

  it('stepped terrain: smoothing keeps both sides of every height change and never clips (seeded)', () => {
    let seed = 99173;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let routes = 0;
    let changes = 0;
    for (let trial = 0; trial < 60; trial++) {
      const world = flatWorld(12);
      for (let x = 1; x < 10; x++) for (let z = 1; z < 10; z++) {
        if ((x === 1 && z === 1) || (x === 9 && z === 9)) continue;
        const r = random();
        if (r < 0.35) world.set(x, 1, z, BlockId.Stone); // a one-block step up
        else if (r < 0.42) for (const y of [1, 2]) world.set(x, y, z, BlockId.Stone);
      }
      const from: Cell = [1, 1, 1];
      const to = nearestStandable(world, 9, 9)!;
      const path = findPath(world, from, to);
      if (!path) continue;
      routes++;
      const smooth = smoothPath(world, path, from);
      expect(smooth.at(-1)).toEqual(to);
      const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      let prev = from;
      for (const cell of path) {
        if (cell[1] !== prev[1]) {
          changes++;
          expect(same(prev, from) || smooth.some(c => same(c, prev))).toBe(true);
          expect(smooth.some(c => same(c, cell))).toBe(true);
        }
        prev = cell;
      }
      let a = from;
      for (const b of smooth) {
        if (a[1] !== b[1]) {
          expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeLessThanOrEqual(Math.SQRT2 + 1e-8);
        } else {
          const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.025));
          for (let i = 0; i <= count; i++) {
            const x = a[0] + 0.5 + (b[0] - a[0]) * i / count;
            const z = a[2] + 0.5 + (b[2] - a[2]) * i / count;
            expect(isStandable(world, [Math.floor(x), a[1], Math.floor(z)])).toBe(true);
          }
        }
        a = b;
      }
    }
    expect(routes).toBeGreaterThan(25);
    expect(changes).toBeGreaterThan(20);
  });

  it('look-ahead is capped but short paths smooth exactly as before', () => {
    const world = flatWorld(48);
    const short = findPath(world, [1, 1, 1], [9, 1, 5])!;
    expect(smoothPath(world, short, [1, 1, 1])).toEqual([[9, 1, 5]]);
    const long = findPath(world, [1, 1, 1], [40, 1, 40])!;
    const smooth = smoothPath(world, long, [1, 1, 1]);
    expect(smooth.at(-1)).toEqual([40, 1, 40]);
    expect(smooth.length).toBeGreaterThanOrEqual(1);
    expect(smooth.length).toBeLessThan(long.length);
  });

  it('smoothing keeps a waypoint at a height change, even when the end returns to the start height', () => {
    const world = flatWorld();
    world.set(4, 1, 3, BlockId.Stone);
    const path: Cell[] = [[2, 1, 3], [3, 1, 3], [4, 2, 3], [5, 1, 3], [6, 1, 3]];
    expect(smoothPath(world, path, [1, 1, 3])).toEqual([[3, 1, 3], [4, 2, 3], [5, 1, 3], [6, 1, 3]]);
  });
});
