import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { FIRE_COOLDOWN, WEAPON_REACH } from '../../src/core/grumpRules';
import { ItemId } from '../../src/core/items';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { Game, type GameEvent } from '../../src/game/game';
import { GrumpSystem } from '../../src/game/grumps';

const ZONE = { x0: 2, z0: 2, x1: 37, z1: 37 };

function setup(weapon: ItemId | null = ItemId.BubbleBlaster) {
  const world = new World(40, 10, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) world.set(x, 0, z, BlockId.Grass);
  world.clearEdits();
  world.markClean();
  const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 } });
  const sys = new GrumpSystem(mulberry32(4), ZONE, new Set());
  game.grumps = sys;
  game.grumpRng = mulberry32(9);
  if (weapon !== null) { game.inventory.add(weapon, 1); game.selected = weapon; }
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  return { world, game, sys, events, grump: sys.spawn([9, 1, 5], 'jelly') };
}
const types = (events: GameEvent[]): string[] => events.map(e => e.type);
const reload = (game: Game): void => game.update(FIRE_COOLDOWN + 0.01);

describe('Game.fireWeapon', () => {
  it('needs the selected item to be a weapon', () => {
    for (const sel of ['hand', BlockId.Stone, ItemId.Apple] as const) {
      const t = setup();
      t.game.inventory.add(BlockId.Stone, 1); t.game.inventory.add(ItemId.Apple, 1);
      t.game.selected = sel;
      t.game.fireWeapon(t.grump.id);
      expect(t.grump.mood, String(sel)).toBe(0);
      expect(types(t.events)).not.toContain('fired');
    }
  });

  it('is refused out of reach, during the cooldown and while paused', () => {
    const far = setup();
    far.grump.x = 5.5 + WEAPON_REACH + 2;
    far.game.fireWeapon(far.grump.id);
    expect(types(far.events)).not.toContain('fired');
    const paused = setup();
    paused.game.paused = true;
    paused.game.fireWeapon(paused.grump.id);
    expect(paused.grump.mood).toBe(0);
    expect(types(paused.events)).toEqual([]);
    const gone = setup();
    gone.game.fireWeapon(9999);
    expect(types(gone.events)).toEqual([]);
  });

  it('a fast double tap fires once; after the cooldown it fires again', () => {
    const t = setup();
    t.game.fireWeapon(t.grump.id);
    t.game.fireWeapon(t.grump.id);
    expect(types(t.events).filter(e => e === 'fired').length).toBe(1);
    expect(t.grump.hits).toBe(1);
    t.game.update(FIRE_COOLDOWN - 0.1);
    t.game.fireWeapon(t.grump.id);
    expect(t.grump.hits).toBe(1);
    t.game.update(0.2);
    t.game.fireWeapon(t.grump.id);
    expect(types(t.events)).toContain('cheered');
  });

  it('the first hit makes it unsure and the plants resume; the cooldown does not run while paused', () => {
    const t = setup();
    const plant: [number, number, number] = [9, 1, 7];
    expect(t.sys.pausesCell(plant)).toBe(true);
    t.game.fireWeapon(t.grump.id);
    expect(types(t.events)).toEqual(['fired', 'unsure']);
    expect(t.grump.mood).toBe(1);
    expect(t.sys.pausesCell(plant)).toBe(false);
    t.game.paused = true;
    t.game.update(5);
    t.game.paused = false;
    t.game.fireWeapon(t.grump.id);
    expect(t.grump.hits).toBe(1); // still cooling down: paused time does not count
  });

  it('the second hit cheers it up: a reward is in the bag, the weapon is still there, the counter counts', () => {
    const t = setup();
    t.game.fireWeapon(t.grump.id);
    reload(t.game);
    t.events.length = 0;
    const before = t.game.inventory.toJSON();
    t.game.fireWeapon(t.grump.id);
    const cheered = t.events.find((e): e is Extract<GameEvent, { type: 'cheered' }> => e.type === 'cheered')!;
    expect(cheered).toBeDefined();
    expect(cheered.friend).toBe(false);
    expect(cheered.reward.length).toBeGreaterThan(0);
    for (const r of cheered.reward) expect(t.game.inventory.count(r.id)).toBeGreaterThanOrEqual(r.n);
    expect(t.game.inventory.count(ItemId.BubbleBlaster)).toBe(1);
    expect(t.game.cheered).toBe(1);
    expect(t.sys.grumps.length).toBe(0);
    expect(t.game.inventory.toJSON()).toEqual(before); // blocks untouched (rewards are items)
  });

  it('a reward that cannot fit is skipped and nothing else changes', () => {
    const t = setup();
    for (const id of [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.Gem, ItemId.AppleSapling]) t.game.inventory.add(id, 99);
    t.game.fireWeapon(t.grump.id);
    reload(t.game);
    t.game.fireWeapon(t.grump.id);
    const cheered = t.events.find((e): e is Extract<GameEvent, { type: 'cheered' }> => e.type === 'cheered')!;
    expect(cheered.reward).toEqual([]);
    for (const id of [ItemId.WheatSeed, ItemId.Gem, ItemId.AppleSapling]) expect(t.game.inventory.count(id)).toBe(99);
    expect(t.game.cheered).toBe(1);
  });

  it('the fifth cheer-up makes a friend with a Gem, the tenth too, until five friends; then the fifth just bursts with an extra Gem', () => {
    const t = setup();
    const cheerOne = (x: number): Extract<GameEvent, { type: 'cheered' }> => {
      const g = t.sys.spawn([x, 1, 5], 'cloud');
      t.events.length = 0;
      t.game.fireWeapon(g.id); reload(t.game);
      t.game.fireWeapon(g.id); reload(t.game);
      return t.events.find((e): e is Extract<GameEvent, { type: 'cheered' }> => e.type === 'cheered')!;
    };
    t.sys.grumps.length = 0;
    for (let i = 1; i <= 4; i++) expect(cheerOne(8 + i).friend).toBe(false);
    const fifth = cheerOne(12);
    expect(fifth.friend).toBe(true);
    expect(types(t.events)).toContain('friendMade');
    expect(t.sys.friends.length).toBe(1);
    expect(fifth.reward).toEqual([{ id: ItemId.Gem, n: 1 }]);
    for (let i = 6; i <= 9; i++) cheerOne(8 + (i % 6));
    expect(cheerOne(11).friend).toBe(true);
    expect(t.sys.friends.length).toBe(2);
    // Fill to five friends, then the next fifth only bursts.
    while (t.sys.friends.length < 5) t.sys.makeFriend(t.sys.spawn([20 + t.sys.friends.length, 1, 20], 'jelly').id);
    t.game.cheered = 14;
    t.game.inventory.remove(ItemId.Gem, t.game.inventory.count(ItemId.Gem));
    const atCap = cheerOne(10);
    expect(atCap.friend).toBe(false);
    expect(t.sys.friends.length).toBe(5);
    expect(atCap.reward.some(r => r.id === ItemId.Gem)).toBe(true);
  });

  it('firing changes only the bag, the grump and the counters', () => {
    const t = setup();
    const edits = JSON.stringify(t.world.edits());
    t.game.fireWeapon(t.grump.id); reload(t.game);
    t.game.fireWeapon(t.grump.id);
    expect(JSON.stringify(t.world.edits())).toBe(edits);
    expect(t.game.player.pos).toEqual({ x: 5.5, y: 1, z: 5.5 });
    expect(t.game.selected).toBe(ItemId.BubbleBlaster);
  });

  it('applyIntent fire and petFriend work; petting a friend costs nothing', () => {
    const t = setup();
    t.game.applyIntent({ kind: 'fire', grump: t.grump.id });
    expect(t.grump.mood).toBe(1);
    const f = t.sys.makeFriend(t.sys.spawn([12, 1, 12], 'cloud').id);
    const bag = JSON.stringify(t.game.inventory.toJSON());
    t.events.length = 0;
    t.game.applyIntent({ kind: 'petFriend', friend: f.id });
    expect(types(t.events)).toEqual(['friendPetted']);
    expect(f.state).toBe('hop');
    expect(JSON.stringify(t.game.inventory.toJSON())).toBe(bag);
  });
});

describe('the pad fires', () => {
  it('Place with a weapon selected hits the nearest grump in reach, else does nothing and never builds', () => {
    const t = setup();
    const other = t.sys.spawn([11, 1, 5], 'cloud');
    expect(t.game.fireNearest()).toBe(true);
    expect(t.grump.mood).toBe(1);
    expect(other.mood).toBe(0);
    reload(t.game);
    t.game.padAction('place');
    expect(t.grump.hits + other.hits).toBeGreaterThan(1);
    const none = setup();
    none.sys.grumps.length = 0;
    const edits = JSON.stringify(none.world.edits());
    none.game.padAction('place');
    expect(none.events).toEqual([]);
    expect(JSON.stringify(none.world.edits())).toBe(edits);
    expect(none.game.fireNearest()).toBe(false);
  });
});
