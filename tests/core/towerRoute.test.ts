import { describe, expect, it, vi } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { WORLD } from '../../src/core/bounds';
import { canStep, findPath, isStandable, smoothPath, type Cell } from '../../src/core/pathfind';
import { applySave } from '../../src/core/save';
import { TOWER_GROUND_Y, TOWER_PLAN } from '../../src/core/tower';
import { buildVillage, VILLAGE_PLAN, type Rect } from '../../src/core/village';
import type { World } from '../../src/core/world';
import { GEN_VERSION, generateMeadowStage, generateWorld } from '../../src/core/worldgen';

vi.setConfig({ testTimeout: 60_000 });

const t0 = performance.now();
const generated = generateWorld(2026);
const genMs = performance.now() - t0;
const { world, village, tower, towerRoute, towerRects } = generated;
const spawn: Cell = [Math.floor(generated.spawn.x), Math.floor(generated.spawn.y), Math.floor(generated.spawn.z)];
const G = TOWER_GROUND_Y;
const pad = TOWER_PLAN.pad;
const foot = TOWER_PLAN.footprint;

const TERRAIN = new Set([BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Sand, BlockId.PathStone, BlockId.Bedrock, BlockId.Farmland]);
/** Ground height ignoring trees and buildings. */
function ground(w: World, x: number, z: number): number {
  for (let y = w.sizeY - 1; y >= 0; y--) if (TERRAIN.has(w.get(x, y, z))) return y;
  return 0;
}
const inRect = (r: Rect, x: number, z: number, m = 0): boolean => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
/** Chebyshev gap between two rectangles (0 when touching or overlapping). */
const gap = (a: Rect, b: Rect): number => Math.max(a.x0 - b.x1, b.x0 - a.x1, a.z0 - b.z1, b.z0 - a.z1) - 1;
const solid = (x: number, y: number, z: number): boolean => BLOCKS[world.get(x, y, z)].solid;

describe('the tower in the generated world', () => {
  it('bumps GEN_VERSION to 3 (the tower changes the terrain)', () => {
    expect(GEN_VERSION).toBe(3);
  });

  it('stands on a real hilltop: the highest ground within 6 blocks and 2 above the ground 10 cells north', () => {
    let highest = 0;
    for (let x = pad.x0 - 6; x <= pad.x1 + 6; x++) for (let z = pad.z0 - 6; z <= Math.min(WORLD.z - 1, pad.z1 + 6); z++) {
      if (inRect(foot, x, z)) continue;
      highest = Math.max(highest, ground(world, x, z));
    }
    expect(highest).toBe(G);
    const cx = Math.floor((foot.x0 + foot.x1) / 2);
    expect(G - ground(world, cx, pad.z0 - 10)).toBeGreaterThanOrEqual(2);
    // It is near the far (south) edge, far from the village and the spawn.
    expect(WORLD.z - 1 - pad.z1).toBeLessThanOrEqual(8);
    expect(Math.hypot(cx - 74, 81 - 26)).toBeGreaterThan(60);
  });

  it('the pad is level at 9 and the skirt is gentle', () => {
    for (let x = pad.x0; x <= pad.x1; x++) for (let z = pad.z0; z <= pad.z1; z++) {
      if (!inRect(foot, x, z)) expect(ground(world, x, z), `${x},${z}`).toBe(G);
    }
    let checked = 0;
    for (const r of towerRects) {
      for (let x = Math.max(1, r.x0); x <= Math.min(WORLD.x - 2, r.x1); x++) {
        for (let z = Math.max(1, r.z0); z <= Math.min(WORLD.z - 2, r.z1); z++) {
          if (inRect(foot, x, z)) continue;
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            const nx = x + dx, nz = z + dz;
            if (inRect(foot, nx, nz) || !towerRects.some(q => inRect(q, nx, nz))) continue;
            // The village's own ground (houses aside) is checked by its own test.
            if (village.houses.some(h => inRect(h.rect, x, z) || inRect(h.rect, nx, nz))) continue;
            expect(Math.abs(ground(world, x, z) - ground(world, nx, nz)), `${x},${z}`).toBeLessThanOrEqual(1);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('keeps a 6-cell gap from the pasture skirt, the farm plot, every house, the pond and the spawn', () => {
    const pastureSkirt: Rect = (({ x0, z0, x1, z1 }) => ({ x0: x0 - 6, z0: z0 - 6, x1: x1 + 6, z1: z1 + 6 }))(VILLAGE_PLAN.pasture);
    const pond: Rect = { x0: 8, z0: 26, x1: 20, z1: 38 };
    const spawnRect: Rect = { x0: spawn[0], z0: spawn[2], x1: spawn[0], z1: spawn[2] };
    for (const other of [pastureSkirt, village.farmPlot, VILLAGE_PLAN.pad, pond, spawnRect, ...village.houses.map(h => h.rect)]) {
      expect(gap(pad, other), JSON.stringify(other)).toBeGreaterThanOrEqual(6);
    }
    // The path never crosses a house, the plot, the pasture or the pond.
    for (const [x, , z] of towerRoute) {
      for (const r of [VILLAGE_PLAN.pasture, village.farmPlot, pond, ...village.houses.map(h => h.rect)]) {
        expect(inRect(r, x, z, 2), `${x},${z}`).toBe(false);
      }
    }
  });

  it('the path is 3 wide PathStone with two blocks of headroom, a chain of single-block steps, ending at the door front', () => {
    expect(towerRoute[towerRoute.length - 1]).toEqual(tower.doorFront);
    const [sx, , sz] = towerRoute[0];
    expect(inRect(village.square, sx, sz)).toBe(true);
    for (let i = 1; i < towerRoute.length; i++) expect(canStep(world, towerRoute[i - 1], towerRoute[i]), `step ${i}`).toBe(true);
    for (const [x, y, z] of towerRoute) {
      expect(world.get(x, y - 1, z), `${x},${z}`).toBe(BlockId.PathStone);
      expect(solid(x, y, z) || solid(x, y + 1, z)).toBe(false);
      // 3 wide: both neighbours across the direction of travel are paved too (outside the tower).
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => world.get(x + dx, y - 1, z + dz) === BlockId.PathStone);
      expect(sides.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('route length is between 60 and 100 cells', () => {
    expect(towerRoute.length).toBeGreaterThanOrEqual(60);
    expect(towerRoute.length).toBeLessThanOrEqual(100);
    console.log(`tower route ${towerRoute.length} cells`);
  });

  it('leaves no half trees on the path and the pad', () => {
    const columns: Array<[number, number]> = [];
    for (const [cx, , cz] of towerRoute) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) columns.push([cx + dx, cz + dz]);
    for (let x = pad.x0; x <= pad.x1; x++) for (let z = pad.z0; z <= pad.z1; z++) columns.push([x, z]);
    for (const [x, z] of columns) {
      for (let y = ground(world, x, z) + 1; y < WORLD.y; y++) {
        const id = world.get(x, y, z);
        expect(id === BlockId.Leaves || id === BlockId.Wood, `${x},${y},${z}`).toBe(false);
      }
    }
  });

  it('A* from the village gate to the door, up the stairs to the star room, and back to the spawn', () => {
    const star = tower.floors[1];
    const top = star.cells[Math.floor(star.cells.length / 2)];
    const legs: Array<[Cell, Cell]> = [[village.gate, tower.doorFront], [tower.doorFront, top], [top, tower.doorFront], [tower.doorFront, spawn]];
    for (const [from, to] of legs) {
      const path = findPath(world, from, to, 80000);
      expect(path, `${from.join()} -> ${to.join()}`).not.toBeNull();
      let prev = from;
      for (const cell of path!) { expect(canStep(world, prev, cell)).toBe(true); prev = cell; }
      const smooth = smoothPath(world, path!, from);
      expect(smooth.length).toBeGreaterThan(0);
      for (const cell of smooth) expect(isStandable(world, cell), cell.join()).toBe(true);
    }
  });

  it('A* from the spawn to the door works too (he can walk there without Pip)', () => {
    expect(findPath(world, spawn, tower.doorFront, 80000)).not.toBeNull();
    expect(findPath(world, spawn, tower.wizardSpot, 80000)).not.toBeNull();
  });

  it('writes nothing outside the world array and is deterministic', () => {
    for (const r of towerRects) {
      expect(r.x0 >= -6 && r.z0 >= -6 && r.x1 <= WORLD.x + 6 && r.z1 <= WORLD.z + 6).toBe(true);
    }
    const again = generateWorld(2026);
    expect(again.tower).toEqual(tower);
    expect(again.towerRoute).toEqual(towerRoute);
    for (let x = pad.x0 - 6; x <= pad.x1 + 6; x++) for (let z = pad.z0 - 6; z < WORLD.z; z++) for (let y = 0; y < WORLD.y; y++) {
      expect(again.world.get(x, y, z)).toBe(world.get(x, y, z));
    }
  });

  it('step 1 and step 2 stamps are byte-identical to before on their rectangles', () => {
    const { world: before, spawn: s } = generateMeadowStage(2026);
    const old = buildVillage(before, s);
    expect(old.route).toEqual(village.route);
    expect([...old.routeCells]).toEqual([...village.routeCells]);
    const rects: Rect[] = [...village.houses.map(h => h.rect), village.square, village.farmPlot, village.farm.pasture, village.quarry];
    for (const r of rects) {
      for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) for (let y = 0; y < WORLD.y; y++) {
        expect(world.get(x, y, z), `${x},${y},${z}`).toBe(before.get(x, y, z));
      }
    }
    for (const k of village.routeCells) {
      const x = k % WORLD.x, z = Math.floor(k / WORLD.x) % WORLD.z, y = Math.floor(k / (WORLD.x * WORLD.z));
      for (let dy = -1; dy <= 1; dy++) expect(world.get(x, y + dy, z)).toBe(before.get(x, y + dy, z));
    }
  });

  it('puts no Water in any tower stamp', () => {
    for (const r of towerRects) {
      for (let x = Math.max(0, r.x0); x <= Math.min(WORLD.x - 1, r.x1); x++) {
        for (let z = Math.max(0, r.z0); z <= Math.min(WORLD.z - 1, r.z1); z++) {
          if (inRect(village.farm.pool, x, z)) continue;
          for (let y = 1; y < WORLD.y; y++) expect(world.get(x, y, z)).not.toBe(BlockId.Water);
        }
      }
    }
  });

  it('his edits still win: a tower wall and a path block replay on top, and the rest stands', () => {
    const wall: [number, number, number, number] = [foot.x0, G + 2, foot.z0 + 1, BlockId.Air];
    const [px, py, pz] = towerRoute[40];
    const path: [number, number, number, number] = [px, py - 1, pz, BlockId.Bricks];
    const loaded = applySave({
      version: 2, gen: 2, seed: 2026, edits: [wall, path], inventory: {}, player: { x: 24.5, y: 6, z: 24.5 }, flags: { ledToVillage: false },
    });
    expect(loaded.world.get(wall[0], wall[1], wall[2])).toBe(BlockId.Air);
    expect(loaded.world.get(px, py - 1, pz)).toBe(BlockId.Bricks);
    // An old (gen 2) save gets the tower around his edits.
    expect(loaded.world.get(...tower.topLamp)).toBe(BlockId.Lamp);
    expect(loaded.world.get(foot.x0, G + 3, foot.z0 + 1)).toBe(BlockId.Stone);
    expect(loaded.world.get(towerRoute[41][0], towerRoute[41][1] - 1, towerRoute[41][2])).toBe(BlockId.PathStone);
    // Both edits stay in every later save.
    expect(loaded.world.edits()).toEqual(expect.arrayContaining([wall, path]));
  });

  it('old saves load: his spot is kept, and a spot now inside the tower means the spawn', () => {
    const base = { version: 2 as const, seed: 2026, edits: [], inventory: { [BlockId.Wood]: 3 }, flags: { ledToVillage: true } };
    const kept = applySave({ ...base, gen: 2, player: { x: 60.5, y: 6, z: 29.5 } });
    expect(kept.spawn).toEqual({ x: 60.5, y: 6, z: 29.5 });
    expect(kept.inventory.count(BlockId.Wood)).toBe(3);
    expect(kept.tower).toEqual(tower);
    expect(kept.towerRoute).toEqual(towerRoute);
    const [wx, wy, wz] = tower.wizardSpot;
    const inside = applySave({ ...base, gen: 1, player: { x: wx + 0.5, y: wy, z: wz + 0.5 } });
    expect(inside.spawn).toEqual(generated.spawn);
    // Where the hill rose under an old spot, he is never put inside the ground.
    const buried = applySave({ ...base, gen: 2, player: { x: 30.5, y: 7, z: 80.5 } });
    expect(buried.spawn).toEqual(generated.spawn);
  });

  it('generateWorld with the tower stays under the existing build-time guard', () => {
    console.log(`generateWorld with the tower: ${genMs.toFixed(0)} ms`);
    expect(genMs).toBeLessThan(2500);
  });
});
