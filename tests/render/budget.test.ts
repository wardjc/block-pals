import { describe, expect, it } from 'vitest';
import { generateWorld } from '../../src/core/worldgen';
import { buildChunkGeometry, CHUNK_SIZE } from '../../src/render/mesher';

const uvFor = () => [0, 0, 1, 1] as [number, number, number, number];

// The world is 192 x 68 x 192 since the bigger-world plan (chunk A). The old 96 x 96 meadow is its
// middle 6 x 6 chunks (cx, cz 3..8) and keeps the old budget; the whole world is reported, and the
// per-view section budgets replace the whole-world figure in chunk B (Tasks 9, 10, 23).
const OLD = (cx: number, cz: number): boolean => cx >= 3 && cx <= 8 && cz >= 3 && cz <= 8;

describe('render budget for the 192×192 world (the old 96×96 meadow in the middle)', () => {
  const t0 = performance.now();
  const { world } = generateWorld(2026);
  const genMs = performance.now() - t0;
  const t1 = performance.now();
  const per: number[] = [];
  let oldRegion = 0;
  let transparentMeshes = 0;
  let meshes = 0;
  const cx = Math.ceil(world.sizeX / CHUNK_SIZE), cz = Math.ceil(world.sizeZ / CHUNK_SIZE);
  for (let z = 0; z < cz; z++) for (let x = 0; x < cx; x++) {
    const g = buildChunkGeometry(world, x, z, uvFor);
    const t = g.indices.length / 3, tt = g.transparent.indices.length / 3;
    per.push(t + tt);
    if (OLD(x, z)) oldRegion += t + tt;
    if (g.indices.length > 0) meshes++;
    if (g.transparent.indices.length > 0) transparentMeshes++;
  }
  const meshMs = performance.now() - t1;
  const total = per.reduce((a, b) => a + b, 0);
  console.log(`budget: ${total} triangles (old meadow chunks ${oldRegion}), max chunk ${Math.max(...per)}, ${meshes} solid + ${transparentMeshes} transparent meshes of ${cx * cz} chunks, generate ${genMs.toFixed(0)} ms, mesh ${meshMs.toFixed(0)} ms`);

  it('triangle budget: the old meadow at most 110,000 as before, at most 12,000 per chunk, 600,000 in all', () => {
    expect(cx * cz).toBe(144);
    expect(oldRegion).toBeLessThanOrEqual(110_000);
    expect(Math.max(...per)).toBeLessThanOrEqual(12_000);
    expect(total).toBeLessThanOrEqual(600_000); // the plan's "all sections built" figure
  });
  it('build time: generate under 4 s (loading screen covers it; CI runner took 2.1 s); mesh every chunk under 6 s (chunk A guard: chunk B meshes ~60 sections first, the rest lazily)', () => {
    expect(genMs).toBeLessThan(4000);
    expect(meshMs).toBeLessThan(6000);
  });
  it('mesh count: empty transparent meshes are skipped', () => {
    expect(transparentMeshes).toBeLessThan(144);
  });
});
