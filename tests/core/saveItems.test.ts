// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ItemId } from '../../src/core/items';
import {
  LEGACY_SAVE_KEY, SAVE_KEY, applySave, parseSave, readSave, serialise, startAutosave, storeSave, type SaveData,
} from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

const base = (): SaveData => ({
  version: 2, gen: 1, seed: 1234, edits: [], inventory: { [BlockId.Wood]: 4 }, player: { x: 24, y: 9, z: 24 },
  flags: { ledToVillage: false },
});

beforeEach(() => localStorage.clear());

describe('items in the save', () => {
  test('a block-only bag writes exactly what step 1 wrote (no items fields)', () => {
    const game = new Game(generateWorld(1234));
    game.inventory.add(BlockId.Wood, 2);
    const data = serialise(game, 1234);
    expect('items' in data).toBe(false);
    expect('itemOrder' in data).toBe(false);
    expect(data.version).toBe(2);
    expect(data.inventory).toEqual({ [BlockId.Wood]: 2 });
  });

  test('items and their order round-trip, beside the untouched inventory field', () => {
    const game = new Game(generateWorld(1234));
    game.inventory.add(BlockId.Wood, 2);
    game.inventory.add(ItemId.Egg, 3);
    game.inventory.add(ItemId.WheatSeed, 5);
    game.inventory.add(ItemId.Egg, 0);
    expect(storeSave(localStorage, serialise(game, 1234))).toBe(true);
    const stored = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(stored.inventory).toEqual({ [BlockId.Wood]: 2 });
    expect(stored.items).toEqual({ [ItemId.Egg]: 3, [ItemId.WheatSeed]: 5 });
    expect(stored.itemOrder).toEqual([ItemId.Egg, ItemId.WheatSeed]);
    const back = applySave(readSave(localStorage)!);
    expect(back.inventory.slots()).toEqual([BlockId.Wood, ItemId.Egg, ItemId.WheatSeed]);
    expect(back.inventory.count(ItemId.WheatSeed)).toBe(5);
  });

  test('the v1 key is never written', () => {
    const game = new Game(generateWorld(1234));
    game.inventory.add(ItemId.Milk, 1);
    localStorage.setItem(LEGACY_SAVE_KEY, 'v1-untouched');
    storeSave(localStorage, serialise(game, 1234));
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe('v1-untouched');
  });

  test('bad item entries are skipped and never cost the world, the blocks or the other items', () => {
    const edits = [[5, 5, 5, BlockId.Stone]];
    const raw = JSON.stringify({
      ...base(), edits,
      items: { 100: 2, 999: 3, 104: 500, 105: -1, 106: 1.5, 108: 'x', 109: 4, foo: 1 },
      itemOrder: [109, 109, 999, 100, 'x'],
    });
    const data = parseSave(raw)!;
    expect(data).not.toBeNull();
    expect(data.edits).toEqual(edits);
    expect(data.inventory).toEqual({ [BlockId.Wood]: 4 });
    const inv = applySave(data).inventory;
    expect(inv.count(BlockId.Wood)).toBe(4);
    expect(inv.itemsToJSON()).toEqual({ 100: 2, 109: 4 });
    expect(inv.slots()).toEqual([BlockId.Wood, ItemId.Milk, ItemId.WheatSeed]);
  });

  test.each([null, 5, 'x', [], [1, 2], true])('garbage items %j does not discard anything', garbage => {
    const data = parseSave(JSON.stringify({ ...base(), items: garbage, itemOrder: garbage }))!;
    expect(data).not.toBeNull();
    expect(data.inventory).toEqual({ [BlockId.Wood]: 4 });
    expect(applySave(data).inventory.itemsToJSON()).toEqual({});
  });

  test('an item id in the block inventory field never loads a wrong block, but a damaged bag does not cost items', () => {
    const data = parseSave(JSON.stringify({ ...base(), inventory: { 104: 2 }, items: { 104: 2 } }))!;
    expect(data).not.toBeNull();
    expect(applySave(data).inventory.itemsToJSON()).toEqual({ 104: 2 });
  });

  test('old step 1 v2 saves (no items fields) load', () => {
    const data = parseSave(JSON.stringify(base()))!;
    const { inventory } = applySave(data);
    expect(inventory.count(BlockId.Wood)).toBe(4);
    expect(inventory.slots()).toEqual([BlockId.Wood]);
  });

  test('new block ids are valid in edits', () => {
    const edits = [[5, 5, 5, BlockId.Farmland], [6, 5, 5, BlockId.Wheat3], [7, 5, 5, BlockId.Potato0], [8, 5, 5, BlockId.WoolRed]];
    const data = parseSave(JSON.stringify({ ...base(), edits }))!;
    expect(data.edits).toEqual(edits);
  });

  test('autosave notices a change that only touched items', () => {
    const game = new Game(generateWorld(1234));
    const stop = startAutosave(game, 1234, localStorage);
    game.inventory.add(ItemId.Egg, 2);
    window.dispatchEvent(new Event('pagehide'));
    stop();
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).items).toEqual({ [ItemId.Egg]: 2 });
  });
});
