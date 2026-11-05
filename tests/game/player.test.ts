import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { Player } from '../../src/game/player';

function flatWorld(): World {
  const world = new World(48, 16, 48);
  for (let x = 0; x < 48; x++) {
    for (let z = 0; z < 48; z++) world.set(x, 0, z, BlockId.Grass);
  }
  return world;
}

function playerAt(x = 3.5, y = 1, z = 3.5): Player {
  return new Player({ x, y, z });
}

describe('Player', () => {
  it('uses feet positions in world units and floors them to cells', () => {
    const spawn = { x: 3.75, y: 1, z: 4.25 };
    const player = new Player(spawn);
    expect(player.pos).toEqual(spawn);
    expect(player.feetCell()).toEqual([3, 1, 4]);
    player.pos.x++;
    expect(spawn.x).toBe(3.75);
  });

  it('follows a path to the end, including bends and steps', () => {
    const world = flatWorld();
    world.set(5, 1, 4, BlockId.Stone);
    const player = playerAt();
    player.setPath(findPath(world, player.feetCell(), [5, 2, 4]));
    for (let i = 0; i < 100; i++) {
      player.update(world, 0.02);
      expect(isStandable(world, player.feetCell())).toBe(true);
    }
    expect(player.pos).toEqual({ x: 5.5, y: 2, z: 4.5 });
    player.update(world, 10);
    expect(player.pos).toEqual({ x: 5.5, y: 2, z: 4.5 });
  });

  it('uses remaining movement time across path waypoints', () => {
    const player = playerAt();
    player.setPath([[4, 1, 3], [5, 1, 3], [6, 1, 3], [7, 1, 3]]);
    player.update(flatWorld(), 1);
    expect(player.pos.x).toBeCloseTo(7);
    expect(player.heading).toBeCloseTo(Math.PI / 2);
  });

  it('moves at 3.5 blocks/s with world-space stick input and faces its travel', () => {
    const world = flatWorld();
    for (const [dx, dz] of [[1, 0], [0, -1], [1, 1]]) {
      const player = playerAt(20.5, 1, 20.5);
      player.setStick(dx, dz);
      player.update(world, 1);
      expect(Math.hypot(player.pos.x - 20.5, player.pos.z - 20.5)).toBeCloseTo(3.5);
      expect(player.heading).toBeCloseTo(Math.atan2(dx, dz));
    }
  });

  it('stick movement auto-steps up 1 block and back down', () => {
    const world = flatWorld();
    world.set(4, 1, 3, BlockId.Stone);
    const player = playerAt();
    player.setStick(1, 0);
    player.update(world, 1 / 3.5);
    expect(player.feetCell()).toEqual([4, 2, 3]);
    player.update(world, 1 / 3.5);
    expect(player.feetCell()).toEqual([5, 1, 3]);
  });

  it.each([[1, 0, 46, 24], [-1, 0, 1, 24], [0, 1, 24, 46], [0, -1, 24, 1]])(
    'cannot leave the soft wall with stick (%s, %s)', (dx, dz, x, z) => {
      const player = playerAt(24.5, 1, 24.5);
      player.setStick(dx, dz);
      player.update(flatWorld(), 100);
      expect(player.feetCell()).toEqual([x, 1, z]);
    },
  );

  it('does not follow paths outside the soft wall', () => {
    const player = playerAt(46.5);
    player.setPath([[47, 1, 3]]);
    player.update(flatWorld(), 10);
    expect(player.feetCell()[0]).toBe(46);
  });

  it('is blocked by a 2-high wall, even with a large tick', () => {
    const world = flatWorld();
    world.set(4, 1, 3, BlockId.Stone);
    world.set(4, 2, 3, BlockId.Stone);
    const player = playerAt();
    player.setStick(1, 0);
    player.update(world, 10);
    expect(player.feetCell()).toEqual([3, 1, 3]);
    expect(isStandable(world, player.feetCell())).toBe(true);
  });

  it.each(['water', 'drop', 'ceiling'])('stops at %s', obstacle => {
    const world = flatWorld();
    const player = playerAt();
    if (obstacle === 'water') world.set(4, 1, 3, BlockId.Water);
    if (obstacle === 'drop') world.set(4, 0, 3, BlockId.Air);
    if (obstacle === 'ceiling') {
      world.set(4, 1, 3, BlockId.Stone);
      world.set(3, 3, 3, BlockId.Stone);
    }
    player.setStick(1, 0);
    player.update(world, 1);
    expect(player.feetCell()).toEqual([3, 1, 3]);
  });

  it('cannot cut diagonally through solid corners', () => {
    const world = flatWorld();
    for (const [x, z] of [[4, 3], [3, 4]]) {
      world.set(x, 1, z, BlockId.Stone);
      world.set(x, 2, z, BlockId.Stone);
    }
    const player = playerAt();
    player.setStick(1, 1);
    player.update(world, 10);
    expect(player.feetCell()).toEqual([3, 1, 3]);
  });

  it('diagonal stick into a wall slides along it', () => {
    const world = flatWorld();
    for (let x = 0; x < 48; x++) for (const y of [1, 2]) world.set(x, y, 5, BlockId.Stone);
    const player = playerAt(3.5, 1, 4.5);
    player.setStick(1, 1);
    for (let i = 0; i < 20; i++) player.update(world, 0.05);
    expect(player.pos.x).toBeGreaterThan(5);
    expect(player.feetCell()[2]).toBe(4);
    player.setStick(-1, 1);
    for (let i = 0; i < 20; i++) player.update(world, 0.05);
    expect(player.pos.x).toBeLessThan(4);
  });

  it('non-zero stick input clears a path; releasing the stick preserves a path', () => {
    const world = flatWorld();
    const player = playerAt();
    player.setPath([[4, 1, 3], [5, 1, 3]]);
    player.setStick(0, 0);
    player.update(world, 1 / 3.5);
    expect(player.pos.x).toBeCloseTo(4.5);
    player.setStick(0, 1);
    player.update(world, 1 / 3.5);
    expect(player.pos.z).toBeCloseTo(4.5);
    player.setStick(0, 0);
    player.update(world, 1);
    expect(player.pos.x).toBeCloseTo(4.5);
  });

  it('null and empty paths stop path movement', () => {
    const player = playerAt();
    for (const path of [null, []]) {
      player.setPath([[4, 1, 3]]);
      player.setPath(path);
      player.update(flatWorld(), 1);
      expect(player.pos.x).toBe(3.5);
    }
  });

  it('stops if the next path cell becomes blocked or the path skips cells', () => {
    const world = flatWorld();
    const player = playerAt();
    player.setPath(findPath(world, player.feetCell(), [5, 1, 3]));
    world.set(4, 1, 3, BlockId.Stone);
    world.set(4, 2, 3, BlockId.Stone);
    player.update(world, 1);
    expect(player.feetCell()).toEqual([3, 1, 3]);
    player.setPath([[5, 1, 3]]);
    player.update(world, 1);
    expect(player.feetCell()).toEqual([3, 1, 3]);
  });

  it('copies the supplied path and ignores non-positive or invalid time', () => {
    const player = playerAt();
    const path: Cell[] = [[4, 1, 3]];
    player.setPath(path);
    path[0][0] = 20;
    for (const dt of [0, -1, NaN, Infinity]) player.update(flatWorld(), dt);
    expect(player.pos.x).toBe(3.5);
    player.update(flatWorld(), 1);
    expect(player.pos.x).toBe(4.5);
  });

  it('recovers after the block under the feet is removed', () => {
    const world = flatWorld();
    world.set(10, 1, 10, BlockId.Stone);
    const player = playerAt(10.5, 2, 10.5);
    world.set(10, 1, 10, BlockId.Air);
    player.update(world, 0.02);
    expect(player.pos.y).toBe(1);
    expect(isStandable(world, player.feetCell())).toBe(true);
    player.setStick(1, 0);
    const x = player.pos.x;
    player.update(world, 0.5);
    expect(player.pos.x).toBeGreaterThan(x);
  });

  it('recovers when a solid is placed in the feet cell', () => {
    const world = flatWorld();
    const player = playerAt(10.5, 1, 10.5);
    world.set(10, 1, 10, BlockId.Stone);
    player.update(world, 0.02);
    expect(isStandable(world, player.feetCell())).toBe(true);
    expect(player.pos.y).toBe(2);
    player.setStick(0, 1);
    const z = player.pos.z;
    player.update(world, 0.3);
    expect(player.pos.z).toBeGreaterThan(z);
  });
});
