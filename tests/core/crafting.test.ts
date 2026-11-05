import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory, MAX_STACK } from '../../src/core/inventory';
import { RECIPES } from '../../src/core/recipes';
import { canCraft, craft } from '../../src/core/crafting';

describe('Inventory', () => {
  test('add caps at 20 and returns amount added', () => {
    const inv = new Inventory();
    expect(MAX_STACK).toBe(20);
    expect(inv.count(BlockId.Wood)).toBe(0);
    expect(inv.add(BlockId.Wood)).toBe(1);
    expect(inv.add(BlockId.Wood, 25)).toBe(19);
    expect(inv.count(BlockId.Wood)).toBe(20);
    expect(inv.add(BlockId.Wood)).toBe(0);
  });

  test('remove fails without enough and changes nothing', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 2);
    expect(inv.remove(BlockId.Wood, 3)).toBe(false);
    expect(inv.count(BlockId.Wood)).toBe(2);
    expect(inv.remove(BlockId.Stone)).toBe(false);
    expect(inv.remove(BlockId.Wood)).toBe(true);
    expect(inv.count(BlockId.Wood)).toBe(1);
    expect(inv.remove(BlockId.Wood)).toBe(true);
    expect(inv.count(BlockId.Wood)).toBe(0);
  });

  test.each([-1, 0.5, NaN, Infinity])('rejects invalid quantities: %s', (n) => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 2);
    expect(inv.add(BlockId.Wood, n)).toBe(0);
    expect(inv.remove(BlockId.Wood, n)).toBe(false);
    expect(inv.count(BlockId.Wood)).toBe(2);
  });

  test('hotbar shows every positive stack in first-collected order', () => {
    const inv = new Inventory();
    const ids = [BlockId.Wood, BlockId.Sand, BlockId.Stone, BlockId.Dirt,
      BlockId.Glass, BlockId.Bricks, BlockId.Leaves, BlockId.Grass, BlockId.Planks];
    inv.add(BlockId.Planks, 0);
    for (const id of ids) inv.add(id);
    expect(inv.hotbar()).toEqual(ids);
    inv.remove(BlockId.Wood);
    expect(inv.hotbar()).toEqual(ids.slice(1));
    inv.add(BlockId.Wood);
    expect(inv.hotbar()).toEqual(ids);
    inv.hotbar().reverse();
    expect(inv.hotbar()).toEqual(ids);
  });

  test('order round-trips through fromJSON, keeping emptied stacks in place', () => {
    const inv = new Inventory();
    for (const id of [BlockId.Stone, BlockId.Wood, BlockId.Planks, BlockId.Dirt]) inv.add(id, 2);
    inv.remove(BlockId.Wood, 2);
    expect(inv.order()).toEqual([BlockId.Stone, BlockId.Wood, BlockId.Planks, BlockId.Dirt]);
    const restored = Inventory.fromJSON(JSON.parse(JSON.stringify(inv)), inv.order());
    expect(restored.hotbar()).toEqual([BlockId.Stone, BlockId.Planks, BlockId.Dirt]);
    restored.add(BlockId.Wood);
    expect(restored.hotbar()).toEqual([BlockId.Stone, BlockId.Wood, BlockId.Planks, BlockId.Dirt]);
  });

  test('fromJSON without an order falls back to id order; a bad order is ignored', () => {
    const counts = { [BlockId.Planks]: 1, [BlockId.Dirt]: 3 };
    expect(Inventory.fromJSON(counts).hotbar()).toEqual([BlockId.Dirt, BlockId.Planks]);
    for (const order of ['x', [999], [BlockId.Planks, BlockId.Planks], [1.5], {}, [BlockId.Bedrock]]) {
      expect(Inventory.fromJSON(counts, order).hotbar()).toEqual([BlockId.Dirt, BlockId.Planks]);
    }
    expect(Inventory.fromJSON(counts, [BlockId.Planks]).hotbar()).toEqual([BlockId.Planks, BlockId.Dirt]);
  });

  test('revision changes only when a count changes', () => {
    const inv = new Inventory();
    const r0 = inv.revision;
    inv.add(BlockId.Wood, 0);
    inv.remove(BlockId.Wood, 1);
    expect(inv.revision).toBe(r0);
    inv.add(BlockId.Wood, 2);
    const r1 = inv.revision;
    expect(r1).not.toBe(r0);
    inv.remove(BlockId.Wood, 1);
    expect(inv.revision).not.toBe(r1);
  });

  test('toJSON and fromJSON round-trip counts without sharing state', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 4);
    inv.add(BlockId.Glass, 20);
    const saved = inv.toJSON();
    expect(saved).toEqual({ [BlockId.Wood]: 4, [BlockId.Glass]: 20 });
    const restored = Inventory.fromJSON(JSON.parse(JSON.stringify(inv)));
    expect(restored.toJSON()).toEqual(saved);
    saved[BlockId.Wood] = 1;
    restored.remove(BlockId.Glass);
    expect(inv.count(BlockId.Wood)).toBe(4);
    expect(inv.count(BlockId.Glass)).toBe(20);
    expect(Inventory.fromJSON({ [BlockId.Wood]: 0 }).hotbar()).toEqual([]);
  });

  test('fromJSON ignores garbage', () => {
    for (const value of [null, undefined, 'garbage', 5, [], true,
      { unknown: 1 }, { 999: 1 }, { [BlockId.Wood]: '2' },
      { [BlockId.Wood]: -1 }, { [BlockId.Wood]: 21 },
      { [BlockId.Wood]: 1.5 }, { [BlockId.Wood]: NaN },
      { [BlockId.Wood]: Infinity }, { [BlockId.Wood]: 2, [BlockId.Stone]: -1 }]) {
      const inv = Inventory.fromJSON(value);
      expect(inv.toJSON()).toEqual({});
      expect(inv.hotbar()).toEqual([]);
    }
  });
});

describe('crafting', () => {
  test('defines the exact recipes and words', () => {
    expect(RECIPES).toEqual([
      { id: 'planks', inputs: [{ id: BlockId.Wood, n: 1 }], output: { id: BlockId.Planks, n: 2 }, word: 'wood' },
      { id: 'glass', inputs: [{ id: BlockId.Sand, n: 3 }], output: { id: BlockId.Glass, n: 1 }, word: 'glass' },
      { id: 'bricks', inputs: [{ id: BlockId.Dirt, n: 2 }, { id: BlockId.Stone, n: 2 }], output: { id: BlockId.Bricks, n: 1 }, word: 'brick' },
    ]);
  });

  test('craft planks turns 1 wood into 2 planks', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood);
    expect(canCraft(inv, RECIPES[0])).toBe(true);
    expect(inv.count(BlockId.Wood)).toBe(1);
    expect(craft(inv, RECIPES[0])).toBe(true);
    expect(inv.count(BlockId.Wood)).toBe(0);
    expect(inv.count(BlockId.Planks)).toBe(2);
    expect(craft(inv, RECIPES[0])).toBe(false);
    expect(inv.count(BlockId.Planks)).toBe(2);
  });

  test.each([1, 2])('crafts recipe %s with all inputs', (index) => {
    const inv = new Inventory();
    const recipe = RECIPES[index];
    for (const input of recipe.inputs) inv.add(input.id, input.n);
    expect(craft(inv, recipe)).toBe(true);
    for (const input of recipe.inputs) expect(inv.count(input.id)).toBe(0);
    expect(inv.count(recipe.output.id)).toBe(recipe.output.n);
  });

  test('craft is atomic when missing an input', () => {
    const inv = new Inventory();
    inv.add(BlockId.Dirt, 2);
    inv.add(BlockId.Stone);
    const before = inv.toJSON();
    expect(canCraft(inv, RECIPES[2])).toBe(false);
    expect(craft(inv, RECIPES[2])).toBe(false);
    expect(inv.toJSON()).toEqual(before);
  });

  test('cannot craft when output is full', () => {
    for (const recipe of RECIPES) {
      const inv = new Inventory();
      for (const input of recipe.inputs) inv.add(input.id, input.n);
      inv.add(recipe.output.id, 20);
      const before = inv.toJSON();
      expect(canCraft(inv, recipe)).toBe(false);
      expect(craft(inv, recipe)).toBe(false);
      expect(inv.toJSON()).toEqual(before);
    }
  });

  test('requires room for the whole output without losing inputs or output', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood);
    inv.add(BlockId.Planks, 19);
    const before = inv.toJSON();
    expect(canCraft(inv, RECIPES[0])).toBe(false);
    expect(craft(inv, RECIPES[0])).toBe(false);
    expect(inv.toJSON()).toEqual(before);
    inv.remove(BlockId.Planks);
    expect(craft(inv, RECIPES[0])).toBe(true);
    expect(inv.count(BlockId.Planks)).toBe(20);
  });
});
