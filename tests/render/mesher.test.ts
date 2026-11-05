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
