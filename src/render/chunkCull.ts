import { CHUNK_SIZE } from './mesher';

/** Fog is fully opaque from this VIEW DEPTH (three.js fogs by depth along the camera's forward, not by radial distance). */
export const FOG_FAR = 40;
/** Slack beyond the fog before a chunk may be hidden. */
export const CULL_MARGIN = 1.5;

/**
 * Keys ("cx,cz") of the chunks that must be drawn. A chunk is hidden only when even its nearest
 * corner is deeper along the camera's forward than FOG_FAR + CULL_MARGIN, which means every surface
 * in it is inside solid fog colour. Chunks behind or beside the camera have a small depth and stay
 * in the set: three.js's own frustum culling skips what is off screen. The chunk containing
 * (keepX, keepZ) is always kept. Fails open: any non-finite input returns every chunk.
 */
export function visibleChunks(
  sizeX: number, sizeY: number, sizeZ: number,
  camX: number, camY: number, camZ: number,
  fx: number, fy: number, fz: number,
  keepX: number = camX, keepZ: number = camZ,
): Set<string> {
  const cxs = Math.ceil(sizeX / CHUNK_SIZE);
  const czs = Math.ceil(sizeZ / CHUNK_SIZE);
  const all = ![camX, camY, camZ, fx, fy, fz].every(Number.isFinite);
  const keepKey = `${Math.floor(keepX / CHUNK_SIZE)},${Math.floor(keepZ / CHUNK_SIZE)}`;
  const out = new Set<string>();
  const limit = FOG_FAR + CULL_MARGIN;
  for (let cz = 0; cz < czs; cz++) {
    for (let cx = 0; cx < cxs; cx++) {
      const key = `${cx},${cz}`;
      if (!all && key !== keepKey) {
        const x0 = cx * CHUNK_SIZE, x1 = Math.min(sizeX, x0 + CHUNK_SIZE);
        const z0 = cz * CHUNK_SIZE, z1 = Math.min(sizeZ, z0 + CHUNK_SIZE);
        // Depth is linear in position, so the minimum over the box is at one of its corners.
        const dx = (fx >= 0 ? x0 : x1) - camX, dz = (fz >= 0 ? z0 : z1) - camZ, dy = (fy >= 0 ? 0 : sizeY) - camY;
        if (dx * fx + dy * fy + dz * fz > limit) continue;
      }
      out.add(key);
    }
  }
  return out;
}

/**
 * The visible chunk set, recomputed from the camera's real position and direction every frame
 * (a few hundred multiplications), handing back the same Set object until its contents change.
 */
export class ChunkCuller {
  private set: Set<string> | null = null;

  constructor(private readonly sizeX: number, private readonly sizeY: number, private readonly sizeZ: number) {}

  update(
    camX: number, camY: number, camZ: number, fx: number, fy: number, fz: number, keepX: number, keepZ: number,
  ): Set<string> {
    const next = visibleChunks(this.sizeX, this.sizeY, this.sizeZ, camX, camY, camZ, fx, fy, fz, keepX, keepZ);
    const prev = this.set;
    if (prev && prev.size === next.size && [...next].every(k => prev.has(k))) return prev;
    this.set = next;
    return next;
  }
}
