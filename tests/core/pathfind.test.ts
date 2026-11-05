import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { findPath, isStandable, nearestStandable, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';

function flatWorld(): World {
  const world = new World(9, 8, 9);
  for (let x = 0; x < 9; x++) {
    for (let z = 0; z < 9; z++) world.set(x, 0, z, BlockId.Grass);
  }
  return world;
}

describe('isStandable', () => {
  it('requires solid support, clear feet and head, and dry feet', () => {
    const world = flatWorld();
    expect(isStandable(world, [3, 1, 3])).toBe(true);
    for (const [y, id] of [[0, BlockId.Water], [1, BlockId.Water], [1, BlockId.Stone], [2, BlockId.Glass]] as const) {
      world.set(3, y, 3, id);
      expect(isStandable(world, [3, 1, 3])).toBe(false);
      world.set(3, y, 3, y === 0 ? BlockId.Grass : BlockId.Air);
    }
    world.set(3, 2, 3, BlockId.Water);
    expect(isStandable(world, [3, 1, 3])).toBe(true);
    for (const cell of [[-1, 1, 3], [9, 1, 3], [3, 0, 3], [3.5, 1, 3], [3, 1, 9]] as Cell[]) {
      expect(isStandable(world, cell)).toBe(false);
    }
  });
});

describe('findPath', () => {
  it('finds a straight path on flat ground, excluding the start', () => {
    expect(findPath(flatWorld(), [2, 1, 3], [5, 1, 3])).toEqual([
      [3, 1, 3], [4, 1, 3], [5, 1, 3],
    ]);
  });

  it('climbs a 1-block step but not 2, and steps back down', () => {
    const world = flatWorld();
    world.set(4, 1, 3, BlockId.Stone);
    expect(findPath(world, [3, 1, 3], [4, 2, 3])).toEqual([[4, 2, 3]]);
    expect(findPath(world, [4, 2, 3], [3, 1, 3])).toEqual([[3, 1, 3]]);
    world.set(4, 2, 3, BlockId.Stone);
    expect(findPath(world, [3, 1, 3], [4, 3, 3])).toBeNull();
  });

  it('returns null when enclosed and never targets or crosses water', () => {
    const world = flatWorld();
    for (const [x, z] of [[2, 3], [4, 3], [3, 2], [3, 4]]) {
      world.set(x, 1, z, BlockId.Water);
    }
    expect(findPath(world, [3, 1, 3], [6, 1, 3])).toBeNull();
    expect(findPath(world, [1, 1, 3], [2, 1, 3])).toBeNull();
    expect(findPath(world, [2, 1, 3], [1, 1, 3])).toBeNull();
    const path = findPath(world, [1, 1, 3], [5, 1, 3]);
    expect(path).not.toBeNull();
    let previous: Cell = [1, 1, 3];
    for (const cell of path!) {
      expect(isStandable(world, cell)).toBe(true);
      expect(Math.abs(cell[0] - previous[0]) + Math.abs(cell[2] - previous[2])).toBe(1);
      expect(Math.abs(cell[1] - previous[1])).toBeLessThanOrEqual(1);
      previous = cell;
    }
    expect(previous).toEqual([5, 1, 3]);
  });

  it('respects maxNodes', () => {
    const world = flatWorld();
    expect(findPath(world, [1, 1, 1], [7, 1, 7], 2)).toBeNull();
    expect(findPath(world, [1, 1, 1], [7, 1, 7], 100)).toHaveLength(12);
    expect(findPath(world, [1, 1, 1], [2, 1, 1], 0)).toBeNull();
  });

  it('returns an empty path only for an already reached standable cell', () => {
    const world = flatWorld();
    expect(findPath(world, [1, 1, 1], [1, 1, 1])).toEqual([]);
    expect(findPath(world, [1, 2, 1], [1, 2, 1])).toBeNull();
  });

  it('cannot step through a ceiling in either direction', () => {
    const world = new World(2, 6, 1);
    world.set(0, 0, 0, BlockId.Grass);
    world.set(1, 1, 0, BlockId.Stone);
    world.set(0, 3, 0, BlockId.Stone);
    expect(isStandable(world, [0, 1, 0])).toBe(true);
    expect(isStandable(world, [1, 2, 0])).toBe(true);
    expect(findPath(world, [0, 1, 0], [1, 2, 0])).toBeNull();
    expect(findPath(world, [1, 2, 0], [0, 1, 0])).toBeNull();
  });
});

describe('nearestStandable', () => {
  it('returns the top of the requested column', () => {
    const world = flatWorld();
    world.set(3, 3, 3, BlockId.Stone);
    expect(nearestStandable(world, 3, 3)).toEqual([3, 4, 3]);
  });

  it('returns null for water, empty or out-of-bounds columns', () => {
    const world = flatWorld();
    world.set(3, 1, 3, BlockId.Water);
    world.set(4, 0, 3, BlockId.Air);
    expect(nearestStandable(world, 3, 3)).toBeNull();
    expect(nearestStandable(world, 4, 3)).toBeNull();
    expect(nearestStandable(world, -1, 3)).toBeNull();
    expect(nearestStandable(world, 9, 3)).toBeNull();
  });
});
