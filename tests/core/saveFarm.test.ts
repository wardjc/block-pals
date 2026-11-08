// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { OFFLINE_CAP_MS, STAGE_MS, TREE_STAGE_MS } from '../../src/core/growth';
import { ItemId } from '../../src/core/items';
import {
  BACKUP_KEY, HINT_NAMES, LEGACY_SAVE_KEY, MAX_FARM_RECORDS, SAVE_KEY, applySave, inspectSave, parseSave, readSave, serialise, storeSave,
  type SaveData,
} from '../../src/core/save';
import { GEN_VERSION, generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

const base = (): SaveData => ({
  version: 2, gen: 1, seed: 1234, edits: [], inventory: { [BlockId.Wood]: 4 }, player: { x: 24, y: 9, z: 24 },
  flags: { ledToVillage: false },
});
const NOW = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

/** Neighbouring Grass cells (x, x+1, x+2 in a row) somewhere in the spawn meadow. */
function grassRow(world: Game['world']): Array<[number, number, number]> {
  for (let z = 30; z < 40; z++) {
    for (let x = 28; x < 38; x++) {
      const cells = [0, 1, 2, 3].map(d => [x + d, world.topSolidY(x + d, z) + 1, z] as [number, number, number]);
      if (cells.every(c => world.get(c[0], c[1] - 1, c[2]) === BlockId.Grass && c[1] === cells[0][1] && world.get(c[0], c[1], c[2]) === BlockId.Air && world.get(c[0], c[1] + 1, c[2]) === BlockId.Air)) return cells;
    }
  }
  throw new Error('no grass row');
}

function reload(game: Game, now = NOW): { game: Game; data: SaveData } {
  const raw = JSON.stringify(serialise(game, 1234, { ledToVillage: false }, now));
  const data = parseSave(raw)!;
  const applied = applySave(data, now);
  const next = new Game({ world: applied.world, spawn: applied.spawn, inventory: applied.inventory });
  next.farm.restore(applied.farm.crops, applied.farm.trees);
  return { game: next, data };
}

describe('farm fields in the save', () => {
  test('a step 1 v2 save without any new field loads', () => {
    const data = parseSave(JSON.stringify(base()))!;
    expect(data.items).toBeUndefined();
    expect(data.crops).toBeUndefined();
    expect(data.flags).toEqual({ ledToVillage: false });
    const applied = applySave(data, NOW);
    expect(applied.items).toEqual({});
    expect(applied.farm).toEqual({ crops: [], trees: [] });
    expect(applied.animals).toEqual([]);
    expect(applied.offlineMs).toBe(0);
    expect(applied.flags.fernSeeds).toBeUndefined();
    expect(applied.inventory.count(BlockId.Wood)).toBe(4);
  });

  test('new fields round-trip (items, crops, trees, animals, flags, savedAt)', () => {
    const game = new Game(generateWorld(1234));
    game.inventory.add(ItemId.WheatSeed, 5);
    game.inventory.add(ItemId.AppleSapling, 2);
    const row = grassRow(game.world);
    const at = (i: number): [number, number, number] => row[i];
    expect(game.farm.plant(at(0), ItemId.WheatSeed, [])).toBe(true);
    expect(game.farm.plant(at(2), ItemId.AppleSapling, [])).toBe(true);
    game.farm.advance(40_000);
    const flags = { ledToVillage: true, fernSeeds: true, hints: ['plantSome', 'cropReady'] };
    const animals: SaveData['animals'] = [[1, 66.5, 6, 49.5, 12, 0], [0, 70.5, 6, 52.5, 0, 1]];
    const data = serialise(game, 1234, flags, NOW, animals);
    expect(storeSave(localStorage, data)).toBe(true);
    const back = readSave(localStorage)!;
    expect(back.savedAt).toBe(NOW);
    expect(back.crops).toEqual([[...at(0), 40_000]]);
    expect(back.trees).toEqual([[...at(2), 0, 40_000]]);
    expect(back.animals).toEqual(animals);
    expect(back.flags).toEqual(flags);
    expect(back.items).toEqual({ [ItemId.WheatSeed]: 4, [ItemId.AppleSapling]: 1 });
    const applied = applySave(back, NOW + 5000);
    expect(applied.farm.crops).toEqual([{ x: at(0)[0], y: at(0)[1], z: at(0)[2], p: 40_000 }]);
    expect(applied.offlineMs).toBe(5000);
    expect(applied.flags).toEqual(flags);
  });

  test('gen is written as the generator version (2) and a stored higher gen is never lowered', () => {
    const game = new Game(generateWorld(1234));
    expect(GEN_VERSION).toBe(2);
    expect(serialise(game, 1234, undefined, NOW).gen).toBe(2);
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...base(), gen: 5 }));
    storeSave(localStorage, serialise(game, 1234, undefined, NOW));
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).gen).toBe(5);
  });

  test('a save from a newer build (version above 2) is never overwritten', () => {
    const newer = JSON.stringify({ ...base(), version: 3, extra: 'future' });
    localStorage.setItem(SAVE_KEY, newer);
    const game = new Game(generateWorld(1234));
    expect(storeSave(localStorage, serialise(game, 1234, undefined, NOW))).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
  });

  test('the v1 key is never written and the backup is made once', () => {
    const v1 = JSON.stringify({ version: 1, seed: 1234, edits: [], inventory: { 4: 2 }, player: { x: 24, y: 9, z: 24 } });
    localStorage.setItem(LEGACY_SAVE_KEY, v1);
    const migrated = readSave(localStorage)!;
    expect(migrated.inventory).toEqual({ 4: 2 });
    const game = new Game(generateWorld(1234));
    game.farm.records();
    storeSave(localStorage, serialise(game, 1234, undefined, NOW));
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(v1);
    expect(localStorage.getItem(BACKUP_KEY)).toBe(v1);
  });

  test('v1 saves never carry farm fields', () => {
    const v1 = { version: 1, seed: 1, edits: [], inventory: {}, player: { x: 24, y: 9, z: 24 }, crops: [[1, 1, 1, 0]], savedAt: NOW };
    const data = parseSave(JSON.stringify(v1))!;
    expect(data.crops).toBeUndefined();
    expect(data.savedAt).toBeUndefined();
  });

  test('bad item entries are skipped and the blocks survive', () => {
    const data = parseSave(JSON.stringify({ ...base(), items: { 100: 2, 999: 3, 104: 500, 105: -1 }, itemOrder: [100] }))!;
    expect(data.items).toEqual({ 100: 2 });
    expect(data.inventory).toEqual({ [BlockId.Wood]: 4 });
  });

  test('a bad crops list is dropped and the edits survive', () => {
    const edits = [[5, 5, 5, BlockId.Stone]];
    for (const crops of ['x', 7, { a: 1 }, null, [null, 'x', [1], [1, 2, 3], [NaN, 1, 1, 0], [1.5, 1, 1, 0], [-1, 1, 1, 0], [96, 1, 1, 0], [1, 20, 1, 0], [1, 1, 1, 'x'], [1, 1, 1, NaN]]]) {
      const data = parseSave(JSON.stringify({ ...base(), edits, crops, trees: crops, animals: crops }))!;
      expect(data.edits).toEqual(edits);
      expect(data.crops).toBeUndefined();
      expect(data.trees).toBeUndefined();
      expect(data.animals).toBeUndefined();
    }
  });

  test('one bad entry never costs the rest', () => {
    const data = parseSave(JSON.stringify({
      ...base(),
      crops: [[1, 5, 1, 10], 'bad', [2, 5, 2, 20], [1, 5, 1, 99], [3, 99, 3, 0]],
      trees: [[4, 5, 4, 1, 100], [5, 5, 5, 9, 0], [6, 5, 6, 2, 'x']],
      animals: [[0, 66, 6, 49, 3, 0], [9, 66, 6, 49, 3, 0], [0, 66.2, 6, 49.1, 3, 0], [1, 1e9, 6, 49, 3, 0], [2, 70, 6, 50, 0, 1]],
    }))!;
    expect(data.crops).toEqual([[1, 5, 1, 10], [2, 5, 2, 20]]); // duplicate cell and out-of-range dropped
    expect(data.trees).toEqual([[4, 5, 4, 1, 100]]);
    expect(data.animals).toEqual([[0, 66, 6, 49, 3, 0], [2, 70, 6, 50, 0, 1]]); // unknown kind, duplicate spot, off-world dropped
  });

  test('crop and tree progress is clamped', () => {
    const data = parseSave(JSON.stringify({
      ...base(), crops: [[1, 5, 1, 1e12], [2, 5, 2, -5]], trees: [[4, 5, 4, 0, 1e12], [5, 5, 5, 3, 777]],
    }))!;
    expect(data.crops).toEqual([[1, 5, 1, STAGE_MS - 1], [2, 5, 2, 0]]);
    expect(data.trees).toEqual([[4, 5, 4, 0, TREE_STAGE_MS[0] - 1], [5, 5, 5, 3, 0]]);
  });

  test('more than 2,000 crop records keeps the first 2,000 and the plants still exist as blocks', () => {
    const crops: Array<[number, number, number, number]> = [];
    const edits: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 2100; i++) {
      const x = i % 90;
      const z = Math.floor(i / 90);
      crops.push([x, 5, z, 0]);
      edits.push([x, 5, z, BlockId.Wheat0]);
    }
    const data = parseSave(JSON.stringify({ ...base(), crops, edits }))!;
    expect(data.crops).toHaveLength(MAX_FARM_RECORDS);
    expect(data.edits).toHaveLength(2100);
    const applied = applySave(data, NOW);
    const game = new Game({ world: applied.world, spawn: applied.spawn, inventory: applied.inventory });
    game.farm.restore(applied.farm.crops, applied.farm.trees);
    // Plants without a record get one from the world's edits, so nothing is lost.
    expect(game.farm.seedsAndGrowing().growing).toBe(2100);
    expect(applied.world.get(29, 5, 23)).toBe(BlockId.Wheat0);
  });

  test('unknown hints are dropped and non-boolean flags ignored', () => {
    const data = parseSave(JSON.stringify({
      ...base(), flags: { ledToVillage: true, fernSeeds: 'yes', hints: ['plantSome', 'nope', 3, 'plantSome', 'tryMunch'] },
    }))!;
    expect(data.flags).toEqual({ ledToVillage: true, hints: ['plantSome', 'tryMunch'] });
    expect(parseSave(JSON.stringify({ ...base(), flags: { ledToVillage: false, hints: 'x' } }))!.flags).toEqual({ ledToVillage: false });
    for (const h of HINT_NAMES) expect(typeof h).toBe('string');
  });

  test('savedAt: the future gives 0, a week ago gives exactly the 8-hour cap, missing gives 0', () => {
    const at = (savedAt?: unknown): number => applySave(parseSave(JSON.stringify({ ...base(), savedAt }))!, NOW).offlineMs;
    expect(at(NOW + 60_000)).toBe(0);
    expect(at(NOW - 7 * 24 * 3600_000)).toBe(OFFLINE_CAP_MS);
    expect(at(NOW - 20 * 60_000)).toBe(20 * 60_000);
    expect(at(undefined)).toBe(0);
    expect(at('later')).toBe(0);
    expect(at(NaN)).toBe(0);
    expect(at(-5)).toBe(0);
  });

  test('a damaged v2 is copied to .bad before replacement, with the new fields present', () => {
    const damaged = JSON.stringify({ ...base(), edits: [[1, 2, 3], [5, 5, 5, BlockId.Stone]], crops: [[1, 5, 1, 0]] });
    localStorage.setItem(SAVE_KEY, damaged);
    const read = readSave(localStorage)!;
    expect(read.edits).toEqual([[5, 5, 5, BlockId.Stone]]);
    expect(localStorage.getItem('blockpals.save.v2.bad')).toBe(damaged);
    const game = new Game(generateWorld(1234));
    expect(storeSave(localStorage, serialise(game, 1234, undefined, NOW))).toBe(true);
    expect(localStorage.getItem('blockpals.save.v2.bad')).toBe(damaged);
  });

  test('edits containing crop blocks are valid', () => {
    const edits = [[5, 5, 5, BlockId.Wheat3], [6, 5, 5, BlockId.Potato0], [7, 5, 5, BlockId.Sapling], [8, 5, 5, BlockId.AppleLeaves]];
    const raw = JSON.stringify({ ...base(), edits });
    expect(parseSave(raw)!.edits).toEqual(edits);
    expect(inspectSave(raw)!.skipped).toBe(0);
  });

  test('step 1 shape check: the saved inventory has no key of 100 or more', () => {
    const game = new Game(generateWorld(1234));
    game.inventory.add(BlockId.Wood, 3);
    game.inventory.add(ItemId.Carrot, 4);
    game.inventory.add(ItemId.Wool, 1);
    const data = serialise(game, 1234, undefined, NOW);
    expect(Object.keys(data.inventory).map(Number).every(k => k < 100)).toBe(true);
    expect(data.order!.every(k => k < 100)).toBe(true);
    expect(Object.keys(data.items!).map(Number).every(k => k >= 100)).toBe(true);
  });

  test('a block-only bag with no plants writes no farm fields', () => {
    const data = serialise(new Game(generateWorld(1234)), 1234, undefined, NOW);
    for (const k of ['items', 'itemOrder', 'crops', 'trees', 'animals']) expect(k in data).toBe(false);
    expect(data.flags).toEqual({ ledToVillage: false });
    expect(data.savedAt).toBe(NOW);
  });

  test('a plant block in a saved bag is ignored like any invalid id, never loaded', () => {
    const data = parseSave(JSON.stringify({ ...base(), inventory: { [BlockId.Wheat3]: 3 } }))!;
    expect(data.inventory).toEqual({});
    expect(BLOCKS[BlockId.Wheat3].plant).toBeDefined();
  });

  test('reload keeps every stage, the bag and growth that was waiting to show', () => {
    const game = new Game(generateWorld(1234));
    game.inventory.add(ItemId.CarrotSeed, 3);
    const [a, b] = grassRow(game.world);
    expect(game.farm.plant(a, ItemId.CarrotSeed, [])).toBe(true);
    expect(game.farm.plant(b, ItemId.CarrotSeed, [])).toBe(true);
    game.farm.help(b);
    game.farm.advance(2 * STAGE_MS + 5000); // due, but never shown by update()
    const { game: next } = reload(game);
    expect(next.world.get(...a)).toBe(BlockId.Carrot2);
    expect(next.world.get(...b)).toBe(BlockId.Carrot3);
    expect(next.inventory.count(ItemId.CarrotSeed)).toBe(1);
    expect(next.farm.records()).toEqual(game.farm.records());
  });
});
