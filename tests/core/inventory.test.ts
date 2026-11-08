import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';

describe('Inventory with items', () => {
  test('holds items up to 99 and refuses past it', () => {
    const inv = new Inventory();
    expect(inv.add(ItemId.Egg, 98)).toBe(98);
    expect(inv.add(ItemId.Egg, 5)).toBe(1);
    expect(inv.count(ItemId.Egg)).toBe(99);
    expect(inv.add(ItemId.Egg)).toBe(0);
    expect(inv.remove(ItemId.Egg, 99)).toBe(true);
    expect(inv.remove(ItemId.Egg)).toBe(false);
  });

  test('slots keeps first-obtained order within blocks, then items', () => {
    const inv = new Inventory();
    inv.add(ItemId.Wool);
    inv.add(BlockId.Stone);
    inv.add(ItemId.Apple);
    inv.add(BlockId.Wood);
    expect(inv.slots()).toEqual([BlockId.Stone, BlockId.Wood, ItemId.Wool, ItemId.Apple]);
    expect(inv.hotbar()).toEqual([BlockId.Stone, BlockId.Wood]);
    inv.remove(BlockId.Stone);
    expect(inv.slots()).toEqual([BlockId.Wood, ItemId.Wool, ItemId.Apple]);
  });

  test('toJSON is blocks only and byte-identical to step 1 for a block-only bag', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 3);
    inv.add(BlockId.Stone, 7);
    expect(JSON.stringify(inv.toJSON())).toBe('{"3":7,"4":3}');
    inv.add(ItemId.Egg, 2);
    expect(JSON.stringify(inv.toJSON())).toBe('{"3":7,"4":3}');
    expect(inv.order()).toEqual([BlockId.Wood, BlockId.Stone]);
  });

  test('itemsToJSON and itemOrder round-trip', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 2);
    inv.add(ItemId.Milk, 4);
    inv.add(ItemId.Apple, 1);
    inv.add(ItemId.Egg, 1);
    inv.remove(ItemId.Apple);
    expect(inv.itemsToJSON()).toEqual({ [ItemId.Milk]: 4, [ItemId.Egg]: 1 });
    expect(inv.itemOrder()).toEqual([ItemId.Milk, ItemId.Apple, ItemId.Egg]);
    const back = Inventory.fromJSON(inv.toJSON(), inv.order(), inv.itemsToJSON(), inv.itemOrder());
    expect(back.toJSON()).toEqual(inv.toJSON());
    expect(back.itemsToJSON()).toEqual(inv.itemsToJSON());
    expect(back.slots()).toEqual(inv.slots());
    expect(back.itemOrder()).toEqual(inv.itemOrder());
  });

  test('bad item entries are skipped without touching the blocks', () => {
    const items = { 100: -1, 999: 3, 104: 500, 105: 2, 106: 1.5, 107: 'x', abc: 1, 108: 4 };
    const inv = Inventory.fromJSON({ [BlockId.Wood]: 5 }, [BlockId.Wood], items as never, [105, 105, 999, 108]);
    expect(inv.count(BlockId.Wood)).toBe(5);
    expect(inv.itemsToJSON()).toEqual({ 105: 2, 108: 4 });
    expect(inv.slots()).toEqual([BlockId.Wood, ItemId.Carrot, ItemId.Egg]);
  });

  test('garbage items and itemOrder never throw and never touch blocks', () => {
    for (const bad of [null, 5, 'x', [], [1, 2], { __proto__: { a: 1 } }]) {
      const inv = Inventory.fromJSON({ [BlockId.Wood]: 5 }, undefined, bad as never, bad as never);
      expect(inv.count(BlockId.Wood)).toBe(5);
      expect(inv.itemsToJSON()).toEqual({});
    }
  });

  test('Air, Bedrock and unknown ids are still rejected', () => {
    const inv = new Inventory();
    expect(inv.add(BlockId.Air)).toBe(0);
    expect(inv.add(BlockId.Bedrock)).toBe(0);
    expect(inv.add(999 as never)).toBe(0);
    expect(inv.add(111 as never)).toBe(0);
    expect(inv.slots()).toEqual([]);
  });
});
