import { beforeAll, describe, expect, test } from 'vitest';
import { ORIGIN } from '../../src/core/bounds';
import { ZONE_Y, avoidCells, farmZone, plannedFarmZone, zoneBorder } from '../../src/core/farmZone';
import { findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { generateWorld, type GeneratedWorld } from '../../src/core/worldgen';

let g: GeneratedWorld;
beforeAll(() => { g = generateWorld(2026); });

describe('the farm zone (real world, seed 2026)', () => {
  test('covers the plot with a margin of 3 west, north and east and ends 2 cells before the pasture fence', () => {
    const z = farmZone(g.village);
    const plot = g.village.farmPlot, pasture = g.village.farm.pasture;
    expect(z.x0).toBe(plot.x0 - 3);
    expect(z.x1).toBe(plot.x1 + 3);
    expect(z.z0).toBe(plot.z0 - 3);
    expect(z.z1).toBe(pasture.z0 - 2);
    for (const bed of g.village.farm.beds) {
      expect(bed.x0).toBeGreaterThanOrEqual(z.x0); expect(bed.x1).toBeLessThanOrEqual(z.x1);
      expect(bed.z0).toBeGreaterThanOrEqual(z.z0); expect(bed.z1).toBeLessThanOrEqual(z.z1);
    }
    const p = g.village.farm.pool, i = g.village.farm.irrigation;
    for (const r of [p, i]) { expect(r.x1).toBeLessThanOrEqual(z.x1); expect(r.z1).toBeLessThanOrEqual(z.z1); }
  });

  test('is in world coordinates, never hard-coded, and the planned zone (used by the save) matches', () => {
    expect(plannedFarmZone()).toEqual(farmZone(g.village));
    expect(farmZone(g.village).x0).toBeGreaterThanOrEqual(ORIGIN.x);
  });

  test('avoids every house rectangle, door and the paths by 2 cells', () => {
    const avoid = avoidCells(g.village);
    const z = farmZone(g.village);
    const near = (x: number, z0: number, r: { x0: number; x1: number; z0: number; z1: number }, m: number): boolean =>
      x >= r.x0 - m && x <= r.x1 + m && z0 >= r.z0 - m && z0 <= r.z1 + m;
    for (let x = z.x0; x <= z.x1; x++) for (let zz = z.z0; zz <= z.z1; zz++) {
      for (const h of g.village.houses) {
        expect(avoid.has(`${x},${zz}`) || !near(x, zz, h.rect, 2), `house ${h.id} ${x},${zz}`).toBe(true);
        for (const d of [...h.doorCells, h.doorFront]) {
          if (Math.abs(x - d[0]) <= 2 && Math.abs(zz - d[2]) <= 2) expect(avoid.has(`${x},${zz}`), `door ${x},${zz}`).toBe(true);
        }
      }
      if (near(x, zz, g.village.farm.path, 2)) expect(avoid.has(`${x},${zz}`), `path ${x},${zz}`).toBe(true);
    }
  });

  test('the zone has at least 80 standable, unavoided cells', () => {
    const z = farmZone(g.village), avoid = avoidCells(g.village);
    let n = 0;
    for (let x = z.x0; x <= z.x1; x++) for (let zz = z.z0; zz <= z.z1; zz++) {
      if (avoid.has(`${x},${zz}`)) continue;
      if ([0, 1, -1].some(dy => isStandable(g.world, [x, ZONE_Y + dy, zz]))) n++;
    }
    expect(n).toBeGreaterThanOrEqual(80);
  });

  test('the zone border has standable cells and one is reachable by A* from the village square', () => {
    const z = farmZone(g.village), avoid = avoidCells(g.village);
    const border = zoneBorder(z, g.world, avoid);
    expect(border.length).toBeGreaterThan(4);
    for (const c of border) {
      expect(isStandable(g.world, c)).toBe(true);
      expect(avoid.has(`${c[0]},${c[2]}`)).toBe(false);
      expect(c[0] === z.x0 || c[0] === z.x1 || c[2] === z.z0 || c[2] === z.z1).toBe(true);
    }
    const sq = g.village.square;
    const start: Cell = [Math.floor((sq.x0 + sq.x1) / 2), ZONE_Y, Math.floor((sq.z0 + sq.z1) / 2)];
    expect(isStandable(g.world, start)).toBe(true);
    expect(border.some(c => findPath(g.world, start, c, 20000) !== null)).toBe(true);
  });
});
