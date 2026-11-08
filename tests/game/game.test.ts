import { describe, expect, it, vi } from 'vitest';
import { BlockId, isPlantBlock } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { isItemId, ItemId } from '../../src/core/items';
import { canPlace } from '../../src/core/placement';
import * as pathfinding from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { Game, type GameEvent } from '../../src/game/game';
import { resolveHold } from '../../src/input/tap';

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

  it('a hold dig intent digs the block, whatever slot is selected', () => {
    const inv = new Inventory();
    inv.add(BlockId.Planks, 3);
    const { world, game, events } = setup(inv);
    game.selected = BlockId.Planks;
    world.set(6, 1, 5, BlockId.Stone);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.Stone)).toBe(1);
    expect(game.inventory.count(BlockId.Planks)).toBe(3);
    expect(events).toContainEqual({ type: 'collected', id: BlockId.Stone });
  });

  it('a hold dig intent keeps the collect guards (feet, reach)', () => {
    const { world, game } = setup();
    game.applyIntent({ kind: 'dig', cell: [5, 0, 5] });
    expect(world.get(5, 0, 5)).toBe(BlockId.Grass);
    world.set(12, 1, 5, BlockId.Stone);
    game.applyIntent({ kind: 'dig', cell: [12, 1, 5] });
    expect(world.get(12, 1, 5)).toBe(BlockId.Stone);
    expect(game.inventory.hotbar()).toEqual([]);
  });

  it('a hold walkNear intent walks beside the block, not onto it, so a second hold digs it', () => {
    const { world, game, events } = setup();
    // Ground block 5 away, held on its top face (the old rule walked onto it).
    game.applyIntent({ kind: 'walkNear', block: [10, 0, 5] });
    expect(events.some(e => e.type === 'walking')).toBe(true);
    for (let i = 0; i < 200; i++) game.update(0.05);
    const feet = game.player.feetCell();
    expect([feet[0], feet[2]]).not.toEqual([10, 5]);
    expect(Math.max(Math.abs(feet[0] - 10), Math.abs(feet[1] - 0), Math.abs(feet[2] - 5))).toBeLessThanOrEqual(3);
    expect(resolveHold({ cell: [10, 0, 5], normal: [0, 1, 0] }, feet, world, game.occupied()))
      .toEqual({ kind: 'dig', cell: [10, 0, 5] });
    game.applyIntent(resolveHold({ cell: [10, 0, 5], normal: [0, 1, 0] }, feet, world, game.occupied()));
    expect(world.get(10, 0, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.Grass)).toBe(1);
  });

  it('a hold walkNear on a wall block stops beside it', () => {
    const { world, game } = setup();
    world.set(12, 1, 5, BlockId.Stone);
    game.applyIntent({ kind: 'walkNear', block: [12, 1, 5] });
    for (let i = 0; i < 200; i++) game.update(0.05);
    expect(game.player.feetCell()).toEqual([11, 1, 5]);
    expect(world.get(12, 1, 5)).toBe(BlockId.Stone);
  });

  it('a hold walkNear on a pillar top stops beside the pillar', () => {
    const { world, game } = setup();
    for (let y = 1; y <= 2; y++) world.set(15, y, 5, BlockId.Stone);
    game.applyIntent({ kind: 'walkNear', block: [15, 2, 5] });
    for (let i = 0; i < 300; i++) game.update(0.05);
    const [x, , z] = game.player.feetCell();
    expect([x, z]).not.toEqual([15, 5]);
  });

  it('collect at 99 emits full and keeps block', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 99);
    const { world, game, events } = setup(inv);
    world.set(6, 1, 5, BlockId.Wood);
    game.applyIntent({ kind: 'collect', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Wood);
    expect(game.inventory.count(BlockId.Wood)).toBe(99);
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

  it('crafting selects the output so it can be placed straight away', () => {
    const inv = new Inventory();
    inv.add(BlockId.Wood, 1);
    const { game } = setup(inv);
    expect(game.tryCraft('planks')).toBe(true);
    expect(game.effectiveSelected()).toBe(BlockId.Planks);
  });

  it('idle does not accumulate while paused', () => {
    const { game, events } = setup();
    game.paused = true;
    for (let i = 0; i < 60; i++) game.update(1);
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0);
    game.paused = false;
    for (let i = 0; i < 19; i++) game.update(1);
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0);
  });

  it('idle fires after 20s without actions', () => {
    const { game, events } = setup();
    for (let i = 0; i < 19; i++) game.update(1);
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0);
    game.update(1.5);
    expect(events.filter(e => e.type === 'idle')).toHaveLength(1);
  });

  it('idle hints back off: 20 s, then 60 s, then none until the next action', () => {
    const { game, events } = setup();
    const idles = () => events.filter(e => e.type === 'idle').length;
    for (let i = 0; i < 20; i++) game.update(1);
    expect(idles()).toBe(1);
    for (let i = 0; i < 59; i++) game.update(1);
    expect(idles()).toBe(1);
    game.update(1);
    expect(idles()).toBe(2);
    for (let i = 0; i < 600; i++) game.update(1);
    expect(idles()).toBe(2);
    game.padAction('nextSlot');
    for (let i = 0; i < 20; i++) game.update(1);
    expect(idles()).toBe(3);
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

  it('an unreachable tap walks as close as it can get', () => {
    const { world, game, events } = setup();
    for (let x = 18; x <= 22; x++) for (let z = 18; z <= 22; z++) {
      for (let y = 1; y <= 3; y++) world.set(x, y, z, BlockId.Stone);
    }
    game.applyIntent({ kind: 'walk', to: [20, 4, 20] });
    expect(events.some(e => e.type === 'noPath')).toBe(false);
    for (let i = 0; i < 400; i++) game.update(0.05);
    const [x, , z] = game.player.feetCell();
    expect(Math.max(Math.abs(x - 20), Math.abs(z - 20))).toBe(3);
  });

  it('emits noPath when the player is already as close as he can get', () => {
    const { world, game, events } = setup();
    for (let z = 0; z < 48; z++) for (let y = 1; y <= 3; y++) world.set(6, y, z, BlockId.Stone);
    game.applyIntent({ kind: 'walk', to: [9, 1, 5] });
    expect(events).toContainEqual({ type: 'noPath' });
  });

  it('a walk tap reports where the player is heading', () => {
    const { game, events } = setup();
    game.applyIntent({ kind: 'walk', to: [9, 1, 5] });
    expect(events).toContainEqual({ type: 'walking', to: [9, 1, 5] });
  });

  it('cannot collect the block under the player\'s feet', () => {
    const { world, game, events } = setup();
    game.applyIntent({ kind: 'collect', cell: [5, 0, 5] });
    expect(world.get(5, 0, 5)).toBe(BlockId.Grass);
    expect(game.inventory.count(BlockId.Grass)).toBe(0);
    expect(events).toEqual([]);
  });

  it('cannot collect the block under Pip', () => {
    const { world, game, events } = setup();
    game.setOccupied(() => [[5, 1, 5], [5, 2, 5], [7, 1, 6], [7, 2, 6]]);
    game.applyIntent({ kind: 'collect', cell: [7, 0, 6] });
    expect(world.get(7, 0, 6)).toBe(BlockId.Grass);
    expect(events).toEqual([]);
    game.applyIntent({ kind: 'collect', cell: [6, 0, 6] });
    expect(world.get(6, 0, 6)).toBe(BlockId.Air);
  });

  it('a player in a deep pit is lifted out on noPath', () => {
    const world = new World(48, 16, 48);
    for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) for (let y = 0; y <= 4; y++) world.set(x, y, z, BlockId.Grass);
    for (let y = 2; y <= 4; y++) world.set(10, y, 10, BlockId.Air);
    const game = new Game({ world, spawn: { x: 10.5, y: 2, z: 10.5 } });
    const events: GameEvent[] = [];
    game.on(e => events.push(e));
    game.applyIntent({ kind: 'walk', to: [20, 5, 10] });
    expect(events).toContainEqual({ type: 'lifted' });
    expect(events.some(e => e.type === 'noPath')).toBe(false);
    const [x, y, z] = game.player.feetCell();
    expect(y).toBe(5);
    expect(Math.max(Math.abs(x - 10), Math.abs(z - 10))).toBe(1);
    for (let i = 0; i < 200; i++) game.update(0.05);
    expect(game.player.feetCell()).toEqual([20, 5, 10]);
  });

  it('tapping the middle of the pond walks to the nearest shore', () => {
    const { world, game, events } = setup();
    for (let x = 12; x <= 16; x++) for (let z = 3; z <= 7; z++) world.set(x, 1, z, BlockId.Water);
    game.applyIntent({ kind: 'walk', to: [14, 1, 5] });
    expect(events.some(e => e.type === 'noPath')).toBe(false);
    for (let i = 0; i < 200; i++) game.update(0.05);
    expect(game.player.feetCell()).toEqual([11, 1, 5]);
  });

  it('tapping a tree is fast', () => {
    const { world, spawn } = generateWorld(2026);
    const game = new Game({ world, spawn });
    const trunks: Array<[number, number, number]> = [];
    for (let x = 1; x < 47; x++) for (let z = 1; z < 47; z++) {
      const y = world.topSolidY(x, z);
      if (world.get(x, y, z) === BlockId.Leaves) {
        for (let t = y; t > 0; t--) if (world.get(x, t, z) === BlockId.Wood) { trunks.push([x, t, z]); break; }
      }
    }
    expect(trunks.length).toBeGreaterThan(5);
    const tap = ([x, y, z]: [number, number, number]) => {
      game.player.pos = { ...spawn };
      game.applyIntent({ kind: 'walk', to: [x - 1, y, z] });
    };
    // Deterministic: one flood reads each block a handful of times. The old ring search
    // (up to 25 A* runs of 4000 nodes) read the world millions of times per tree tap.
    const get = world.get.bind(world);
    let reads = 0;
    world.get = (x, y, z) => { reads++; return get(x, y, z); };
    let mostReads = 0;
    for (const trunk of trunks) {
      reads = 0;
      tap(trunk);
      mostReads = Math.max(mostReads, reads);
    }
    world.get = get;
    // Work done, not wall-clock, so machine load cannot flake it.
    // The world is 4x bigger since the village step, so the flood has more ground to cover.
    expect(mostReads).toBeLessThan(80_000);
  });

  it('noteActivity resets idle', () => {
    const { game, events } = setup();
    for (let i = 0; i < 3; i++) { game.update(15); game.noteActivity(); }
    expect(events.filter(e => e.type === 'idle')).toHaveLength(0);
  });
});

describe('Game pause', () => {
  it('paused game does not move the player', () => {
    const { game } = setup();
    game.player.setStick(1, 0);
    game.paused = true;
    const x = game.player.pos.x;
    game.update(0.5);
    expect(game.player.pos.x).toBe(x);
    game.paused = false;
    game.update(0.5);
    expect(game.player.pos.x).not.toBe(x);
  });
});


it('walks the final BFS goal in a straight line on open ground', () => {
  const { game, events } = setup();
  game.applyIntent({ kind: 'walk', to: [17, 1, 10] });
  expect(events).toContainEqual({ type: 'walking', to: [17, 1, 10] });
  for (let tick = 0; tick < 250; tick++) {
    game.update(1 / 60);
    const { x, z } = game.player.pos;
    expect(Math.abs((x - 5.5) * 5 - (z - 5.5) * 12) / 13).toBeLessThan(0.15);
  }
  expect(game.player.feetCell()).toEqual([17, 1, 10]);
});

it('falls back to the BFS route if A* exhausts its search', () => {
  const { game, events } = setup();
  const search = vi.spyOn(pathfinding, 'findPath').mockReturnValue(null);
  try {
    game.applyIntent({ kind: 'walk', to: [10, 1, 8] });
    expect(search).toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'walking', to: [10, 1, 8] });
    for (let tick = 0; tick < 200; tick++) game.update(1 / 30);
    expect(game.player.feetCell()).toEqual([10, 1, 8]);
  } finally {
    search.mockRestore();
  }
});

describe('items in the game', () => {
  it('an item is never placed as a block, and keeps its count', () => {
    const inv = new Inventory();
    inv.add(ItemId.WheatSeed, 3);
    const { world, game, events } = setup(inv);
    game.selected = ItemId.WheatSeed;
    game.applyIntent({ kind: 'place', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(ItemId.WheatSeed)).toBe(3);
    expect(events.some(e => e.type === 'placed')).toBe(false);
    expect(game.effectiveSelected()).toBe(ItemId.WheatSeed);
  });

  it('an emptied item stack falls back to the hand', () => {
    const inv = new Inventory();
    inv.add(ItemId.Egg, 1);
    const { game } = setup(inv);
    game.selected = ItemId.Egg;
    inv.remove(ItemId.Egg);
    expect(game.effectiveSelected()).toBe('hand');
  });

  it('the pad cycles through the hand, blocks and then items', () => {
    const inv = new Inventory();
    inv.add(ItemId.Apple, 1);
    inv.add(BlockId.Wood, 1);
    const { game } = setup(inv);
    game.selectNext();
    expect(game.selected).toBe(BlockId.Wood);
    game.selectNext();
    expect(game.selected).toBe(ItemId.Apple);
    game.selectNext();
    expect(game.selected).toBe('hand');
  });

  it('digging tilled soil gives plain dirt', () => {
    const { world, game } = setup();
    world.set(6, 1, 5, BlockId.Farmland);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.Dirt)).toBe(1);
    expect(game.inventory.count(BlockId.Farmland)).toBe(0);
  });
});

describe('Game: farm', () => {
  const bagWith = (...stacks: Array<[number, number]>): Inventory => {
    const inv = new Inventory();
    for (const [id, n] of stacks) inv.add(id as never, n);
    return inv;
  };

  it('applyIntent plant and help use the farm and cost nothing but one seed', () => {
    const { world, game } = setup(bagWith([ItemId.WheatSeed, 3], [BlockId.Planks, 4]));
    game.selected = ItemId.WheatSeed;
    game.applyIntent({ kind: 'plant', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Wheat0);
    expect(game.inventory.count(ItemId.WheatSeed)).toBe(2);
    expect(game.inventory.count(BlockId.Planks)).toBe(4);
    game.applyIntent({ kind: 'help', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Wheat1);
    expect(game.inventory.count(ItemId.WheatSeed)).toBe(2);
  });

  it('plant needs a seed selected, soil, reach and no one standing there', () => {
    const { world, game } = setup(bagWith([ItemId.WheatSeed, 3], [ItemId.Apple, 2]));
    game.applyIntent({ kind: 'plant', cell: [6, 1, 5] }); // hand
    game.selected = ItemId.Apple;
    game.applyIntent({ kind: 'plant', cell: [6, 1, 5] }); // not a seed
    game.selected = ItemId.WheatSeed;
    game.applyIntent({ kind: 'plant', cell: [20, 1, 20] }); // out of reach
    const [fx, fy, fz] = game.player.feetCell();
    game.applyIntent({ kind: 'plant', cell: [fx, fy, fz] }); // his own cell
    expect(game.inventory.count(ItemId.WheatSeed)).toBe(3);
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
  });

  it('help out of reach does nothing', () => {
    const { world, game } = setup();
    world.set(20, 1, 20, BlockId.Wheat0);
    game.applyIntent({ kind: 'help', cell: [20, 1, 20] });
    expect(world.get(20, 1, 20)).toBe(BlockId.Wheat0);
  });

  it('a hold on a ripe plant harvests food and seeds; no plant block ever enters the bag', () => {
    const { world, game } = setup(bagWith([ItemId.CarrotSeed, 1]));
    game.selected = ItemId.CarrotSeed;
    game.applyIntent({ kind: 'plant', cell: [6, 1, 5] });
    for (let i = 0; i < 3; i++) game.applyIntent({ kind: 'help', cell: [6, 1, 5] });
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(ItemId.Carrot)).toBe(2);
    expect(game.inventory.count(ItemId.CarrotSeed)).toBe(2);
    expect(game.inventory.slots().every(id => !isPlantBlock(id as BlockId) || isItemId(id))).toBe(true);
  });

  it('no plant block is ever added to the bag or placed', () => {
    const plants = Object.values(BlockId).filter((v): v is BlockId => typeof v === 'number' && isPlantBlock(v));
    expect(plants).toHaveLength(13);
    const { world, game } = setup();
    for (const plant of [...plants, BlockId.AppleLeaves]) {
      // Directly: the bag refuses them.
      expect(game.inventory.add(plant as never, 5)).toBe(0);
      // Digging one (any stage) never puts a plant block in the bag.
      world.set(6, 1, 5, plant);
      game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
      // Selecting one and building never places it.
      game.selected = plant;
      game.applyIntent({ kind: 'place', cell: [6, 1, 5] });
      expect(world.get(6, 1, 5)).not.toBe(plant);
      world.set(6, 1, 5, BlockId.Air);
    }
    for (const id of game.inventory.slots()) expect(isPlantBlock(id as BlockId) && !isItemId(id)).toBe(false);
    expect(game.inventory.toJSON()).toEqual({});
    expect(canPlace(world, [6, 1, 5], [], BlockId.Wheat3)).toBe(false);
    expect(canPlace(world, [6, 1, 5], [], BlockId.AppleLeaves)).toBe(false);
    expect(canPlace(world, [6, 1, 5], [], BlockId.Planks)).toBe(true);
  });

  it('a plant cell refuses a placed block', () => {
    const { world, game } = setup(bagWith([BlockId.Planks, 3]));
    world.set(6, 1, 5, BlockId.Wheat1);
    game.selected = BlockId.Planks;
    game.applyIntent({ kind: 'place', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Wheat1);
    expect(game.inventory.count(BlockId.Planks)).toBe(3);
  });

  it('place into an animal cell is refused (occupied includes animals)', () => {
    const { world, game } = setup(bagWith([BlockId.Planks, 3]));
    game.setOccupied(() => [[6, 1, 5], [6, 2, 5]]);
    world.set(7, 1, 5, BlockId.Stone);
    game.selected = BlockId.Planks;
    game.applyIntent({ kind: 'place', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.Planks)).toBe(3);
  });

  it('a harvest that would overflow is refused whole with the full event', () => {
    const { world, game, events } = setup(bagWith([ItemId.Carrot, 99], [ItemId.CarrotSeed, 1]));
    world.set(6, 1, 5, BlockId.Carrot3);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Carrot3);
    expect(game.inventory.count(ItemId.CarrotSeed)).toBe(1);
    expect(events.some(e => e.type === 'full')).toBe(true);
  });

  it('digging ripe apple leaves picks fruit and leaves ordinary leaves', () => {
    const { world, game } = setup();
    world.set(6, 1, 5, BlockId.AppleLeaves);
    game.applyIntent({ kind: 'dig', cell: [6, 1, 5] });
    expect(world.get(6, 1, 5)).toBe(BlockId.Leaves);
    expect(game.inventory.count(ItemId.Apple)).toBe(2);
    expect(game.inventory.count(BlockId.AppleLeaves)).toBe(0);
  });

  it('apples four blocks up a full tree are picked from the ground', () => {
    const { world, game } = setup();
    world.set(6, 5, 5, BlockId.AppleLeaves); // feet are at y 1
    game.applyIntent({ kind: 'dig', cell: [6, 5, 5] });
    expect(world.get(6, 5, 5)).toBe(BlockId.Leaves);
    expect(game.inventory.count(ItemId.Apple)).toBe(2);
    world.set(6, 6, 5, BlockId.AppleLeaves); // five up is too high
    game.applyIntent({ kind: 'dig', cell: [6, 6, 5] });
    expect(world.get(6, 6, 5)).toBe(BlockId.AppleLeaves);
  });

  it('apples are not picked through a wall, but are through leaves and the tree\'s own trunk', () => {
    const { world, game } = setup();
    // feet (5,1,5): an apple 4 up and 1 across, with a planks wall between eye and fruit
    world.set(6, 5, 5, BlockId.AppleLeaves);
    world.set(6, 3, 5, BlockId.Planks);
    world.set(5, 3, 5, BlockId.Planks);
    world.set(5, 4, 5, BlockId.Planks);
    world.set(6, 4, 5, BlockId.Planks);
    game.applyIntent({ kind: 'dig', cell: [6, 5, 5] });
    expect(world.get(6, 5, 5)).toBe(BlockId.AppleLeaves);
    expect(game.inventory.count(ItemId.Apple)).toBe(0);
    for (const [x, y] of [[6, 3], [5, 3], [5, 4], [6, 4]]) world.set(x, y, 5, BlockId.Leaves); // leaves do not hide it
    world.set(6, 2, 5, BlockId.Wood); // nor does a trunk beside the fruit
    game.applyIntent({ kind: 'dig', cell: [6, 5, 5] });
    expect(world.get(6, 5, 5)).toBe(BlockId.Leaves);
    expect(game.inventory.count(ItemId.Apple)).toBe(2);
  });

  it('selecting a seed does not change what pad Collect does', () => {
    const { world, game } = setup(bagWith([ItemId.WheatSeed, 2]));
    world.set(6, 1, 5, BlockId.Wood);
    game.selected = ItemId.WheatSeed;
    game.player.heading = Math.PI / 2; // facing +x
    game.padAction('collect');
    expect(world.get(6, 1, 5)).toBe(BlockId.Air);
    expect(game.inventory.count(BlockId.Wood)).toBe(1);
    expect(game.inventory.count(ItemId.WheatSeed)).toBe(2);
  });
});
