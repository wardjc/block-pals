import { describe, expect, test, vi } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';

describe('blocks', () => {
  test.each([
    [BlockId.Air, 0, 'air', false, false, true],
    [BlockId.Grass, 1, 'grass', true, true, false],
    [BlockId.Dirt, 2, 'dirt', true, true, false],
    [BlockId.Stone, 3, 'stone', true, true, false],
    [BlockId.Wood, 4, 'wood', true, true, false],
    [BlockId.Leaves, 5, 'leaves', true, true, true],
    [BlockId.Sand, 6, 'sand', true, true, false],
    [BlockId.Water, 7, 'water', false, false, true],
    [BlockId.Planks, 8, 'planks', true, true, false],
    [BlockId.Glass, 9, 'glass', true, true, true],
    [BlockId.Bricks, 10, 'bricks', true, true, false],
    [BlockId.Bedrock, 11, 'bedrock', true, false, false],
  ] as const)('defines block %s (%s: %s)', (id, value, name, solid, collectable, transparent) => {
    expect(id).toBe(value);
    expect(BLOCKS[id]).toEqual({ id, name, solid, collectable, transparent, icon: name });
  });
});

describe('block ids', () => {
  test('block ids are stable', () => {
    expect(BlockId.Bedrock).toBe(11);
    expect(BlockId.PathStone).toBe(12);
    expect(BlockId.RoofTile).toBe(13);
    expect(BlockId.DoorFrame).toBe(14);
    expect(BlockId.Lamp).toBe(15);
    const v1 = ['Air', 'Grass', 'Dirt', 'Stone', 'Wood', 'Leaves', 'Sand', 'Water', 'Planks', 'Glass', 'Bricks', 'Bedrock'];
    v1.forEach((name, id) => expect((BlockId as unknown as Record<string, number>)[name]).toBe(id));
    for (const id of [BlockId.PathStone, BlockId.RoofTile, BlockId.DoorFrame, BlockId.Lamp]) {
      expect(BLOCKS[id]).toMatchObject({ id, solid: true, collectable: true, transparent: false });
    }
    expect([12, 13, 14, 15].map(id => BLOCKS[id as BlockId].name)).toEqual(['path', 'roof', 'frame', 'lamp']);
  });
});

describe('World', () => {
  test('get returns Air for a new world', () => {
    const world = new World(2, 3, 4);

    expect([world.sizeX, world.sizeY, world.sizeZ]).toEqual([2, 3, 4]);
    for (let y = 0; y < world.sizeY; y++) {
      for (let z = 0; z < world.sizeZ; z++) {
        for (let x = 0; x < world.sizeX; x++) {
          expect(world.get(x, y, z)).toBe(BlockId.Air);
        }
      }
    }
    expect(world.edits()).toEqual([]);
    expect(world.isDirty()).toBe(false);
  });

  test('set then get round-trips across every cell in a non-cubic world', () => {
    const world = new World(2, 3, 4);
    const cells: Array<[number, number, number, BlockId]> = [];
    for (let y = 0; y < world.sizeY; y++) {
      for (let z = 0; z < world.sizeZ; z++) {
        for (let x = 0; x < world.sizeX; x++) {
          const id = (1 + (x + 3 * z + 5 * y) % 11) as BlockId;
          world.set(x, y, z, id);
          cells.push([x, y, z, id]);
        }
      }
    }

    for (const [x, y, z, id] of cells) {
      expect(world.get(x, y, z)).toBe(id);
    }
    expect(world.edits()).toEqual(expect.arrayContaining(cells));
    expect(world.edits()).toHaveLength(cells.length);
  });

  test.each([
    [-1, 0, 0, BlockId.Air],
    [2, 0, 0, BlockId.Air],
    [0, 3, 0, BlockId.Air],
    [0, 0, -1, BlockId.Air],
    [0, 0, 4, BlockId.Air],
    [0, -1, 0, BlockId.Bedrock],
    [-1, -1, -1, BlockId.Bedrock],
    [2, -1, 4, BlockId.Bedrock],
    [2, 3, 4, BlockId.Air],
  ])('out-of-bounds set at (%s, %s, %s) is a no-op and get returns %s', (x, y, z, expected) => {
    const world = new World(2, 3, 4);
    const listener = vi.fn();
    world.onChange(listener);

    expect(world.inBounds(x, y, z)).toBe(false);
    world.set(x, y, z, BlockId.Stone);
    expect(world.get(x, y, z)).toBe(expected);
    expect(world.edits()).toEqual([]);
    expect(world.isDirty()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    for (let cy = 0; cy < world.sizeY; cy++) {
      for (let cz = 0; cz < world.sizeZ; cz++) {
        for (let cx = 0; cx < world.sizeX; cx++) {
          expect(world.get(cx, cy, cz)).toBe(BlockId.Air);
        }
      }
    }
  });

  test('inBounds includes boundary cells and rejects non-integer coordinates', () => {
    const world = new World(2, 3, 4);
    expect(world.inBounds(0, 0, 0)).toBe(true);
    expect(world.inBounds(1, 2, 3)).toBe(true);
    for (const value of [0.5, NaN, Infinity, -Infinity]) {
      expect(world.inBounds(value, 0, 0)).toBe(false);
      expect(world.inBounds(0, value, 0)).toBe(false);
      expect(world.inBounds(0, 0, value)).toBe(false);
    }
  });

  test('topSolidY ignores water and air and returns -1 for empty or outside columns', () => {
    const world = new World(2, 5, 3);
    expect(world.topSolidY(1, 2)).toBe(-1);
    world.set(1, 4, 2, BlockId.Water);
    expect(world.topSolidY(1, 2)).toBe(-1);
    world.set(1, 1, 2, BlockId.Stone);
    world.set(1, 3, 2, BlockId.Leaves);
    expect(world.topSolidY(1, 2)).toBe(3);
    world.set(1, 3, 2, BlockId.Air);
    expect(world.topSolidY(1, 2)).toBe(1);
    world.set(1, 4, 2, BlockId.Glass);
    expect(world.topSolidY(1, 2)).toBe(4);
    expect(world.topSolidY(0, 2)).toBe(-1);
    for (const [x, z] of [[-1, 0], [2, 0], [0, -1], [0, 3]]) {
      expect(world.topSolidY(x, z)).toBe(-1);
    }
  });

  test('edits records changed cells; clearEdits clears them; markClean clears dirty only', () => {
    const world = new World(2, 3, 4);
    world.set(1, 2, 3, BlockId.Stone);
    expect(world.isDirty()).toBe(true);
    expect(world.edits()).toEqual([[1, 2, 3, BlockId.Stone]]);

    world.markClean();
    expect(world.isDirty()).toBe(false);
    expect(world.edits()).toEqual([[1, 2, 3, BlockId.Stone]]);

    world.set(0, 0, 0, BlockId.Grass);
    expect(world.isDirty()).toBe(true);
    expect(world.edits()).toHaveLength(2);
    world.clearEdits();
    expect(world.edits()).toEqual([]);
    expect(world.isDirty()).toBe(true);
    expect(world.get(1, 2, 3)).toBe(BlockId.Stone);
    expect(world.get(0, 0, 0)).toBe(BlockId.Grass);

    world.markClean();
    world.set(1, 2, 3, BlockId.Dirt);
    expect(world.isDirty()).toBe(true);
    expect(world.edits()).toEqual([[1, 2, 3, BlockId.Dirt]]);
  });

  test('edits deduplicates cells with the latest value, preserving removals across saves', () => {
    const world = new World(2, 3, 4);
    world.set(1, 2, 3, BlockId.Stone);
    world.clearEdits();
    world.markClean();

    world.set(1, 2, 3, BlockId.Dirt);
    world.markClean();
    world.set(1, 2, 3, BlockId.Air);
    world.set(0, 0, 0, BlockId.Wood);
    world.set(0, 0, 0, BlockId.Planks);
    world.markClean();

    expect(world.edits()).toHaveLength(2);
    expect(world.edits()).toEqual(expect.arrayContaining([
      [1, 2, 3, BlockId.Air],
      [0, 0, 0, BlockId.Planks],
    ]));
  });

  test('edits returns a snapshot that cannot mutate the recorded edits', () => {
    const world = new World(2, 3, 4);
    world.set(1, 2, 3, BlockId.Stone);
    const edits = world.edits();
    edits[0][3] = BlockId.Air;
    edits.length = 0;
    expect(world.edits()).toEqual([[1, 2, 3, BlockId.Stone]]);
  });

  test('onChange fires with coordinates after the changed state is available', () => {
    const world = new World(2, 3, 4);
    const first = vi.fn((x: number, y: number, z: number) => {
      expect(world.get(x, y, z)).toBe(BlockId.Stone);
      expect(world.isDirty()).toBe(true);
      expect(world.edits()).toEqual([[x, y, z, BlockId.Stone]]);
    });
    const second = vi.fn();
    world.onChange(first);
    world.onChange(second);
    world.set(1, 2, 3, BlockId.Stone);
    world.markClean();
    world.clearEdits();
    for (const listener of [first, second]) {
      expect(listener).toHaveBeenCalledExactlyOnceWith(1, 2, 3);
    }
  });

  test('setting an unchanged block does not notify, record an edit or mark dirty', () => {
    const world = new World(2, 3, 4);
    const listener = vi.fn();
    world.onChange(listener);
    world.set(1, 2, 3, BlockId.Air);
    expect(world.edits()).toEqual([]);
    expect(world.isDirty()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    world.set(1, 2, 3, BlockId.Stone);
    world.clearEdits();
    world.markClean();
    listener.mockClear();
    world.set(1, 2, 3, BlockId.Stone);
    expect(world.edits()).toEqual([]);
    expect(world.isDirty()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});
