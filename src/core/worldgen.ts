import { BlockId } from './blocks';
import { insideWall, LEGACY_WORLD, WORLD } from './bounds';
import { mulberry32, valueNoise2D } from './rng';
import { buildVillage, type Rect, type VillageLayout } from './village';
import { World } from './world';

/** Bump when later steps add stamps, so saves can tell which generator made the world. */
export const GEN_VERSION = 2;

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

/** The v1 height formula in absolute coordinates: beyond x or z 47 the same noise rolls on. */
export function heightAt(seed: number, x: number, z: number): number {
  const noise = valueNoise2D(seed);
  const plateau = 5 + Math.round(noise(24 / 12, 24 / 12) * 4);
  return column(noise, plateau, x, z).height;
}

export interface GeneratedWorld {
  world: World;
  spawn: { x: number; y: number; z: number };
  village: VillageLayout;
}

function plantTree(
  world: World, heights: Uint8Array, trees: Tree[], spawn: Cell3, x: number, z: number, maxY: number,
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
 * and constants, so the v1 meadow is bit-identical). No stamps. Exposed for tests.
 */
export function generateMeadowStage(seed = 2026): {
  world: World; spawn: Cell3; heights: Uint8Array; trees: Tree[];
} {
  const world = new World(WORLD.x, WORLD.y, WORLD.z);
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

export function generateWorld(seed = 2026): GeneratedWorld {
  // Stages 1 and 2.
  const { world, spawn, heights, trees } = generateMeadowStage(seed);

  // Stage 3: pads, houses and the path (Task 5).
  const village = buildVillage(world, spawn);

  // Stage 4: edge ring and scatter on the new ground, from its own stream.
  const random = mulberry32((seed ^ 0x5eed) >>> 0);
  const blocked = (x: number, z: number): boolean =>
    !insideWall(world, x, z)
    || !(x >= 50 || z >= 50)
    || village.stampedRects.some(rect => inRect(rect, x, z, 3));
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

  world.clearEdits();
  world.markClean();
  return { world, spawn, village };
}
