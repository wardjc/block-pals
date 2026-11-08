import { describe, expect, it } from 'vitest';
import { generateWorld } from '../../src/core/worldgen';
import { buildChunkGeometry, CHUNK_SIZE } from '../../src/render/mesher';

const uvFor = () => [0, 0, 1, 1] as [number, number, number, number];

describe('render budget for the 96×96 world', () => {
  const t0 = performance.now();
  const { world } = generateWorld(2026);
  const genMs = performance.now() - t0;
  const t1 = performance.now();
  const per: number[] = [];
  let transparentMeshes = 0;
  let meshes = 0;
  const cx = Math.ceil(world.sizeX / CHUNK_SIZE), cz = Math.ceil(world.sizeZ / CHUNK_SIZE);
  for (let z = 0; z < cz; z++) for (let x = 0; x < cx; x++) {
    const g = buildChunkGeometry(world, x, z, uvFor);
    const t = g.indices.length / 3, tt = g.transparent.indices.length / 3;
    per.push(t + tt);
    if (g.indices.length > 0) meshes++;
    if (g.transparent.indices.length > 0) transparentMeshes++;
  }
  const meshMs = performance.now() - t1;
  const total = per.reduce((a, b) => a + b, 0);
  console.log(`budget: ${total} triangles, max chunk ${Math.max(...per)}, ${meshes} solid + ${transparentMeshes} transparent meshes of ${cx * cz} chunks, generate ${genMs.toFixed(0)} ms, mesh ${meshMs.toFixed(0)} ms`);

  it('triangle budget: at most 110,000 in all and 12,000 per chunk', () => {
    expect(cx * cz).toBe(36);
    expect(total).toBeLessThanOrEqual(110_000);
    expect(Math.max(...per)).toBeLessThanOrEqual(12_000);
  });
  it('build time: generate and mesh everything in under 2.5 s', () => {
    expect(genMs + meshMs).toBeLessThan(2500);
  });
  it('mesh count: empty transparent meshes are skipped', () => {
    expect(transparentMeshes).toBeLessThan(36);
  });
});
