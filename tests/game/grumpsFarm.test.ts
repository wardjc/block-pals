import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { cropOf } from '../../src/core/crops';
import { OFFLINE_CAP_MS, STAGE_MS } from '../../src/core/growth';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { Farm, PAUSE_STEP_MAX_MS, pauseFor } from '../../src/game/farm';
import { GrumpSystem } from '../../src/game/grumps';

function box(): World {
  const world = new World(24, 16, 24);
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) world.set(x, 0, z, BlockId.Grass);
  world.clearEdits();
  world.markClean();
  return world;
}
function setup() {
  const world = box();
  const inv = new Inventory();
  inv.add(ItemId.WheatSeed, 20);
  inv.add(ItemId.AppleSapling, 4);
  const farm = new Farm(world, inv);
  return { world, inv, farm };
}
const at = (x: number, z: number): Cell => [x, 1, z];
const stage = (world: World, c: Cell): number => cropOf(world.get(...c))?.stage ?? -1;
const never = (): boolean => false;
const always = (): boolean => true;
const records = (farm: Farm): string => JSON.stringify(farm.records());

describe('Farm pause', () => {
  it('a paused plant does not grow (progress unchanged) while an unpaused one does', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(8, 8), ItemId.WheatSeed, []);
    farm.advance(STAGE_MS * 3, (x, _y, z) => x === 3 && z === 3);
    farm.update(0); farm.update(0);
    expect(stage(world, at(3, 3))).toBe(0);
    expect(farm.records().crops.find(c => c.x === 3)!.p).toBe(0);
    expect(stage(world, at(8, 8))).toBe(3);
  });

  it('unpausing resumes from where it stopped', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.advance(STAGE_MS * 0.5);
    farm.advance(100_000, always);
    farm.advance(STAGE_MS * 0.5 - 1000);
    farm.update(0);
    expect(stage(world, at(3, 3))).toBe(0);
    farm.advance(1000);
    farm.update(0);
    expect(stage(world, at(3, 3))).toBe(1);
  });

  it('paused advance equals no advance for that record (property over random sequences)', () => {
    for (let s = 0; s < 40; s++) {
      const rng = mulberry32(s);
      const a = setup(), solo = setup();
      a.farm.plant(at(3, 3), ItemId.WheatSeed, []);
      a.farm.plant(at(9, 9), ItemId.WheatSeed, []);
      solo.farm.plant(at(9, 9), ItemId.WheatSeed, []);
      let moved = 0;
      for (let i = 0; i < 30; i++) {
        const ms = rng() * 60_000;
        const pause = rng() < 0.5;
        a.farm.advance(ms, (x) => pause && x === 3);
        solo.farm.advance(ms);
        if (!pause) moved += ms;
      }
      // The unpaused record is exactly what it would be alone; the paused one only saw the unpaused time.
      expect(a.farm.records().crops.find(c => c.x === 9)).toEqual(solo.farm.records().crops.find(c => c.x === 9));
      const only = setup();
      only.farm.plant(at(3, 3), ItemId.WheatSeed, []);
      only.farm.advance(moved);
      expect(a.farm.records().crops.find(c => c.x === 3)!.p).toBeCloseTo(only.farm.records().crops.find(c => c.x === 3)!.p, 3);
    }
    // Exact form: a farm that only ever sees paused time for a record equals one that never ran.
    const p = setup(), q = setup();
    p.farm.plant(at(3, 3), ItemId.WheatSeed, []);
    q.farm.plant(at(3, 3), ItemId.WheatSeed, []);
    for (let i = 0; i < 50; i++) p.farm.advance(40_000, always);
    expect(records(p.farm)).toBe(records(q.farm));
  });

  it('the pause is deterministic: same inputs, same records', () => {
    const run = (): string => {
      const { farm } = setup();
      farm.plant(at(3, 3), ItemId.WheatSeed, []);
      farm.plant(at(5, 5), ItemId.AppleSapling, []);
      const rng = mulberry32(4);
      for (let i = 0; i < 200; i++) { const pause = rng() < 0.5; farm.advance(rng() * 30_000, () => pause); }
      return records(farm);
    };
    expect(run()).toBe(run());
  });

  it('stages never decrease and no plant block is removed under any pause pattern', () => {
    for (let s = 0; s < 200; s++) {
      const rng = mulberry32(s);
      const { world, farm } = setup();
      const cells = [at(3, 3), at(6, 3), at(9, 3)];
      for (const c of cells) farm.plant(c, ItemId.WheatSeed, []);
      farm.plant(at(12, 12), ItemId.AppleSapling, []);
      const last = [0, 0, 0];
      for (let i = 0; i < 30; i++) {
        const mask = Math.floor(rng() * 8);
        farm.advance(rng() * STAGE_MS, (x) => (mask >> ((x - 3) / 3) & 1) === 1);
        farm.update(0); farm.update(0); farm.update(0);
        cells.forEach((c, k) => {
          const st = stage(world, c);
          expect(st).toBeGreaterThanOrEqual(last[k]);
          last[k] = st;
        });
        expect(world.get(12, 1, 12)).not.toBe(BlockId.Air);
      }
    }
  });

  it('help still advances a paused plant one stage', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.advance(STAGE_MS * 5, always);
    expect(stage(world, at(3, 3))).toBe(0);
    farm.help(at(3, 3));
    expect(stage(world, at(3, 3))).toBe(1);
  });

  it('a tree is paused by its trunk cell and a paused tree does not grow', () => {
    const { world, farm } = setup();
    farm.plant(at(5, 5), ItemId.AppleSapling, []);
    farm.advance(10_000_000, (x, y, z) => x === 5 && y === 1 && z === 5);
    farm.update(0);
    expect(world.get(5, 1, 5)).toBe(BlockId.Sapling);
    farm.advance(10_000_000);
    farm.update(0);
    expect(world.get(5, 1, 5)).not.toBe(BlockId.Sapling);
  });

  it('plantCells lists crop and tree base cells', () => {
    const { farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(5, 5), ItemId.AppleSapling, []);
    expect(farm.plantCells().map(c => c.join()).sort()).toEqual([at(3, 3).join(), at(5, 5).join()].sort());
  });

  it('growingNear finds the nearest plant that is not ripe within the radius', () => {
    const { farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(8, 3), ItemId.WheatSeed, []);
    expect(farm.growingNear(at(7, 3), 5)).toEqual(at(8, 3));
    expect(farm.growingNear(at(7, 3), 1)).toEqual(at(8, 3));
    expect(farm.growingNear(at(20, 20), 3)).toBeNull();
    farm.help(at(8, 3)); farm.help(at(8, 3)); farm.help(at(8, 3)); // ripe
    expect(farm.growingNear(at(7, 3), 5)).toEqual(at(3, 3));
  });

  it('a step bigger than 5 s is applied without the pause (the wiring helper)', () => {
    expect(PAUSE_STEP_MAX_MS).toBe(5000);
    const pauses = (): boolean => true;
    expect(pauseFor(1000, pauses)).toBeDefined();
    expect(pauseFor(5000, pauses)).toBeDefined();
    expect(pauseFor(5001, pauses)).toBeUndefined();
    expect(pauseFor(OFFLINE_CAP_MS, pauses)).toBeUndefined();
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.advance(STAGE_MS + 10, pauseFor(STAGE_MS + 10, always));
    farm.update(0);
    expect(stage(world, at(3, 3))).toBe(1); // time away is never penalised
  });

  it('records round-trip exactly while paused (nothing new to save)', () => {
    const { world, inv, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.advance(60_000);
    farm.advance(60_000, always);
    const before = farm.records();
    const again = new Farm(world, inv);
    again.restore(before.crops, before.trees);
    expect(again.records()).toEqual(before);
  });

  it('GrumpSystem.pausesCell drives the pause and the first hit unpauses at once', () => {
    const { world, farm } = setup();
    const sys = new GrumpSystem(mulberry32(1), { x0: 0, z0: 0, x1: 23, z1: 23 }, new Set());
    farm.plant(at(10, 10), ItemId.WheatSeed, []);
    const g = sys.spawn([10, 1, 12], 'jelly');
    const paused = (x: number, y: number, z: number): boolean => sys.pausesCell([x, y, z]);
    farm.advance(STAGE_MS, paused);
    farm.update(0);
    expect(stage(world, at(10, 10))).toBe(0);
    expect(sys.pausedCells(farm.plantCells())).toEqual([at(10, 10)]);
    sys.hit(g.id);
    expect(sys.pausedCells(farm.plantCells())).toEqual([]);
    farm.advance(STAGE_MS, paused);
    farm.update(0);
    expect(stage(world, at(10, 10))).toBe(1);
  });
});
