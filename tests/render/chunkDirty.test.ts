import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { cropBlock } from '../../src/core/crops';
import { Farm } from '../../src/game/farm';
import { DirtyChunks } from '../../src/render/chunkDirty';
import { CHUNK_SIZE } from '../../src/render/mesher';

const S = CHUNK_SIZE;
const sizes = { x: 96, z: 96 };

describe('DirtyChunks', () => {
  it('many cells in one chunk are one rebuild', () => {
    const d = new DirtyChunks(sizes.x, sizes.z);
    for (let i = 0; i < 50; i++) d.mark(3 + (i % 5), 4);
    expect(d.size).toBe(1);
  });
  it('a cell on a chunk edge also marks the neighbour; corners mark up to four', () => {
    const d = new DirtyChunks(sizes.x, sizes.z);
    d.mark(S, 5);
    expect(d.size).toBe(2);
    const e = new DirtyChunks(sizes.x, sizes.z);
    e.mark(S, S);
    expect(e.size).toBe(4);
    const f = new DirtyChunks(sizes.x, sizes.z);
    f.mark(0, 0); // world edge: no chunk -1
    expect(f.size).toBe(1);
  });
  it('take returns the nearest first, at most the budget, and the rest next time', () => {
    const d = new DirtyChunks(sizes.x, sizes.z);
    d.mark(85, 85); d.mark(5, 5); d.mark(40, 40); d.mark(70, 5);
    expect(d.take(2, 0, 0)).toEqual([[0, 0], [2, 2]]);
    expect(d.size).toBe(2);
    expect(d.take(2, 0, 0)).toEqual([[4, 0], [5, 5]]);
  });
  it('take(Infinity) drains everything exactly once', () => {
    const d = new DirtyChunks(sizes.x, sizes.z);
    d.mark(1, 1); d.mark(60, 60);
    expect(d.take(Infinity, 0, 0)).toHaveLength(2);
    expect(d.take(Infinity, 0, 0)).toHaveLength(0);
  });

  it('growing an apple tree, picking apples and a whole-field catch-up touch few distinct chunks', () => {
    const { world, village } = generateWorld(2026);
    const inv = new Inventory();
    inv.add(ItemId.AppleSapling, 1);
    const farm = new Farm(world, inv);
    const d = new DirtyChunks(world.sizeX, world.sizeZ);
    let sets = 0;
    world.onChange((x, _y, z) => { sets++; d.mark(x, z); });
    const b = village.farm.beds[0];
    const cell: [number, number, number] = [b.x0 + 2, world.topSolidY(b.x0 + 2, b.z0) + 1, b.z0];
    expect(farm.plant(cell, ItemId.AppleSapling, [])).toBe(true);
    for (let i = 0; i < 3; i++) {
      sets = 0; d.take(Infinity, 0, 0);
      farm.help(cell);
      console.log(`tree help ${i + 1}: ${sets} block sets -> ${d.size} chunk rebuilds`);
      expect(d.size, `help ${i + 1} (${sets} sets)`).toBeLessThanOrEqual(2);
    }
    // a whole field: 100 crops ripening one per frame touch only as many chunks as the field covers
    const w2 = generateWorld(2026).world;
    const f2 = new Farm(w2, new Inventory());
    const recs: number[][] = [];
    for (let x = 4; x < 36; x++) for (let z = 4; z < 10; z++) { const y = w2.topSolidY(x, z) + 1; w2.set(x, y, z, cropBlock('wheat', 0)); recs.push([x, y, z, 0]); }
    f2.restore(recs, []);
    const d2 = new DirtyChunks(w2.sizeX, w2.sizeZ);
    w2.onChange((x, _y, z) => d2.mark(x, z));
    f2.advance(3600_000);
    for (let i = 0; i < 300; i++) f2.update(1 / 30);
    expect(d2.size).toBeLessThanOrEqual(12);
    void BlockId; void World;
  });
});
