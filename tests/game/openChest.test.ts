import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { EMPTY_CAVES, type CaveLayout } from '../../src/core/caves';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { applySave, serialise } from '../../src/core/save';
import { CHEST_REWARDS, STRAY_REWARD } from '../../src/core/treasure';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { Game, type GameEvent } from '../../src/game/game';
import { resolveTap } from '../../src/input/tap';

/** Opening chests and digging gems in the game (plan Task 19). */
const CHEST: Cell = [7, 1, 5];

function setup(opts: { inventory?: Inventory; caves?: CaveLayout } = {}) {
  const world = new World(24, 12, 24);
  for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) world.set(x, 0, z, BlockId.Stone);
  world.set(...CHEST, BlockId.Chest);
  world.clearEdits();
  const caves: CaveLayout = opts.caves ?? {
    ...EMPTY_CAVES,
    treasure: [{ id: 'T1', chest: CHEST, reward: CHEST_REWARDS.T1 } as unknown as CaveLayout['treasure'][number]],
  };
  const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 }, inventory: opts.inventory, caves });
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  return { world, game, events };
}

describe('game.openChest', () => {
  it('delivers the whole reward, turns the chest open, emits chestOpened and the bag shows it', () => {
    const { world, game, events } = setup();
    const rev = game.inventory.revision;
    game.applyIntent({ kind: 'open', cell: CHEST });
    expect(world.get(...CHEST)).toBe(BlockId.ChestOpen);
    expect(game.inventory.count(ItemId.Gem)).toBe(3);
    expect(game.inventory.count(BlockId.Lamp)).toBe(4);
    expect(game.inventory.revision).toBeGreaterThan(rev);
    expect(events).toContainEqual({ type: 'chestOpened', reward: CHEST_REWARDS.T1, cell: CHEST });
    expect(world.edits()).toEqual([[...CHEST, BlockId.ChestOpen]]);
  });

  it('opening twice pays once', () => {
    const { game, events } = setup();
    game.applyIntent({ kind: 'open', cell: CHEST });
    game.applyIntent({ kind: 'open', cell: CHEST });
    expect(game.inventory.count(ItemId.Gem)).toBe(3);
    expect(events.filter(e => e.type === 'chestOpened')).toHaveLength(1);
  });

  it('opening while paused does nothing', () => {
    const { world, game, events } = setup();
    game.paused = true;
    game.applyIntent({ kind: 'open', cell: CHEST });
    expect(world.get(...CHEST)).toBe(BlockId.Chest);
    expect(game.inventory.count(ItemId.Gem)).toBe(0);
    expect(events).toEqual([]);
  });

  it('out of reach nothing opens (the tap walks beside it instead)', () => {
    const { world, game } = setup();
    world.set(20, 1, 20, BlockId.Chest);
    game.applyIntent({ kind: 'open', cell: [20, 1, 20] });
    expect(world.get(20, 1, 20)).toBe(BlockId.Chest);
    expect(game.inventory.count(ItemId.Gem)).toBe(0);
    const tap = resolveTap({ cell: [20, 1, 20], normal: [0, 1, 0] }, 'hand', game.player.feetCell(), world, game.occupied());
    expect(tap).toEqual({ kind: 'walkNear', block: [20, 1, 20] });
  });

  it('a bag that cannot hold it all leaves the chest closed, the bag unchanged, and emits full', () => {
    const inv = new Inventory();
    inv.add(BlockId.Lamp, 97); // 97 + 4 > 99: the Lamps would not fit, so nothing comes in
    const { world, game, events } = setup({ inventory: inv });
    game.applyIntent({ kind: 'open', cell: CHEST });
    expect(world.get(...CHEST)).toBe(BlockId.Chest);
    expect(inv.count(BlockId.Lamp)).toBe(97);
    expect(inv.count(ItemId.Gem)).toBe(0);
    expect(events).toContainEqual({ type: 'full', id: BlockId.Lamp });
    expect(events.some(e => e.type === 'chestOpened')).toBe(false);
    expect(world.edits()).toEqual([]);
  });

  it('a chest the layout does not know still opens, for the stray reward', () => {
    const { game } = setup({ caves: EMPTY_CAVES });
    game.applyIntent({ kind: 'open', cell: CHEST });
    expect(game.inventory.count(ItemId.Gem)).toBe(STRAY_REWARD[0].n);
  });

  it('open on an ordinary block does nothing', () => {
    const { world, game, events } = setup();
    world.set(6, 1, 6, BlockId.Stone);
    game.applyIntent({ kind: 'open', cell: [6, 1, 6] });
    expect(world.get(6, 1, 6)).toBe(BlockId.Stone);
    expect(events).toEqual([]);
  });

  it('the pad: Collect never digs a closed chest; Place facing it opens it', () => {
    const { world, game } = setup();
    game.player.heading = Math.PI / 2; // facing +x, the chest is two cells ahead: step next to it first
    game.player.pos = { x: 6.5, y: 1, z: 5.5 };
    game.padAction('collect');
    expect(world.get(...CHEST)).toBe(BlockId.Chest);
    game.padAction('place');
    expect(world.get(...CHEST)).toBe(BlockId.ChestOpen);
    expect(game.inventory.count(ItemId.Gem)).toBe(3);
  });
});

describe('gems from gem stone', () => {
  it('digging GemOre gives exactly one Gem, leaves air and emits gem', () => {
    const { world, game, events } = setup();
    world.set(6, 1, 6, BlockId.GemOre);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 6] });
    expect(world.get(6, 1, 6)).toBe(BlockId.Air);
    expect(game.inventory.count(ItemId.Gem)).toBe(1);
    expect(events).toEqual([{ type: 'collected', id: ItemId.Gem }, { type: 'gem' }]);
  });

  it('at 99 gems the dig is refused whole and the ore stays', () => {
    const inv = new Inventory();
    inv.add(ItemId.Gem, 99);
    const { world, game, events } = setup({ inventory: inv });
    world.set(6, 1, 6, BlockId.GemOre);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 6] });
    expect(world.get(6, 1, 6)).toBe(BlockId.GemOre);
    expect(events).toEqual([{ type: 'full', id: ItemId.Gem }]);
  });

  it('a Gem dug from ore and a Gem given another way (a chest, later a grump) are one stack', () => {
    const { world, game } = setup();
    world.set(6, 1, 6, BlockId.GemOre);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 6] });
    game.inventory.add(ItemId.Gem, 2); // the grumps step gives the same id
    game.applyIntent({ kind: 'open', cell: CHEST });
    expect(game.inventory.count(ItemId.Gem)).toBe(6);
    expect(game.inventory.slots().filter(id => id === ItemId.Gem)).toHaveLength(1);
  });
});

describe('a chest stays open after a reload (the open chest is an edit)', () => {
  it('reopening after save and reload pays nothing', () => {
    const g = generateWorld(2026);
    const t0 = g.caves.treasure.find(t => t.id === 'T0')!;
    const game = new Game({ ...g, spawn: { x: t0.chest[0] + 0.5, y: t0.floorY, z: t0.chest[2] - t0.dir[1] + 0.5 } });
    game.player.pos = { x: t0.chest[0] - t0.dir[0] + 0.5, y: t0.floorY, z: t0.chest[2] - t0.dir[1] + 0.5 };
    game.applyIntent({ kind: 'open', cell: t0.chest });
    expect(game.inventory.count(ItemId.WheatSeed)).toBe(3);
    const data = serialise(game, 2026);
    const loaded = applySave(JSON.parse(JSON.stringify(data)), Date.now(), generateWorld(2026));
    expect(loaded.world.get(...t0.chest)).toBe(BlockId.ChestOpen);
    const again = new Game(loaded);
    again.player.pos = { ...game.player.pos };
    again.applyIntent({ kind: 'open', cell: t0.chest });
    expect(again.inventory.count(ItemId.WheatSeed)).toBe(3);
  }, 30_000);
});
