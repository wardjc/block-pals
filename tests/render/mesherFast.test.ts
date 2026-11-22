import { describe, expect, it } from 'vitest';
import { generateWorld } from '../../src/core/worldgen';
import { buildSectionGeometry, CHUNK_SIZE, sectionsPerColumn, type UvFor } from '../../src/render/mesher';

const uvFor: UvFor = () => [0, 0, 1, 1];

/** Best of a few runs (the machine is shared with the rest of the suite). */
function timeIt(fn: () => void, runs = 3): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe('the fast section mesher on the real 192 x 68 x 192 world', () => {
  const { world } = generateWorld(2026);
  const cxs = Math.ceil(world.sizeX / CHUNK_SIZE);
  const czs = Math.ceil(world.sizeZ / CHUNK_SIZE);
  const sys = sectionsPerColumn(world.sizeY);

  it('the busiest section meshes in under 8 ms, and a whole column of 5 sections in under 20 ms', () => {
    // Find the busiest section by its face count.
    let busiest = { cx: 0, sy: 0, cz: 0, quads: -1 };
    let worstColumn = { cx: 0, cz: 0, quads: -1 };
    for (let cz = 0; cz < czs; cz++) for (let cx = 0; cx < cxs; cx++) {
      let col = 0;
      for (let sy = 0; sy < sys; sy++) {
        const g = buildSectionGeometry(world, cx, sy, cz, uvFor);
        const quads = (g.indices.length + g.transparent.indices.length) / 6;
        col += quads;
        if (quads > busiest.quads) busiest = { cx, sy, cz, quads };
      }
      if (col > worstColumn.quads) worstColumn = { cx, cz, quads: col };
    }
    const one = timeIt(() => buildSectionGeometry(world, busiest.cx, busiest.sy, busiest.cz, uvFor), 5);
    const column = timeIt(() => {
      for (let sy = 0; sy < sys; sy++) buildSectionGeometry(world, worstColumn.cx, sy, worstColumn.cz, uvFor);
    });
    console.log(`busiest section ${busiest.cx},${busiest.sy},${busiest.cz} (${busiest.quads} quads): ${one.toFixed(2)} ms; `
      + `worst column ${worstColumn.cx},${worstColumn.cz} (${worstColumn.quads} quads): ${column.toFixed(2)} ms`);
    expect(one).toBeLessThan(8);
    expect(column).toBeLessThan(20);
  });

  it('the deep stone sections (y 0..47) of the plain deep world emit almost nothing', () => {
    let quads = 0;
    for (let cz = 1; cz < czs - 1; cz++) for (let cx = 1; cx < cxs - 1; cx++) {
      for (let sy = 0; sy < 3; sy++) quads += buildSectionGeometry(world, cx, sy, cz, uvFor).indices.length / 6;
    }
    // No caves yet: solid rock wall to wall; only the quarry and pond beds can dip into section 2.
    expect(quads).toBeLessThan(200);
  });
});
