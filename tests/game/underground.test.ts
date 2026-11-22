import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { cellIndex } from '../../src/core/caves';
import { depthBelowGround, groundLevel, homeSpot } from '../../src/core/home';
import { ItemId } from '../../src/core/items';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { Game } from '../../src/game/game';
import { CaveDiscovery } from '../../src/game/underground';
import { caveWorld } from '../helpers/caveWorld';

/** The Home button's rule and the first-visit flags on the real cave world (plan Task 21). */
const g = caveWorld(2026);
const { world, caves } = g;

const standNear = (c: Cell): Cell => {
  for (const dy of [0, 1, -1, 2, -2]) if (isStandable(world, [c[0], c[1] + dy, c[2]])) return [c[0], c[1] + dy, c[2]];
  throw new Error(`no standable cell near ${c}`);
};

function gameAt(c: Cell): Game {
  const game = new Game({ ...g, spawn: { x: c[0] + 0.5, y: c[1], z: c[2] + 0.5 } });
  game.update(0.016);
  return game;
}

describe('the Home button shows while he is deep (7 in, 5 out)', () => {
  it('hidden on the surface, shown at 7 below the ground, still at 6, hidden at 5', () => {
    // A one-wide shaft dug down from the meadow near the spawn.
    const x = 70, z = 76;
    const top = world.topSolidY(x, z);
    const ground = groundLevel(world, x, z); // the meadow round the shaft
    const cells: Array<[number, BlockId]> = [];
    for (let y = ground - 9; y <= top; y++) { cells.push([y, world.get(x, y, z)]); world.set(x, y, z, BlockId.Air); }
    try {
      const game = gameAt([x, ground - 9, z]);
      game.paused = true; // he stays where he is put (no glide down the shaft); the deep rule still runs
      const at = (depth: number): boolean => {
        game.player.pos = { x: x + 0.5, y: ground - depth, z: z + 0.5 };
        game.update(0.016);
        return game.isDeep();
      };
      expect(at(0)).toBe(false);
      expect(depthBelowGround(world, [x, ground, z])).toBe(0);
      expect(at(6)).toBe(false);
      expect(at(7)).toBe(true);
      expect(at(6)).toBe(true);
      expect(at(5)).toBe(false);
    } finally {
      for (const [y, id] of cells) world.set(x, y, z, id);
    }
  });
});

describe('Home lifts him up from anywhere deep, and keeps the bag', () => {
  const places: Array<[string, Cell]> = [
    ['the Old Hideout', standNear([96, caves.ruin!.floorY, 97])],
    ...caves.treasure.map(t => [`treasure room ${t.id}`, standNear([t.chest[0] - t.dir[0], t.floorY, t.chest[2] - t.dir[1]])] as [string, Cell]),
    ...caves.stairs.map((s, i) => [`stair tunnel ${i}`, standNear(s.cells[Math.floor(s.cells.length / 2)])] as [string, Cell]),
  ];

  it.each(places)('from %s', (_name, c) => {
    const game = gameAt(c);
    expect(game.isDeep()).toBe(true);
    game.inventory.add(ItemId.Gem, 5);
    game.inventory.add(BlockId.Planks, 7);
    const edits = world.edits().length;
    expect(game.goHome()).toBe(true);
    const f = game.player.feetCell();
    expect(f).toEqual(homeSpot(world, c, caves, g.village, [72, 0, 72], [g.tower.rect]));
    expect(isStandable(world, f)).toBe(true);
    expect(depthBelowGround(world, f)).toBeLessThanOrEqual(5);
    expect(game.isDeep()).toBe(false);
    expect(game.inventory.count(ItemId.Gem)).toBe(5);
    expect(game.inventory.count(BlockId.Planks)).toBe(7);
    expect(world.edits().length).toBe(edits);
  });

  it('from his own dug staircase', () => {
    const x0 = 60, z0 = 80;
    const top = world.topSolidY(x0, z0);
    const saved: Array<[number, number, BlockId]> = [];
    for (let i = 0; i < 10; i++) for (let k = 0; k <= 2; k++) {
      const x = x0 + i, y = top - i + k;
      saved.push([x, y, world.get(x, y, z0)]);
      world.set(x, y, z0, BlockId.Air);
    }
    try {
      const bottom: Cell = [x0 + 9, top - 9, z0];
      const game = gameAt(bottom);
      expect(game.isDeep()).toBe(true);
      expect(game.goHome()).toBe(true);
      expect(game.isDeep()).toBe(false);
      expect(isStandable(world, game.player.feetCell())).toBe(true);
    } finally {
      for (const [x, y, id] of saved.reverse()) world.set(x, y, z0, id);
    }
  });
});

describe('first visits (cavesSeen, ruinFound)', () => {
  it('cavesSeen comes from a cave the world made, never from his own pit', () => {
    const d = new CaveDiscovery(world, caves, {});
    // His own deep pit: deep, but not a generated cave cell.
    const pit: Cell = [70, world.topSolidY(70, 76) - 8, 76];
    expect(d.inCave(pit)).toBe(false);
    expect(d.update(pit, true)).toEqual([]);
    // A real cave room, but not deep yet (the top of a mouth ramp): nothing.
    const room = caves.rooms.find(r => r.layer === 'shallow')!;
    const c = standNear([room.cx, room.floorY, room.cz]);
    expect(d.inCave(c)).toBe(true);
    expect(d.update(c, false)).toEqual([]);
    expect(d.update(c, true)).toEqual(['cavesSeen']);
    expect(d.update(c, true)).toEqual([]);
  });

  it('ruinFound the first time he stands inside the Old Hideout, once', () => {
    const d = new CaveDiscovery(world, caves, { cavesSeen: true });
    const inside = standNear([96, caves.ruin!.floorY, 97]);
    expect(d.update([inside[0], inside[1] + 30, inside[2]], false)).toEqual([]); // the same column high above is not the hideout
    expect(d.update(inside, true)).toEqual(['ruinFound']);
    expect(d.update(inside, true)).toEqual([]);
  });

  it('flags already saved never fire again', () => {
    const d = new CaveDiscovery(world, caves, { cavesSeen: true, ruinFound: true });
    const inside = standNear([96, caves.ruin!.floorY, 97]);
    expect(d.update(inside, true)).toEqual([]);
  });

  it('every carved cell is known, and nothing outside the caves is', () => {
    const d = new CaveDiscovery(world, caves, {});
    for (let n = 0; n < caves.airCells.length; n += 97) {
      const i = caves.airCells[n];
      const y = Math.floor(i / (world.sizeX * world.sizeZ));
      const rem = i - y * world.sizeX * world.sizeZ;
      const z = Math.floor(rem / world.sizeX), x = rem - z * world.sizeX;
      expect(cellIndex(world, x, y, z)).toBe(i);
      expect(d.inCave([x, y, z])).toBe(true);
    }
    expect(d.inCave([72, 60, 72])).toBe(false);
    expect(d.inCave([-1, 10, 5])).toBe(false);
    expect(d.inCave([5, 10, 400])).toBe(false);
  });
});
