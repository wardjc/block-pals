import { CHUNK_SIZE } from './mesher';

/** Fog is fully opaque from here (scene.ts uses the same number). */
export const FOG_FAR = 40;
/** The camera may drift this far from where the visible set was last computed before it is recomputed. */
export const CULL_MOVE = 2;
/**
 * Chunks whose nearest point is farther than this from the position the set was computed at are
 * completely inside the fog, even after the camera has drifted CULL_MOVE away: hiding them changes
 * nothing he can see. One block of slack.
 */
export const CULL_RADIUS = FOG_FAR + CULL_MOVE + 1;

/**
 * Keys ("cx,cz") of the chunks whose rectangle is within `radius` of the column (x, z).
 * Fails open: a position that is not a finite number returns every chunk, never a blank world.
 */
export function visibleChunks(sizeX: number, sizeZ: number, x: number, z: number, radius: number = CULL_RADIUS): Set<string> {
  const cxs = Math.ceil(sizeX / CHUNK_SIZE);
  const czs = Math.ceil(sizeZ / CHUNK_SIZE);
  const all = !Number.isFinite(x) || !Number.isFinite(z);
  const out = new Set<string>();
  for (let cz = 0; cz < czs; cz++) {
    for (let cx = 0; cx < cxs; cx++) {
      if (!all) {
        const x0 = cx * CHUNK_SIZE, x1 = Math.min(sizeX, x0 + CHUNK_SIZE);
        const z0 = cz * CHUNK_SIZE, z1 = Math.min(sizeZ, z0 + CHUNK_SIZE);
        const dx = Math.max(x0 - x, 0, x - x1);
        const dz = Math.max(z0 - z, 0, z - z1);
        if (Math.hypot(dx, dz) > radius) continue;
      }
      out.add(`${cx},${cz}`);
    }
  }
  return out;
}

/**
 * The visible chunk set that follows the real camera: recomputed whenever the camera is more than
 * CULL_MOVE blocks from where it was last computed (not only when it changes chunk), so a chunk
 * inside the fog is never hidden and the chunk he stands in is always drawn.
 */
export class ChunkCuller {
  private set: Set<string> | null = null;
  private x = NaN;
  private z = NaN;

  constructor(private readonly sizeX: number, private readonly sizeZ: number) {}

  /** The current set (the same object until it has to change). */
  update(x: number, z: number): Set<string> {
    if (this.set && Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - this.x, z - this.z) <= CULL_MOVE) return this.set;
    this.set = visibleChunks(this.sizeX, this.sizeZ, x, z);
    this.x = x;
    this.z = z;
    return this.set;
  }

  /** The set from the last update, or null before the first (draw everything). */
  get current(): Set<string> | null {
    return this.set;
  }
}
