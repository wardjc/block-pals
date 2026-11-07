import { BlockId } from '../core/blocks';
import type { World } from '../core/world';

/** What a ray stops at: anything but air and water (leaves and glass count). */
export function blocksRay(id: BlockId): boolean {
  return id !== BlockId.Air && id !== BlockId.Water;
}

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Face entered through; all zero when the ray started inside this cell. */
  nx: number;
  ny: number;
  nz: number;
  /** Distance along the (unit) direction at which the ray entered the cell. */
  t: number;
}

/**
 * Voxel DDA (Amanatides and Woo) through in-bounds cells. Fills `out` with the first cell that
 * blocks the ray within maxT and returns true. With skipStart, the cell the ray starts in is
 * ignored (picking from a camera that may sit in a leaf). `d` must be a unit vector.
 * Allocation-free, so it can run every frame.
 */
export function castVoxelRay(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxT: number,
  skipStart: boolean,
  out: VoxelHit,
): boolean {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
  let tMaxX = dx === 0 ? Infinity : (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX;
  let tMaxY = dy === 0 ? Infinity : (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY;
  let tMaxZ = dz === 0 ? Infinity : (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ;
  let nx = 0, ny = 0, nz = 0, t = 0;
  let first = true;
  const maxSteps = Math.ceil(maxT * 3) + 3;

  for (let i = 0; i < maxSteps; i++) {
    if (!(first && skipStart) && world.inBounds(x, y, z) && blocksRay(world.get(x, y, z))) {
      out.x = x; out.y = y; out.z = z;
      out.nx = nx; out.ny = ny; out.nz = nz;
      out.t = t;
      return true;
    }
    first = false;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX; x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY; y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxT) break;
  }
  return false;
}
