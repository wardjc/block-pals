import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../../src/core/blocks';
import { insideWall } from '../../src/core/bounds';
import { goalDistance, isStandable, pathTowards, __pathScratch, type Approach, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { decodeRle, loadWorldFixture } from '../helpers/fixtures';

/**
 * The step 2 pathTowards, verbatim (it allocated two whole-world typed arrays per call). The new
 * implementation must give the same answers wherever the old one ran (maxDrop 1).
 */
function oldPathTowards(
  world: World, from: Cell, goal: Cell,
  allowed: (cell: Cell) => boolean = () => true, maxNodes = 8000,
): Approach | null {
  if (!isStandable(world, from)) return null;
  const sx = world.sizeX;
  const sxz = sx * world.sizeZ;
  const key = ([x, y, z]: Cell): number => x + sx * z + sxz * y;
  const decode = (k: number): Cell => [k % sx, Math.floor(k / sxz), Math.floor((k % sxz) / sx)];
  const parent = new Int32Array(sxz * world.sizeY).fill(-2);
  const queue = new Int32Array(Math.min(parent.length, maxNodes));
  const start = key(from);
  parent[start] = -1;
  queue[0] = start;
  let tail = 1;
  let best = start;
  let bestDistance = goalDistance(from, goal);
  const startDistance = bestDistance;
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
        if (dy === 1 && BLOCKS[world.get(x, y + 2, z)].solid) continue;
        if (dy === -1 && BLOCKS[world.get(nx, ny + 2, nz)].solid) continue;
        parent[nk] = k;
        queue[tail++] = nk;
        const d = Math.max(Math.abs(nx - goal[0]), Math.abs(nz - goal[2])) + Math.abs(ny - goal[1]);
        if (d < bestDistance) { best = nk; bestDistance = d; }
      }
    }
  }
  const path: Cell[] = [];
  for (let k = best; k !== start; k = parent[k]) path.push(decode(k));
  path.reverse();
  return {
    path, end: decode(best), distance: bestDistance, startDistance, visited: tail,
    reached: c => world.inBounds(...c) && parent[key(c)] !== -2,
  };
}

function fixtureWorld(): World {
  const fx = loadWorldFixture(2);
  return World.fromBuffer(fx.sizeX, fx.sizeY, fx.sizeZ, decodeRle(fx.rle));
}

function randomStandable(world: World, random: () => number): Cell {
  for (;;) {
    const x = 1 + Math.floor(random() * (world.sizeX - 2));
    const z = 1 + Math.floor(random() * (world.sizeZ - 2));
    const cell: Cell = [x, world.topSolidY(x, z) + 1, z];
    if (isStandable(world, cell)) return cell;
  }
}

describe('pathTowards at the scale of the 192 x 68 x 192 world', () => {
  const big = generateWorld(2026);
  const world = big.world;
  const allowed = (c: Cell): boolean => insideWall(world, c[0], c[2]);

  it('100 calls take under 400 ms in total and allocate no per-call array', () => {
    const random = mulberry32(7);
    const pairs = Array.from({ length: 100 }, () => [randomStandable(world, random), randomStandable(world, random)] as const);
    pathTowards(world, pairs[0][0], pairs[0][1], allowed); // the scratch buffers are made once
    const before = process.memoryUsage().arrayBuffers;
    // Best of three batches: the machine is shared with 100 other test files.
    let ms = Infinity;
    for (let round = 0; round < 3; round++) {
      const t0 = performance.now();
      for (const [a, b] of pairs) pathTowards(world, a, b, allowed);
      ms = Math.min(ms, performance.now() - t0);
    }
    const grown = process.memoryUsage().arrayBuffers - before;
    console.log(`pathTowards x100 on the big world: ${ms.toFixed(0)} ms, arrayBuffers +${(grown / 1024).toFixed(0)} KB`);
    expect(ms).toBeLessThan(400);
    expect(grown).toBeLessThan(1024 * 1024);
  });

  it('the scratch buffers are sized once for the world, not per call', () => {
    const s = __pathScratch();
    expect(s.cells).toBeGreaterThanOrEqual(world.sizeX * world.sizeY * world.sizeZ);
    // Under 8 MB in all (the old code allocated 12.5 MB on every tap).
    expect(s.bytes).toBeLessThan(8 * 1024 * 1024);
  });
});

describe('pathTowards gives the step 2 answers (maxDrop 1)', () => {
  it('identical to the old implementation on 200 random pairs of the step 2 fixture world', () => {
    const world = fixtureWorld();
    const allowed = (c: Cell): boolean => insideWall(world, c[0], c[2]);
    const random = mulberry32(2026);
    for (let i = 0; i < 200; i++) {
      const a = randomStandable(world, random);
      const b = randomStandable(world, random);
      const maxNodes = i % 3 === 0 ? 400 : 8000; // some capped floods too
      const want = oldPathTowards(world, a, b, allowed, maxNodes)!;
      const got = pathTowards(world, a, b, allowed, maxNodes)!;
      expect(got.path, `pair ${i}`).toEqual(want.path);
      expect(got.end).toEqual(want.end);
      expect([got.distance, got.startDistance, got.visited]).toEqual([want.distance, want.startDistance, want.visited]);
      for (let j = 0; j < 20; j++) {
        const c = randomStandable(world, random);
        expect(got.reached(c)).toBe(want.reached(c));
      }
    }
  });

  it('two interleaved searches do not corrupt each other', () => {
    const world = fixtureWorld();
    const random = mulberry32(99);
    const a0 = randomStandable(world, random), a1 = randomStandable(world, random);
    const b0 = randomStandable(world, random), b1 = randomStandable(world, random);
    const a = pathTowards(world, a0, a1)!;
    const b = pathTowards(world, b0, b1)!;
    const wantA = oldPathTowards(world, a0, a1)!;
    const wantB = oldPathTowards(world, b0, b1)!;
    expect(a.path).toEqual(wantA.path);
    expect(b.path).toEqual(wantB.path);
    // `reached` of the older search still answers correctly after the newer one ran.
    for (let j = 0; j < 200; j++) {
      const c = randomStandable(world, random);
      expect(a.reached(c)).toBe(wantA.reached(c));
      expect(b.reached(c)).toBe(wantB.reached(c));
    }
  });

  it('stamp wraparound is handled (the counter forced near its limit)', () => {
    const world = fixtureWorld();
    const random = mulberry32(5);
    const s = __pathScratch();
    s.forceStamp(s.maxStamp - 3);
    for (let i = 0; i < 12; i++) {
      const a = randomStandable(world, random);
      const b = randomStandable(world, random);
      const want = oldPathTowards(world, a, b)!;
      const got = pathTowards(world, a, b)!;
      expect(got.path).toEqual(want.path);
      expect(got.visited).toBe(want.visited);
    }
  });
});
