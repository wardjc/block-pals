// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { craft } from '../../src/core/crafting';
import { RECIPES } from '../../src/core/recipes';
import { CraftScreen, craftRows } from '../../src/ui/craft';

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

describe('CraftScreen', () => {
  function make(inv: Inventory, t: { now: number }) {
    let crafted = 0, full = 0, need = 0;
    const screen = new CraftScreen(document.body, {
      inventory: inv,
      tryCraft: id => { const ok = craft(inv, RECIPES.find(x => x.id === id)!); if (ok) crafted++; return ok; },
      iconFor: () => '',
      say: () => {},
      sayNeedMore: () => { need++; },
      sayFull: () => { full++; },
      sfxTap: () => {},
      sfxCraft: () => {},
      onOpenChange: () => {},
      now: () => t.now,
    });
    return { screen, counts: () => ({ crafted, full, need }) };
  }
  test('two makes 10 ms apart craft once', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 5);
    const t = { now: 1000 };
    const { screen, counts } = make(inv, t);
    screen.open();
    screen.make(0);
    t.now += 10;
    screen.make(0);
    expect(counts().crafted).toBe(1);
    t.now += 200;
    screen.make(0);
    expect(counts().crafted).toBe(2);
  });
  test('crafting is all-or-nothing: 97 planks + a 2-plank recipe makes 99, 98 says full', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 2);
    inv.add(BlockId.Planks, 97);
    const t = { now: 0 };
    const { screen, counts } = make(inv, t);
    screen.open();
    screen.make(0);
    expect(counts()).toEqual({ crafted: 1, full: 0, need: 0 });
    expect(inv.count(BlockId.Planks)).toBe(99);
    inv.remove(BlockId.Planks, 1); // 98: no room for 2
    t.now += 1000;
    screen.make(0);
    expect(counts()).toEqual({ crafted: 1, full: 1, need: 0 });
    expect(inv.count(BlockId.Planks)).toBe(98);
    expect(inv.count(BlockId.Wood)).toBe(1);
  });
  test('full output stack says full, not need-more', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 1);
    inv.add(BlockId.Planks, 99);
    const { screen, counts } = make(inv, { now: 0 });
    screen.open();
    screen.make(0);
    expect(counts()).toEqual({ crafted: 0, full: 1, need: 0 });
  });
});
