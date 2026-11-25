import { ORIGIN, WORLD } from './bounds';
import type { Cell } from './pathfind';
import { GROUND_Y, VILLAGE_PLAN, type Rect, type VillageLayout } from './village';
import type { World } from './world';
import { isStandable } from './pathfind';

/** Feet level on the farm ground, in world coordinates (the layout is shifted by ORIGIN). */
export const ZONE_Y = GROUND_Y + 1 + ORIGIN.y;

const MARGIN = 3;
/** Cells kept clear of doors, houses and paths. */
const KEEP_CLEAR = 2;

const zoneOf = (plot: Rect, pasture: Rect): Rect => ({
  x0: plot.x0 - MARGIN, x1: plot.x1 + MARGIN, z0: plot.z0 - MARGIN, z1: pasture.z0 - 2,
});

/** Where grumps and friends live: the farm plot with a margin, ending 2 cells before the pasture fence. */
export const farmZone = (layout: Pick<VillageLayout, 'farmPlot' | 'farm'>): Rect => zoneOf(layout.farmPlot, layout.farm.pasture);

/** The same zone from the fixed village plan (the save checks positions without generating a world). */
export function plannedFarmZone(): Rect {
  const shift = (r: Rect): Rect => ({ x0: r.x0 + ORIGIN.x, x1: r.x1 + ORIGIN.x, z0: r.z0 + ORIGIN.z, z1: r.z1 + ORIGIN.z });
  return zoneOf(shift(VILLAGE_PLAN.farmPlot), shift(VILLAGE_PLAN.pasture));
}

const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m });
const within = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * "x,z" keys of the zone cells a grump or friend never stands on: within 2 of any door, of a house
 * rectangle, of the plot-to-gate path or of the village route.
 */
export function avoidCells(layout: VillageLayout): Set<string> {
  const zone = grow(farmZone(layout), 0);
  const out = new Set<string>();
  const mark = (r: Rect): void => {
    for (let x = Math.max(r.x0, zone.x0); x <= Math.min(r.x1, zone.x1); x++) {
      for (let z = Math.max(r.z0, zone.z0); z <= Math.min(r.z1, zone.z1); z++) out.add(`${x},${z}`);
    }
  };
  for (const h of layout.houses) {
    mark(grow(h.rect, KEEP_CLEAR));
    for (const d of [...h.doorCells, h.doorFront, h.doorInside]) mark(grow({ x0: d[0], x1: d[0], z0: d[2], z1: d[2] }, KEEP_CLEAR));
  }
  mark(grow(layout.farm.path, KEEP_CLEAR));
  const reach = grow(zone, KEEP_CLEAR);
  for (const k of layout.routeCells) {
    const x = k % WORLD.x, z = Math.floor(k / WORLD.x) % WORLD.z;
    if (within(reach, x, z)) mark({ x0: x - KEEP_CLEAR, x1: x + KEEP_CLEAR, z0: z - KEEP_CLEAR, z1: z + KEEP_CLEAR });
  }
  return out;
}

/** Standable cells on the outer ring of the zone, not avoided: where a new grump wobbles in from. */
export function zoneBorder(zone: Rect, world: World, avoid: Set<string>): Cell[] {
  const cells: Cell[] = [];
  for (let x = zone.x0; x <= zone.x1; x++) {
    for (let z = zone.z0; z <= zone.z1; z++) {
      if (x !== zone.x0 && x !== zone.x1 && z !== zone.z0 && z !== zone.z1) continue;
      if (avoid.has(`${x},${z}`)) continue;
      for (const dy of [0, 1, -1]) {
        const c: Cell = [x, ZONE_Y + dy, z];
        if (isStandable(world, c)) { cells.push(c); break; }
      }
    }
  }
  return cells;
}
