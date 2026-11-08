import { CHUNK_SIZE } from './mesher';

/**
 * Chunks waiting for a rebuild. Many block changes in one frame (a tree growing, apples picked, a
 * field ripening) mark the same few chunks, and each is rebuilt once. A cell on a chunk edge also
 * marks its neighbour.
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
