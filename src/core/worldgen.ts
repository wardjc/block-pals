import { BlockId } from './blocks';
import {
  carveField, carveMouth, carveStairs, groundTops, inOld, layTrail, planCaves, repairFloors,
  EMPTY_CAVES, type CaveLayout, type Mouth, type MouthContext,
} from './caves';
import { dressCaves } from './caveDress';
import { stampRuin } from './ruin';
import { placeTreasureRooms, stampTreasure } from './treasure';
import { insideWall, LEGACY_WORLD, ORIGIN, V2_WORLD, WORLD } from './bounds';
import { generateOuter, type OuterInfo } from './outer';
import type { Cell } from './pathfind';
import { mulberry32, valueNoise2D } from './rng';
import { ShiftedWorld, shiftLayout, shiftTowerLayout, type WorldCells } from './shifted';
import { buildTower, TOWER_PLAN, type TowerInfo, type TowerLayout } from './tower';
import { buildVillage, type Rect, type VillageLayout } from './village';
import { World } from './world';

/**
 * Bump when later steps add stamps, so saves can tell which generator made the world. Never lowered.
 * 2: village step 2 (96 x 20 x 96). 3: the wizard's tower, its hill and its path (still 96 x 20 x 96).
 * 4: the 192 x 68 x 192 world, the gen 3 meadow (tower included) unchanged at +ORIGIN, with the caves
 *    (chunk C was built before 4 shipped, so the caves are part of 4: no save was ever written by a
 *    gen 4 world without them).
 * Old saves regenerate and replay his edits on top.
 */
export const GEN_VERSION = 4;

type Cell3 = { x: number; y: number; z: number };
type Tree = { x: number; z: number };

interface Column { height: number; inPond: boolean; onShore: boolean }

function column(noise: (x: number, z: number) => number, plateau: number, x: number, z: number): Column {
  const spawnDistance = Math.max(Math.abs(x - 24), Math.abs(z - 24));
  const blend = Math.min(1, Math.max(0, (spawnDistance - 3) / 5));
  const meadow = 5 + noise(x / 12, z / 12) * 4;
  const hill = Math.floor(11 - Math.hypot(x - 34, z - 12) * 0.75);
  let height = Math.max(Math.round(plateau + (meadow - plateau) * blend), hill);

  const pondDistance = Math.hypot(x - 14, z - 32);
  const inPond = pondDistance <= 5;
  const onShore = pondDistance > 5 && pondDistance <= 6;
  // Ease the meadow down to the sandy bank; the pond has a solid sandy bed.
  if (pondDistance < 10) {
    height = Math.round(5 + (height - 5) * Math.max(0, (pondDistance - 6) / 4));
  }
  if (inPond) height = 3;
  if (onShore) height = 5;
  return { height, inPond, onShore };
}

/** The v1 height formula for one seed, built once (meadow coordinates; it rolls on beyond the old edges). */
export function makeHeightAt(seed: number): (x: number, z: number) => number {
  const noise = valueNoise2D(seed);
  const plateau = 5 + Math.round(noise(24 / 12, 24 / 12) * 4);
  return (x, z) => column(noise, plateau, x, z).height;
}

/** The v1 height formula in absolute coordinates: beyond x or z 47 the same noise rolls on. */
export function heightAt(seed: number, x: number, z: number): number {
  return makeHeightAt(seed)(x, z);
}

export interface GeneratedWorld {
  world: World;
  /** World coordinates. */
  spawn: { x: number; y: number; z: number };
  /** World coordinates (the step 2 layout moved by ORIGIN). */
  village: VillageLayout;
  /** The new land around the old rectangle (hills, ponds, trees), world coordinates. */
  outer: OuterInfo;
  /** World coordinates (the gen 3 tower moved by ORIGIN). */
  tower: TowerInfo;
  /** Centre line of the path from the village square to the tower door (world coordinates). */
  towerRoute: Cell[];
  /** Everything the tower's generator may have changed (world coordinates). */
  towerRects: Rect[];
  /** The tower's level hilltop (TOWER_PLAN.pad moved by ORIGIN): arriving there ends Pip's walk. */
  towerPad: Rect;
  /** The caves: rooms, mouths, stairs, the trail, lights, gems, treasure rooms and the Old Hideout. */
  caves: CaveLayout;
}

function plantTree(
  world: WorldCells, heights: Uint8Array, trees: Tree[], spawn: Cell3, x: number, z: number, maxY: number,
  blocked: (x: number, z: number) => boolean = () => false,
): boolean {
  if (!world.inBounds(x - 1, 0, z - 1) || !world.inBounds(x + 1, 0, z + 1)) return false;
  const ground = heights[x + world.sizeX * z];
  if (world.get(x, ground, z) !== BlockId.Grass || ground + 6 >= maxY) return false;
  // Include the canopy in the three-column clearing and keep trees separate.
  if (Math.max(Math.abs(x - spawn.x), Math.abs(z - spawn.z)) <= 4) return false;
  if (trees.some(tree => Math.max(Math.abs(x - tree.x), Math.abs(z - tree.z)) < 5)) return false;
  if (blocked(x, z)) return false;

  for (let y = ground + 1; y <= ground + 4; y++) world.set(x, y, z, BlockId.Wood);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let y = ground + 5; y <= ground + 6; y++) {
        world.set(x + dx, y, z + dz, BlockId.Leaves);
      }
    }
  }
  trees.push({ x, z });
  return true;
}

/**
 * Stages 1 and 2: terrain for the whole 96 world, then the v1 trees only (verbatim v1 stream
 * and constants, so the v1 meadow is bit-identical). No stamps. Writes into `target` (the
 * ShiftedWorld view of the big world, or a plain 96 world by default). Exposed for tests.
 */
export function generateMeadowStage<W extends WorldCells = World>(
  seed = 2026, target?: W,
): { world: W; spawn: Cell3; heights: Uint8Array; trees: Tree[] } {
  const world = target ?? (new World(V2_WORLD.x, V2_WORLD.y, V2_WORLD.z) as unknown as W);
  const noise = valueNoise2D(seed);
  const random = mulberry32(seed);
  const heights = new Uint8Array(world.sizeX * world.sizeZ);
  const plateau = 5 + Math.round(noise(24 / 12, 24 / 12) * 4);

  for (let z = 0; z < world.sizeZ; z++) {
    for (let x = 0; x < world.sizeX; x++) {
      const { height, inPond, onShore } = column(noise, plateau, x, z);
      heights[x + world.sizeX * z] = height;

      world.set(x, 0, z, BlockId.Bedrock);
      for (let y = 1; y <= height; y++) {
        const id = y === height
          ? (inPond || onShore ? BlockId.Sand : BlockId.Grass)
          : (y >= height - 2 ? BlockId.Dirt : BlockId.Stone);
        world.set(x, y, z, id);
      }
      if (inPond) {
        for (let y = height + 1; y <= 5; y++) world.set(x, y, z, BlockId.Water);
      }
    }
  }

  const spawn = { x: 24, y: world.topSolidY(24, 24) + 1, z: 24 };
  const trees: Tree[] = [];
  // v1 rejected trees against the v1 world height (16); keep that rule so the same trees land.
  const plant = (x: number, z: number): boolean =>
    plantTree(world, heights, trees, spawn, x, z, LEGACY_WORLD.y);

  // Three well-spaced trees per side guarantee a denser ring, 2–4 cells in.
  for (let side = 0; side < 4; side++) {
    for (const anchor of [8, 24, 40]) {
      const along = anchor + Math.floor(random() * 5) - 2;
      const inset = 2 + Math.floor(random() * 3);
      if (side === 0) plant(along, inset);
      if (side === 1) plant(LEGACY_WORLD.x - 1 - inset, along);
      if (side === 2) plant(along, LEGACY_WORLD.z - 1 - inset);
      if (side === 3) plant(inset, along);
    }
  }

  // Shuffle a finite candidate list so placement cannot get stuck retrying.
  const candidates: Array<{ x: number; z: number }> = [];
  for (let z = 8; z < 40; z++) {
    for (let x = 8; x < 40; x++) candidates.push({ x, z });
  }
  const targetTrees = 14 + Math.floor(random() * 3);
  for (let i = candidates.length - 1; i >= 0 && trees.length < targetTrees; i--) {
    const chosen = Math.floor(random() * (i + 1));
    const candidate = candidates[chosen];
    candidates[chosen] = candidates[i];
    plant(candidate.x, candidate.z);
  }

  return { world, spawn, heights, trees };
}

const inRect = (r: Rect, x: number, z: number, margin = 0): boolean =>
  x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;

/**
 * The step 2 world (terrain, v1 trees, village, farm, pasture, stage 4 trees), unchanged, written
 * into `world` (a plain 96 world, or the ShiftedWorld view of the big one). Meadow coordinates.
 */
export function generateMeadowWorld(
  seed: number, world: WorldCells,
): { spawn: Cell3; village: VillageLayout; tower: TowerLayout } {
  // Stages 1 and 2.
  const { spawn, heights, trees } = generateMeadowStage(seed, world);

  // Stage 3: pads, houses and the path (Task 5).
  const village = buildVillage(world, spawn);
  // Stage 3b: the wizard's hill, tower and path (after the village, so its stamps stay byte-identical).
  const tower = buildTower(world);

  // Stage 4: edge ring and scatter on the new ground, from its own stream.
  const random = mulberry32((seed ^ 0x5eed) >>> 0);
  const blocked = (x: number, z: number): boolean =>
    !insideWall(world, x, z)
    || !(x >= 50 || z >= 50)
    || village.stampedRects.some(rect => inRect(rect, x, z, 3))
    || tower.stampedRects.some(rect => inRect(rect, x, z, 3));
  const plant = (x: number, z: number): boolean =>
    plantTree(world, heights, trees, spawn, x, z, world.sizeY, blocked);

  const lastEdge = world.sizeX - 1;
  for (let side = 0; side < 4; side++) {
    for (const anchor of [8, 20, 32, 44, 56, 68, 80, 88]) {
      const along = anchor + Math.floor(random() * 5) - 2;
      const inset = 2 + Math.floor(random() * 3);
      if (side === 0) plant(along, inset);
      if (side === 1) plant(lastEdge - inset, along);
      if (side === 2) plant(along, lastEdge - inset);
      if (side === 3) plant(inset, along);
    }
  }

  const candidates: Array<{ x: number; z: number }> = [];
  for (let z = 8; z < world.sizeZ - 8; z++) {
    for (let x = 8; x < world.sizeX - 8; x++) {
      if (x >= 50 || z >= 50) candidates.push({ x, z });
    }
  }
  const targetTrees = trees.length + 22 + Math.floor(random() * 5);
  for (let i = candidates.length - 1; i >= 0 && trees.length < targetTrees; i--) {
    const chosen = Math.floor(random() * (i + 1));
    const candidate = candidates[chosen];
    candidates[chosen] = candidates[i];
    plant(candidate.x, candidate.z);
  }
  return { spawn, village, tower };
}

/**
 * The bigger, deeper world (192 x 68 x 192). Stage 0 fills the deep rock in whole layers; stage 1
 * runs the step 2 generator UNCHANGED on a ShiftedWorld view at +ORIGIN, so the old region is
 * identical by construction (old streams `seed` and `seed ^ 0x5eed` consumed exactly as before).
 * The one documented difference (D1): the old bedrock row (now y 48) is Stone, so he can dig past it.
 * Stages 2 and 3 add the outer land (src/core/outer.ts) around the old rectangle, never inside it.
 * Everything runs in bulk mode: no edit records, a clean world.
 */
export function generateWorld(seed = 2026, opts: { caves?: boolean } = {}): GeneratedWorld {
  const world = new World(WORLD.x, WORLD.y, WORLD.z);
  world.beginBulk();

  // Stage 0: bedrock floor, deep stone up to the old world's floor.
  world.fillLayer(0, BlockId.Bedrock);
  for (let y = 1; y < ORIGIN.y; y++) world.fillLayer(y, BlockId.Stone);

  // Stage 1: the old region, on the view.
  const view = new ShiftedWorld(world);
  const meadow = generateMeadowWorld(seed, view);
  // D1: the old bedrock row becomes Stone.
  for (let z = 0; z < view.sizeZ; z++) {
    for (let x = 0; x < view.sizeX; x++) {
      if (view.get(x, 0, z) === BlockId.Bedrock) view.set(x, 0, z, BlockId.Stone);
    }
  }
  const village = shiftLayout(meadow.village, world);
  const tower = shiftTowerLayout(meadow.tower, world);
  const spawn = { x: meadow.spawn.x + ORIGIN.x, y: meadow.spawn.y + ORIGIN.y, z: meadow.spawn.z + ORIGIN.z };

  // Stages 2 and 3: the outer ring (its own streams; only columns outside the old rectangle).
  const outer = generateOuter(world, seed);

  // Stages 4 to 9: the caves (their own streams, seed ^ 0xca7e5 and sub-streams). `caves: false` is
  // for the tests of the earlier stages only; the game always has them.
  const caves = opts.caves === false ? EMPTY_CAVES : generateCaves(world, seed, {
    spawn,
    keepOff: [...village.houses.map(h => h.rect), village.farmPlot, village.farm.pasture, tower.info.rect, ...tower.stampedRects],
    pathColumns: [
      ...[...village.routeCells].map(k => { const x = k % world.sizeX; return [x, Math.floor(k / world.sizeX) % world.sizeZ] as [number, number]; }),
      ...tower.route.map(c => [c[0], c[2]] as [number, number]),
    ],
    quarry: village.quarry,
    outerTrees: outer.trees,
  });

  // Trees a mouth's open trench cleared are gone from the list too.
  outer.trees = outer.trees.filter(t => world.get(t.x, world.topSolidY(t.x, t.z), t.z) === BlockId.Leaves);

  world.endBulk();
  world.clearEdits();
  world.markClean();
  const p = TOWER_PLAN.pad;
  const towerPad: Rect = { x0: p.x0 + ORIGIN.x, z0: p.z0 + ORIGIN.z, x1: p.x1 + ORIGIN.x, z1: p.z1 + ORIGIN.z };
  return { world, spawn, village, outer, tower: tower.info, towerRoute: tower.route, towerRects: tower.stampedRects, towerPad, caves };
}

/**
 * The caves, in order (plan Task 18): plan rooms (avoiding the Old Hideout's hall), mouths and
 * stairs, tunnels; treasure rooms; repair the floors; carve the layers, the mouths and the stairs;
 * stamp the treasure rooms and the Old Hideout; lay the trail; then light everything and set the
 * gems (the trail, lamps and furnishings are never replaced). Runs in bulk mode inside generateWorld.
 */
export function generateCaves(world: World, seed: number, ctx: MouthContext): CaveLayout {
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let t = now();
  const lap = (): number => { const n = now(); const d = n - t; t = n; return d; };
  const ground = groundTops(world);
  const plan = planCaves(world, seed, ground, ctx);
  const treasure = placeTreasureRooms(seed, plan.rooms, { shallow: plan.shallow, deep: plan.deep }, plan.reserved, plan.mouths.map(m => ({ cell: m.o })), plan.thin);
  repairFloors(plan.shallow);
  repairFloors(plan.deep);
  const planMs = lap();
  const n = world.sizeX * world.sizeY * world.sizeZ;
  const carved = new Uint8Array(n);
  const walk = new Uint8Array(n);
  carveField(world, plan.shallow, carved, walk);
  carveField(world, plan.deep, carved, walk);
  const mouths: Mouth[] = plan.mouths.map((m, id) => {
    const rect = carveMouth(world, ground, m, carved, walk);
    const ramp = m.steps.map(s => [s.x, s.f, s.z] as Cell);
    return { id, cell: [...m.o] as Cell, rect, stamped: inOld(m.o[0], m.o[2]), room: m.room.id, kind: m.kind, dir: m.dir, ramp };
  });
  const stairs = plan.stairs.map(st => carveStairs(world, st, carved, walk));
  const carveMs = lap();
  for (const tr of treasure) stampTreasure(world, plan.rooms, tr);
  const ruin = stampRuin(world, seed);
  const stampMs = lap();
  const stampedRects = mouths.filter(m => m.stamped).map(m => m.rect);
  const ring = { x0: ruin.rect.x0 - 1, z0: ruin.rect.z0 - 1, x1: ruin.rect.x1 + 1, z1: ruin.rect.z1 + 1, y0: 0, y1: 27 };
  const { trail } = layTrail(world, plan.rooms, mouths, walk, [ring, ...treasure.map(tr => ({ ...tr.rect, y0: tr.floorY - 1, y1: tr.floorY + 5 }))]);
  const trailMs = lap();
  const dress = dressCaves(world, seed, carved, stampedRects);
  const dressMs = lap();
  const tunnels = plan.lines.map(l => {
    const seen = new Set<string>();
    const line: Cell[] = [];
    for (const p of l.points) {
      const c: Cell = [Math.floor(p.x), p.f, Math.floor(p.z)];
      const k = `${c[0]},${c[2]}`;
      if (!seen.has(k)) { seen.add(k); line.push(c); }
    }
    return { a: l.a, b: l.b, line };
  });
  return {
    rooms: plan.rooms, edges: plan.edges, mouths, stairs, trail,
    lights: dress.lights, ore: dress.ore, airCells: dress.airCells, treasure, ruin, stampedRects, tunnels,
    timings: { plan: planMs, carve: carveMs, stamp: stampMs, trail: trailMs, dress: dressMs },
  };
}
