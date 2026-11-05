import { BlockId } from './blocks';
import { mulberry32, valueNoise2D } from './rng';
import { World } from './world';

export function generateWorld(seed = 2026): {
  world: World;
  spawn: { x: number; y: number; z: number };
} {
  const world = new World(48, 16, 48);
  const noise = valueNoise2D(seed);
  const random = mulberry32(seed);
  const heights = new Uint8Array(world.sizeX * world.sizeZ);
  const plateau = 5 + Math.round(noise(24 / 12, 24 / 12) * 4);

  for (let z = 0; z < world.sizeZ; z++) {
    for (let x = 0; x < world.sizeX; x++) {
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
  const trees: Array<{ x: number; z: number }> = [];
  const plantTree = (x: number, z: number): boolean => {
    const ground = heights[x + world.sizeX * z];
    if (world.get(x, ground, z) !== BlockId.Grass || ground + 6 >= world.sizeY) return false;
    // Include the canopy in the three-column clearing and keep trees separate.
    if (Math.max(Math.abs(x - spawn.x), Math.abs(z - spawn.z)) <= 4) return false;
    if (trees.some(tree => Math.max(Math.abs(x - tree.x), Math.abs(z - tree.z)) < 5)) return false;

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
  };

  // Three well-spaced trees per side guarantee a denser ring, 2–4 cells in.
  for (let side = 0; side < 4; side++) {
    for (const anchor of [8, 24, 40]) {
      const along = anchor + Math.floor(random() * 5) - 2;
      const inset = 2 + Math.floor(random() * 3);
      if (side === 0) plantTree(along, inset);
      if (side === 1) plantTree(47 - inset, along);
      if (side === 2) plantTree(along, 47 - inset);
      if (side === 3) plantTree(inset, along);
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
    plantTree(candidate.x, candidate.z);
  }

  world.clearEdits();
  world.markClean();
  return { world, spawn };
}
