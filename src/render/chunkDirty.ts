import { CHUNK_SIZE, SECTION_HEIGHT } from './mesher';

/**
 * Chunks waiting for a rebuild. Many block changes in one frame (a tree growing, apples picked, a
 * field ripening) mark the same few chunks, and each is rebuilt once. A cell on a chunk edge also
 * marks its neighbour. (Step 2's whole-column chunks; the scene now uses DirtySections.)
 */
export class DirtyChunks {
  private readonly keys = new Map<number, [number, number]>();
  private readonly cxs: number;
  private readonly czs: number;

  constructor(sizeX: number, sizeZ: number) {
    this.cxs = Math.ceil(sizeX / CHUNK_SIZE);
    this.czs = Math.ceil(sizeZ / CHUNK_SIZE);
  }

  get size(): number {
    return this.keys.size;
  }

  mark(x: number, z: number): void {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const xs = [cx];
    const zs = [cz];
    if (lx === 0) xs.push(cx - 1);
    if (lx === CHUNK_SIZE - 1) xs.push(cx + 1);
    if (lz === 0) zs.push(cz - 1);
    if (lz === CHUNK_SIZE - 1) zs.push(cz + 1);
    for (const a of xs) for (const b of zs) {
      if (a < 0 || b < 0 || a >= this.cxs || b >= this.czs) continue;
      this.keys.set(a * 4096 + b, [a, b]);
    }
  }

  /** Removes and returns up to `max` chunks, nearest to the world point (px, pz) first. */
  take(max: number, px: number, pz: number): Array<[number, number]> {
    if (this.keys.size === 0) return [];
    const all = [...this.keys.values()].sort((u, v) =>
      Math.hypot((u[0] + 0.5) * CHUNK_SIZE - px, (u[1] + 0.5) * CHUNK_SIZE - pz)
      - Math.hypot((v[0] + 0.5) * CHUNK_SIZE - px, (v[1] + 0.5) * CHUNK_SIZE - pz));
    const out = all.slice(0, max);
    for (const [a, b] of out) this.keys.delete(a * 4096 + b);
    return out;
  }
}

export type SectionCoord = [cx: number, sy: number, cz: number];

/** The "cx,sy,cz" key the scene stores section meshes under. */
export const sectionKey = (cx: number, sy: number, cz: number): string => `${cx},${sy},${cz}`;

/**
 * 16 x 16 x 16 sections waiting for a rebuild. A changed cell marks its own section, plus the one
 * across each border it sits on (a face of a neighbour cell can only live in a face-neighbour
 * section), so one change marks at most 4 sections (a corner cell). Many changes in one frame mark
 * each section once.
 */
export class DirtySections {
  private readonly keys = new Map<number, SectionCoord>();
  private readonly cxs: number;
  private readonly sys: number;
  private readonly czs: number;

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.cxs = Math.ceil(sizeX / CHUNK_SIZE);
    this.sys = Math.ceil(sizeY / SECTION_HEIGHT);
    this.czs = Math.ceil(sizeZ / CHUNK_SIZE);
  }

  get size(): number {
    return this.keys.size;
  }

  has(cx: number, sy: number, cz: number): boolean {
    return this.keys.has(this.code(cx, sy, cz));
  }

  private code(cx: number, sy: number, cz: number): number {
    return (cx * 64 + sy) * 4096 + cz;
  }

  private add(cx: number, sy: number, cz: number): void {
    if (cx < 0 || sy < 0 || cz < 0 || cx >= this.cxs || sy >= this.sys || cz >= this.czs) return;
    this.keys.set(this.code(cx, sy, cz), [cx, sy, cz]);
  }

  mark(x: number, y: number, z: number): void {
    const cx = Math.floor(x / CHUNK_SIZE);
    const sy = Math.floor(y / SECTION_HEIGHT);
    const cz = Math.floor(z / CHUNK_SIZE);
    this.add(cx, sy, cz);
    const lx = x - cx * CHUNK_SIZE, ly = y - sy * SECTION_HEIGHT, lz = z - cz * CHUNK_SIZE;
    if (lx === 0) this.add(cx - 1, sy, cz);
    if (lx === CHUNK_SIZE - 1) this.add(cx + 1, sy, cz);
    if (ly === 0) this.add(cx, sy - 1, cz);
    if (ly === SECTION_HEIGHT - 1) this.add(cx, sy + 1, cz);
    if (lz === 0) this.add(cx, sy, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.add(cx, sy, cz + 1);
  }

  /** Marks one section itself (no neighbours). */
  markSection(cx: number, sy: number, cz: number): void {
    this.add(cx, sy, cz);
  }

  /** Removes and returns up to `max` sections, nearest to the world point (px, py, pz) first. */
  take(max: number, px: number, py: number, pz: number): SectionCoord[] {
    if (this.keys.size === 0 || max <= 0) return [];
    const d = (s: SectionCoord): number => Math.hypot(
      (s[0] + 0.5) * CHUNK_SIZE - px, (s[1] + 0.5) * SECTION_HEIGHT - py, (s[2] + 0.5) * CHUNK_SIZE - pz);
    const all = [...this.keys.values()];
    const out = all.length <= max ? all : all.sort((u, v) => d(u) - d(v)).slice(0, max);
    if (all.length <= max) out.sort((u, v) => d(u) - d(v));
    for (const [a, b, c] of out) this.keys.delete(this.code(a, b, c));
    return out;
  }
}
