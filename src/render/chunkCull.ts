import { CHUNK_SIZE, SECTION_HEIGHT } from './mesher';

/**
 * Fog is fully opaque from this VIEW DEPTH (three.js fogs by depth along the camera's forward, not by
 * radial distance). Since the longer view (Task 10b) this is the MINIMUM fog end: the live value is
 * viewFog(distance).far, between 40 and 96.
 */
export const FOG_FAR = 40;
/** Slack beyond the fog before a chunk or section may be hidden. */
export const CULL_MARGIN = 1.5;

/**
 * Keys ("cx,cz") of the chunks that must be drawn. A chunk is hidden only when even its nearest
 * corner is deeper along the camera's forward than fogEnd + CULL_MARGIN, which means every surface
 * in it is inside solid fog colour. Chunks behind or beside the camera have a small depth and stay
 * in the set: three.js's own frustum culling skips what is off screen. The chunk containing
 * (keepX, keepZ) is always kept. Fails open: any non-finite input returns every chunk.
 */
export function visibleChunks(
  sizeX: number, sizeY: number, sizeZ: number,
  camX: number, camY: number, camZ: number,
  fx: number, fy: number, fz: number,
  keepX: number = camX, keepZ: number = camZ,
  fogEnd: number = FOG_FAR,
): Set<string> {
  const cxs = Math.ceil(sizeX / CHUNK_SIZE);
  const czs = Math.ceil(sizeZ / CHUNK_SIZE);
  const all = ![camX, camY, camZ, fx, fy, fz, fogEnd].every(Number.isFinite);
  const keepKey = `${Math.floor(keepX / CHUNK_SIZE)},${Math.floor(keepZ / CHUNK_SIZE)}`;
  const out = new Set<string>();
  const limit = fogEnd + CULL_MARGIN;
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

/** Where the camera is, for the draw rule: out in the open, or down in the rock and caves. */
export type CameraZone = 'outdoors' | 'underground';
/**
 * Within this many blocks (horizontally) of a cave mouth, and no more than MOUTH_ABOVE above its
 * doorway, counts as underground. (The plan said "below y 60"; the meadow's mouths sit at y 53 to
 * 59, so the camera behind his head at a mouth is often above 60: the rule is relative to the mouth.)
 */
export const MOUTH_NEAR = 24;
export const MOUTH_ABOVE = 8;
/** Underground, sections whose y-range overlaps the camera's height plus or minus this are drawn. */
export const ZONE_Y_WINDOW = 20;
/** Outdoors, sections from this height up (the old surface: y 48..67) are drawn; deeper ones only where the ground dips (see floorSection). */
export const SURFACE_SECTION_Y = 48;
/**
 * A point is drawable only if its view depth is within the fog end, and the camera's frustum then
 * limits how far to the side it can be: distance <= depth / cos(half the diagonal field of view). At
 * 60 degrees vertical and up to a 2.3 aspect that is under 1.8 times the depth.
 */
export const DEFAULT_RADIAL_FACTOR = 1.8;

/** The radial factor for a camera: 1 / cos(half the diagonal field of view). */
export function radialFactor(vfovDeg: number, aspect: number): number {
  const t = Math.tan((vfovDeg * Math.PI) / 360);
  const f = Math.sqrt(1 + t * t * (1 + aspect * aspect));
  return Number.isFinite(f) && f >= 1 ? f : DEFAULT_RADIAL_FACTOR;
}

/** The part of a world the zone rule reads. */
interface ZoneWorld { topSolidY(x: number, z: number): number }

/**
 * Underground when the camera is inside the ground mass (more than 1 below the top of its column), or
 * within MOUTH_NEAR blocks of a cave mouth horizontally and at most MOUTH_ABOVE above it (so looking
 * into a tunnel from its doorway already shows the cave). Non-finite numbers count as outdoors.
 */
export function cameraZone(
  world: ZoneWorld, camX: number, camY: number, camZ: number, mouths: ReadonlyArray<readonly [number, number, number]>,
): CameraZone {
  if (![camX, camY, camZ].every(Number.isFinite)) return 'outdoors';
  if (camY < world.topSolidY(Math.floor(camX), Math.floor(camZ)) - 1) return 'underground';
  for (const m of mouths) {
    if (camY <= m[1] + MOUTH_ABOVE && Math.hypot(m[0] + 0.5 - camX, m[2] + 0.5 - camZ) <= MOUTH_NEAR) return 'underground';
  }
  return 'outdoors';
}

export interface SectionCullOptions {
  /**
   * Outdoors, the lowest section index drawn in a column (default SURFACE_SECTION_Y / 16, never above
   * the top section). The scene passes the lowest ground top round the column, so a shaft he digs, a
   * pond bed or a quarry floor is never a hole.
   */
  floorSection?: (cx: number, cz: number) => number;
  /** See DEFAULT_RADIAL_FACTOR; the scene passes radialFactor(fov, aspect). */
  radialFactor?: number;
}

/**
 * Keys ("cx,sy,cz") of the 16 x 16 x 16 sections that must be drawn: the view-depth rule of
 * visibleChunks per section box (hidden only when its nearest corner is deeper than fogEnd +
 * CULL_MARGIN), a radial bound (nothing farther than that times the frustum's radial factor can be
 * on screen inside the fog), and the zone rule: outdoors the surface sections (from floorSection
 * up), underground the sections overlapping the camera's height +/- ZONE_Y_WINDOW. The column
 * containing (keepX, keepZ) skips the distance rules. Fails open: any non-finite number returns
 * every section.
 */
export function visibleSections(
  sizeX: number, sizeY: number, sizeZ: number,
  camX: number, camY: number, camZ: number, fx: number, fy: number, fz: number,
  zone: CameraZone, keepX: number, keepZ: number,
  fogEnd: number = FOG_FAR, opts: SectionCullOptions = {},
): Set<string> {
  const cxs = Math.ceil(sizeX / CHUNK_SIZE);
  const czs = Math.ceil(sizeZ / CHUNK_SIZE);
  const sys = Math.ceil(sizeY / SECTION_HEIGHT);
  const out = new Set<string>();
  const radial = opts.radialFactor ?? DEFAULT_RADIAL_FACTOR;
  if (![camX, camY, camZ, fx, fy, fz, keepX, keepZ, fogEnd, radial].every(Number.isFinite)) {
    for (let cz = 0; cz < czs; cz++) for (let cx = 0; cx < cxs; cx++) for (let sy = 0; sy < sys; sy++) out.add(`${cx},${sy},${cz}`);
    return out;
  }
  const limit = fogEnd + CULL_MARGIN;
  const reach = limit * Math.max(1, radial);
  const keepCx = Math.floor(keepX / CHUNK_SIZE), keepCz = Math.floor(keepZ / CHUNK_SIZE);
  const defaultFloor = Math.min(sys - 1, Math.floor(SURFACE_SECTION_Y / SECTION_HEIGHT));
  for (let cz = 0; cz < czs; cz++) {
    const z0 = cz * CHUNK_SIZE, z1 = Math.min(sizeZ, z0 + CHUNK_SIZE);
    for (let cx = 0; cx < cxs; cx++) {
      const x0 = cx * CHUNK_SIZE, x1 = Math.min(sizeX, x0 + CHUNK_SIZE);
      const keep = cx === keepCx && cz === keepCz;
      const hx = Math.max(x0 - camX, 0, camX - x1), hz = Math.max(z0 - camZ, 0, camZ - z1);
      if (!keep && Math.hypot(hx, hz) > reach) continue;
      const floor = zone === 'outdoors' ? Math.max(0, Math.min(sys - 1, opts.floorSection?.(cx, cz) ?? defaultFloor)) : 0;
      for (let sy = floor; sy < sys; sy++) {
        const y0 = sy * SECTION_HEIGHT, y1 = Math.min(sizeY, y0 + SECTION_HEIGHT);
        if (zone === 'underground' && (y1 < camY - ZONE_Y_WINDOW || y0 > camY + ZONE_Y_WINDOW)) continue;
        if (!keep) {
          const dx = (fx >= 0 ? x0 : x1) - camX, dy = (fy >= 0 ? y0 : y1) - camY, dz = (fz >= 0 ? z0 : z1) - camZ;
          if (dx * fx + dy * fy + dz * fz > limit) continue;
        }
        out.add(`${cx},${sy},${cz}`);
      }
    }
  }
  return out;
}

/**
 * Lazy first builds of sections, nearest (lowest priority number) first, at most `max` per frame.
 * A key is built once; `requeue` (a section disposed, or changed while unbuilt) lets it be queued again.
 */
export class SectionQueue {
  private readonly pending = new Map<string, number>();
  private readonly built = new Set<string>();

  constructor(readonly max = 2) {}

  /** Sections waiting for their first build. */
  get size(): number {
    return this.pending.size;
  }

  isBuilt(key: string): boolean {
    return this.built.has(key);
  }

  /** Queues a section not yet built, or updates its priority. */
  enqueue(key: string, priority: number): void {
    if (this.built.has(key) || !Number.isFinite(priority)) return;
    this.pending.set(key, priority);
  }

  /** Drops every pending key not in `keep` (they left the view before being built). */
  retain(keep: Set<string>): void {
    for (const k of this.pending.keys()) if (!keep.has(k)) this.pending.delete(k);
  }

  /** The next section to build (marked built), or null. */
  next(): string | null {
    let best: string | null = null;
    let bestP = Infinity;
    for (const [k, p] of this.pending) if (p < bestP) { best = k; bestP = p; }
    if (best === null) return null;
    this.pending.delete(best);
    this.built.add(best);
    return best;
  }

  /** Up to `max` sections for this frame, nearest first. */
  take(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.max; i++) {
      const k = this.next();
      if (k === null) break;
      out.push(k);
    }
    return out;
  }

  /** A section that must be built again (it was disposed, or changed while unbuilt). */
  requeue(key: string, priority?: number): void {
    this.built.delete(key);
    if (priority !== undefined) this.enqueue(key, priority);
  }

  /** Marks a section built outside the queue (the first-frame build). */
  markBuilt(key: string): void {
    this.pending.delete(key);
    this.built.add(key);
  }
}
