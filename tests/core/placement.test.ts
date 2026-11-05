import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import { canCollect, canPlace, withinReach } from '../../src/core/placement';

type Cell = [number, number, number];

describe('placement', () => {
  test('refuses placing into occupied cell', () => {
    const world = new World(5, 5, 5);
    const occupied: Cell[] = [[2, 1, 2], [2, 2, 2], [3, 1, 2]];
    for (const cell of occupied) {
      world.set(cell[0], cell[1], cell[2] - 1, BlockId.Stone);
      expect(canPlace(world, cell, [])).toBe(true);
      expect(canPlace(world, cell, occupied)).toBe(false);
    }
    expect(canPlace(world, [2, 1, 1], [])).toBe(false);
  });

  test('refuses placing in mid-air with no neighbour', () => {
    const world = new World(5, 5, 5);
    expect(canPlace(world, [2, 2, 2], [])).toBe(false);
    world.set(1, 1, 1, BlockId.Stone);
    world.set(1, 1, 2, BlockId.Stone);
    world.set(2, 1, 2, BlockId.Water);
    expect(canPlace(world, [2, 2, 2], [])).toBe(false);
  });

  test.each<Cell>([[1, 2, 2], [3, 2, 2], [2, 1, 2], [2, 3, 2], [2, 2, 1], [2, 2, 3]])(
    'accepts a solid face neighbour at (%s, %s, %s)', (x, y, z) => {
      const world = new World(5, 5, 5);
      world.set(x, y, z, BlockId.Glass);
      expect(canPlace(world, [2, 2, 2], [])).toBe(true);
      world.set(2, 2, 2, BlockId.Water);
      expect(canPlace(world, [2, 2, 2], [[0, 0, 0]])).toBe(true);
    },
  );

  test.each<Cell>([[-1, 1, 1], [5, 1, 1], [1, -1, 1], [1, 5, 1], [1, 1, -1], [1, 1, 5], [1.5, 1, 1]])(
    'refuses placing outside integer bounds at (%s, %s, %s)', (x, y, z) => {
      const world = new World(5, 5, 5);
      for (let cy = 0; cy < 5; cy++) {
        for (let cz = 0; cz < 5; cz++) {
          for (let cx = 0; cx < 5; cx++) world.set(cx, cy, cz, BlockId.Stone);
        }
      }
      expect(canPlace(world, [x, y, z], [])).toBe(false);
    },
  );

  test('bedrock and water cannot be collected', () => {
    const world = new World(3, 3, 3);
    for (const id of [BlockId.Air, BlockId.Bedrock, BlockId.Water]) {
      world.set(1, 1, 1, id);
      expect(canCollect(world, [1, 1, 1])).toBe(false);
    }
    expect(canCollect(world, [1, -1, 1])).toBe(false);
    expect(canCollect(world, [3, 1, 1])).toBe(false);
  });

  test('allows collecting every collectable block without changing the world', () => {
    const world = new World(3, 3, 3);
    for (const block of Object.values(BLOCKS).filter((block) => block.collectable)) {
      world.set(1, 1, 1, block.id);
      world.markClean();
      expect(canCollect(world, [1, 1, 1])).toBe(true);
      expect(world.get(1, 1, 1)).toBe(block.id);
      expect(world.isDirty()).toBe(false);
      expect(canPlace(world, [1, 1, 1], [])).toBe(false);
    }
  });

  test('withinReach uses Chebyshev distance 3', () => {
    const from: Cell = [5, 5, 5];
    expect(withinReach(from, from)).toBe(true);
    expect(withinReach(from, [8, 8, 8])).toBe(true);
    expect(withinReach(from, [2, 2, 2])).toBe(true);
    for (const cell of [[9, 5, 5], [5, 9, 5], [5, 5, 9], [1, 5, 5], [5, 1, 5], [5, 5, 1]] as Cell[]) {
      expect(withinReach(from, cell)).toBe(false);
    }
    expect(withinReach(from, [7, 7, 7], 2)).toBe(true);
    expect(withinReach(from, [8, 5, 5], 2)).toBe(false);
    expect(withinReach(from, from, 0)).toBe(true);
    expect(withinReach(from, [6, 5, 5], 0)).toBe(false);
  });
});
