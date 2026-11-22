import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId, isCarriable, yieldOf } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ITEMS, ItemId, isItemId, isStackId } from '../../src/core/items';
import { MYTHICAL, PRICE } from '../../src/core/mythical';
import { RECIPES } from '../../src/core/recipes';
import { WIZARD_STOCK } from '../../src/game/wizardTrade';

/** Chunk C, Task 12: the cave blocks (56 to 64) and the Gem item (123). */
const ids = Object.keys(BLOCKS).map(Number);

describe('cave block ids', () => {
  test('ids 0..39 unchanged, 56..64 pinned; 48..55 and 65..71 unused', () => {
    expect(BlockId.Potato3).toBe(35);
    expect(BlockId.MagicMirror).toBe(47);
    expect([
      BlockId.GlowMushroom, BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen, BlockId.GemOre,
      BlockId.MossyBricks, BlockId.Chest, BlockId.ChestOpen, BlockId.RuinCrystal,
    ]).toEqual([56, 57, 58, 59, 60, 61, 62, 63, 64]);
    for (let id = 48; id <= 55; id++) expect(ids, `id ${id}`).not.toContain(id);
    for (let id = 65; id <= 71; id++) expect(ids, `id ${id}`).not.toContain(id);
    expect(Math.max(...ids)).toBe(64);
  });

  test('every cave block is a solid full cube (no new mesher shapes)', () => {
    for (let id = 56; id <= 64; id++) {
      const def = BLOCKS[id as BlockId];
      expect(def.solid, def.name).toBe(true);
      expect(def.shape ?? 'cube').toBe('cube');
      expect(def.transparent).toBe(false);
    }
  });

  test('light flag is exactly the five glow blocks plus the three the wizard made', () => {
    const lit = ids.filter(id => BLOCKS[id as BlockId].light === true).sort((a, b) => a - b);
    expect(lit).toEqual([
      BlockId.StarlightCrystal, BlockId.MoonBlock, BlockId.SunBlock,
      BlockId.GlowMushroom, BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen, BlockId.RuinCrystal,
    ]);
  });

  test('GemOre and a closed Chest are not carriable; ChestOpen, MossyBricks and the crystals are', () => {
    expect(isCarriable(BlockId.GemOre)).toBe(false);
    expect(isCarriable(BlockId.Chest)).toBe(false);
    for (const id of [BlockId.ChestOpen, BlockId.MossyBricks, BlockId.GlowMushroom, BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen, BlockId.RuinCrystal]) {
      expect(isCarriable(id), BLOCKS[id].name).toBe(true);
    }
  });

  test('a closed chest is not collectable (it opens instead); gem ore is', () => {
    expect(BLOCKS[BlockId.Chest].collectable).toBe(false);
    expect(BLOCKS[BlockId.GemOre].collectable).toBe(true);
    expect(BLOCKS[BlockId.ChestOpen].collectable).toBe(true);
  });

  test('yieldOf: gem ore gives the Gem item, stone gives stone, tilled soil gives dirt', () => {
    expect(yieldOf(BlockId.GemOre)).toBe(ItemId.Gem);
    expect(yieldOf(BlockId.Stone)).toBe(BlockId.Stone);
    expect(yieldOf(BlockId.Farmland)).toBe(BlockId.Dirt);
    expect(yieldOf(BlockId.ChestOpen)).toBe(BlockId.ChestOpen);
    expect(yieldOf(BlockId.Chest)).toBeNull();
    expect(yieldOf(BlockId.Bedrock)).toBeNull();
    expect(yieldOf(BlockId.Air)).toBeNull();
  });

  test('RuinCrystal is solid, collectable, carriable and placeable, and no recipe or wizard price refers to it', () => {
    const def = BLOCKS[BlockId.RuinCrystal];
    expect(def.solid && def.collectable).toBe(true);
    expect(isCarriable(BlockId.RuinCrystal)).toBe(true);
    expect(MYTHICAL as readonly number[]).not.toContain(BlockId.RuinCrystal);
    expect(Object.keys(PRICE).map(Number)).not.toContain(BlockId.RuinCrystal);
    expect(WIZARD_STOCK.order).not.toContain(BlockId.RuinCrystal);
    expect(JSON.stringify(RECIPES)).not.toMatch(new RegExp(`\\b${BlockId.RuinCrystal}\\b`));
  });
});

describe('the Gem item', () => {
  test('Gem is 123: a gift item, not edible, not a feed, not a seed, and 111..122 stay free', () => {
    expect(ItemId.Gem).toBe(123);
    const gem = ITEMS[ItemId.Gem];
    expect(gem).toMatchObject({ id: 123, name: 'gem', icon: '💎', kind: 'gift', edible: false });
    for (let id = 111; id <= 122; id++) expect(isItemId(id), `item ${id}`).toBe(false);
  });

  test('the wizard trades the real Gem', () => {
    expect(WIZARD_STOCK.gem).toBe(ItemId.Gem);
    expect(isStackId(WIZARD_STOCK.gem)).toBe(true);
  });

  test('the real bag holds gems (99 a stack), and a bag with a Gem serialises it under items only', () => {
    const inv = new Inventory();
    expect(inv.add(ItemId.Gem, 120)).toBe(99);
    inv.add(BlockId.Stone, 2);
    expect(inv.itemsToJSON()[ItemId.Gem]).toBe(99);
    expect(inv.toJSON()[ItemId.Gem]).toBeUndefined();
    const back = Inventory.fromJSON(inv.toJSON(), inv.order(), inv.itemsToJSON(), inv.itemOrder());
    expect(back.count(ItemId.Gem)).toBe(99);
  });

  test('an old bag with ids below 40 loads as before', () => {
    const back = Inventory.fromJSON({ [BlockId.Wood]: 3, [BlockId.Lamp]: 2 }, [BlockId.Wood, BlockId.Lamp], { [ItemId.Apple]: 1 }, [ItemId.Apple]);
    expect(back.count(BlockId.Wood)).toBe(3);
    expect(back.count(BlockId.Lamp)).toBe(2);
    expect(back.count(ItemId.Apple)).toBe(1);
  });

  test('a gem cannot be placed as a block', () => {
    expect(isCarriable(ItemId.Gem)).toBe(false);
  });
});
