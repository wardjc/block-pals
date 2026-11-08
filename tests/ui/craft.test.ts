// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { craft } from '../../src/core/crafting';
import { ItemId } from '../../src/core/items';
import { RECIPES } from '../../src/core/recipes';
import { Game } from '../../src/game/game';
import { generateWorld } from '../../src/core/worldgen';
import { CraftScreen, craftRows } from '../../src/ui/craft';

const row = (inv: Inventory, id: string) => craftRows(inv).find(r => r.recipe.id === id)!;

describe('craftRows', () => {
  test('lists every recipe', () => {
    expect(craftRows(new Inventory()).map(r => r.recipe.id)).toEqual(['planks', 'glass', 'bricks', 'wool-white', 'wool-red', 'wool-blue', 'wool-yellow']);
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

describe('wool in the craft screen', () => {
  function open(inv: Inventory) {
    document.body.replaceChildren();
    const picked: string[] = [];
    const screen = new CraftScreen(document.body, {
      inventory: inv,
      tryCraft: id => craft(inv, RECIPES.find(x => x.id === id)!),
      iconFor: id => `tile-${id}`,
      say: w => picked.push(w),
      sayNeedMore: () => {},
      sfxTap: () => {},
      sfxCraft: () => {},
      onOpenChange: () => {},
      now: () => 0,
    });
    screen.open();
    return { screen, picked };
  }

  test('shows the wool picture and the colour block picture, with digit and dots', () => {
    const inv = new Inventory();
    inv.add(ItemId.Wool, 1);
    open(inv);
    const row = document.querySelectorAll('.craft-row')[4]; // wool-red
    const wool = row.querySelector(`[data-block="${ItemId.Wool}"]`)!;
    expect(wool.querySelector('.pic-item')!.textContent).toContain('🧶');
    expect(wool.querySelector('.craft-digit')!.textContent).toBe('1');
    expect(wool.querySelectorAll('.craft-dots i').length).toBe(1);
    const out = row.querySelector(`[data-block="${BlockId.WoolRed}"]`)!;
    expect(out.querySelector('img')!.getAttribute('src')).toBe(`tile-${BlockId.WoolRed}`);
    expect(out.querySelector('.craft-digit')!.textContent).toBe('2');
    expect(out.querySelectorAll('.craft-dots i').length).toBe(2);
  });

  test('every recipe picture has a digit and at most 20 dots; no recipe needs reading', () => {
    open(new Inventory());
    for (const item of document.querySelectorAll('.craft-item')) {
      expect(Number(item.querySelector('.craft-digit')!.textContent)).toBeLessThanOrEqual(20);
      expect(item.querySelectorAll('.craft-dots i').length).toBeLessThanOrEqual(20);
      expect(item.querySelector('img, .pic-item')).not.toBeNull();
    }
    expect(document.querySelector('.craft-list')!.classList.contains('dense')).toBe(true);
  });

  test('a missing wool pulses the wool picture', () => {
    const { screen } = open(new Inventory());
    screen.make(3);
    expect(document.querySelectorAll('.craft-row')[3].querySelector(`[data-block="${ItemId.Wool}"]`)!.classList.contains('pulse')).toBe(true);
  });

  test('selecting the result selects the coloured block, ready to place', () => {
    const game = new Game(generateWorld(7));
    game.inventory.add(ItemId.Wool, 2);
    expect(game.tryCraft('wool-blue')).toBe(true);
    expect(game.selected).toBe(BlockId.WoolBlue);
    expect(game.inventory.count(BlockId.WoolBlue)).toBe(2);
    expect(game.inventory.count(ItemId.Wool)).toBe(1);
  });

  test('making a recipe with wool in the bag crafts through the screen', () => {
    const inv = new Inventory();
    inv.add(ItemId.Wool, 1);
    const { screen } = open(inv);
    screen.make(5);
    expect(inv.count(BlockId.WoolBlue)).toBe(2);
    expect(inv.count(ItemId.Wool)).toBe(0);
  });
});
