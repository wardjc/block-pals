// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { canCraft, craft } from '../../src/core/crafting';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { RECIPES, owns, type Recipe } from '../../src/core/recipes';
import { Game } from '../../src/game/game';
import { generateWorld } from '../../src/core/worldgen';
import { CraftScreen, craftRows } from '../../src/ui/craft';

const recipe = (id: string): Recipe => RECIPES.find(r => r.id === id)!;
const stock = (r: Recipe, extra = 0): Inventory => {
  const inv = new Inventory();
  for (const i of r.inputs) inv.add(i.id, i.n + extra);
  return inv;
};
const WEAPON_IDS = ['bubble-blaster', 'magic-wand', 'water-squirter'];

describe('weapon recipes (grumps chunk A, task 2)', () => {
  test('the three recipes exist with the planned inputs and are once-only', () => {
    expect(recipe('bubble-blaster').inputs).toEqual([{ id: BlockId.Glass, n: 3 }, { id: BlockId.Planks, n: 2 }]);
    expect(recipe('magic-wand').inputs).toEqual([{ id: BlockId.Planks, n: 2 }, { id: BlockId.WoolYellow, n: 2 }]);
    expect(recipe('water-squirter').inputs).toEqual([{ id: BlockId.Glass, n: 2 }, { id: BlockId.Stone, n: 3 }, { id: BlockId.WoolBlue, n: 1 }]);
    expect(recipe('bubble-blaster').output).toEqual({ id: ItemId.BubbleBlaster, n: 1 });
    expect(recipe('magic-wand').output).toEqual({ id: ItemId.MagicWand, n: 1 });
    expect(recipe('water-squirter').output).toEqual({ id: ItemId.WaterSquirter, n: 1 });
    for (const id of WEAPON_IDS) expect(recipe(id).once).toBe(true);
  });

  test('each weapon crafts one weapon from exactly its inputs', () => {
    for (const id of WEAPON_IDS) {
      const r = recipe(id);
      const inv = stock(r);
      expect(canCraft(inv, r)).toBe(true);
      expect(craft(inv, r)).toBe(true);
      expect(inv.count(r.output.id)).toBe(1);
      for (const i of r.inputs) expect(inv.count(i.id)).toBe(0);
    }
  });

  test('an owned weapon cannot be crafted again and uses nothing', () => {
    for (const id of WEAPON_IDS) {
      const r = recipe(id);
      const inv = stock(r, 5);
      expect(craft(inv, r)).toBe(true);
      expect(owns(inv, r)).toBe(true);
      const before = r.inputs.map(i => inv.count(i.id));
      expect(canCraft(inv, r)).toBe(false);
      expect(craft(inv, r)).toBe(false);
      expect(r.inputs.map(i => inv.count(i.id))).toEqual(before);
      expect(inv.count(r.output.id)).toBe(1);
    }
  });

  test('every count is 20 or fewer, and every input is a block he can reach without grumps', () => {
    for (const id of WEAPON_IDS) {
      const r = recipe(id);
      for (const i of [...r.inputs, r.output]) expect(i.n).toBeLessThanOrEqual(20);
      for (const i of r.inputs) expect(i.id).toBeLessThan(100); // blocks only
    }
    const made = new Set(RECIPES.map(r => r.output.id));
    for (const b of [BlockId.Glass, BlockId.Planks, BlockId.WoolYellow, BlockId.WoolBlue]) expect(made.has(b)).toBe(true);
  });

  test('existing recipes behave exactly as before (not once, still repeatable)', () => {
    for (const r of RECIPES.filter(r => !WEAPON_IDS.includes(r.id))) expect(r.once).toBeUndefined();
    const inv = new Inventory();
    inv.add(BlockId.Wood, 2);
    expect(craft(inv, recipe('planks'))).toBe(true);
    expect(craft(inv, recipe('planks'))).toBe(true);
    expect(inv.count(BlockId.Planks)).toBe(4);
  });

  test('crafting a weapon selects it', () => {
    const game = new Game(generateWorld(7));
    for (const i of recipe('magic-wand').inputs) game.inventory.add(i.id, i.n);
    expect(game.tryCraft('magic-wand')).toBe(true);
    expect(game.selected).toBe(ItemId.MagicWand);
  });
});

describe('weapon rows in the craft screen', () => {
  function open(inv: Inventory, tryCraft?: (id: string) => boolean, sayNeedMore = () => {}) {
    document.body.replaceChildren();
    const screen = new CraftScreen(document.body, {
      inventory: inv,
      tryCraft: tryCraft ?? (id => craft(inv, RECIPES.find(x => x.id === id)!)),
      iconFor: id => `tile-${id}`,
      say: () => {}, sayNeedMore, sfxTap: () => {}, sfxCraft: () => {}, onOpenChange: () => {},
      now: () => 0,
    });
    screen.open();
    return screen;
  }
  const rowEl = (id: string) => document.querySelectorAll('.craft-row')[RECIPES.findIndex(r => r.id === id)];

  test('three weapon rows show picture, digits and dots', () => {
    open(new Inventory());
    for (const id of WEAPON_IDS) {
      const el = rowEl(id);
      expect(el.querySelectorAll('.craft-item').length).toBe(recipe(id).inputs.length + 1);
      for (const item of el.querySelectorAll('.craft-item')) {
        expect(item.querySelector('img, .pic-item')).not.toBeNull();
        expect(item.querySelector('.craft-digit')).not.toBeNull();
      }
      expect(el.querySelector('.owned-tick')).toBeNull();
    }
  });

  test('an owned weapon shows a tick and no dots; craftRows marks it owned and not makeable', () => {
    const inv = new Inventory();
    inv.add(ItemId.MagicWand, 1);
    const row = craftRows(inv).find(r => r.recipe.id === 'magic-wand')!;
    expect(row).toMatchObject({ owned: true, can: false });
    expect(craftRows(inv).find(r => r.recipe.id === 'planks')!.owned).toBe(false);
    open(inv);
    const el = rowEl('magic-wand');
    expect(el.querySelector('.owned-tick')).not.toBeNull();
    expect(el.querySelectorAll('.craft-dots i').length).toBe(0);
    expect(el.classList.contains('owned')).toBe(true);
  });

  test('tapping an owned weapon row neither crafts nor asks for more', () => {
    const inv = new Inventory();
    inv.add(ItemId.MagicWand, 1);
    let need = 0;
    const screen = open(inv, () => { throw new Error('must not craft'); }, () => { need++; });
    screen.make(RECIPES.findIndex(r => r.id === 'magic-wand'));
    expect(need).toBe(0);
    expect(inv.count(ItemId.MagicWand)).toBe(1);
  });
});
