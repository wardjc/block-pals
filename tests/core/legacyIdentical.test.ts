import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ORIGIN, V2_WORLD, WORLD } from '../../src/core/bounds';
import { isStandable } from '../../src/core/pathfind';
import type { Rect, VillageLayout } from '../../src/core/village';
import { GEN_VERSION, generateWorld, type GeneratedWorld } from '../../src/core/worldgen';
import { decodeRle, loadWorldFixture } from '../helpers/fixtures';

// Gen 3: main's world with the wizard's tower, its hill and its path (frozen from main b6d77d7).
const fixture = loadWorldFixture(3);
const old = decodeRle(fixture.rle);
const shiftRect = (r: Rect): Rect => ({ x0: r.x0 + ORIGIN.x, z0: r.z0 + ORIGIN.z, x1: r.x1 + ORIGIN.x, z1: r.z1 + ORIGIN.z });
const shiftCell = (c: number[]): number[] => [c[0] + ORIGIN.x, c[1] + ORIGIN.y, c[2] + ORIGIN.z];

/**
 * Old cells (meadow coordinates "x,y,z") allowed to differ from the step 2 world, apart from D1 (the
 * old bedrock row, checked on its own). Chunk C adds the two stamped cave mouths (D2) here; until
 * then the list is empty.
 */
function documentedDifferences(_layout: VillageLayout): Set<string> {
  return new Set();
}

let gen: GeneratedWorld;
let genMs = 0;
beforeAll(() => {
  const t0 = performance.now();
  gen = generateWorld(2026);
  genMs = performance.now() - t0;
  console.log(`generateWorld(2026): ${genMs.toFixed(0)} ms, ${gen.world.buffer.length} bytes`);
});

describe('the old 96 x 20 x 96 world sits unchanged in the middle of the big one', () => {
  test('GEN_VERSION is 4 (above main\'s 3, never lowered) and the world is 192 x 68 x 192 (2,506,752 bytes)', () => {
    expect(GEN_VERSION).toBe(4);
    const { world } = gen;
    expect([world.sizeX, world.sizeY, world.sizeZ]).toEqual([WORLD.x, WORLD.y, WORLD.z]);
    expect(world.buffer.length).toBe(2_506_752);
  });

  test('every old cell is the same block at +48', () => {
    const allowed = documentedDifferences(gen.village);
    const mismatches: string[] = [];
    for (let y = 1; y < V2_WORLD.y; y++) {
      for (let z = 0; z < V2_WORLD.z; z++) {
        for (let x = 0; x < V2_WORLD.x; x++) {
          const want = old[x + V2_WORLD.x * (z + V2_WORLD.z * y)];
          const got = gen.world.get(x + ORIGIN.x, y + ORIGIN.y, z + ORIGIN.z);
          if (got !== want && !allowed.has(`${x},${y},${z}`)) mismatches.push(`old (${x},${y},${z}): want ${want}, got ${got}`);
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });

  test('old row y = 0 is now Stone (D1) and y = 0 of the world is Bedrock everywhere', () => {
    for (let z = 0; z < V2_WORLD.z; z++) for (let x = 0; x < V2_WORLD.x; x++) {
      expect(old[x + V2_WORLD.x * z]).toBe(BlockId.Bedrock);
    }
    let stone = 0;
    for (let z = 0; z < V2_WORLD.z; z++) for (let x = 0; x < V2_WORLD.x; x++) {
      if (gen.world.get(x + ORIGIN.x, ORIGIN.y, z + ORIGIN.z) === BlockId.Stone) stone++;
    }
    expect(stone).toBe(V2_WORLD.x * V2_WORLD.z);
    const layer = WORLD.x * WORLD.z;
    expect(gen.world.buffer.subarray(0, layer).every(id => id === BlockId.Bedrock)).toBe(true);
    // Bedrock appears nowhere else.
    expect(gen.world.buffer.subarray(layer).indexOf(BlockId.Bedrock)).toBe(-1);
  });

  test('the layout equals the fixture layout shifted by ORIGIN', () => {
    const v = gen.village;
    const f = fixture.layout;
    expect(v.houses.map(h => ({ id: h.id, rect: h.rect, doorFront: h.doorFront, doorInside: h.doorInside }))).toEqual(
      f.houses.map(h => ({ id: h.id, rect: shiftRect(h.rect), doorFront: shiftCell(h.doorFront), doorInside: shiftCell(h.doorInside) })),
    );
    expect(v.square).toEqual(shiftRect(f.square));
    expect(v.farmPlot).toEqual(shiftRect(f.farmPlot));
    expect(v.farm.pasture).toEqual(shiftRect(f.pasture));
    expect(v.quarry).toEqual(shiftRect(f.quarry));
    expect(v.pad).toEqual(shiftRect(f.pad));
    // routeCells are world indices with the new sizes, standing on the shifted path.
    for (const k of v.routeCells) {
      const x = k % WORLD.x, z = Math.floor(k / WORLD.x) % WORLD.z, y = Math.floor(k / (WORLD.x * WORLD.z));
      expect(gen.world.get(x, y - 1, z)).toBe(BlockId.PathStone);
    }
  });

  test('the tower, its hill and its path equal the gen 3 fixture shifted by ORIGIN', () => {
    const t = gen.tower;
    const f = fixture.tower!;
    expect(t.rect).toEqual(shiftRect(f.rect));
    expect(t.rect).toEqual({ x0: 81, z0: 126, x1: 87, z1: 132 });
    expect(t.groundY).toBe(f.groundY + ORIGIN.y);
    expect(t.groundY).toBe(57);
    expect(t.doorFront).toEqual(shiftCell(f.doorFront));
    expect(t.doorInside).toEqual(shiftCell(f.doorInside));
    expect(t.wizardSpot).toEqual(shiftCell(f.wizardSpot));
    expect(t.topLamp).toEqual(shiftCell(f.topLamp));
    expect(t.topLamp[1]).toBe(WORLD.y - 1); // still the very top block of the world
    expect(gen.world.get(...t.topLamp)).toBe(BlockId.Lamp);
    expect(t.beacon).toEqual({ x: f.beacon.x + ORIGIN.x, y: f.beacon.y + ORIGIN.y, z: f.beacon.z + ORIGIN.z });
    expect(t.beacon.y).toBeGreaterThan(WORLD.y); // floats above the world
    expect(gen.towerRoute).toEqual(f.route.map(shiftCell));
    expect(gen.towerRects).toEqual(f.stampedRects.map(shiftRect));
    expect(gen.towerPad).toEqual(shiftRect(f.pad));
    // The wizard stands on the ground floor, on Planks, with room for him.
    const [wx, wy, wz] = t.wizardSpot;
    expect(gen.world.get(wx, wy - 1, wz)).toBe(BlockId.Planks);
    expect(isStandable(gen.world, [wx, wy, wz])).toBe(true);
  });

  test('spawn is (72, 56, 72) and standable', () => {
    expect(gen.spawn).toEqual({ x: fixture.spawn.x + 48, y: fixture.spawn.y + 48, z: fixture.spawn.z + 48 });
    expect(gen.spawn).toEqual({ x: 72, y: 56, z: 72 });
    expect(isStandable(gen.world, [gen.spawn.x, gen.spawn.y, gen.spawn.z])).toBe(true);
  });

  test('edits() is empty and the world is clean after generateWorld', () => {
    expect(gen.world.edits()).toEqual([]);
    expect(gen.world.isDirty()).toBe(false);
  });

  test('deterministic: two calls give identical buffers', () => {
    const hash = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
    expect(hash(generateWorld(2026).world.buffer)).toBe(hash(gen.world.buffer));
  });

  test('the whole world is Stone from y 1 to 47 under every column', () => {
    const layer = WORLD.x * WORLD.z;
    expect(gen.world.buffer.subarray(layer, 48 * layer).every(id => id === BlockId.Stone)).toBe(true);
  });

  test('generation is within budget (under 1.5 s per seed on desktop)', () => {
    expect(genMs).toBeLessThan(1500);
  });
});
