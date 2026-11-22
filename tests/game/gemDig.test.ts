import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { World } from '../../src/core/world';
import { Game, type GameEvent } from '../../src/game/game';

/** The cave blocks through the one dig path (plan Task 12: yieldOf). */
function setup(inventory?: Inventory) {
  const world = new World(48, 16, 48);
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) world.set(x, 0, z, BlockId.Stone);
  world.clearEdits();
  const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 }, inventory });
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  return { world, game, events };
}

describe('digging cave blocks', () => {
  it('gem stone gives exactly one Gem and leaves air', () => {
    const { world, game, events } = setup();
    world.set(6, 1, 5, BlockId.GemOre);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(ItemId.Gem)).toBe(1);
    expect(game.inventory.count(BlockId.GemOre)).toBe(0);
    expect(events).toContainEqual({ type: 'collected', id: ItemId.Gem });
  });

  it('with 99 gems the stone stays and the bag says full', () => {
    const inv = new Inventory();
    inv.add(ItemId.Gem, 99);
    const { world, game, events } = setup(inv);
    world.set(6, 1, 5, BlockId.GemOre);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.GemOre);
    expect(inv.count(ItemId.Gem)).toBe(99);
    expect(events).toContainEqual({ type: 'full', id: ItemId.Gem });
  });

  it('a closed chest can never be dug; an open one is an ordinary block', () => {
    const { world, game } = setup();
    world.set(6, 1, 5, BlockId.Chest);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Chest);
    world.set(6, 1, 5, BlockId.ChestOpen);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.ChestOpen)).toBe(1);
  });

  it('crystals, mushrooms, mossy bricks and the Ruin crystal dig into the bag as themselves', () => {
    const { world, game } = setup();
    for (const id of [BlockId.GlowMushroom, BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen, BlockId.MossyBricks, BlockId.RuinCrystal]) {
      world.set(6, 1, 5, id);
      game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
      expect(game.inventory.count(id)).toBe(1);
    }
  });
});
