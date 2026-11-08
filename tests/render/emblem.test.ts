import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCKS } from '../../src/core/blocks';
import { generateWorld } from '../../src/core/worldgen';
import type { World } from '../../src/core/world';
import type { VillageLayout } from '../../src/core/village';
import { emblemBox, emblemPlacement, type Box } from '../../src/render/emblem';

let world: World;
let village: VillageLayout;
beforeAll(() => {
  const g = generateWorld(2026);
  world = g.world;
  village = g.village;
});

/** Solid voxels whose cube comes within `gap` of the box. */
function solidHits(b: Box, gap: number): Array<[number, number, number]> {
  const hits: Array<[number, number, number]> = [];
  for (let x = Math.floor(b.min[0] - gap); x <= Math.floor(b.max[0] + gap); x++) {
    for (let y = Math.floor(b.min[1] - gap); y <= Math.floor(b.max[1] + gap); y++) {
      for (let z = Math.floor(b.min[2] - gap); z <= Math.floor(b.max[2] + gap); z++) {
        if (!BLOCKS[world.get(x, y, z)].solid) continue;
        const near = x < b.max[0] + gap && x + 1 > b.min[0] - gap
          && y < b.max[1] + gap && y + 1 > b.min[1] - gap
          && z < b.max[2] + gap && z + 1 > b.min[2] - gap;
        if (near) hits.push([x, y, z]);
      }
    }
  }
  return hits;
}

describe('door signs', () => {
  it('there are five houses', () => expect(village.houses).toHaveLength(5));

  it('every sign clears every solid block of its house by at least 0.1', () => {
    for (const house of village.houses) {
      expect(solidHits(emblemBox(emblemPlacement(house)), 0.1), house.id).toEqual([]);
    }
  });

  it('every sign sits in front of its own door wall, above the door, and close to the wall', () => {
    for (const house of village.houses) {
      const p = emblemPlacement(house);
      const b = emblemBox(p);
      const out = [house.doorFront[0] - house.doorCells[0][0], house.doorFront[2] - house.doorCells[0][2]];
      const doorTop = house.groundY + 4; // door gap fills groundY+1..+3
      expect(b.min[1], house.id).toBeGreaterThanOrEqual(doorTop);
      expect(b.max[1], house.id).toBeLessThanOrEqual(house.groundY + 6); // under the roof
      // a thin gap, not floating metres away
      const wallPlane = out[0] !== 0 ? house.doorCells[0][0] + (out[0] > 0 ? 1 : 0) : house.doorCells[0][2] + (out[1] > 0 ? 1 : 0);
      const nearEdge = out[0] !== 0 ? (out[0] > 0 ? b.min[0] : b.max[0]) : (out[1] > 0 ? b.min[2] : b.max[2]);
      const gap = Math.abs(nearEdge - wallPlane);
      expect(gap, house.id).toBeGreaterThanOrEqual(0.1);
      expect(gap, house.id).toBeLessThanOrEqual(0.3);
    }
  });

  it('the checker notices the old floating billboard at 0.8 (it poked into the wall)', () => {
    let poking = 0;
    for (const house of village.houses) {
      const out = [house.doorFront[0] - house.doorCells[0][0], house.doorFront[2] - house.doorCells[0][2]];
      const cx = house.doorCells.reduce((a, c) => a + c[0] + 0.5, 0) / house.doorCells.length;
      const cz = house.doorCells.reduce((a, c) => a + c[2] + 0.5, 0) / house.doorCells.length;
      const x = cx + out[0] * 0.8; const y = house.groundY + 4.9; const z = cz + out[1] * 0.8;
      // a camera-facing 1.5 square can swing 0.75 either way sideways: its worst-case box
      const old: Box = { min: [x - 0.75, y - 0.75, z - 0.75], max: [x + 0.75, y + 0.75, z + 0.75] };
      if (solidHits(old, 0.1).length > 0) poking++;
    }
    expect(poking).toBe(5);
  });
});
