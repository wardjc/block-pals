import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { cropBlock } from '../../src/core/crops';
import { Farm } from '../../src/game/farm';
import { DirtyChunks, DirtySections, sectionKey } from '../../src/render/chunkDirty';
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

describe('DirtySections (16 x 16 x 16)', () => {
  const W = { x: 192, y: 68, z: 192 };
  it('a dig in the middle of a section marks one; at a section border it marks both', () => {
    const d = new DirtySections(W.x, W.y, W.z);
    d.mark(20, 40, 20);
    expect(d.size).toBe(1);
    expect(d.has(1, 2, 1)).toBe(true);
    const y = new DirtySections(W.x, W.y, W.z);
    y.mark(20, 48, 20); // bottom layer of section 3: section 2 below shares the border
    expect(y.size).toBe(2);
    expect(y.has(1, 3, 1) && y.has(1, 2, 1)).toBe(true);
    const x = new DirtySections(W.x, W.y, W.z);
    x.mark(31, 40, 20);
    expect(x.size).toBe(2);
    expect(x.has(2, 2, 1)).toBe(true);
  });
  it('a corner cell marks at most 4 sections, and never one outside the world', () => {
    const d = new DirtySections(W.x, W.y, W.z);
    d.mark(16, 32, 16);
    expect(d.size).toBe(4);
    const e = new DirtySections(W.x, W.y, W.z);
    e.mark(0, 0, 0);
    expect(e.size).toBe(1);
    const top = new DirtySections(W.x, W.y, W.z);
    top.mark(191, 67, 191); // section 4 holds y 64..67; nothing above
    expect(top.size).toBe(1);
  });
  it('many changes in one frame mark each section once; take is nearest first and drains once', () => {
    const d = new DirtySections(W.x, W.y, W.z);
    for (let i = 0; i < 200; i++) d.mark(3 + (i % 10), 50 + (i % 5), 4 + (i % 7));
    expect(d.size).toBe(1);
    d.mark(100, 50, 100); d.mark(150, 20, 150);
    expect(d.take(2, 0, 50, 0).map(s => s.join(','))).toEqual(['0,3,0', '6,3,6']);
    expect(d.take(Infinity, 0, 0, 0)).toHaveLength(1);
    expect(d.take(Infinity, 0, 0, 0)).toHaveLength(0);
  });
  it('the apple tree, the picking and a whole-field catch-up mark few distinct sections', () => {
    const { world, village } = generateWorld(2026);
    const inv = new Inventory();
    inv.add(ItemId.AppleSapling, 1);
    const farm = new Farm(world, inv);
    const d = new DirtySections(world.sizeX, world.sizeY, world.sizeZ);
    world.onChange((x, y, z) => d.mark(x, y, z));
    const b = village.farm.beds[0];
    const cell: [number, number, number] = [b.x0 + 2, world.topSolidY(b.x0 + 2, b.z0) + 1, b.z0];
    expect(farm.plant(cell, ItemId.AppleSapling, [])).toBe(true);
    for (let i = 0; i < 3; i++) {
      d.take(Infinity, 0, 0, 0);
      farm.help(cell);
      expect(d.size, `help ${i + 1}`).toBeLessThanOrEqual(4);
    }
  });
  it('sectionKey is "cx,sy,cz"', () => {
    expect(sectionKey(3, 4, 5)).toBe('3,4,5');
  });
});
