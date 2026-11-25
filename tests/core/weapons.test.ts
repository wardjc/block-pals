import { describe, expect, test } from 'vitest';
import { BLOCKS } from '../../src/core/blocks';
import { FEEDS, ITEMS, ItemId, WEAPONS, isItemId, isStackId, isWeapon, weaponKind } from '../../src/core/items';
import { Inventory } from '../../src/core/inventory';

describe('friendly weapons and the gem (grumps chunk A, task 1)', () => {
  test('weapon ids are 120 to 122, Gem stays 123, and nothing collides', () => {
    expect([ItemId.BubbleBlaster, ItemId.MagicWand, ItemId.WaterSquirter, ItemId.Gem]).toEqual([120, 121, 122, 123]);
    for (const id of [120, 121, 122, 123]) expect(Object.hasOwn(BLOCKS, id)).toBe(false);
    for (let id = 111; id <= 119; id++) expect(isItemId(id)).toBe(false); // baked foods stay reserved
    expect(ITEMS[ItemId.Gem]).toMatchObject({ name: 'gem', icon: '💎', kind: 'gift', edible: false });
  });

  test('every weapon has a picture, a simple name and a distinct weapon kind', () => {
    expect(WEAPONS).toEqual([ItemId.BubbleBlaster, ItemId.MagicWand, ItemId.WaterSquirter]);
    expect(WEAPONS.map(id => weaponKind(id))).toEqual(['bubble', 'wand', 'water']);
    for (const id of WEAPONS) {
      expect(ITEMS[id].icon.length).toBeGreaterThan(0);
      expect(ITEMS[id].name).toMatch(/^[a-z ]+$/);
      expect(ITEMS[id].kind).toBe('tool');
    }
  });

  test('weapons are not edible, not feed, not seeds', () => {
    for (const id of WEAPONS) {
      expect(ITEMS[id].edible).toBe(false);
      expect(FEEDS).not.toContain(id);
      expect(ITEMS[id].kind).not.toBe('seed');
    }
  });

  test('isWeapon is true for exactly the three; weaponKind is null for everything else', () => {
    const all = Object.keys(ITEMS).map(Number);
    expect(all.filter(id => isWeapon(id))).toEqual([120, 121, 122]);
    expect(isWeapon(ItemId.Gem)).toBe(false);
    expect(isWeapon(1)).toBe(false);
    expect(weaponKind(ItemId.Gem)).toBeNull();
  });

  test('a weapon is a bag stack, never a block', () => {
    for (const id of WEAPONS) {
      expect(isStackId(id)).toBe(true);
      expect(Object.hasOwn(BLOCKS, id)).toBe(false);
    }
    const inv = new Inventory();
    inv.add(ItemId.MagicWand, 1);
    expect(inv.count(ItemId.MagicWand)).toBe(1);
  });
});
