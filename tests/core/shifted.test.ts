import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ORIGIN, V2_WORLD, WORLD } from '../../src/core/bounds';
import { ShiftedWorld } from '../../src/core/shifted';
import { World } from '../../src/core/world';
import { decodeRle, loadWorldFixture } from '../helpers/fixtures';

const big = (): World => new World(WORLD.x, WORLD.y, WORLD.z);
const layer = (w: World, y: number, id: BlockId): void => {
  for (let z = 0; z < w.sizeZ; z++) for (let x = 0; x < w.sizeX; x++) w.set(x, y, z, id);
};

describe('ShiftedWorld: the old 96 x 20 x 96 world as a window of the big one', () => {
  test('sizeX/Y/Z are 96/20/96', () => {
    const view = new ShiftedWorld(big());
    expect([view.sizeX, view.sizeY, view.sizeZ]).toEqual([96, 20, 96]);
  });

  test('a write through the view lands at +ORIGIN in the base', () => {
    const base = big();
    const view = new ShiftedWorld(base);
    view.set(0, 0, 0, BlockId.Planks);
    view.set(95, 19, 95, BlockId.Bricks);
    view.set(24, 8, 30, BlockId.Glass);
    expect(base.get(48, 48, 48)).toBe(BlockId.Planks);
    expect(base.get(143, 67, 143)).toBe(BlockId.Bricks);
    expect(base.get(72, 56, 78)).toBe(BlockId.Glass);
    expect(view.get(24, 8, 30)).toBe(BlockId.Glass);
    expect(base.edits()).toHaveLength(3);
  });

  test('reads outside the old box are Air, below are Bedrock; writes outside do nothing', () => {
    const base = big();
    layer(base, 47, BlockId.Stone);
    for (let y = 0; y < WORLD.y; y++) base.set(47, y, 60, BlockId.Stone);
    const view = new ShiftedWorld(base);
    expect(view.get(-1, 5, 10)).toBe(BlockId.Air); // base x 47 is Stone, but the view ends at 0
    expect(view.get(5, -1, 5)).toBe(BlockId.Bedrock); // base y 47 is Stone
    expect(view.get(96, 5, 5)).toBe(BlockId.Air);
    expect(view.get(5, 20, 5)).toBe(BlockId.Air);
    expect(view.get(1.5, 2, 2)).toBe(BlockId.Air);
    base.clearEdits();
    view.set(-1, 0, 0, BlockId.Planks);
    view.set(96, 0, 0, BlockId.Planks);
    view.set(0, 20, 0, BlockId.Planks);
    view.set(0, -1, 0, BlockId.Planks);
    expect(base.edits()).toEqual([]);
    expect(view.inBounds(95, 19, 95)).toBe(true);
    expect(view.inBounds(96, 0, 0)).toBe(false);
  });

  test('topSolidY matches a plain 96 world on the same data', () => {
    const f = loadWorldFixture();
    const cells = decodeRle(f.rle);
    const plain = new World(V2_WORLD.x, V2_WORLD.y, V2_WORLD.z);
    const base = big();
    // A stone floor under the window and a tall pillar beside it must not leak into the view.
    layer(base, ORIGIN.y - 1, BlockId.Stone);
    for (let y = 0; y < WORLD.y; y++) base.set(ORIGIN.x - 1, y, ORIGIN.z + 3, BlockId.Stone);
    const view = new ShiftedWorld(base);
    for (let y = 0; y < 20; y++) for (let z = 0; z < 96; z++) for (let x = 0; x < 96; x++) {
      view.set(x, y, z, cells[x + 96 * (z + 96 * y)]);
      plain.set(x, y, z, cells[x + 96 * (z + 96 * y)]);
    }
    for (let z = -1; z <= 96; z++) for (let x = -1; x <= 96; x++) {
      expect(view.topSolidY(x, z)).toBe(plain.topSolidY(x, z));
    }
  });
});
