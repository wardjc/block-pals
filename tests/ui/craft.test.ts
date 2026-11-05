import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { craftRows } from '../../src/ui/craft';

const row = (inv: Inventory, id: string) => craftRows(inv).find(r => r.recipe.id === id)!;

describe('craftRows', () => {
  test('lists every recipe', () => {
    expect(craftRows(new Inventory()).map(r => r.recipe.id)).toEqual(['planks', 'glass', 'bricks']);
  });
  test('can make planks with 1 wood', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 1);
    expect(row(inv, 'planks')).toMatchObject({ can: true, missing: [] });
  });
  test('dims recipes he cannot make', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 1);
    expect(row(inv, 'glass').can).toBe(false);
    expect(row(inv, 'bricks').can).toBe(false);
  });
  test('lists the missing input', () => {
    const inv = new Inventory();
    inv.add(BlockId.Sand, 2);
    inv.add(BlockId.Dirt, 2);
    expect(row(inv, 'glass').missing).toEqual([BlockId.Sand]);
    expect(row(inv, 'bricks').missing).toEqual([BlockId.Stone]);
    expect(row(new Inventory(), 'bricks').missing).toEqual([BlockId.Dirt, BlockId.Stone]);
  });
});
