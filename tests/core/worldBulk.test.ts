import { describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';

describe('World bulk mode and the raw buffer', () => {
  test('bulk set records no edits, calls no listeners and leaves the world clean', () => {
    const w = new World(8, 6, 8);
    const listener = vi.fn();
    w.onChange(listener);
    w.beginBulk();
    w.set(1, 2, 3, BlockId.Stone);
    w.set(7, 5, 7, BlockId.Planks);
    w.set(9, 0, 0, BlockId.Planks); // out of bounds: still ignored
    w.endBulk();
    expect(w.get(1, 2, 3)).toBe(BlockId.Stone);
    expect(w.get(7, 5, 7)).toBe(BlockId.Planks);
    expect(w.edits()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(w.isDirty()).toBe(false);
  });

  test('normal set after endBulk records edits again', () => {
    const w = new World(4, 4, 4);
    const listener = vi.fn();
    w.onChange(listener);
    w.beginBulk();
    w.set(0, 0, 0, BlockId.Stone);
    w.endBulk();
    w.set(1, 1, 1, BlockId.Glass);
    expect(w.edits()).toEqual([[1, 1, 1, BlockId.Glass]]);
    expect(listener).toHaveBeenCalledWith(1, 1, 1);
    expect(w.isDirty()).toBe(true);
  });

  test('beginBulk twice then endBulk once stays bulk until the second endBulk', () => {
    const w = new World(4, 4, 4);
    w.beginBulk();
    w.beginBulk();
    w.endBulk();
    w.set(0, 0, 0, BlockId.Stone);
    expect(w.edits()).toEqual([]);
    w.endBulk();
    w.set(1, 0, 0, BlockId.Stone);
    expect(w.edits()).toEqual([[1, 0, 0, BlockId.Stone]]);
    // An unmatched endBulk never makes the count negative.
    w.endBulk();
    w.set(2, 0, 0, BlockId.Stone);
    expect(w.edits()).toHaveLength(2);
  });

  test('fromBuffer takes the buffer and rejects one of the wrong length', () => {
    const cells = new Uint8Array(4 * 3 * 2);
    cells[1 + 4 * (1 + 2 * 2)] = BlockId.Bricks; // x 1, y 2, z 1
    const w = World.fromBuffer(4, 3, 2, cells);
    expect([w.sizeX, w.sizeY, w.sizeZ]).toEqual([4, 3, 2]);
    expect(w.get(1, 2, 1)).toBe(BlockId.Bricks);
    expect(w.buffer).toBe(cells);
    expect(w.edits()).toEqual([]);
    expect(w.isDirty()).toBe(false);
    expect(() => World.fromBuffer(4, 3, 2, new Uint8Array(23))).toThrow();
    expect(() => World.fromBuffer(4, 3, 2, new Uint8Array(25))).toThrow();
  });

  test('fillLayer fills exactly one layer, without edits', () => {
    const w = new World(5, 4, 3);
    w.fillLayer(2, BlockId.Stone);
    for (let y = 0; y < 4; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 5; x++) {
      expect(w.get(x, y, z)).toBe(y === 2 ? BlockId.Stone : BlockId.Air);
    }
    expect(w.edits()).toEqual([]);
    w.fillLayer(-1, BlockId.Stone);
    w.fillLayer(4, BlockId.Stone);
    w.fillLayer(1.5, BlockId.Stone);
    expect(w.buffer.filter(id => id !== 0).length).toBe(15);
  });

  test('get and index are unchanged for in-bounds cells', () => {
    const w = new World(6, 5, 7);
    w.set(5, 4, 6, BlockId.Lamp);
    expect(w.buffer[5 + 6 * (6 + 7 * 4)]).toBe(BlockId.Lamp);
    expect(w.get(5, 4, 6)).toBe(BlockId.Lamp);
    expect(w.get(-1, 0, 0)).toBe(BlockId.Air);
    expect(w.get(0, -1, 0)).toBe(BlockId.Bedrock);
  });
});
