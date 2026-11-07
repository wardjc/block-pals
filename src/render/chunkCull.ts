import { CHUNK_SIZE } from './mesher';

/**
 * Chunks whose nearest point is farther than this are completely inside the fog (fully opaque at
 * 40, see scene.ts FOG_FAR) so hiding them changes nothing he can see. One block of slack.
 */
export const FOG_FAR = 40;
export const CULL_RADIUS = FOG_FAR + 2;

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
