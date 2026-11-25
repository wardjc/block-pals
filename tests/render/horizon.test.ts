import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import {
  HORIZON_CELL, HORIZON_DROP, HorizonField, VERTS_PER_CELL, columnTop, fillCell, fillIndices, horizonColour, horizonHaze,
} from '../../src/render/horizon';

/** A flat 16 x 12 x 16 world: grass on top of y = 4. */
function flat(): World {
  const w = new World(16, 12, 16);
  w.beginBulk();
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) w.set(x, y, z, BlockId.Dirt);
    w.set(x, 4, z, BlockId.Grass);
  }
  w.endBulk();
  return w;
}

describe('horizon sampling', () => {
  it('columnTop finds the top face and block; water counts, a plant is skipped', () => {
    const w = flat();
    expect(columnTop(w, 3, 3)).toEqual({ top: 5, id: BlockId.Grass });
    w.set(3, 5, 3, BlockId.Wheat3);
    expect(columnTop(w, 3, 3)).toEqual({ top: 5, id: BlockId.Grass });
    w.set(4, 4, 4, BlockId.Water);
    expect(columnTop(w, 4, 4)).toEqual({ top: 5, id: BlockId.Water });
  });

  it('samples every cell in slices and says when it is ready', () => {
    const f = new HorizonField(flat());
    expect(f.cells).toBe(16);
    expect(f.ready).toBe(false);
    let steps = 0;
    while (!f.ready) {
      expect(f.step(5).length).toBeLessThanOrEqual(5);
      steps++;
    }
    expect(steps).toBe(4);
    expect(f.pending).toBe(0);
    expect(Array.from(f.heights)).toEqual(new Array(16).fill(5));
    expect(Array.from(f.colours.slice(0, 3))).toEqual(Array.from(horizonColour(BlockId.Grass)));
  });

  it('a cell takes its height from the tallest column and its colour from the columns near that height', () => {
    const w = flat();
    for (let y = 5; y < 11; y++) w.set(1, y, 1, BlockId.Stone); // a tower in cell 0
    const f = new HorizonField(w);
    f.step(100);
    expect(f.heights[0]).toBe(11);
    expect(Array.from(f.colours.slice(0, 3))).toEqual(Array.from(horizonColour(BlockId.Stone)));
    expect(f.heights[1]).toBe(5);
  });

  it('an edit re-samples only its cell, later, and reports it changed', () => {
    const w = flat();
    const f = new HorizonField(w);
    f.step(100);
    w.set(9, 5, 9, BlockId.Planks);
    f.markDirty(9, 9);
    f.markDirty(10, 10); // same cell: queued once
    expect(f.pending).toBe(1);
    expect(f.step(10)).toEqual([10]);
    expect(f.heights[10]).toBe(6);
    f.markDirty(0, 0);
    expect(f.step(10)).toEqual([]); // sampled again, nothing different
  });

  it('stops early when the time budget is spent', () => {
    const f = new HorizonField(flat());
    let t = 0;
    const out = f.step(16, 1, () => (t += 2));
    expect(out.length).toBeLessThanOrEqual(1);
    expect(f.pending).toBe(15);
  });
});

describe('horizon geometry', () => {
  it('a cell writes its top at height minus the drop, and a wall only toward a lower neighbour', () => {
    const w = flat();
    for (let y = 5; y < 9; y++) w.set(1, y, 1, BlockId.Stone);
    const f = new HorizonField(w);
    f.step(100);
    const pos = new Float32Array(f.cells * VERTS_PER_CELL * 3), col = new Float32Array(f.cells * VERTS_PER_CELL * 3);
    for (let i = 0; i < f.cells; i++) fillCell(f, i, pos, col);
    const top0 = 9 - HORIZON_DROP;
    expect(pos[1]).toBe(top0);
    // cell 0's +x wall (vertices 8..11) drops to the neighbour's top (5 - drop); its -x wall is collapsed.
    const wallBottom = (cell: number, q: number): number => pos[cell * VERTS_PER_CELL * 3 + (q * 4 + 2) * 3 + 1];
    expect(wallBottom(0, 2)).toBe(5 - HORIZON_DROP);
    expect(wallBottom(0, 1)).toBe(top0);
    // the lower neighbour has no wall toward the taller cell (collapsed onto its own top)
    expect(wallBottom(1, 1)).toBe(5 - HORIZON_DROP);
    expect(col[0]).toBeGreaterThan(0);
  });

  it('indices cover every vertex of every cell once, in range', () => {
    const idx = new Uint16Array(16 * 30);
    fillIndices(16, idx);
    expect(Math.max(...idx)).toBe(16 * VERTS_PER_CELL - 1);
    expect(new Set(idx).size).toBe(16 * VERTS_PER_CELL);
  });

  it('the 192 x 192 world fits 16-bit indices and well under 2 MB', () => {
    const cells = (192 / HORIZON_CELL) ** 2;
    expect(cells * VERTS_PER_CELL).toBeLessThan(65536);
    expect(cells * VERTS_PER_CELL * (3 + 3) * 4 + cells * 30 * 2).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('horizon haze', () => {
  it('is clear near, matches the detailed haze at the seam, grows with distance and stays under maxK', () => {
    expect(horizonHaze(10, 48, 96, 0.75, 0.92, 280)).toBe(0);
    expect(horizonHaze(96, 48, 96, 0.75, 0.92, 280)).toBeCloseTo(0.75, 6);
    let prev = 0;
    for (let d = 0; d <= 300; d += 5) {
      const k = horizonHaze(d, 48, 96, 0.75, 0.92, 280);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(k).toBeLessThanOrEqual(0.92 + 1e-9);
      prev = k;
    }
    expect(horizonHaze(280, 48, 96, 0.75, 0.92, 280)).toBeCloseTo(0.92, 6);
  });

  it('underground (haze 1) is pure haze', () => {
    expect(horizonHaze(120, 14, 36, 1, 0.92, 280)).toBe(1);
  });
});
