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

/** Builds geometry (in world coordinates) for the 16x16-column chunk (cx, cz). */
export function buildChunkGeometry(world: World, cx: number, cz: number, uvFor: UvFor): ChunkGeometry {
  const solid = new Builder();
  const trans = new Builder();
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const x1 = Math.min(x0 + CHUNK_SIZE, world.sizeX);
  const z1 = Math.min(z0 + CHUNK_SIZE, world.sizeZ);
  let hasShimmer = false;

  for (let y = 0; y < world.sizeY; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const id = world.get(x, y, z);
        if (id === BlockId.Air) continue;
        if (BLOCKS[id].shimmer) hasShimmer = true;
        if (BLOCKS[id].shape === 'cross') {
          trans.cross(x, y, z, uvFor(id, 'south'));
          continue;
        }
        const isTrans = BLOCKS[id].transparent;
        const target = isTrans ? trans : solid;
        for (const def of FACES) {
          const n = def.normal;
          const nid = world.get(x + n[0], y + n[1], z + n[2]);
          const show = nid === BlockId.Air || (BLOCKS[nid].transparent && nid !== id);
          if (show) target.quad(x, y, z, def, uvFor(id, def.face));
        }
      }
    }
  }

  return { ...solid.finish(), transparent: trans.finish(), hasShimmer };
}
