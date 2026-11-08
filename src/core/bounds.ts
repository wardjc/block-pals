export const WORLD = { x: 96, y: 20, z: 96 } as const;
export const LEGACY_WORLD = { x: 48, y: 16, z: 48 } as const;

const EPSILON = 1e-8;

/** Soft wall: cells must be one block inside every edge. */
export function insideWall(world: { sizeX: number; sizeZ: number }, x: number, z: number): boolean {
  return x >= 1 && x <= world.sizeX - 2 && z >= 1 && z <= world.sizeZ - 2;
}

/** Clamp world-unit positions just below the outer cell on each axis. */
export function clampToWall(world: { sizeX: number; sizeZ: number }, x: number, z: number): { x: number; z: number } {
  return {
    x: Math.max(1, Math.min(world.sizeX - 1 - EPSILON, x)),
    z: Math.max(1, Math.min(world.sizeZ - 1 - EPSILON, z)),
  };
}
