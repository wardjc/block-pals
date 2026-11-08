import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { findPath, isStandable, smoothPath, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { easeHeading, Player } from '../../src/game/player';

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

  it('stops when a blocked cell lies between waypoints', () => {
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


describe('natural walking', () => {
  it('player walks a straight line across open ground (max deviation < 0.15 blocks)', () => {
    const world = flatWorld();
    const player = playerAt();
    const start = { ...player.pos };
    const goal: Cell = [15, 1, 8];
    player.setPath(smoothPath(world, findPath(world, player.feetCell(), goal)!, player.feetCell()));
    let deviation = 0;
    for (let i = 0; i < 300; i++) {
      player.update(world, 1 / 60);
      deviation = Math.max(deviation, Math.abs((player.pos.x - start.x) * 5 - (player.pos.z - start.z) * 12) / 13);
      expect(isStandable(world, player.feetCell())).toBe(true);
    }
    expect(deviation).toBeLessThan(0.15);
    expect(player.pos.x).toBeCloseTo(15.5);
    expect(player.pos.z).toBeCloseTo(8.5);
  });

  it('heading eases and takes the shortest way round the +-pi wrap', () => {
    expect(easeHeading(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1);
    const angle = easeHeading(Math.PI - 0.1, -Math.PI + 0.1, 0.05);
    expect(Math.atan2(Math.sin(angle - (Math.PI - 0.1)), Math.cos(angle - (Math.PI - 0.1)))).toBeCloseTo(0.05);
    const reverse = easeHeading(-Math.PI + 0.1, Math.PI - 0.1, 0.05);
    expect(Math.atan2(Math.sin(reverse + Math.PI - 0.1), Math.cos(reverse + Math.PI - 0.1))).toBeCloseTo(-0.05);
    expect(easeHeading(0, 0.02, 0.1)).toBeCloseTo(0.02);
    for (const stick of [false, true]) {
      const player = playerAt();
      if (stick) player.setStick(1, 0);
      else player.setPath([[10, 1, 3]]);
      player.update(flatWorld(), 0.02);
      expect(player.heading).toBeCloseTo(0.2);
      expect(player.pos.x).toBeCloseTo(3.57);
    }
  });

  it('sweeps a long waypoint through a doorway without entering its walls', () => {
    const world = flatWorld();
    for (let z = 0; z < 48; z++) if (z !== 5) {
      for (const y of [1, 2, 3]) world.set(8, y, z, BlockId.Stone);
    }
    const player = playerAt(3.5, 1, 5.5);
    player.setPath([[12, 1, 5]]);
    player.update(world, 3);
    expect(player.pos).toEqual({ x: 12.5, y: 1, z: 5.5 });
  });
});


it('reaches smoothed waypoints across generated terrain without getting stuck', () => {
  let routes = 0;
  for (const seed of [17, 83, 2026]) {
    const { world, spawn } = generateWorld(seed);
    const start: Cell = [Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)];
    for (const [dx, dz] of [[7, 3], [-6, 5], [5, -7], [-7, -4]]) {
      const x = start[0] + dx;
      const z = start[2] + dz;
      const end: Cell = [x, world.topSolidY(x, z) + 1, z];
      const path = findPath(world, start, end);
      if (!path) continue;
      routes++;
      const player = new Player(spawn);
      player.setPath(smoothPath(world, path, start));
      for (let tick = 0; tick < 600; tick++) {
        const before = { ...player.pos };
        player.update(world, 1 / 30);
        expect(isStandable(world, player.feetCell())).toBe(true);
        expect(Math.abs(player.pos.y - before.y)).toBeLessThanOrEqual(1);
        expect(Math.hypot(player.pos.x - before.x, player.pos.z - before.z)).toBeLessThanOrEqual(3.5 / 30 + 1e-8);
      }
      expect(player.feetCell()).toEqual(end);
    }
  }
  expect(routes).toBeGreaterThanOrEqual(6);
});

describe('walking never stops dead', () => {
  it('reaches the end from random sub-cell starts over seeded worlds', () => {
    let seed = 4242;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let routes = 0;
    for (let trial = 0; trial < 1500; trial++) {
      const world = flatWorld();
      const sx = 2 + random() * 3;
      const sz = 2 + random() * 3;
      for (let x = 1; x < 12; x++) for (let z = 1; z < 12; z++) {
        if (random() >= 0.2 || (x === Math.floor(sx) && z === Math.floor(sz)) || (x === 10 && z === 10)) continue;
        for (const y of [1, 2]) world.set(x, y, z, BlockId.Stone);
      }
      const player = playerAt(sx, 1, sz);
      const start = player.feetCell();
      const end: Cell = [10, 1, 10];
      const wall = (c: Cell) => c[0] >= 1 && c[0] <= 46 && c[2] >= 1 && c[2] <= 46; // the Game's soft wall
      const route = findPath(world, start, end, 4000, wall);
      if (!route) continue;
      routes++;
      player.setPath(smoothPath(world, route, start, wall));
      for (let i = 0; i < 900; i++) player.update(world, 1 / 30);
      expect(player.feetCell(), `trial ${trial} from ${sx},${sz}`).toEqual(end);
    }
    expect(routes).toBeGreaterThan(500);
  }, 60_000);
});
