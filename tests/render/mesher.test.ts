import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import { buildChunkGeometry } from '../../src/render/mesher';

const uvFor = () => [0, 0, 1, 1] as [number, number, number, number];

describe('mesher', () => {
  it('single block in empty world has 6 faces', () => {
    const w = new World(16, 16, 16);
    w.set(5, 5, 5, BlockId.Stone);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.positions.length).toBe(24 * 3);
    expect(g.indices.length).toBe(36);
    expect(g.transparent.indices.length).toBe(0);
  });

  it('new blocks mesh as opaque cubes', () => {
    for (const id of [BlockId.PathStone, BlockId.RoofTile, BlockId.DoorFrame, BlockId.Lamp]) {
      const w = new World(16, 16, 16);
      w.set(5, 5, 5, id);
      const g = buildChunkGeometry(w, 0, 0, uvFor);
      expect(g.indices.length / 3).toBe(12);
      expect(g.positions.length).toBe(24 * 3);
      expect(g.transparent.indices.length).toBe(0);
    }
  });

  it('two adjacent blocks hide the shared faces', () => {
    const w = new World(16, 16, 16);
    w.set(5, 5, 5, BlockId.Stone);
    w.set(6, 5, 5, BlockId.Dirt);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.indices.length / 6).toBe(10);
  });

  it('water goes into transparent geometry', () => {
    const w = new World(16, 16, 16);
    w.set(5, 5, 5, BlockId.Water);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.indices.length).toBe(0);
    expect(g.transparent.indices.length).toBe(36);
  });

  it('glass next to glass emits no shared face', () => {
    const w = new World(16, 16, 16);
    w.set(5, 5, 5, BlockId.Glass);
    w.set(6, 5, 5, BlockId.Glass);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.transparent.indices.length / 6).toBe(10);
  });

  it('no bottom face at y=0 and solid face next to water shows', () => {
    const w = new World(16, 16, 16);
    w.set(5, 0, 5, BlockId.Stone);
    w.set(6, 0, 5, BlockId.Water);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.indices.length / 6).toBe(5);
  });
});

describe('plants', () => {
  it('crossed plants mesh as 4 quads (16 vertices, 8 triangles) in the transparent mesh only', () => {
    for (const id of [BlockId.Carrot2, BlockId.Wheat3, BlockId.Potato0, BlockId.Sapling]) {
      const w = new World(16, 16, 16);
      w.set(5, 5, 5, id);
      const g = buildChunkGeometry(w, 0, 0, uvFor);
      expect(g.positions.length).toBe(0);
      expect(g.indices.length).toBe(0);
      expect(g.transparent.positions.length / 3).toBe(16);
      expect(g.transparent.indices.length / 3).toBe(8);
      // Both windings: for every plane there is a triangle seen from each side.
      const p = g.transparent.positions;
      let up = 0, down = 0;
      for (let t = 0; t < 8; t++) {
        const [a, b, c] = [0, 1, 2].map(k => g.transparent.indices[t * 3 + k]);
        const ux = p[b * 3] - p[a * 3], uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
        const nx = -uz * vy, nz = ux * vy; // horizontal part of u × v (u has no y)
        void vx; void vz;
        void nx; if (nz > 0) up++; else down++;
        expect(Math.hypot(nx, nz)).toBeGreaterThan(0);
      }
      expect(up).toBe(4);
      expect(down).toBe(4);
    }
  });

  it('cube faces next to a plant are still drawn, and a plant on soil does not hide the soil top', () => {
    const w = new World(16, 16, 16);
    w.set(5, 4, 5, BlockId.Farmland);
    w.set(5, 5, 5, BlockId.Wheat1);
    w.set(6, 5, 5, BlockId.Stone);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.indices.length / 6).toBe(6 + 6); // two cubes, none of their faces hidden by the plant
    expect(g.transparent.indices.length / 3).toBe(8);
  });

  it('farm cubes mesh as opaque cubes, apple leaves as transparent ones', () => {
    for (const id of [BlockId.Farmland, BlockId.Fence, BlockId.WoolWhite, BlockId.WoolRed, BlockId.WoolBlue, BlockId.WoolYellow]) {
      const w = new World(16, 16, 16);
      w.set(5, 5, 5, id);
      const g = buildChunkGeometry(w, 0, 0, uvFor);
      expect(g.indices.length / 3).toBe(12);
      expect(g.transparent.indices.length).toBe(0);
    }
    const w = new World(16, 16, 16);
    w.set(5, 5, 5, BlockId.AppleLeaves);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.indices.length).toBe(0);
    expect(g.transparent.indices.length / 3).toBe(12);
  });
});
