import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { FEEDS, GIFT, ITEMS, ItemId, isItemId, isStackId } from '../../src/core/items';

const ids = Object.values(ItemId).filter((v): v is ItemId => typeof v === 'number');

describe('items', () => {
  test('item ids are stable', () => {
    expect(ids).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
    expect(ItemId.WheatSeed).toBe(100);
    expect(ItemId.CarrotSeed).toBe(101);
    expect(ItemId.PotatoSeed).toBe(102);
    expect(ItemId.AppleSapling).toBe(103);
    expect(ItemId.Apple).toBe(104);
    expect(ItemId.Carrot).toBe(105);
    expect(ItemId.Potato).toBe(106);
    expect(ItemId.Wheat).toBe(107);
    expect(ItemId.Egg).toBe(108);
    expect(ItemId.Milk).toBe(109);
    expect(ItemId.Wool).toBe(110);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(100);
  });

  test('no item id collides with a block id', () => {
    for (const id of ids) expect(Object.hasOwn(BLOCKS, id)).toBe(false);
    expect(Math.max(...Object.keys(BLOCKS).map(Number))).toBeLessThan(100);
  });

  test('every item has a picture and a simple name', () => {
    expect(Object.keys(ITEMS).map(Number).sort((a, b) => a - b)).toEqual(ids);
    for (const id of ids) {
      const def = ITEMS[id];
      expect(def.id).toBe(id);
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.name).toMatch(/^[a-z ]+$/);
    }
  });

  test('edible set is apple, carrot, potato, milk', () => {
    const edible = ids.filter(id => ITEMS[id].edible);
    expect(edible).toEqual([ItemId.Apple, ItemId.Carrot, ItemId.Potato, ItemId.Milk]);
  });

  test('FEEDS is exactly apple, carrot, potato, wheat and every animal kind gives a registered item', () => {
    expect([...FEEDS].sort()).toEqual([ItemId.Apple, ItemId.Carrot, ItemId.Potato, ItemId.Wheat].sort());
    expect(Object.keys(GIFT).sort()).toEqual(['chicken', 'cow', 'pig', 'sheep']);
    expect(GIFT).toEqual({ chicken: ItemId.Egg, cow: ItemId.Milk, sheep: ItemId.Wool, pig: ItemId.Potato });
    for (const gift of Object.values(GIFT)) expect(isItemId(gift)).toBe(true);
  });

  test('seeds have a badge', () => {
    for (const id of [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling]) {
      expect(ITEMS[id].kind).toBe('seed');
      expect(ITEMS[id].badge).toBeTruthy();
    }
  });

  test('isItemId and isStackId', () => {
    expect(isItemId(100)).toBe(true);
    expect(isItemId(110)).toBe(true);
    expect(isItemId(111)).toBe(false);
    expect(isItemId(5)).toBe(false);
    expect(isItemId(1.5)).toBe(false);
    expect(isStackId(BlockId.Wood)).toBe(true);
    expect(isStackId(ItemId.Egg)).toBe(true);
    expect(isStackId(BlockId.Air)).toBe(false);
    expect(isStackId(BlockId.Bedrock)).toBe(false);
    expect(isStackId(999)).toBe(false);
    expect(isStackId(-1)).toBe(false);
    expect(isStackId(NaN)).toBe(false);
  });
});
