import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { cellIndex, cellOf } from '../../src/core/caves';
import { darkStretches, GLOWS, LIGHT_RADIUS, lightDistances } from '../../src/core/caveDress';
import { caveWorld, SEEDS } from '../helpers/caveWorld';

/** Plan Task 14: never dark. Every carved cell of four seeds is within 6 blocks of a glowing block. */
describe.each(SEEDS)('cave lights, seed %i', seed => {
  test('no dark stretch: every carved cell is within 6 of a light (scans every carved cell)', () => {
    const { world, caves } = caveWorld(seed);
    const d = lightDistances(world, caves.airCells, 12);
    let worst = 0;
    for (const v of d) worst = Math.max(worst, v);
    console.log(`caveLights ${seed}: ${caves.airCells.length} carved cells, worst distance ${worst.toFixed(2)}, ${caves.lights.length} lights`);
    expect(darkStretches(world, caves, LIGHT_RADIUS)).toEqual([]);
    expect(worst).toBeLessThanOrEqual(6);
  });

  test('mean light spacing (nearest other light) is under 5', () => {
    const { caves } = caveWorld(seed);
    const ls = caves.lights;
    let sum = 0;
    for (const a of ls) {
      let best = Infinity;
      for (const b of ls) if (a !== b) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      sum += best;
    }
    expect(sum / ls.length).toBeLessThan(5);
  });

  test('shallow lights are glowing mushrooms; deep lights are crystals of all three kinds', () => {
    const { world, caves } = caveWorld(seed);
    const kinds = new Set<number>();
    for (const [x, y, z] of caves.lights) {
      const id = world.get(x, y, z);
      if (y >= 30) expect(id, `${x},${y},${z}`).toBe(BlockId.GlowMushroom);
      else { expect([BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen]).toContain(id); kinds.add(id); }
    }
    expect(kinds.size).toBe(3);
  });

  test('every light and every gem sits in rock next to carved air (never floating)', () => {
    const { world, caves } = caveWorld(seed);
    const air = new Set(caves.airCells);
    const touches = ([x, y, z]: number[]): boolean =>
      [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => air.has(cellIndex(world, x + dx, y + dy, z + dz)));
    for (const c of caves.lights) expect(touches(c), c.join(',')).toBe(true);
    for (const c of caves.ore) {
      expect(world.get(c[0], c[1], c[2])).toBe(BlockId.GemOre);
      expect(touches(c)).toBe(true);
      // Never a floor: the cell above a gem is never the air he stands in.
      expect(air.has(cellIndex(world, c[0], c[1] + 1, c[2])) && !air.has(cellIndex(world, c[0], c[1] - 1, c[2])) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => air.has(cellIndex(world, c[0] + dx, c[1], c[2] + dz)))).toBe(false);
    }
  });

  test('gems: at least 14 shallow and 36 deep, at most 120 in all, no two touching', () => {
    const { world, caves } = caveWorld(seed);
    const shallow = caves.ore.filter(c => c[1] >= 30).length;
    const deep = caves.ore.length - shallow;
    expect(shallow).toBeGreaterThanOrEqual(14);
    expect(deep).toBeGreaterThanOrEqual(36);
    expect(caves.ore.length).toBeLessThanOrEqual(120);
    let total = 0;
    for (let i = 0; i < world.buffer.length; i++) if (world.buffer[i] === BlockId.GemOre) total++;
    expect(total).toBe(caves.ore.length);
    for (const [x, y, z] of caves.ore) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        expect(world.get(x + dx, y + dy, z + dz)).not.toBe(BlockId.GemOre);
      }
    }
  });

  test('no gem or light on the trail, a lamp or a furnishing', () => {
    const { world, caves } = caveWorld(seed);
    for (const k of caves.trail) expect([BlockId.PathStone]).toContain(world.buffer[k]);
    const furn = new Set([...caves.treasure.flatMap(t => t.furnishings), ...(caves.ruin?.furnishings ?? [])].map(c => cellIndex(world, c[0], c[1], c[2])));
    for (const c of [...caves.lights, ...caves.ore]) {
      const k = cellIndex(world, c[0], c[1], c[2]);
      expect(caves.trail.has(k)).toBe(false);
      expect(furn.has(k)).toBe(false);
    }
  });

  test('bedrock rule: y 0 is Bedrock everywhere and nothing at y 1..3 is carved', () => {
    const { world, caves } = caveWorld(seed);
    const layer = world.sizeX * world.sizeZ;
    expect(world.buffer.subarray(0, layer).every(id => id === BlockId.Bedrock)).toBe(true);
    for (const i of caves.airCells) expect(cellOf(world, i)[1]).toBeGreaterThan(3);
    for (let i = layer; i < 4 * layer; i++) expect(world.buffer[i]).toBe(BlockId.Stone);
  });

  test('dressing is quick (about 100 to 200 ms alone on an idle desktop; under 500 on a busy one)', () => {
    const { caves } = caveWorld(seed);
    console.log(`caveLights ${seed}: dressing ${caves.timings.dress.toFixed(0)} ms`);
    expect(caves.timings.dress).toBeLessThan(500);
  });
});

test('GLOWS is the Lamp and every light block', () => {
  for (const id of Object.values(BLOCKS).filter(d => d.light).map(d => d.id)) expect(GLOWS.has(id)).toBe(true);
  expect(GLOWS.has(BlockId.Lamp)).toBe(true);
  expect(GLOWS.has(BlockId.Stone)).toBe(false);
});

test('dressing is deterministic', async () => {
  const { generateWorld } = await import('../../src/core/worldgen');
  const again = generateWorld(1).caves;
  const first = caveWorld(1).caves;
  expect(again.lights).toEqual(first.lights);
  expect(again.ore).toEqual(first.ore);
});
