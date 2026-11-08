import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { WORLD } from '../../src/core/bounds';
import { findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { GROUND_Y, VILLAGE_PLAN, type FarmLayout, type Rect, type VillageLayout } from '../../src/core/village';
import { applySave } from '../../src/core/save';
import type { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';

let world: World;
let village: VillageLayout;
let farm: FarmLayout;
let spawn: Cell;

beforeAll(() => {
  const g = generateWorld(2026);
  world = g.world;
  village = g.village;
  farm = village.farm;
  spawn = [Math.floor(g.spawn.x), Math.floor(g.spawn.y), Math.floor(g.spawn.z)];
});

const cells = (r: Rect): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) out.push([x, z]);
  return out;
};
const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const solid = (x: number, y: number, z: number): boolean => BLOCKS[world.get(x, y, z)].solid;
/** Chebyshev gap between two rects: 0 when they touch, negative when they overlap. */
const gap = (a: Rect, b: Rect): number =>
  Math.max(a.x0 - b.x1, b.x0 - a.x1, a.z0 - b.z1, b.z0 - a.z1) - 1;

describe('farm layout', () => {
  it('beds are Farmland and every bed cell is within reach 3 of an aisle cell', () => {
    expect(farm.beds).toHaveLength(3);
    const aisles = cells(village.farmPlot).filter(([x, z]) => world.get(x, GROUND_Y, z) === BlockId.Dirt);
    for (const bed of farm.beds) {
      expect(bed.x1 - bed.x0 + 1).toBeGreaterThanOrEqual(2);
      for (const [x, z] of cells(bed)) {
        expect(world.get(x, GROUND_Y, z)).toBe(BlockId.Farmland);
        expect(aisles.some(([ax, az]) => Math.max(Math.abs(ax - x), Math.abs(az - z)) <= 3)).toBe(true);
        expect(world.get(x, GROUND_Y + 1, z)).toBe(BlockId.Air);
      }
    }
  });

  it('pool is six Water source blocks, flush with the ground and ringed by solid blocks at pool level', () => {
    const pool = cells(farm.pool);
    expect(pool).toHaveLength(6);
    for (const [x, z] of pool) {
      expect(world.get(x, GROUND_Y, z)).toBe(BlockId.Water);
      expect(world.get(x, GROUND_Y + 1, z)).toBe(BlockId.Air);
      expect(solid(x, GROUND_Y - 1, z)).toBe(true);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (inRect(farm.pool, x + dx, z + dz)) continue;
        expect(solid(x + dx, GROUND_Y, z + dz), `${x + dx},${z + dz}`).toBe(true);
      }
    }
    let water = 0;
    for (let x = 60; x <= 90; x++) for (let z = 30; z <= 56; z++) for (let y = 1; y < WORLD.y; y++) if (world.get(x, y, z) === BlockId.Water) water++;
    expect(water).toBe(6);
  });

  it('the irrigation aisle is empty plain Dirt from the pool to the beds (nothing stamped, nothing planted)', () => {
    const irr = farm.irrigation;
    expect(irr.z0).toBe(irr.z1);
    expect(irr.x0).toBe(farm.beds[0].x0);
    expect(irr.x1).toBeGreaterThanOrEqual(farm.beds[0].x1);
    expect(irr.x1 + 1).toBeLessThanOrEqual(farm.pool.x0); // reaches the pool's side
    for (const [x, z] of cells(irr)) {
      expect(world.get(x, GROUND_Y, z)).toBe(BlockId.Dirt);
      for (let y = GROUND_Y + 1; y < WORLD.y; y++) expect(world.get(x, y, z)).toBe(BlockId.Air);
    }
    // It touches the pool's row of Water through its east end.
    expect(Math.abs(irr.z0 - farm.pool.z1)).toBeLessThanOrEqual(1);
  });

  it('the pasture is level and clear', () => {
    const p = farm.pasture;
    for (const [x, z] of cells(p)) {
      expect(world.get(x, GROUND_Y, z), `${x},${z}`).toBe(BlockId.Grass);
      expect(solid(x, GROUND_Y - 1, z)).toBe(true);
      const ring = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
      for (let y = GROUND_Y + 1; y < WORLD.y; y++) {
        const id = world.get(x, y, z);
        if (ring && y === GROUND_Y + 1) continue;
        expect(id, `${x},${y},${z}`).toBe(BlockId.Air);
      }
    }
  });

  it('the fence is one block high, solid, with a 2-wide gap', () => {
    const p = farm.pasture;
    expect(farm.gate).toHaveLength(2);
    expect(farm.gate[1][0] - farm.gate[0][0]).toBe(1);
    for (const [x, y, z] of farm.gate) {
      expect(z).toBe(p.z0);
      expect(world.get(x, y, z)).toBe(BlockId.Air);
    }
    const ringCount = 2 * (p.x1 - p.x0 + 1) + 2 * (p.z1 - p.z0 - 1);
    expect(farm.fence).toHaveLength(ringCount - 2);
    for (const [x, y, z] of farm.fence) {
      expect(y).toBe(GROUND_Y + 1);
      expect(world.get(x, y, z)).toBe(BlockId.Fence);
      expect(world.get(x, y + 1, z)).toBe(BlockId.Air);
      expect(BLOCKS[BlockId.Fence].solid).toBe(true);
    }
    // No other fence block exists.
    let n = 0;
    for (let x = 0; x < WORLD.x; x++) for (let z = 0; z < WORLD.z; z++) for (let y = 1; y < WORLD.y; y++) if (world.get(x, y, z) === BlockId.Fence) n++;
    expect(n).toBe(farm.fence.length);
  });

  it('a path of standable cells joins the plot and the gate', () => {
    const r = farm.path;
    expect(r.x1 - r.x0 + 1).toBe(3);
    for (const [x, z] of cells(r)) {
      expect(world.get(x, GROUND_Y, z)).toBe(BlockId.PathStone);
      expect(isStandable(world, [x, GROUND_Y + 1, z])).toBe(true);
    }
    expect(r.z1 + 1).toBe(farm.pasture.z0);
    for (const [gx] of farm.gate) expect(gx >= r.x0 && gx <= r.x1).toBe(true);
    expect(r.z0).toBe(village.farmPlot.z1 + 1);
  });

  it('A* from spawn reaches the plot, the gate and the pasture middle', () => {
    const p = farm.pasture;
    const goals: Cell[] = [
      [76, GROUND_Y + 1, 40],
      [farm.gate[0][0], GROUND_Y + 1, farm.gate[0][2]],
      [Math.floor((p.x0 + p.x1) / 2), GROUND_Y + 1, Math.floor((p.z0 + p.z1) / 2)],
    ];
    for (const goal of goals) {
      expect(isStandable(world, goal), goal.join()).toBe(true);
      expect(findPath(world, spawn, goal, 60000), goal.join()).not.toBeNull();
    }
  });

  it('herd spawns are standable, inside the interior and not on the fence', () => {
    const p = farm.pasture;
    expect(farm.herdSpawns.length).toBeGreaterThanOrEqual(12);
    const seen = new Set<string>();
    for (const c of farm.herdSpawns) {
      expect(isStandable(world, c)).toBe(true);
      expect(c[0]).toBeGreaterThan(p.x0);
      expect(c[0]).toBeLessThan(p.x1);
      expect(c[2]).toBeGreaterThan(p.z0);
      expect(c[2]).toBeLessThan(p.z1);
      expect(seen.has(c.join())).toBe(false);
      seen.add(c.join());
    }
  });

  it('no overlap, and gaps: pasture, plot, farmhouse, Granny and the pad', () => {
    const p = farm.pasture;
    const plot = village.farmPlot;
    const [, , , farmhouse, granny] = village.houses;
    for (const r of village.houses.map(h => h.rect)) expect(gap(p, r)).toBeGreaterThanOrEqual(2);
    expect(gap(p, plot)).toBeGreaterThanOrEqual(2);
    expect(gap(p, VILLAGE_PLAN.pad)).toBeGreaterThanOrEqual(0); // the pasture sits just below the village pad, never over it
    expect(gap(plot, farmhouse.rect)).toBeGreaterThanOrEqual(0);
    expect(gap(plot, granny.rect)).toBeGreaterThanOrEqual(0);
    expect(gap(plot, village.square)).toBeGreaterThanOrEqual(2);
    // The plot's contents stay inside the plot.
    for (const r of [...farm.beds, farm.pool, farm.irrigation]) {
      expect(r.x0 >= plot.x0 && r.x1 <= plot.x1 && r.z0 >= plot.z0 && r.z1 <= plot.z1).toBe(true);
    }
  });

  it('step 1 stamps unchanged: houses, doors, route and the square', () => {
    const again = generateWorld(2026).village;
    expect(again.route).toEqual(village.route);
    expect([...again.routeCells]).toEqual([...village.routeCells]);
    expect(village.houses).toHaveLength(5);
    expect(village.square).toEqual(VILLAGE_PLAN.square);
    // Every house door is still reachable from spawn.
    for (const house of village.houses) expect(findPath(world, spawn, house.doorFront, 60000)).not.toBeNull();
  });

  it('is deterministic', () => {
    const again = generateWorld(2026);
    for (const [x, z] of [[72, 35], [81, 35], [74, 46], [62, 46], [83, 54]] as Array<[number, number]>) {
      expect(again.world.get(x, GROUND_Y, z)).toBe(world.get(x, GROUND_Y, z));
      expect(again.world.get(x, GROUND_Y + 1, z)).toBe(world.get(x, GROUND_Y + 1, z));
    }
    expect(again.village.farm.herdSpawns).toEqual(farm.herdSpawns);
  });

  it('his edits still win over the farm stamps (through applySave, as a reload does)', () => {
    const edits: Array<[number, number, number, number]> = [
      [73, GROUND_Y, 35, BlockId.Stone], // in a bed
      [farm.fence[3][0], farm.fence[3][1], farm.fence[3][2], BlockId.Air], // a fence block taken
      [82, GROUND_Y, 35, BlockId.Dirt], // filled in the pool
    ];
    const loaded = applySave({
      version: 2, gen: 1, seed: 2026, edits, inventory: {}, player: { x: 24.5, y: 6, z: 24.5 }, flags: { ledToVillage: false },
    });
    for (const [x, y, z, id] of edits) expect(loaded.world.get(x, y, z)).toBe(id);
    // An old (gen 1) save regenerates the farm around his edits.
    expect(loaded.world.get(72, GROUND_Y, 35)).toBe(BlockId.Farmland);
    expect(loaded.world.get(farm.fence[0][0], farm.fence[0][1], farm.fence[0][2])).toBe(BlockId.Fence);
  });
});
