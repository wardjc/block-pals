import { beforeAll, describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { ORIGIN, V2_WORLD, WORLD, insideWall } from '../../src/core/bounds';
import { OUTER_MARGIN, inOldRect, outerHeight } from '../../src/core/outer';
import { findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import type { World } from '../../src/core/world';
import { generateWorld, heightAt, type GeneratedWorld } from '../../src/core/worldgen';
import { decodeRle, loadWorldFixture } from '../helpers/fixtures';

const OLD = { x0: ORIGIN.x, x1: ORIGIN.x + V2_WORLD.x - 1, z0: ORIGIN.z, z1: ORIGIN.z + V2_WORLD.z - 1 };
/** Chebyshev distance from a column to the old rectangle (0 inside). */
const toOld = (x: number, z: number): number => Math.max(OLD.x0 - x, 0, x - OLD.x1, OLD.z0 - z, 0, z - OLD.z1);
const TERRAIN = new Set([BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Sand, BlockId.PathStone, BlockId.Farmland, BlockId.Bedrock]);

/** Top of the ground (terrain blocks only, ignoring trees and water). */
function ground(world: World, x: number, z: number): number {
  for (let y = world.sizeY - 1; y >= 0; y--) if (TERRAIN.has(world.get(x, y, z))) return y;
  return -1;
}

function outerColumns(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let z = 0; z < WORLD.z; z++) for (let x = 0; x < WORLD.x; x++) if (!inOldRect(x, z)) out.push([x, z]);
  return out;
}

const seeds = [2026, 2027, 7, 0xffffffff];
const gens = new Map<number, GeneratedWorld>();
beforeAll(() => { for (const s of seeds) gens.set(s, generateWorld(s)); });
const gen = (seed = 2026): GeneratedWorld => gens.get(seed)!;

describe.each(seeds)('the outer ring, seed %s', seed => {
  const water = (w: World, x: number, z: number): boolean => w.get(x, ground(w, x, z) + 1, z) === BlockId.Water;

  test('outer terrain is continuous with the old edge: heights across the seam differ by at most 1', () => {
    const { world } = gen(seed);
    let checked = 0;
    for (let i = 0; i < V2_WORLD.x; i++) {
      for (const [ix, iz, ox, oz] of [
        [OLD.x0 + i, OLD.z0, OLD.x0 + i, OLD.z0 - 1], [OLD.x0 + i, OLD.z1, OLD.x0 + i, OLD.z1 + 1],
        [OLD.x0, OLD.z0 + i, OLD.x0 - 1, OLD.z0 + i], [OLD.x1, OLD.z0 + i, OLD.x1 + 1, OLD.z0 + i],
      ]) {
        expect(Math.abs(ground(world, ix, iz) - ground(world, ox, oz)), `${ix},${iz} | ${ox},${oz}`).toBeLessThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBe(4 * 96);
  });

  test('adjacent outer columns differ by at most 1 (a walkable surface, outside ponds)', () => {
    const { world } = gen(seed);
    for (const [x, z] of outerColumns()) {
      if (water(world, x, z)) continue;
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!world.inBounds(nx, 0, nz) || inOldRect(nx, nz) || water(world, nx, nz)) continue;
        expect(Math.abs(ground(world, x, z) - ground(world, nx, nz)), `${x},${z} -> ${nx},${nz}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('no ground above y 60; every outer column is Grass (or a Sand bank) over Dirt over Stone', () => {
    const { world } = gen(seed);
    for (const [x, z] of outerColumns()) {
      const g = ground(world, x, z);
      expect(g).toBeLessThanOrEqual(60);
      expect(g).toBeGreaterThanOrEqual(49);
      const top = world.get(x, g, z);
      expect([BlockId.Grass, BlockId.Sand]).toContain(top);
      if (top === BlockId.Grass) {
        expect(world.get(x, g - 1, z)).toBe(BlockId.Dirt);
        expect(world.get(x, g - 2, z)).toBe(BlockId.Dirt);
      }
      for (let y = 1; y < g - 2; y++) if (world.get(x, y, z) !== BlockId.Stone) throw new Error(`not stone at ${x},${y},${z}`);
    }
  });

  test('ponds are static water, at least 3, banks of Sand, bed 2 below the water', () => {
    const { world, outer } = gen(seed);
    expect(outer.ponds.length).toBeGreaterThanOrEqual(3);
    expect(outer.ponds.length).toBeLessThanOrEqual(4);
    for (const p of outer.ponds) {
      expect(toOld(p.x, p.z) - p.r).toBeGreaterThanOrEqual(OUTER_MARGIN);
      const g = ground(world, p.x, p.z);
      const top = g + 2; // water top
      expect(world.get(p.x, g, p.z)).toBe(BlockId.Sand);
      expect(world.get(p.x, g + 1, p.z)).toBe(BlockId.Water);
      expect(world.get(p.x, g + 2, p.z)).toBe(BlockId.Water);
      expect(world.get(p.x, g + 3, p.z)).toBe(BlockId.Air);
      // Every water cell is held in: its four neighbours at its level are water or solid.
      for (let x = p.x - p.r - 1; x <= p.x + p.r + 1; x++) for (let z = p.z - p.r - 1; z <= p.z + p.r + 1; z++) {
        for (let y = top - 1; y <= top; y++) {
          if (world.get(x, y, z) !== BlockId.Water) continue;
          expect(y).toBeLessThanOrEqual(top);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = world.get(x + dx, y, z + dz);
            expect(n === BlockId.Water || BLOCKS[n].solid, `${x + dx},${y},${z + dz}`).toBe(true);
          }
          expect(BLOCKS[world.get(x, y - 1, z)].solid || world.get(x, y - 1, z) === BlockId.Water).toBe(true);
        }
      }
      // The shore ring is Sand at the water's level.
      let sand = 0;
      for (let a = 0; a < 16; a++) {
        const x = Math.round(p.x + Math.cos((a * Math.PI) / 8) * (p.r + 0.6));
        const z = Math.round(p.z + Math.sin((a * Math.PI) / 8) * (p.r + 0.6));
        if (world.get(x, top, z) === BlockId.Sand) sand++;
      }
      expect(sand).toBeGreaterThanOrEqual(12);
    }
  });

  test('hills are 5 to 7, peak at most y 59, outside the margin', () => {
    const { outer } = gen(seed);
    expect(outer.hills.length).toBeGreaterThanOrEqual(5);
    expect(outer.hills.length).toBeLessThanOrEqual(7);
    for (const h of outer.hills) {
      expect(toOld(h.x, h.z) - h.r).toBeGreaterThanOrEqual(OUTER_MARGIN);
      expect(outerHeight(seed, h.x, h.z)).toBeLessThanOrEqual(59);
    }
  });

  test('edge rises: the ground at 1 block from the edge is 1 to 3 higher than at 8, beyond the meadow\'s own roll (average per side)', () => {
    const { world } = gen(seed);
    for (const side of [0, 1, 2, 3]) {
      let rise = 0, n = 0;
      for (let along = 20; along < 172; along += 4) {
        const at = (d: number): [number, number] =>
          side === 0 ? [along, d] : side === 1 ? [WORLD.x - 1 - d, along] : side === 2 ? [along, WORLD.z - 1 - d] : [d, along];
        const [ax, az] = at(1), [bx, bz] = at(8);
        if (water(world, ax, az) || water(world, bx, bz)) continue;
        // The meadow formula rolls on by itself; the edge adds its rise on top of that.
        const roll = heightAt(seed, ax - 48, az - 48) - heightAt(seed, bx - 48, bz - 48);
        rise += ground(world, ax, az) - ground(world, bx, bz) - roll;
        n++;
      }
      expect(rise / n).toBeGreaterThanOrEqual(1);
      expect(rise / n).toBeLessThanOrEqual(3);
    }
  });

  test('trees: a ring near every edge, a scatter of 50 to 100, spaced, on grass, inside the wall, clear of the old rectangle', () => {
    const { world, outer } = gen(seed);
    const near = [0, 0, 0, 0];
    for (const t of outer.trees) {
      if (t.z <= 5) near[0]++;
      if (WORLD.x - 1 - t.x <= 5) near[1]++;
      if (WORLD.z - 1 - t.z <= 5) near[2]++;
      if (t.x <= 5) near[3]++;
    }
    for (const n of near) expect(n).toBeGreaterThanOrEqual(20);
    const ring = outer.trees.filter(t => Math.min(t.x, t.z, WORLD.x - 1 - t.x, WORLD.z - 1 - t.z) <= 5).length;
    const scatter = outer.trees.length - ring;
    expect(scatter).toBeGreaterThanOrEqual(50);
    expect(scatter).toBeLessThanOrEqual(100);
    for (const [i, t] of outer.trees.entries()) {
      expect(toOld(t.x, t.z), `${t.x},${t.z}`).toBeGreaterThan(4);
      expect(insideWall(world, t.x - 1, t.z - 1) && insideWall(world, t.x + 1, t.z + 1)).toBe(true);
      const g = ground(world, t.x, t.z);
      expect(world.get(t.x, g, t.z)).toBe(BlockId.Grass);
      for (let y = g + 1; y <= g + 4; y++) expect(world.get(t.x, y, t.z)).toBe(BlockId.Wood);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = g + 5; y <= g + 6; y++) {
        expect(world.get(t.x + dx, y, t.z + dz)).toBe(BlockId.Leaves);
      }
      for (const o of outer.trees.slice(i + 1)) expect(Math.max(Math.abs(o.x - t.x), Math.abs(o.z - t.z))).toBeGreaterThanOrEqual(5);
    }
  });

  test('nothing dark: no outer cell above the ground is anything but Air, Water, Wood or Leaves', () => {
    const { world } = gen(seed);
    const ok = new Set([BlockId.Air, BlockId.Water, BlockId.Wood, BlockId.Leaves]);
    for (const [x, z] of outerColumns()) {
      for (let y = ground(world, x, z) + 1; y < WORLD.y; y++) {
        if (!ok.has(world.get(x, y, z))) throw new Error(`${world.get(x, y, z)} at ${x},${y},${z}`);
      }
    }
  });

  test('deterministic', () => {
    expect(generateWorld(seed).world.buffer).toEqual(gen(seed).world.buffer);
  });
});

describe('the outer ring leaves the old world alone', () => {
  test('the old region is unchanged by this stage (the gen 3 fixture, tower included, still matches at +48)', () => {
    const fixture = loadWorldFixture(3);
    const old = decodeRle(fixture.rle);
    const { world } = gen();
    let mismatches = 0;
    for (let y = 1; y < 20; y++) for (let z = 0; z < 96; z++) for (let x = 0; x < 96; x++) {
      if (world.get(x + 48, y + 48, z + 48) !== old[x + 96 * (z + 96 * y)]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  test('every outer surface cell is reachable on foot from spawn (sampled: 40 random outer columns)', () => {
    const { world, spawn } = gen();
    const random = mulberry32(5);
    const from: Cell = [spawn.x, spawn.y, spawn.z];
    const cols = outerColumns().filter(([x, z]) => insideWall(world, x, z));
    let tried = 0;
    while (tried < 40) {
      const [x, z] = cols[Math.floor(random() * cols.length)];
      const to: Cell = [x, ground(world, x, z) + 1, z];
      if (!isStandable(world, to)) continue; // water, a trunk or under a canopy edge
      tried++;
      expect(findPath(world, from, to, 200_000), `${x},${z}`).not.toBeNull();
    }
  }, 120_000);
});
