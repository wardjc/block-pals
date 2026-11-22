import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { generateWorld } from '../../src/core/worldgen';
import { CULL_MARGIN, radialFactor, visibleSections } from '../../src/render/chunkCull';
import { CHUNK_SIZE, SECTION_HEIGHT } from '../../src/render/mesher';

const { world, spawn, village } = generateWorld(2026);
const S = { x: world.sizeX, y: world.sizeY, z: world.sizeZ };
const cxs = S.x / CHUNK_SIZE, czs = S.z / CHUNK_SIZE, sys = Math.ceil(S.y / SECTION_HEIGHT);
const RADIAL = radialFactor(60, 1.6);

/** 200 seeded camera positions and directions: along an edge, in a corner, at the village, at spawn, anywhere. */
function poses(): Array<{ c: { x: number; y: number; z: number }; f: { x: number; y: number; z: number } }> {
  const random = mulberry32(10);
  const anchors = [
    { x: spawn.x, z: spawn.z }, { x: (village.square.x0 + village.square.x1) / 2, z: (village.square.z0 + village.square.z1) / 2 },
    { x: 3, z: 3 }, { x: 188, z: 188 }, { x: 3, z: 96 }, { x: 96, z: 188 },
  ];
  const out = [];
  for (let i = 0; i < 200; i++) {
    const a = i < 120 ? anchors[i % anchors.length] : { x: 2 + random() * 188, z: 2 + random() * 188 };
    const x = a.x + (random() - 0.5) * 6, z = a.z + (random() - 0.5) * 6;
    const y = world.topSolidY(Math.floor(x), Math.floor(z)) + 1 + 1.6 + random() * 3;
    const yaw = random() * Math.PI * 2, pitch = -0.2 + random() * 0.9;
    out.push({ c: { x, y, z }, f: { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) } });
  }
  return out;
}

/** The nearest corner of a section box along the view direction (depth), and its horizontal distance. */
function nearest(cx: number, sy: number, cz: number, c: { x: number; y: number; z: number }, f: { x: number; y: number; z: number }) {
  const x0 = cx * 16, x1 = x0 + 16, y0 = sy * 16, y1 = Math.min(S.y, y0 + 16), z0 = cz * 16, z1 = z0 + 16;
  const depth = ((f.x >= 0 ? x0 : x1) - c.x) * f.x + ((f.y >= 0 ? y0 : y1) - c.y) * f.y + ((f.z >= 0 ? z0 : z1) - c.z) * f.z;
  const flat = Math.hypot(Math.max(x0 - c.x, 0, c.x - x1), Math.max(z0 - c.z, 0, c.z - z1));
  return { depth, flat };
}

const setAt = (p: ReturnType<typeof poses>[number], fogEnd: number) =>
  visibleSections(S.x, S.y, S.z, p.c.x, p.c.y, p.c.z, p.f.x, p.f.y, p.f.z, 'outdoors', p.c.x, p.c.z, fogEnd, { radialFactor: RADIAL });

describe('the draw rule at fog ends 40, 64 and 96', () => {
  const all = poses();

  it('every surface section that can be on screen inside fogEnd + 1.5 of view depth is in the set (no hole inside the fog end)', () => {
    for (const fogEnd of [40, 64, 96]) {
      for (const p of all) {
        const set = setAt(p, fogEnd);
        for (let cz = 0; cz < czs; cz++) for (let cx = 0; cx < cxs; cx++) for (let sy = 3; sy < sys; sy++) {
          const { depth, flat } = nearest(cx, sy, cz, p.c, p.f);
          // On screen means within the frustum, so within RADIAL x depth of the camera.
          if (depth <= fogEnd + CULL_MARGIN && flat <= (fogEnd + CULL_MARGIN) * RADIAL) {
            expect(set.has(`${cx},${sy},${cz}`), `fog ${fogEnd} section ${cx},${sy},${cz}`).toBe(true);
          }
        }
      }
    }
  });

  it('the set at a smaller fog end is a subset of the set at a larger one', () => {
    for (const p of all) {
      const s40 = setAt(p, 40), s64 = setAt(p, 64), s96 = setAt(p, 96);
      for (const k of s40) expect(s64.has(k)).toBe(true);
      for (const k of s64) expect(s96.has(k)).toBe(true);
    }
  });

  it('fails open on NaN at any fog end', () => {
    for (const fogEnd of [40, 64, 96, NaN]) {
      expect(visibleSections(S.x, S.y, S.z, NaN, 60, 90, 1, 0, 0, 'outdoors', 90, 90, fogEnd).size).toBe(cxs * czs * sys);
    }
  });

  it('growing from 40 to 48 adds exactly the sections whose nearest corner depth is between 41.5 and 49.5 (or that only the wider radius reaches)', () => {
    for (const p of all.slice(0, 60)) {
      const s40 = setAt(p, 40), s48 = setAt(p, 48);
      const keep = `${Math.floor(p.c.x / 16)},${Math.floor(p.c.z / 16)}`;
      for (const k of s48) {
        if (s40.has(k)) continue;
        const [cx, sy, cz] = k.split(',').map(Number);
        expect(`${cx},${cz}`).not.toBe(keep);
        const { depth, flat } = nearest(cx, sy, cz, p.c, p.f);
        const newByDepth = depth > 41.5 && depth <= 49.5;
        const newByRadius = flat > 41.5 * RADIAL && flat <= 49.5 * RADIAL;
        expect(newByDepth || newByRadius, `${k}: depth ${depth.toFixed(2)} flat ${flat.toFixed(2)}`).toBe(true);
      }
    }
  });
});
