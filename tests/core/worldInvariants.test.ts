import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { CARVE_MAX_Y, ORIGIN, V2_WORLD } from '../../src/core/bounds';
import { cellIndex, cellOf, inOld, roomCentre } from '../../src/core/caves';
import { darkStretches } from '../../src/core/caveDress';
import { routeHome } from '../../src/core/home';
import { findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { decodeRle, loadWorldFixture } from '../helpers/fixtures';
import { caveWorld, reached, SEEDS, timedCaveWorld, walkCaves } from '../helpers/caveWorld';

/** Plan Task 18: the whole world with its caves, four seeds. */

const fixture = loadWorldFixture(3);
const old = decodeRle(fixture.rle);
const inRect = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

describe.each(SEEDS)('the whole world, seed %i', seed => {
  test('generation is under 1.5 s (a warm run; the first in a busy test run is printed too) and the caves come back with it', async () => {
    const { g, ms } = timedCaveWorld(seed);
    const { generateWorld } = await import('../../src/core/worldgen');
    const t0 = performance.now();
    const again = generateWorld(seed);
    const warm = performance.now() - t0;
    console.log(`worldInvariants ${seed}: generateWorld first ${ms.toFixed(0)} ms, warm ${warm.toFixed(0)} ms, caves ${JSON.stringify(Object.fromEntries(Object.entries(again.caves.timings).map(([k, v]) => [k, Math.round(v)])))}`);
    expect(warm).toBeLessThan(1500);
    expect(g.world.edits()).toEqual([]);
    expect(g.world.isDirty()).toBe(false);
  });

  test('old region columns at y 49 and up are never carved except inside the stamped mouths', () => {
    const { world, caves } = caveWorld(seed);
    for (const i of caves.airCells) {
      const [x, y, z] = cellOf(world, i);
      if (y > CARVE_MAX_Y && inOld(x, z)) expect(caves.stampedRects.some(r => inRect(r, x, z)), `${x},${y},${z}`).toBe(true);
    }
  });

  test('everything he can reach underground is lit: no dark stretch', () => {
    const { world, caves } = caveWorld(seed);
    expect(darkStretches(world, caves)).toEqual([]);
  });

  test('connected on foot: spawn to every mouth; every mouth to every room, treasure room and the Old Hideout', () => {
    const { world, caves, spawn } = caveWorld(seed);
    const from: Cell = [Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)];
    for (const m of caves.mouths) expect(findPath(world, from, m.cell, 400_000), m.kind).not.toBeNull();
    const targets: Cell[] = [
      ...caves.rooms.map(r => roomCentre(world, r)),
      ...caves.treasure.map(t => [t.chest[0] - t.dir[0], t.floorY, t.chest[2] - t.dir[1]] as Cell),
      [96, caves.ruin!.floorY, 97],
    ];
    for (const m of caves.mouths) {
      const flood = walkCaves(world, caves, [m.cell]);
      const missing = targets.filter(t => !reached(world, flood, t));
      expect(missing, m.kind).toEqual([]);
    }
  });

  test('a walkable way home from 200 sampled cave floor cells', () => {
    const { world, caves } = caveWorld(seed);
    // Every floor cell he can walk to (the top of the hideout's wall is not one: he would have to build up there).
    const air = new Set(caves.airCells);
    const flood = walkCaves(world, caves, caves.mouths.map(m => m.cell));
    const floors: Cell[] = flood.order.filter(k => air.has(k)).map(k => cellOf(world, k)).filter(c => isStandable(world, c));
    expect(floors.length).toBeGreaterThan(10_000);
    const rng = mulberry32(seed);
    let fails = 0;
    for (let n = 0; n < 200; n++) {
      const c = floors[Math.floor(rng() * floors.length)];
      if (!routeHome(world, c, caves)) fails++;
    }
    expect(fails).toBe(0);
  });

  test('nothing underground can fall or flood: no Water or Sand below y 48, no block id 48..55 or 65+, bedrock only at y 0', () => {
    const { world } = caveWorld(seed);
    const layer = world.sizeX * world.sizeZ;
    for (let i = 0; i < world.buffer.length; i++) {
      const id = world.buffer[i];
      if (i >= layer && id === BlockId.Bedrock) throw new Error(`bedrock at ${cellOf(world, i).join(',')}`);
      if (i < 48 * layer && (id === BlockId.Water || id === BlockId.Sand)) throw new Error(`${id} at ${cellOf(world, i).join(',')}`);
      if ((id >= 48 && id <= 55) || id >= 65) throw new Error(`id ${id}`);
      if (id >= 40 && id <= 47) throw new Error(`mythical block ${id} in a fresh world`);
    }
    expect(world.buffer.subarray(0, layer).every(id => id === BlockId.Bedrock)).toBe(true);
  });

  test('no creature, villager or animal starts below the ground (all on the surface)', () => {
    const { village, world } = caveWorld(seed);
    for (const s of village.farm.herdSpawns) expect(s[1]).toBeGreaterThanOrEqual(world.topSolidY(s[0], s[2]) - 2);
    for (const h of village.houses) expect(h.npcSpot[1]).toBeGreaterThan(50);
  });

  test('the faces of the world are never carved', () => {
    const { world, caves } = caveWorld(seed);
    for (const i of caves.airCells) {
      const [x, , z] = cellOf(world, i);
      expect(x > 0 && z > 0 && x < world.sizeX - 1 && z < world.sizeZ - 1).toBe(true);
    }
  });

  test('the documented-difference compare: every old cell equals the frozen world at +48 except D1 and D2', () => {
    if (seed !== 2026) return; // the fixture is seed 2026
    const { world, caves } = caveWorld(seed);
    let bad = 0;
    for (let y = 1; y < V2_WORLD.y; y++) for (let z = 0; z < V2_WORLD.z; z++) for (let x = 0; x < V2_WORLD.x; x++) {
      const want = old[x + V2_WORLD.x * (z + V2_WORLD.z * y)];
      if (world.get(x + ORIGIN.x, y + ORIGIN.y, z + ORIGIN.z) === want) continue;
      if (!caves.stampedRects.some(r => inRect(r, x + ORIGIN.x, z + ORIGIN.z))) bad++;
    }
    expect(bad).toBe(0);
  });
});

test('deterministic and pinned: the seed 2026 world hashes to the golden number', () => {
  const h = createHash('sha256').update(caveWorld(2026).world.buffer).digest('hex').slice(0, 16);
  console.log(`worldInvariants golden hash ${h}`);
  expect(h).toBe(GOLDEN_2026);
});

/** The seed 2026 world's hash (first 16 hex digits). Change only with GEN_VERSION. */
const GOLDEN_2026 = '218015242516a36f';

test('cellIndex and cellOf are inverse', () => {
  const w = { sizeX: 192, sizeZ: 192 };
  expect(cellOf(w, cellIndex(w, 5, 40, 191))).toEqual([5, 40, 191]);
});
