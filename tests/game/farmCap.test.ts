import { describe, expect, it, vi } from 'vitest';

// Make everything grow very slowly, so that eight hours is NOT enough to ripen it. Then the cap
// shows: ten hours and eight hours must give exactly the same state.
vi.mock('../../src/core/crops', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/core/crops')>();
  return { ...real, growthRateAt: () => 0.001 };
});

import { BlockId } from '../../src/core/blocks';
import { cropOf } from '../../src/core/crops';
import { OFFLINE_CAP_MS, STAGE_MS } from '../../src/core/growth';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { World } from '../../src/core/world';
import { Farm } from '../../src/game/farm';

const HOUR = 3600_000;

function field() {
  const world = new World(16, 16, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(x, 0, z, BlockId.Grass);
  const inv = new Inventory();
  inv.add(ItemId.WheatSeed, 3);
  inv.add(ItemId.AppleSapling, 1);
  const farm = new Farm(world, inv);
  farm.plant([3, 1, 3], ItemId.WheatSeed, []);
  farm.plant([5, 1, 3], ItemId.WheatSeed, []);
  farm.plant([8, 1, 8], ItemId.AppleSapling, []);
  return { world, farm };
}

describe('Farm.advance cap, shown before growth saturates', () => {
  it('slow plants really are still growing after 8 h (so the cap is observable)', () => {
    const { farm } = field();
    farm.advance(8 * HOUR);
    const p = farm.records().crops[0].p;
    expect(p).toBeCloseTo(8 * HOUR * 0.001, 0); // 28.8 s of growth, far from a 150 s stage
    expect(p).toBeLessThan(STAGE_MS);
  });
  it('10 hours in one call grows exactly what 8 hours grow (crops and trees)', () => {
    const a = field();
    const b = field();
    a.farm.advance(8 * HOUR);
    b.farm.advance(10 * HOUR);
    expect(b.farm.records()).toEqual(a.farm.records());
    expect(OFFLINE_CAP_MS).toBe(8 * HOUR);
  });
  it('a week and Infinity are capped the same way, and a second call adds a second 8 h at most', () => {
    const a = field();
    const b = field();
    const c = field();
    a.farm.advance(8 * HOUR);
    b.farm.advance(7 * 24 * HOUR);
    c.farm.advance(Infinity);
    expect(b.farm.records()).toEqual(a.farm.records());
    expect(c.farm.records()).toEqual(a.farm.records());
    b.farm.advance(7 * 24 * HOUR);
    expect(b.farm.records().crops[0].p).toBeCloseTo(2 * 8 * HOUR * 0.001, 0);
  });
  it('slow crops stay unripe blocks and nothing is lost to the cap', () => {
    const { world, farm } = field();
    farm.advance(100 * HOUR);
    farm.update(0.03);
    expect(cropOf(world.get(3, 1, 3))?.stage).toBe(0);
    expect(world.get(8, 1, 8)).toBe(BlockId.Sapling);
  });
});
