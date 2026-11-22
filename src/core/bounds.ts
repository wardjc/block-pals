/** The bigger, deeper world (spec 7h): 192 x 192 blocks, 68 high. */
export const WORLD = { x: 192, y: 68, z: 192 } as const;
/** The step 1 and step 2 world (saves of version 2 are in this box). */
export const V2_WORLD = { x: 96, y: 20, z: 96 } as const;
/** The v1 world (saves of version 1), unchanged. */
export const LEGACY_WORLD = { x: 48, y: 16, z: 48 } as const;
/** Where meadow cell (0, 0, 0) of the step 2 world sits in the big world: the old box is the exact middle. */
export const ORIGIN = { x: 48, y: 48, z: 48 } as const;
/** The old meadow ground (old y 5) in the big world. */
export const SURFACE_BASE_Y = 53;
/** Nothing is carved above this y except cave mouths, so the old region at y >= 49 never changes. */
export const CARVE_MAX_Y = 48;

export type Cell3 = [number, number, number];

/** Meadow (step 2) coordinates to world coordinates. */
export const toWorld = ([x, y, z]: Cell3): Cell3 => [x + ORIGIN.x, y + ORIGIN.y, z + ORIGIN.z];
/** World coordinates to meadow (step 2) coordinates. */
export const fromWorld = ([x, y, z]: Cell3): Cell3 => [x - ORIGIN.x, y - ORIGIN.y, z - ORIGIN.z];

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
