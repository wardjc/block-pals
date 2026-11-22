import { BLOCKS, BlockId } from '../core/blocks';
import type { World } from '../core/world';

export type Face = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export interface ChunkGeometry extends MeshArrays {
  transparent: MeshArrays;
  /** The chunk holds a block whose tile shimmers (the scene repaints the atlas only while one is visible). */
  hasShimmer: boolean;
}

export type UvFor = (id: BlockId, face: Face) => [number, number, number, number];

export const CHUNK_SIZE = 16;

interface FaceDef {
  face: Face;
  normal: [number, number, number];
  corners: [number, number, number][]; // counter-clockwise seen from outside
}

const FACES: FaceDef[] = [
  { face: 'top', normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { face: 'bottom', normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { face: 'south', normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { face: 'north', normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { face: 'east', normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { face: 'west', normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
];

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  quad(x: number, y: number, z: number, def: FaceDef, uv: [number, number, number, number]): void {
    const base = this.positions.length / 3;
    const [u0, v0, u1, v1] = uv;
    const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (let i = 0; i < 4; i++) {
      const c = def.corners[i];
      this.positions.push(x + c[0], y + c[1], z + c[2]);
      this.normals.push(def.normal[0], def.normal[1], def.normal[2]);
      this.uvs.push(uvs[i * 2], uvs[i * 2 + 1]);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Two crossed vertical planes (an X seen from above), each emitted with both windings so the
   * single-sided material shows them from every side: 4 quads, 16 vertices, 8 triangles. Normals
   * point up, so a plant is lit like the sky whichever way it faces.
   */
  cross(x: number, y: number, z: number, uv: [number, number, number, number]): void {
    const [u0, v0, u1, v1] = uv;
    const planes: Array<[number, number, number, number]> = [[0, 0, 1, 1], [1, 0, 0, 1]];
    for (const [ax, az, bx, bz] of planes) {
      for (const flip of [false, true]) {
        const base = this.positions.length / 3;
        const [lx, lz, rx, rz] = flip ? [bx, bz, ax, az] : [ax, az, bx, bz];
        // left-bottom, right-bottom, right-top, left-top (texture left to right follows the order)
        this.positions.push(
          x + lx, y, z + lz, x + rx, y, z + rz,
          x + rx, y + 1, z + rz, x + lx, y + 1, z + lz,
        );
        for (let i = 0; i < 4; i++) this.normals.push(0, 1, 0);
        this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  finish(): MeshArrays {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Mesh sections are 16 x 16 x 16: five per column in the 68-high world (y 0..15, ..., 64..67). */
export const SECTION_HEIGHT = 16;
export const sectionsPerColumn = (sizeY: number): number => Math.ceil(sizeY / SECTION_HEIGHT);

/** Per block id: 0 nothing, 1 opaque cube, 2 transparent cube, 3 cross plant (looked up once per cell). */
const KIND = new Uint8Array(256);
/** 1 when a neighbour of this id lets a face show (air, or a transparent block). */
const SEE_THROUGH = new Uint8Array(256);
const SHIMMER = new Uint8Array(256);
for (const [key, def] of Object.entries(BLOCKS)) {
  const id = Number(key);
  KIND[id] = id === BlockId.Air ? 0 : def.shape === 'cross' ? 3 : def.transparent ? 2 : 1;
  SEE_THROUGH[id] = id === BlockId.Air || def.transparent ? 1 : 0;
  SHIMMER[id] = def.shimmer ? 1 : 0;
}
SEE_THROUGH[BlockId.Air] = 1;

/** uvFor answers allocate; the mesher asks the same few (id, face) pairs thousands of times. */
const uvCaches = new WeakMap<UvFor, Array<[number, number, number, number] | undefined>>();
const FACE_INDEX: Record<Face, number> = { top: 0, bottom: 1, south: 2, north: 3, east: 4, west: 5 };
function cachedUv(uvFor: UvFor): (id: BlockId, face: Face) => [number, number, number, number] {
  let cache = uvCaches.get(uvFor);
  if (!cache) { cache = []; uvCaches.set(uvFor, cache); }
  const c = cache;
  return (id, face) => {
    const k = id * 6 + FACE_INDEX[face];
    return c[k] ?? (c[k] = uvFor(id, face));
  };
}

/**
 * Geometry (world coordinates) of the 16 x 16 x 16 section (cx, sy, cz). Every neighbour is read
 * from the world buffer by index arithmetic. A neighbour outside the world in x or z counts as solid,
 * so the world's four outside walls emit nothing (never seen from inside); below y 0 is bedrock and
 * above the top is air, as World.get says. Faces otherwise as before: a cube face shows next to air or
 * a different transparent block; a cross plant is two crossed planes in the transparent mesh.
 */
export function buildSectionGeometry(world: World, cx: number, sy: number, cz: number, uvFor: UvFor): ChunkGeometry {
  const solid = new Builder();
  const trans = new Builder();
  const uv = cachedUv(uvFor);
  const SX = world.sizeX, SY = world.sizeY, SZ = world.sizeZ;
  const layer = SX * SZ;
  const cells = world.buffer;
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE, y0 = sy * SECTION_HEIGHT;
  const x1 = Math.min(x0 + CHUNK_SIZE, SX), z1 = Math.min(z0 + CHUNK_SIZE, SZ), y1 = Math.min(y0 + SECTION_HEIGHT, SY);
  let hasShimmer = false;
  const OUTSIDE = BlockId.Bedrock; // opaque: no face on the world's outside walls
  // Neighbour ids in FACES order: top, bottom, south (+z), north (-z), east (+x), west (-x).
  const n = [0, 0, 0, 0, 0, 0];

  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let z = Math.max(0, z0); z < z1; z++) {
      let i = x0 + SX * (z + SZ * y);
      for (let x = Math.max(0, x0); x < x1; x++, i++) {
        const id = cells[i];
        const kind = KIND[id];
        if (kind === 0) continue;
        if (SHIMMER[id] === 1) hasShimmer = true;
        if (kind === 3) {
          trans.cross(x, y, z, uv(id, 'south'));
          continue;
        }
        n[0] = y + 1 < SY ? cells[i + layer] : BlockId.Air;
        n[1] = y > 0 ? cells[i - layer] : BlockId.Bedrock;
        n[2] = z + 1 < SZ ? cells[i + SX] : OUTSIDE;
        n[3] = z > 0 ? cells[i - SX] : OUTSIDE;
        n[4] = x + 1 < SX ? cells[i + 1] : OUTSIDE;
        n[5] = x > 0 ? cells[i - 1] : OUTSIDE;
        const target = kind === 2 ? trans : solid;
        for (let f = 0; f < 6; f++) {
          const nid = n[f];
          if (SEE_THROUGH[nid] === 1 && (nid === BlockId.Air || nid !== id)) target.quad(x, y, z, FACES[f], uv(id, FACES[f].face));
        }
      }
    }
  }

  return { ...solid.finish(), transparent: trans.finish(), hasShimmer };
}

function concat(parts: MeshArrays[]): MeshArrays {
  let p = 0, idx = 0;
  for (const a of parts) { p += a.positions.length; idx += a.indices.length; }
  const out: MeshArrays = {
    positions: new Float32Array(p), normals: new Float32Array(p), uvs: new Float32Array((p / 3) * 2), indices: new Uint32Array(idx),
  };
  let vp = 0, ip = 0;
  for (const a of parts) {
    const base = vp / 3;
    out.positions.set(a.positions, vp);
    out.normals.set(a.normals, vp);
    out.uvs.set(a.uvs, (vp / 3) * 2);
    for (let k = 0; k < a.indices.length; k++) out.indices[ip + k] = a.indices[k] + base;
    vp += a.positions.length;
    ip += a.indices.length;
  }
  return out;
}

/**
 * Geometry for the whole 16 x 16 column (cx, cz): its sections joined. Kept for the step 2 tests and
 * budget checks; the scene draws sections.
 */
export function buildChunkGeometry(world: World, cx: number, cz: number, uvFor: UvFor): ChunkGeometry {
  const parts: ChunkGeometry[] = [];
  for (let sy = 0; sy < sectionsPerColumn(world.sizeY); sy++) parts.push(buildSectionGeometry(world, cx, sy, cz, uvFor));
  return { ...concat(parts), transparent: concat(parts.map(g => g.transparent)), hasShimmer: parts.some(g => g.hasShimmer) };
}
