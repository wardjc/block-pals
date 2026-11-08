import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { WORLD } from '../../src/core/bounds';
import { canStep, findPath, isStandable, smoothPath, type Cell } from '../../src/core/pathfind';
import { GROUND_Y, VILLAGE_PLAN, type Rect, type VillageLayout } from '../../src/core/village';
import type { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';

let world: World;
let village: VillageLayout;
let spawn: Cell;

beforeAll(() => {
  const generated = generateWorld(2026);
  world = generated.world;
  village = generated.village;
  spawn = [Math.floor(generated.spawn.x), Math.floor(generated.spawn.y), Math.floor(generated.spawn.z)];
});

const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const solid = (x: number, y: number, z: number): boolean => BLOCKS[world.get(x, y, z)].solid;
const TERRAIN = new Set([BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Sand, BlockId.PathStone, BlockId.Bedrock]);

/** Ground height ignoring trees. */
function ground(x: number, z: number): number {
  for (let y = world.sizeY - 1; y >= 0; y--) if (TERRAIN.has(world.get(x, y, z))) return y;
  return 0;
}

const footprints = (): Rect[] => village.houses.map(h => h.rect);
const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.z0 - gap <= b.z1 && b.z0 - gap <= a.z1;

describe('village', () => {
  it('has the cottage first, then four neighbours', () => {
    expect(village.houses.map(h => h.id)).toEqual(['cottage', 'bakery', 'shop', 'farmhouse', 'granny']);
  });

  it('every door is reachable from spawn', () => {
    for (const house of village.houses) {
      expect(findPath(world, spawn, house.doorFront, 40000), house.id).not.toBeNull();
      expect(findPath(world, spawn, house.doorInside, 40000), house.id).not.toBeNull();
    }
  });

  it('walks from spawn to the village and back, smoothed', () => {
    const end = village.route[village.route.length - 1];
    const there = findPath(world, spawn, end, 40000);
    expect(there).not.toBeNull();
    const smooth = smoothPath(world, there!, spawn);
    expect(smooth.length).toBeGreaterThan(0);
    expect(smooth.length).toBeLessThanOrEqual(there!.length);
    const back = findPath(world, end, spawn, 40000);
    expect(back).not.toBeNull();
    expect(smoothPath(world, back!, end).length).toBeGreaterThan(0);
    console.log(`route cells ${village.route.length}, A* steps there ${there!.length}, smoothed ${smooth.length}`);
  });

  it('route is a chain of legal steps', () => {
    const { route } = village;
    expect(route[0]).toEqual(spawn);
    expect(inRect(village.square, route[route.length - 1][0], route[route.length - 1][2])).toBe(true);
    expect(route.length).toBeGreaterThanOrEqual(60);
    expect(route.length).toBeLessThanOrEqual(140);
    for (let i = 1; i < route.length; i++) expect(canStep(world, route[i - 1], route[i]), `step ${i}`).toBe(true);
  });

  it('route is 3 wide and PathStone with two blocks of headroom', () => {
    for (const [x, y, z] of village.route) {
      // The spawn column itself stays Grass; the path begins around it.
      if (x === spawn[0] && z === spawn[2]) continue;
      expect(world.get(x, y - 1, z)).toBe(BlockId.PathStone);
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => world.get(x + dx, y - 1, z + dz) === BlockId.PathStone);
      expect(side).toBe(true);
      expect(solid(x, y, z) || solid(x, y + 1, z)).toBe(false);
    }
    for (const k of village.routeCells) {
      const x = k % WORLD.x;
      const z = Math.floor(k / WORLD.x) % WORLD.z;
      const y = Math.floor(k / (WORLD.x * WORLD.z));
      expect(world.get(x, y - 1, z)).toBe(BlockId.PathStone);
    }
  });

  it('route goes over the hill in steps of one', () => {
    let top = 0;
    for (const [x, y, z] of village.route) top = Math.max(top, y - 1, ground(x, z));
    expect(top).toBeGreaterThanOrEqual(6);
    expect(top).toBeLessThanOrEqual(9);
  });

  it('leaves no half trees on the corridor', () => {
    for (const [cx, , cz] of village.route) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let y = ground(cx + dx, cz + dz) + 1; y < WORLD.y; y++) {
            const id = world.get(cx + dx, y, cz + dz);
            expect(id === BlockId.Leaves || id === BlockId.Wood).toBe(false);
          }
        }
      }
    }
  });

  it('pads are flat and skirts are gentle', () => {
    const quarry = village.quarry;
    const skip = (x: number, z: number): boolean => inRect(quarry, x, z) || footprints().some(r => inRect(r, x, z));
    for (let x = VILLAGE_PLAN.pad.x0; x <= VILLAGE_PLAN.pad.x1; x++) {
      for (let z = VILLAGE_PLAN.pad.z0; z <= VILLAGE_PLAN.pad.z1; z++) {
        if (!skip(x, z)) expect(ground(x, z), `${x},${z}`).toBe(GROUND_Y);
      }
    }
    const rects = [...village.stampedRects];
    let checked = 0;
    for (const r of rects) {
      for (let x = Math.max(1, r.x0); x <= Math.min(WORLD.x - 2, r.x1); x++) {
        for (let z = Math.max(1, r.z0); z <= Math.min(WORLD.z - 2, r.z1); z++) {
          if (skip(x, z)) continue;
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            if (skip(x + dx, z + dz)) continue;
            expect(Math.abs(ground(x, z) - ground(x + dx, z + dz)), `${x},${z}`).toBeLessThanOrEqual(1);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('plan is tidy', () => {
    const rects = footprints();
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j], 1), `${i} ${j}`).toBe(false);
    }
    for (const r of rects.slice(1)) {
      expect(r.x0).toBeGreaterThanOrEqual(VILLAGE_PLAN.pad.x0);
      expect(r.x1).toBeLessThanOrEqual(VILLAGE_PLAN.pad.x1);
      expect(r.z0).toBeGreaterThanOrEqual(VILLAGE_PLAN.pad.z0);
      expect(r.z1).toBeLessThanOrEqual(VILLAGE_PLAN.pad.z1);
      expect(overlaps(r, village.farmPlot)).toBe(false);
      expect(overlaps(r, village.square)).toBe(false);
    }
    expect(overlaps(rects[0], VILLAGE_PLAN.pad)).toBe(false);
    const q = village.quarry;
    const pad = VILLAGE_PLAN.pad;
    expect(q.x0 >= pad.x0 && q.x1 <= pad.x1 && q.z0 >= pad.z0 && q.z1 <= pad.z1).toBe(true);
    for (const r of rects) expect(overlaps(r, q)).toBe(false);
  });

  it('keeps the farm plot reserved', () => {
    const f = village.farmPlot;
    expect(f.x1 - f.x0 + 1).toBeGreaterThanOrEqual(12);
    expect(f.z1 - f.z0 + 1).toBeGreaterThanOrEqual(9);
    for (let x = f.x0; x <= f.x1; x++) {
      for (let z = f.z0; z <= f.z1; z++) {
        expect(world.get(x, GROUND_Y, z)).toBe(BlockId.Dirt);
        for (let y = GROUND_Y + 1; y < WORLD.y; y++) expect(world.get(x, y, z)).toBe(BlockId.Air);
      }
    }
  });

  it('has a walkable quarry', () => {
    const q = village.quarry;
    const centre: Cell = [Math.floor((q.x0 + q.x1) / 2) + 1, 0, Math.floor((q.z0 + q.z1) / 2)];
    centre[1] = ground(centre[0], centre[2]) + 1;
    expect(isStandable(world, centre)).toBe(true);
    expect(findPath(world, village.houses[2].doorFront, centre, 40000)).not.toBeNull();
  });

  it('has an empty cottage near the spawn', () => {
    const cottage = village.houses[0];
    for (const [x, y, z] of cottage.floor) for (let dy = 0; dy < 4; dy++) expect(world.get(x, y + dy, z)).toBe(BlockId.Air);
    expect(Math.max(Math.abs(cottage.doorFront[0] - spawn[0]), Math.abs(cottage.doorFront[2] - spawn[2]))).toBeLessThanOrEqual(12);
  });

  it('lights every house and puts no water in any stamp', () => {
    for (const house of village.houses) {
      expect(house.lampCells.filter(([x, y, z]) => world.get(x, y, z) === BlockId.Lamp).length).toBeGreaterThanOrEqual(2);
    }
    for (const r of village.stampedRects) {
      for (let x = Math.max(0, r.x0); x <= Math.min(WORLD.x - 1, r.x1); x++) {
        for (let z = Math.max(0, r.z0); z <= Math.min(WORLD.z - 1, r.z1); z++) {
          for (let y = 1; y < WORLD.y; y++) expect(world.get(x, y, z)).not.toBe(BlockId.Water);
        }
      }
    }
  });

  it('writes nothing outside the world and is deterministic', () => {
    const again = generateWorld(2026);
    expect(again.village.route).toEqual(village.route);
    for (const r of village.stampedRects) expect(r.x0 > WORLD.x || r.z0 > WORLD.z).toBe(false);
  });
});
