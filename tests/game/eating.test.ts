import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { isItemId, ItemId } from '../../src/core/items';
import { World } from '../../src/core/world';
import { LINES } from '../../src/content/lines';
import { BITES, EAT_SECONDS, EatState, reactionKey } from '../../src/game/eating';
import { FarmHints } from '../../src/game/hints';
import { Game, type GameEvent } from '../../src/game/game';

function setup(items: Array<[ItemId | BlockId, number]> = []) {
  const world = new World(48, 16, 48);
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) world.set(x, 0, z, BlockId.Grass);
  world.clearEdits();
  const inv = new Inventory();
  for (const [id, n] of items) inv.add(id, n);
  const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 }, inventory: inv });
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  return { game, inv, events, world };
}

describe('EatState', () => {
  it('progress reaches 1 at EAT_SECONDS and the bites go 0 to 3', () => {
    const e = new EatState();
    expect(e.start(ItemId.Apple)).toBe(true);
    expect(e.bite).toBe(0);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      e.update(EAT_SECONDS / 100 * 0.999);
      seen.add(e.bite);
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
    e.update(0.1);
    expect(e.active).toBe(false);
    expect(e.progress).toBe(0);
    expect(BITES).toBe(3);
  });
  it('a second start during the animation is refused', () => {
    const e = new EatState();
    expect(e.start(ItemId.Carrot)).toBe(true);
    e.update(0.5);
    expect(e.start(ItemId.Carrot)).toBe(false);
    e.update(1);
    expect(e.start(ItemId.Carrot)).toBe(true);
  });
  it('the finish is reported once, after the animation', () => {
    const e = new EatState();
    e.start(ItemId.Potato);
    e.update(1);
    expect(e.takeFinished()).toBeNull();
    e.update(0.5);
    expect(e.takeFinished()).toBe(ItemId.Potato);
    expect(e.takeFinished()).toBeNull();
  });
  it('the reaction key matches the food and every key is a real line', () => {
    expect(reactionKey(ItemId.Apple)).toBe('ateApple');
    expect(reactionKey(ItemId.Carrot)).toBe('ateCarrot');
    expect(reactionKey(ItemId.Potato)).toBe('atePotato');
    expect(reactionKey(ItemId.Milk)).toBe('drankMilk');
    for (const f of [ItemId.Apple, ItemId.Carrot, ItemId.Potato, ItemId.Milk]) expect(LINES[reactionKey(f)]).toHaveLength(4);
  });
  it('Pip reacts at most once per 20 s per food', () => {
    const hints = new FarmHints([]);
    const said: string[] = [];
    const finish = (t: number) => { const k = reactionKey(ItemId.Apple); if (hints.reactionAllowed(k, t)) said.push(k); };
    finish(0); finish(5000); finish(19_999); finish(20_000);
    expect(said).toHaveLength(2);
  });
});

describe('Game.eat', () => {
  it('eats one and only one, and emits ate once', () => {
    const { game, inv, events } = setup([[ItemId.Carrot, 3]]);
    game.selected = ItemId.Carrot;
    game.applyIntent({ kind: 'eat' });
    expect(inv.count(ItemId.Carrot)).toBe(2);
    expect(events.filter(e => e.type === 'ate')).toEqual([{ type: 'ate', id: ItemId.Carrot }]);
    expect(game.eating.active).toBe(true);
  });
  it('a second tap during the animation eats nothing', () => {
    const { game, inv } = setup([[ItemId.Apple, 5]]);
    game.selected = ItemId.Apple;
    game.applyIntent({ kind: 'eat' });
    game.update(0.4);
    game.applyIntent({ kind: 'eat' });
    expect(inv.count(ItemId.Apple)).toBe(4);
    game.update(1);
    game.applyIntent({ kind: 'eat' });
    expect(inv.count(ItemId.Apple)).toBe(3);
  });
  it('eating the last one falls back to the hand', () => {
    const { game, inv } = setup([[ItemId.Milk, 1]]);
    game.selected = ItemId.Milk;
    game.applyIntent({ kind: 'eat' });
    expect(inv.count(ItemId.Milk)).toBe(0);
    expect(game.effectiveSelected()).toBe('hand');
  });
  it('non-edible selections never eat', () => {
    const none: Array<ItemId | BlockId | 'hand'> = [
      ItemId.Wheat, ItemId.Egg, ItemId.Wool, ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling, BlockId.Planks, BlockId.Dirt, 'hand',
    ];
    for (const sel of none) {
      const { game, inv, events } = setup(sel === 'hand' ? [[ItemId.Wheat, 1]] : [[sel, 4]]);
      game.selected = sel;
      const before = JSON.stringify([inv.toJSON(), inv.itemsToJSON()]);
      game.applyIntent({ kind: 'eat' });
      expect(JSON.stringify([inv.toJSON(), inv.itemsToJSON()]), String(sel)).toBe(before);
      expect(events.some(e => e.type === 'ate')).toBe(false);
      expect(game.eating.active).toBe(false);
    }
  });
  it('no state remains after eating: the bag changes by exactly one and nothing else', () => {
    const { game, inv } = setup([[ItemId.Apple, 4], [ItemId.Carrot, 2], [BlockId.Planks, 7]]);
    game.selected = ItemId.Apple;
    const pos = { ...game.player.pos };
    game.applyIntent({ kind: 'eat' });
    for (let i = 0; i < 60; i++) game.update(0.05);
    expect(inv.count(ItemId.Apple)).toBe(3);
    expect(inv.count(ItemId.Carrot)).toBe(2);
    expect(inv.count(BlockId.Planks)).toBe(7);
    expect(game.player.pos).toEqual(pos);
    expect(game.eating.active).toBe(false);
    expect(game.effectiveSelected()).toBe(ItemId.Apple);
  });
  it('a paused game (overlay open) does not eat', () => {
    const { game, inv } = setup([[ItemId.Apple, 2]]);
    game.selected = ItemId.Apple;
    game.paused = true;
    game.applyIntent({ kind: 'eat' });
    expect(inv.count(ItemId.Apple)).toBe(2);
  });
  it('pad Place with an edible selected eats; a block still places', () => {
    const { game, inv, world } = setup([[ItemId.Carrot, 2], [BlockId.Planks, 2]]);
    game.selected = ItemId.Carrot;
    game.padAction('place');
    expect(inv.count(ItemId.Carrot)).toBe(1);
    game.update(2);
    game.selected = BlockId.Planks;
    game.padAction('place');
    expect(inv.count(BlockId.Planks)).toBe(1);
    expect(inv.count(ItemId.Carrot)).toBe(1);
    expect([...world.edits()].length).toBeGreaterThan(0);
  });
  it('every edible item is a real item', () => {
    for (const f of [ItemId.Apple, ItemId.Carrot, ItemId.Potato, ItemId.Milk]) expect(isItemId(f)).toBe(true);
  });
});
