import type { HouseInfo } from '../core/houses';

export interface Box { min: [number, number, number]; max: [number, number, number] }

/** Where a door sign hangs: centre, outward wall normal (x/z unit step) and square size. */
export interface EmblemPlacement { x: number; y: number; z: number; nx: number; nz: number; size: number }

export const EMBLEM_SIZE = 1.2;
/** Air between the wall face and the sign. */
export const EMBLEM_GAP = 0.15;

/**
 * The sign is a flat square fixed to the door wall, facing out, a small gap in front of the wall face and
 * above the door (on the lintel row, under the roof line).
 */
export function emblemPlacement(house: HouseInfo): EmblemPlacement {
  const [dx, , dz] = house.doorCells[0];
  const nx = Math.sign(house.doorFront[0] - dx);
  const nz = Math.sign(house.doorFront[2] - dz);
  const cx = house.doorCells.reduce((a, c) => a + c[0] + 0.5, 0) / house.doorCells.length;
  const cz = house.doorCells.reduce((a, c) => a + c[2] + 0.5, 0) / house.doorCells.length;
  // Face of the wall on the outside: far edge of the door cell when facing +, near edge when facing -.
  const wallX = dx + (nx > 0 ? 1 : 0);
  const wallZ = dz + (nz > 0 ? 1 : 0);
  return {
    x: nx !== 0 ? wallX + nx * EMBLEM_GAP : cx,
    y: house.groundY + 5, // lintel row is groundY+4..+5, ceiling to +6; the sign spans +4.4..+5.6
    z: nz !== 0 ? wallZ + nz * EMBLEM_GAP : cz,
    nx, nz, size: EMBLEM_SIZE,
  };
}

/** The sign's world bounding box (it is paper-thin along the wall normal). */
export function emblemBox(p: EmblemPlacement): Box {
  const h = p.size / 2;
  const hx = p.nx !== 0 ? 0 : h;
  const hz = p.nz !== 0 ? 0 : h;
  return { min: [p.x - hx, p.y - h, p.z - hz], max: [p.x + hx, p.y + h, p.z + hz] };
}
