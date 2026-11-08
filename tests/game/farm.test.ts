import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { cropBlock, cropOf, seedFor } from '../../src/core/crops';
import { APPLE_REGROW_MS, OFFLINE_CAP_MS, STAGE_MS, TREE_STAGE_MS } from '../../src/core/growth';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { Farm, type FarmEvent } from '../../src/game/farm';

function box(w = 16, d = 16, h = 16, floor = BlockId.Grass): World {
  const world = new World(w, h, d);
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) world.set(x, 0, z, floor);
  world.clearEdits();
  world.markClean();
  return world;
}

function setup(seeds: Array<[ItemId, number]> = [[ItemId.WheatSeed, 5], [ItemId.CarrotSeed, 5], [ItemId.AppleSapling, 2]]) {
  const world = box();
  const inv = new Inventory();
  for (const [id, n] of seeds) inv.add(id, n);
  const farm = new Farm(world, inv);
  const events: FarmEvent[] = [];
  farm.onEvent(e => events.push(e));
  return { world, inv, farm, events };
}

const at = (x: number, z: number): Cell => [x, 1, z];
const stageAt = (world: World, cell: Cell): number | null => cropOf(world.get(...cell))?.stage ?? null;

describe('Farm: planting', () => {
  it('plant uses one seed and turns grass to farmland', () => {
    const { world, inv, farm } = setup();
    expect(farm.plant(at(3, 3), ItemId.WheatSeed, [])).toBe(true);
    expect(inv.count(ItemId.WheatSeed)).toBe(4);
    expect(world.get(3, 0, 3)).toBe(BlockId.Farmland);
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat0);
    expect(farm.isPlantCell(at(3, 3))).toBe(true);
  });
  it('plant refuses sand and an occupied cell and keeps the seed', () => {
    const { world, inv, farm } = setup();
    world.set(4, 0, 4, BlockId.Sand);
    expect(farm.plant(at(4, 4), ItemId.WheatSeed, [])).toBe(false);
    expect(farm.plant(at(5, 5), ItemId.WheatSeed, [at(5, 5)])).toBe(false);
    expect(inv.count(ItemId.WheatSeed)).toBe(5);
  });
  it('plant refuses where a plant already stands, and with no seed or a non-seed', () => {
    const { world, inv, farm } = setup([[ItemId.WheatSeed, 1], [ItemId.Apple, 3]]);
    expect(farm.plant(at(3, 3), ItemId.WheatSeed, [])).toBe(true);
    expect(farm.plant(at(3, 3), ItemId.WheatSeed, [])).toBe(false);
    expect(farm.plant(at(6, 6), ItemId.WheatSeed, [])).toBe(false); // none left
    expect(farm.plant(at(6, 6), ItemId.Apple, [])).toBe(false);
    expect(inv.count(ItemId.Apple)).toBe(3);
    expect(world.get(6, 1, 6)).toBe(BlockId.Air);
  });
  it('replant straight away works after a harvest, soil stays', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.harvest(at(3, 3));
    expect(world.get(3, 0, 3)).toBe(BlockId.Farmland);
    expect(farm.plant(at(3, 3), ItemId.WheatSeed, [])).toBe(true);
  });
});

describe('Farm: help', () => {
  it('help advances exactly one stage and returns the cue', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.CarrotSeed, []);
    expect(farm.help(at(3, 3))).toMatchObject({ type: 'helped', cue: 'water', ripe: false });
    expect(stageAt(world, at(3, 3))).toBe(1);
    expect(farm.help(at(3, 3))).toMatchObject({ type: 'helped', cue: 'sun', ripe: false });
    expect(stageAt(world, at(3, 3))).toBe(2);
  });
  it('three helps ripen a crop (and say ripe once)', () => {
    const { world, farm, events } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    const last = [1, 2, 3].map(() => farm.help(at(3, 3))).pop();
    expect(last).toMatchObject({ type: 'helped', cue: 'both', ripe: true });
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat3);
    expect(events.filter(e => e.type === 'ripe')).toHaveLength(1);
  });
  it('help on a ripe crop does nothing (rest)', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    for (let i = 0; i < 3; i++) farm.help(at(3, 3));
    expect(farm.help(at(3, 3))).toEqual({ type: 'rest' });
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat3);
  });
  it('help on a non-plant is null', () => {
    const { farm } = setup();
    expect(farm.help(at(3, 3))).toBeNull();
  });
  it("help resets that stage's timer", () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.advance(STAGE_MS - 1000);
    farm.update(0.03);
    farm.help(at(3, 3)); // stage 1, timer 0
    farm.advance(STAGE_MS - 1000);
    farm.update(0.03);
    expect(stageAt(world, at(3, 3))).toBe(1);
  });
});

describe('Farm: natural growth', () => {
  it('ripens after 3 stages of time', () => {
    const { world, farm, events } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.advance(3 * STAGE_MS);
    farm.update(0.03);
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat3);
    expect(events.some(e => e.type === 'ripe')).toBe(true);
  });
  it('is order independent: one big advance equals many small ones', () => {
    const a = setup();
    const b = setup();
    for (const s of [a, b]) {
      s.farm.plant(at(3, 3), ItemId.WheatSeed, []);
      s.farm.plant(at(5, 5), ItemId.CarrotSeed, []);
    }
    a.farm.advance(2.4 * STAGE_MS);
    for (let i = 0; i < 240; i++) b.farm.advance(0.01 * STAGE_MS);
    for (const s of [a, b]) for (let i = 0; i < 10; i++) s.farm.update(0.03);
    expect(a.world.get(3, 1, 3)).toBe(b.world.get(3, 1, 3));
    expect(a.world.get(5, 1, 5)).toBe(b.world.get(5, 1, 5));
    expect(stageAt(a.world, at(3, 3))).toBe(2);
    expect(a.farm.records().crops.map(c => Math.round(c.p))).toEqual(b.farm.records().crops.map(c => Math.round(c.p)));
  });
  it('applies at most one natural stage change per update call', () => {
    const world = box(20, 20, 8);
    const inv = new Inventory();
    inv.add(ItemId.WheatSeed, 99);
    const farm = new Farm(world, inv);
    for (let i = 0; i < 90; i++) farm.plant([1 + (i % 10), 1, 1 + Math.floor(i / 10)], ItemId.WheatSeed, []);
    world.clearEdits();
    farm.advance(STAGE_MS);
    let changes = 0;
    world.onChange(() => { changes++; });
    for (let i = 1; i <= 90; i++) {
      farm.update(0.03);
      expect(changes).toBeLessThanOrEqual(i);
    }
    expect(changes).toBe(90);
    farm.update(0.03);
    expect(changes).toBe(90);
  });
  it('an 8-hour absence ripens everything planted', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(5, 5), ItemId.AppleSapling, []);
    farm.advance(OFFLINE_CAP_MS);
    for (let i = 0; i < 10; i++) farm.update(0.03);
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat3);
    expect(farm.records().trees[0].stage).toBe(3);
  });
  it('nothing wilts: a year of capped steps leaves every plant, all ripe', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(5, 3), ItemId.CarrotSeed, []);
    const steps = Math.ceil((365 * 24 * 3600_000) / OFFLINE_CAP_MS);
    for (let i = 0; i < steps; i++) { farm.advance(OFFLINE_CAP_MS); farm.update(0.03); farm.update(0.03); }
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat3);
    expect(world.get(5, 1, 3)).toBe(BlockId.Carrot3);
  });
  it('bad time amounts never move a plant backwards', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.help(at(3, 3));
    for (const bad of [-1e9, NaN, -Infinity]) { farm.advance(bad); farm.update(0.03); }
    expect(stageAt(world, at(3, 3))).toBe(1);
    farm.advance(Infinity); // clamped to the offline cap, never beyond
    for (let i = 0; i < 5; i++) farm.update(0.03);
    expect(stageAt(world, at(3, 3))).toBe(3);
  });
  it('records() brings pending stage changes into the blocks so a save never loses growth', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(4, 3), ItemId.WheatSeed, []);
    farm.advance(2 * STAGE_MS + 5000);
    const rec = farm.records();
    expect(world.get(3, 1, 3)).toBe(BlockId.Wheat2);
    expect(world.get(4, 1, 3)).toBe(BlockId.Wheat2);
    expect(rec.crops.map(c => c.p)).toEqual([5000, 5000]);
  });
});

describe('Farm: invariants', () => {
  it('stages never decrease over random plant/help/advance/harvest sequences', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = mulberry32(seed);
      const { world, inv, farm } = setup([[ItemId.WheatSeed, 50], [ItemId.CarrotSeed, 50]]);
      const last = new Map<string, number>();
      for (let step = 0; step < 300; step++) {
        const cell = at(1 + Math.floor(rand() * 8), 1 + Math.floor(rand() * 8));
        const r = rand();
        if (r < 0.3) farm.plant(cell, rand() < 0.5 ? ItemId.WheatSeed : ItemId.CarrotSeed, []);
        else if (r < 0.5) farm.help(cell);
        else if (r < 0.55) { farm.harvest(cell); last.delete(cell.join()); }
        else if (r < 0.9) farm.advance(rand() * STAGE_MS);
        else farm.advance(rand() < 0.5 ? -5000 : NaN);
        farm.update(0.03);
        for (let x = 1; x <= 8; x++) {
          for (let z = 1; z <= 8; z++) {
            const k = `${x},1,${z}`;
            const s = stageAt(world, [x, 1, z]);
            if (s === null) { last.delete(k); continue; }
            expect(s).toBeGreaterThanOrEqual(last.get(k) ?? 0);
            last.set(k, s);
          }
        }
      }
      expect(inv.count(ItemId.WheatSeed)).toBeLessThanOrEqual(99);
    }
  });
});

describe('Farm: harvest', () => {
  function ripe(farm: Farm, cell: Cell, seed = ItemId.CarrotSeed): void {
    farm.plant(cell, seed, []);
    for (let i = 0; i < 3; i++) farm.help(cell);
  }
  it('harvest ripe gives 2 food and 2 seeds', () => {
    const { world, inv, farm, events } = setup();
    ripe(farm, at(3, 3));
    const before = inv.count(ItemId.CarrotSeed);
    const e = farm.harvest(at(3, 3));
    expect(e).toMatchObject({ type: 'harvested', ripe: true });
    expect(inv.count(ItemId.Carrot)).toBe(2);
    expect(inv.count(ItemId.CarrotSeed)).toBe(before + 2);
    expect(world.get(3, 1, 3)).toBe(BlockId.Air);
    expect(world.get(3, 0, 3)).toBe(BlockId.Farmland);
    expect(events.at(-1)).toEqual(e);
  });
  it('harvest unripe gives one seed', () => {
    const { world, inv, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.help(at(3, 3));
    farm.harvest(at(3, 3));
    expect(inv.count(ItemId.WheatSeed)).toBe(5);
    expect(inv.count(ItemId.Wheat)).toBe(0);
    expect(world.get(3, 1, 3)).toBe(BlockId.Air);
  });
  it('harvest of a non-plant is refused harmlessly', () => {
    const { farm } = setup();
    expect(farm.harvest(at(3, 3))).toEqual({ type: 'rest' });
  });
  it('harvest is refused whole when a yield would pass 99 (plant and bag unchanged)', () => {
    const { world, inv, farm, events } = setup();
    ripe(farm, at(3, 3));
    inv.add(ItemId.Carrot, 98); // 2 more would be 100
    const seeds = inv.count(ItemId.CarrotSeed);
    const e = farm.harvest(at(3, 3));
    expect(e).toEqual({ type: 'full' });
    expect(world.get(3, 1, 3)).toBe(BlockId.Carrot3);
    expect(inv.count(ItemId.Carrot)).toBe(98);
    expect(inv.count(ItemId.CarrotSeed)).toBe(seeds);
    expect(events.at(-1)).toEqual({ type: 'full' });
    // the seed side too
    inv.remove(ItemId.Carrot, 98);
    inv.add(ItemId.CarrotSeed, 99 - inv.count(ItemId.CarrotSeed));
    expect(farm.harvest(at(3, 3))).toEqual({ type: 'full' });
    expect(inv.count(ItemId.Carrot)).toBe(0);
  });
  it('seeds can never run out over 500 random plant/harvest/pull actions', () => {
    for (const seed of [3, 4, 5]) {
      const rand = mulberry32(seed);
      const { inv, farm } = setup([[ItemId.WheatSeed, 1]]);
      const seedItems = [ItemId.WheatSeed];
      for (let i = 0; i < 500; i++) {
        const cell = at(1 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 4));
        const r = rand();
        if (r < 0.4) farm.plant(cell, ItemId.WheatSeed, []);
        else if (r < 0.6) farm.help(cell);
        else if (r < 0.9) farm.harvest(cell);
        else { farm.advance(rand() * 2 * STAGE_MS); farm.update(0.03); }
        const { seeds, growing } = farm.seedsAndGrowing();
        expect(seeds + growing).toBeGreaterThanOrEqual(1);
        expect(seeds).toBe(seedItems.reduce((n, id) => n + inv.count(id), 0));
      }
    }
  });
});

describe('Farm: trees', () => {
  const base: Cell = [6, 1, 6];
  const countOf = (world: World, id: BlockId): number => {
    let n = 0;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) if (world.get(x, y, z) === id) n++;
    return n;
  };
  function tree(stage: number) {
    const s = setup();
    s.farm.plant(base, ItemId.AppleSapling, []);
    for (let i = 0; i < stage; i++) s.farm.help(base);
    return s;
  }
  it('a planted sapling is a sapling block with a tree record', () => {
    const { world, farm } = tree(0);
    expect(world.get(6, 1, 6)).toBe(BlockId.Sapling);
    expect(farm.records().trees).toEqual([{ x: 6, y: 1, z: 6, stage: 0, p: 0 }]);
  });
  it('young tree: trunk of 2 and a few leaves', () => {
    const { world } = tree(1);
    expect(world.get(6, 1, 6)).toBe(BlockId.Wood);
    expect(world.get(6, 2, 6)).toBe(BlockId.Wood);
    expect(world.get(6, 3, 6)).toBe(BlockId.Leaves);
    expect(countOf(world, BlockId.Wood)).toBe(2);
  });
  it('sapling to young tree stamps only air cells', () => {
    const s = setup();
    s.world.set(7, 2, 6, BlockId.Planks); // he built here
    s.world.set(6, 3, 6, BlockId.Glass);
    s.farm.plant(base, ItemId.AppleSapling, []);
    s.farm.help(base);
    expect(s.world.get(7, 2, 6)).toBe(BlockId.Planks);
    expect(s.world.get(6, 3, 6)).toBe(BlockId.Glass);
    expect(s.world.get(6, 2, 6)).toBe(BlockId.Wood);
  });
  it('full tree has trunk 4 and a 3x3 canopy', () => {
    const { world } = tree(2);
    for (let y = 1; y <= 4; y++) expect(world.get(6, y, 6)).toBe(BlockId.Wood);
    expect(countOf(world, BlockId.Wood)).toBe(4);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const y of [5, 6]) expect(world.get(6 + dx, y, 6 + dz)).toBe(BlockId.Leaves);
    expect(countOf(world, BlockId.Leaves)).toBe(18);
  });
  it('ripe tree has four AppleLeaves', () => {
    const { world, events } = tree(3);
    expect(countOf(world, BlockId.AppleLeaves)).toBe(4);
    expect(countOf(world, BlockId.Leaves)).toBe(14);
    expect(events.some(e => e.type === 'ripe')).toBe(true);
  });
  it('helping any trunk or leaf block of the tree grows it', () => {
    const s = tree(2);
    expect(s.farm.isPlantCell([6, 3, 6])).toBe(true);
    expect(s.farm.help([7, 5, 6])).toMatchObject({ type: 'helped', ripe: true });
    expect(s.farm.help([6, 2, 6])).toEqual({ type: 'rest' });
    expect(s.farm.isPlantCell([12, 2, 12])).toBe(false);
  });
  it('picking apples gives 2 apples + 1 sapling and leaves the tree whole', () => {
    const { world, inv, farm } = tree(3);
    const cell: Cell = [...[...Array(16).keys()].flatMap(x => [...Array(16).keys()].flatMap(y => [...Array(16).keys()].map(z => [x, y, z] as Cell)))].find(c => world.get(...c) === BlockId.AppleLeaves)!;
    const saplings = inv.count(ItemId.AppleSapling);
    expect(farm.harvest(cell)).toMatchObject({ type: 'harvested', ripe: true });
    expect(inv.count(ItemId.Apple)).toBe(2);
    expect(inv.count(ItemId.AppleSapling)).toBe(saplings + 1);
    expect(countOf(world, BlockId.AppleLeaves)).toBe(0);
    expect(countOf(world, BlockId.Leaves)).toBe(18);
    expect(countOf(world, BlockId.Wood)).toBe(4);
    expect(farm.records().trees[0].stage).toBe(2);
  });
  it('apples regrow after 180 s', () => {
    const { world, farm } = tree(3);
    const apple = [[5, 5, 6], [7, 5, 6], [6, 5, 5], [6, 5, 7]].map(c => c as Cell).find(c => world.get(...c) === BlockId.AppleLeaves)!;
    farm.harvest(apple);
    farm.advance(APPLE_REGROW_MS - 1000);
    farm.update(0.03);
    expect(countOf(world, BlockId.AppleLeaves)).toBe(0);
    farm.advance(1000);
    farm.update(0.03);
    expect(countOf(world, BlockId.AppleLeaves)).toBe(4);
  });
  it('trees grow by time with the tree stage lengths', () => {
    const { world, farm } = tree(0);
    farm.advance(TREE_STAGE_MS[0]);
    farm.update(0.03);
    expect(world.get(6, 2, 6)).toBe(BlockId.Wood);
    expect(countOf(world, BlockId.Wood)).toBe(2);
  });
  it('digging the trunk base drops the record, nothing throws', () => {
    const { world, farm } = tree(2);
    world.set(6, 1, 6, BlockId.Air);
    expect(() => { farm.advance(OFFLINE_CAP_MS); farm.update(0.03); farm.records(); }).not.toThrow();
    expect(farm.records().trees).toEqual([]);
  });
  it('pulling a sapling gives the sapling back', () => {
    const { world, inv, farm } = tree(0);
    farm.harvest(base);
    expect(inv.count(ItemId.AppleSapling)).toBe(2);
    expect(world.get(6, 1, 6)).toBe(BlockId.Air);
    expect(farm.records().trees).toEqual([]);
  });
});

describe('Farm: records', () => {
  it('records round-trip through restore', () => {
    const a = setup();
    a.farm.plant(at(3, 3), ItemId.WheatSeed, []);
    a.farm.plant(at(5, 5), ItemId.AppleSapling, []);
    a.farm.help(at(5, 5));
    a.farm.advance(40_000);
    const rec = a.farm.records();
    const b = new Farm(a.world, a.inv);
    b.restore(rec.crops, rec.trees);
    expect(b.records()).toEqual(rec);
  });
  it('restore drops records for missing blocks and adds p = 0 for plants with no record', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(4, 4), ItemId.CarrotSeed, []);
    world.set(3, 1, 3, BlockId.Air);
    const fresh = new Farm(world, new Inventory());
    fresh.restore([{ x: 3, y: 1, z: 3, p: 99 }, { x: 9, y: 1, z: 9, p: 5 }], []);
    expect(fresh.records().crops).toEqual([{ x: 4, y: 1, z: 4, p: 0 }]);
  });
  it('restore ignores garbage entries and clamps progress', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    const fresh = new Farm(world, new Inventory());
    fresh.restore([{ x: 3, y: 1, z: 3, p: 1e12 }, null as never, { x: NaN, y: 1, z: 1, p: 0 }], [null as never]);
    expect(fresh.records().crops[0].p).toBeLessThan(STAGE_MS);
  });
  it('revision bumps on plant, help and harvest but not on natural growth', () => {
    const { farm } = setup();
    const r0 = farm.revision;
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    const r1 = farm.revision;
    expect(r1).toBeGreaterThan(r0);
    farm.help(at(3, 3));
    const r2 = farm.revision;
    expect(r2).toBeGreaterThan(r1);
    farm.advance(STAGE_MS);
    farm.update(0.03);
    expect(farm.revision).toBe(r2);
    farm.harvest(at(3, 3));
    expect(farm.revision).toBeGreaterThan(r2);
  });
  it('nearestRipe finds the closest ripe plant within the radius', () => {
    const { farm } = setup();
    farm.plant(at(3, 3), ItemId.WheatSeed, []);
    farm.plant(at(10, 10), ItemId.WheatSeed, []);
    expect(farm.nearestRipe(at(2, 2), 20)).toBeNull();
    for (let i = 0; i < 3; i++) { farm.help(at(3, 3)); farm.help(at(10, 10)); }
    expect(farm.nearestRipe(at(2, 2), 20)).toEqual(at(3, 3));
    expect(farm.nearestRipe(at(2, 2), 3)).toEqual(at(3, 3));
    expect(farm.nearestRipe(at(14, 14), 3)).toBeNull();
  });
  it('cropBlock and seedFor stay in step with planting', () => {
    const { world, farm } = setup();
    farm.plant(at(3, 3), seedFor('carrot'), []);
    expect(world.get(3, 1, 3)).toBe(cropBlock('carrot', 0));
  });
});
