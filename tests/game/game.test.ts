import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { World } from '../../src/core/world';
import { Game, type GameEvent } from '../../src/game/game';

function flatWorld(): World {
  const world = new World(48, 16, 48);
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) world.set(x, 0, z, BlockId.Grass);
  world.clearEdits();
  return world;
}

function setup(inventory?: Inventory) {
  const world = flatWorld();
  const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 }, inventory });
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  return { world, game, events };
}

describe('Game', () => {
  it('collect intent removes block and emits collected', () => {
    const { world, game, events } = setup();
    world.set(6, 1, 5, BlockId.Wood);
    game.applyIntent({ kind: 'collect', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.Wood)).toBe(1);
    expect(events).toContainEqual({ type: 'collected', id: BlockId.Wood });
  });

  it('collect at 20 emits full and keeps block', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 20);
    const { world, game, events } = setup(inv);
    world.set(6, 1, 5, BlockId.Wood);
    game.applyIntent({ kind: 'collect', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Wood);
    expect(game.inventory.count(BlockId.Wood)).toBe(20);
    expect(events).toContainEqual({ type: 'full', id: BlockId.Wood });
  });

  it('place intent uses one item', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 2);
    const { world, game, events } = setup(inv);
    game.selected = BlockId.Wood;
    game.applyIntent({ kind: 'place', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Wood);
    expect(game.inventory.count(BlockId.Wood)).toBe(1);
    expect(events).toContainEqual({ type: 'placed', id: BlockId.Wood });
  });

  it('selection resets to hand when the stack empties', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 1);
    const { game } = setup(inv);
    game.selected = BlockId.Wood;
    game.applyIntent({ kind: 'place', cell: [6, 1, 5] });
    expect(game.selected).toBe('hand');
  });

  it('selectNext cycles hand and items', () => {
    const inv = new Inventory();
    inv.add(BlockId.Dirt, 1);
    inv.add(BlockId.Wood, 1);
    const { game } = setup(inv);
    expect(game.selected).toBe('hand');
    game.selectNext();
    expect(game.selected).toBe(BlockId.Dirt);
    game.selectNext();
    expect(game.selected).toBe(BlockId.Wood);
    game.selectNext();
    expect(game.selected).toBe('hand');
  });

  it('walk intent sets a path', () => {
    const { world, game, events } = setup();
    game.applyIntent({ kind: 'walk', to: [9, 1, 5] });
    for (let i = 0; i < 60; i++) game.update(0.05);
    expect(game.player.pos.x).toBeGreaterThan(8);
    expect(events.some(e => e.type === 'noPath')).toBe(false);
  });

  it('craft consumes inputs and emits crafted', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 1);
    const { game, events } = setup(inv);
    expect(game.tryCraft('planks')).toBe(true);
    expect(game.inventory.count(BlockId.Planks)).toBe(2);
    expect(events).toContainEqual({ type: 'crafted', recipe: 'planks' });
    expect(game.tryCraft('nope')).toBe(false);
  });

  it('idle fires after 20s without actions', () => {
    const { game, events } = setup();
    for (let i = 0; i < 19; i++) game.update(1);
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0);
    game.update(1.5);
    expect(events.filter(e => e.type === 'idle')).toHaveLength(1);
  });

  it('default occupied covers feet and head', () => {
    const { game } = setup();
    expect(game.occupied()).toEqual([[5, 1, 5], [5, 2, 5]]);
    game.setOccupied(() => [[1, 1, 1]]);
    expect(game.occupied()).toEqual([[1, 1, 1]]);
  });

  it('pad collect takes the block in front, pad place puts one there', () => {
    const inv = new Inventory();
    inv.add(BlockId.Dirt, 3);
    const { world, game } = setup(inv);
    game.player.heading = Math.PI / 2; // facing +x
    world.set(6, 1, 5, BlockId.Wood);
    game.padAction('collect');
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    game.selected = BlockId.Dirt;
    game.padAction('place');
    expect(world.get(6, 1, 5)).toBe(BlockId.Dirt);
    expect(game.inventory.count(BlockId.Dirt)).toBe(2);
  });

  it('tapping a far tree walks to a cell next to it', () => {
    const { world, game, events } = setup();
    for (let y = 1; y <= 4; y++) world.set(15, y, 5, BlockId.Wood);
    game.applyIntent({ kind: 'walk', to: [15, 5, 5] });
    for (let i = 0; i < 200; i++) game.update(0.05);
    const [x, , z] = game.player.feetCell();
    expect(Math.max(Math.abs(x - 15), Math.abs(z - 5))).toBe(1);
    expect(events.some(e => e.type === 'noPath')).toBe(false);
  });

  it('tapping the pond walks to the shore', () => {
    const { world, game, events } = setup();
    for (let x = 13; x <= 15; x++) for (let z = 4; z <= 6; z++) world.set(x, 1, z, BlockId.Water);
    game.applyIntent({ kind: 'walk', to: [14, 1, 5] });
    for (let i = 0; i < 200; i++) game.update(0.05);
    const [x, y, z] = game.player.feetCell();
    expect(world.get(x, y, z)).not.toBe(BlockId.Water);
    expect(Math.max(Math.abs(x - 14), Math.abs(z - 5))).toBe(2);
    expect(events.some(e => e.type === 'noPath')).toBe(false);
  });

  it('unreachable tap emits noPath', () => {
    const { world, game, events } = setup();
    for (let x = 18; x <= 22; x++) for (let z = 18; z <= 22; z++) {
      for (let y = 1; y <= 3; y++) world.set(x, y, z, BlockId.Stone);
    }
    game.applyIntent({ kind: 'walk', to: [20, 4, 20] });
    expect(events).toContainEqual({ type: 'noPath' });
  });

  it('noteActivity resets idle', () => {
    const { game, events } = setup();
    for (let i = 0; i < 3; i++) { game.update(15); game.noteActivity(); }
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0);
  });
});
