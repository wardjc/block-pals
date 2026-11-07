import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
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
    expect(mostReads).toBeLessThan(60_000);
    // Wall clock, after warming the JIT up: best of three per tree, so a GC pause or a
    // busy CI core does not count as the tap's cost.
    for (let i = 0; i < 2; i++) trunks.forEach(tap);
    let worst = 0;
    for (const trunk of trunks) {
      let best = Infinity;
      for (let rep = 0; rep < 3; rep++) {
        const t0 = performance.now();
        tap(trunk);
        best = Math.min(best, performance.now() - t0);
      }
      worst = Math.max(worst, best);
    }
    expect(worst).toBeLessThanOrEqual(10);
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
