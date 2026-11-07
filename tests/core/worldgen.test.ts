import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { canStep, findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32, valueNoise2D } from '../../src/core/rng';
import { World } from '../../src/core/world';
import fixture from '../fixtures/legacy-meadow-2026.json';
import { insideWall } from '../../src/core/bounds';
import { generateMeadowStage, generateWorld, GEN_VERSION, heightAt } from '../../src/core/worldgen';

function cells(world: World): BlockId[] {
  const result: BlockId[] = [];
  for (let y = 0; y < world.sizeY; y++) {
    for (let z = 0; z < world.sizeZ; z++) {
      for (let x = 0; x < world.sizeX; x++) result.push(world.get(x, y, z));
    }
  }
  return result;
}

function grassY(world: World, x: number, z: number): number {
  for (let y = world.sizeY - 1; y >= 0; y--) {
    if (world.get(x, y, z) === BlockId.Grass) return y;
  }
  return -1;
}

describe('seeded random helpers', () => {
  it('produces the Mulberry32 sequence in [0, 1)', () => {
    const random = mulberry32(1);
    expect([random(), random(), random()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
    for (const seed of [0, 2026, -1, 0xffffffff]) {
      const first = mulberry32(seed);
      const second = mulberry32(seed);
      for (let i = 0; i < 100; i++) {
        const value = first();
        expect(value).toBe(second());
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it('provides smooth, seeded, order-independent 2D value noise in [0, 1]', () => {
    const noise = valueNoise2D(2026);
    const again = valueNoise2D(2026);
    const other = valueNoise2D(2027);
    const points = [[0, 0], [1.5, 2.25], [-3.2, -4], [9.99999, 7], [10, 7]];
    const values = points.map(([x, z]) => noise(x, z));
    expect(new Set(values).size).toBeGreaterThan(1);
    expect(values).not.toEqual(points.map(([x, z]) => other(x, z)));
    for (const [x, z] of [...points].reverse()) {
      const value = noise(x, z);
      expect(value).toBe(again(x, z));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(Math.abs(value - noise(x + 0.00001, z))).toBeLessThan(0.001);
      expect(Math.abs(value - noise(x, z + 0.00001))).toBeLessThan(0.001);
    }
  });
});

describe('generateWorld', () => {
  it('is deterministic for the same seed', () => {
    const first = generateWorld(2026);
    const second = generateWorld(2026);
    expect(cells(first.world)).toEqual(cells(second.world));
    expect(first.spawn).toEqual(second.spawn);
  });

  it('different seeds differ', () => {
    expect(cells(generateWorld(2026).world)).not.toEqual(cells(generateWorld(2027).world));
  });

  it('defaults to seed 2026 and creates a 96×20×96 world', () => {
    const { world, spawn } = generateWorld();
    expect([world.sizeX, world.sizeY, world.sizeZ]).toEqual([96, 20, 96]);
    expect(cells(world)).toEqual(cells(generateWorld(2026).world));
    expect(spawn).toEqual(generateWorld(2026).spawn);
  });

  it('clears generation edits and records subsequent player changes only', () => {
    const { world, spawn } = generateWorld();
    expect(world.edits()).toEqual([]);
    world.set(spawn.x, spawn.y - 1, spawn.z, BlockId.Air);
    expect(world.edits()).toEqual([[spawn.x, spawn.y - 1, spawn.z, BlockId.Air]]);
    world.markClean();
    expect(world.edits()).toHaveLength(1);
  });

  describe.each([2026, 2027, 0, 1, -1, 0xffffffff])('seed %s', (seed) => {
    const { world, spawn } = generateWorld(seed);

    it('bedrock at y=0 everywhere', () => {
      for (let x = 0; x < 48; x++) {
        for (let z = 0; z < 48; z++) expect(world.get(x, 0, z)).toBe(BlockId.Bedrock);
      }
    });

    it('spawn stands on solid grass with 2 air above', () => {
      expect([spawn.x, spawn.z]).toEqual([24, 24]);
      expect(spawn.y).toBe(world.topSolidY(24, 24) + 1);
      expect(world.get(24, spawn.y - 1, 24)).toBe(BlockId.Grass);
      expect(BLOCKS[world.get(24, spawn.y - 1, 24)].solid).toBe(true);
      expect(world.get(24, spawn.y, 24)).toBe(BlockId.Air);
      expect(world.get(24, spawn.y + 1, 24)).toBe(BlockId.Air);
    });

    it('contains at least one water cell and sand next to it', () => {
      let water = 0;
      let shore = false;
      for (let x = 0; x < 48; x++) {
        for (let z = 0; z < 48; z++) {
          const distance = Math.hypot(x - 14, z - 32);
          if (distance <= 5) expect(world.get(x, 5, z)).toBe(BlockId.Water);
          if (distance > 5 && distance <= 6) expect(world.get(x, 5, z)).toBe(BlockId.Sand);
          for (let y = 1; y < 16; y++) {
            if (world.get(x, y, z) !== BlockId.Water) continue;
            water++;
            expect(y).toBeLessThanOrEqual(5);
            expect(distance).toBeLessThanOrEqual(5);
            if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) =>
              world.get(x + dx, y, z + dz) === BlockId.Sand)) shore = true;
          }
        }
      }
      expect(water).toBeGreaterThan(0);
      expect(shore).toBe(true);
    });

    it('layers stone below two dirt blocks and grass, with a hill near (34, 12)', () => {
      let peak = 0;
      for (let x = 0; x < 48; x++) {
        for (let z = 0; z < 48; z++) {
          const top = grassY(world, x, z);
          if (top < 0) continue;
          expect(top).toBeGreaterThanOrEqual(5);
          expect(top).toBeLessThanOrEqual(11);
          expect(world.get(x, top - 1, z)).toBe(BlockId.Dirt);
          expect(world.get(x, top - 2, z)).toBe(BlockId.Dirt);
          for (let y = 1; y < top - 2; y++) expect(world.get(x, y, z)).toBe(BlockId.Stone);
          if (Math.hypot(x - 34, z - 12) <= 3) peak = Math.max(peak, top);
          if (Math.hypot(x - 34, z - 12) > 10) expect(top).toBeLessThanOrEqual(9);
        }
      }
      expect(peak).toBeGreaterThanOrEqual(10);
    });

    it('contains at least 10 wood cells in trunks, with 10–16 complete trees and a denser edge ring', () => {
      let trees = 0;
      let edgeTrees = 0;
      let wood = 0;
      let leaves = 0;
      for (let x = 0; x < 48; x++) {
        for (let z = 0; z < 48; z++) {
          const trunk: number[] = [];
          for (let y = 0; y < 16; y++) {
            if (world.get(x, y, z) === BlockId.Leaves) leaves++;
            if (world.get(x, y, z) === BlockId.Wood) trunk.push(y);
          }
          wood += trunk.length;
          if (!trunk.length) continue;
          trees++;
          const base = trunk[0];
          expect(trunk).toEqual([base, base + 1, base + 2, base + 3]);
          expect(world.get(x, base - 1, z)).toBe(BlockId.Grass);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              for (let y = base + 4; y <= base + 5; y++) {
                expect(world.inBounds(x + dx, y, z + dz)).toBe(true);
                expect(world.get(x + dx, y, z + dz)).toBe(BlockId.Leaves);
              }
            }
          }
          const edge = Math.min(x, z, 47 - x, 47 - z);
          if (edge >= 2 && edge <= 4) edgeTrees++;
        }
      }
      expect(wood).toBeGreaterThanOrEqual(10);
      expect(trees).toBeGreaterThanOrEqual(10);
      expect(trees).toBeLessThanOrEqual(16);
      expect(edgeTrees).toBeGreaterThan(trees / 2);
      expect(leaves).toBe(trees * 18);
    });

    it('no tree within 3 columns of spawn', () => {
      for (let x = spawn.x - 3; x <= spawn.x + 3; x++) {
        for (let z = spawn.z - 3; z <= spawn.z + 3; z++) {
          for (let y = 0; y < 16; y++) {
            expect([BlockId.Wood, BlockId.Leaves]).not.toContain(world.get(x, y, z));
          }
        }
      }
    });
  });

  it('every land column at the spawn plateau is reachable', () => {
    for (const seed of [2026, 2027, 0, 1, -1, 0xffffffff]) {
      const { world, spawn } = generateWorld(seed);
      const from: Cell = [spawn.x, spawn.y, spawn.z];
      // Check the tree-free spawn clearing, including the slope towards the pond.
      for (let x = spawn.x - 3; x <= spawn.x + 3; x++) {
        for (let z = spawn.z - 3; z <= spawn.z + 3; z++) {
          const to: Cell = [x, world.topSolidY(x, z) + 1, z];
          const path = findPath(world, from, to);
          expect(path, `seed ${seed}, column (${x}, ${z})`).not.toBeNull();
          let previous = from;
          for (const cell of path!) {
            expect(isStandable(world, cell)).toBe(true);
            expect(canStep(world, previous, cell)).toBe(true);
            expect(Math.abs(cell[1] - previous[1])).toBeLessThanOrEqual(1);
            previous = cell;
          }
          expect(previous).toEqual(to);
        }
      }
    }
  });
});

describe('worldgen stages', () => {
  it('v1 meadow is unchanged', () => {
    const { world, spawn } = generateMeadowStage(2026);
    let hash = 0x811c9dc5;
    const counts: Record<string, number> = {};
    for (let y = 0; y < 16; y++) for (let z = 0; z < 48; z++) for (let x = 0; x < 48; x++) {
      const id = world.get(x, y, z);
      hash = Math.imul(hash ^ id, 0x01000193) >>> 0;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(hash).toBe(fixture.hash);
    expect(counts).toEqual(fixture.counts);
    expect(spawn).toEqual(fixture.spawn);
    for (let y = 16; y < world.sizeY; y++) for (let z = 0; z < 48; z++) for (let x = 0; x < 48; x++) {
      expect(world.get(x, y, z)).toBe(BlockId.Air);
    }
  });

  it('heightAt matches the generated surface and GEN_VERSION is 1', () => {
    const { world } = generateMeadowStage(2026);
    expect(GEN_VERSION).toBe(1);
    for (const [x, z] of [[0, 0], [24, 24], [34, 12], [14, 32], [70, 70], [95, 95]]) {
      const h = heightAt(2026, x, z);
      expect(BLOCKS[world.get(x, h, z)].solid).toBe(true);
      expect(world.get(x, h + 1, z)).not.toBe(BlockId.Dirt);
    }
  });

  it('size, bedrock and surface heights', () => {
    const { world } = generateWorld(2026);
    expect([world.sizeX, world.sizeY, world.sizeZ]).toEqual([96, 20, 96]);
    for (let x = 0; x < 96; x++) for (let z = 0; z < 96; z++) {
      expect(world.get(x, 0, z)).toBe(BlockId.Bedrock);
      const ground = heightAt(2026, x, z);
      expect(ground).toBeGreaterThanOrEqual(3);
      expect(ground).toBeLessThanOrEqual(12);
    }
  });

  it('trees stay inside the soft wall and keep the spawn clear', () => {
    const { world, spawn } = generateWorld(2026);
    for (let x = 0; x < 96; x++) for (let z = 0; z < 96; z++) {
      for (let y = 0; y < 20; y++) {
        const id = world.get(x, y, z);
        if (id === BlockId.Wood) expect(insideWall(world, x, z)).toBe(true);
        if ((id === BlockId.Wood || id === BlockId.Leaves) && Math.abs(x - spawn.x) <= 4 && Math.abs(z - spawn.z) <= 4) {
          throw new Error(`tree near spawn at ${x},${y},${z}`);
        }
      }
    }
  });

  it('edge ring: at least 3 trees within 4 cells of each edge', () => {
    const { world } = generateWorld(2026);
    const near = [0, 0, 0, 0];
    for (let x = 0; x < 96; x++) for (let z = 0; z < 96; z++) {
      if (world.get(x, heightAt(2026, x, z) + 1, z) !== BlockId.Wood) continue;
      if (z <= 4) near[0]++;
      if (95 - x <= 4) near[1]++;
      if (95 - z <= 4) near[2]++;
      if (x <= 4) near[3]++;
    }
    for (const n of near) expect(n).toBeGreaterThanOrEqual(3);
  });

  it('no tree stands on water or sand, and every tree has grass under it', () => {
    const { world } = generateWorld(2026);
    for (let x = 0; x < 96; x++) for (let z = 0; z < 96; z++) {
      const g = heightAt(2026, x, z);
      if (world.get(x, g + 1, z) === BlockId.Wood) expect(world.get(x, g, z)).toBe(BlockId.Grass);
    }
  });

  it('new ground has extra trees beyond the v1 area', () => {
    const { world } = generateWorld(2026);
    let trunks = 0;
    for (let x = 48; x < 96; x++) for (let z = 0; z < 96; z++) {
      if (world.get(x, heightAt(2026, x, z) + 1, z) === BlockId.Wood) trunks++;
    }
    expect(trunks).toBeGreaterThan(5);
  });
});
