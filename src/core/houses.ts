import { BLOCKS, BlockId } from './blocks';
import type { Cell } from './pathfind';
import type { World } from './world';

/** Inclusive rectangle on the x/z plane. */
export interface Rect { x0: number; z0: number; x1: number; z1: number }
/** Side the door is on; north = -z. */
export type Facing = 'north' | 'south' | 'east' | 'west';
export type HouseId = 'cottage' | 'bakery' | 'shop' | 'farmhouse' | 'granny';

export interface HouseSpec {
  id: HouseId;
  rect: Rect;
  facing: Facing;
  wall: BlockId;
  /** Offset from the footprint corner (x0, z0); Bricks, 2 above the roof layer it stands on. */
  chimney?: { dx: number; dz: number };
}

export interface HouseInfo {
  id: HouseId;
  groundY: number;
  rect: Rect;
  interior: Rect;
  /** Feet cells of the 2-wide gap, at groundY + 1. */
  doorCells: Cell[];
  /** Outside, in front of the gap's first cell (feet cell). */
  doorFront: Cell;
  /** Inside, behind the gap's first cell (feet cell). */
  doorInside: Cell;
  /** Every interior floor-standing cell (feet cells). */
  floor: Cell[];
  /** Back wall, off the door line by 1. */
  npcSpot: Cell;
  /** The footprint plus 3 cells in front of the door. */
  greetRect: Rect;
  lampCells: Cell[];
  windowCells: Cell[];
}

export const INTERIOR_HEIGHT = 4;
export const DOOR_WIDTH = 2;
export const DOOR_HEIGHT = 3;

/**
 * Writes a whole house: floor, walls, door gap and frame, windows, lamps, ceiling, roof, chimney.
 * Fills Dirt under the floor down to the existing ground and clears everything above the
 * footprint to the top of the world. Only the footprint columns are ever written.
 */
export function stampHouse(world: World, spec: HouseSpec, groundY: number): HouseInfo {
  const g = groundY;
  const { rect, facing } = spec;
  const set = (x: number, y: number, z: number, id: BlockId): void => world.set(x, y, z, id);
  const interior: Rect = { x0: rect.x0 + 1, z0: rect.z0 + 1, x1: rect.x1 - 1, z1: rect.z1 - 1 };

  // Ground and clearing.
  for (let x = rect.x0; x <= rect.x1; x++) {
    for (let z = rect.z0; z <= rect.z1; z++) {
      for (let y = g + 1; y < world.sizeY; y++) set(x, y, z, BlockId.Air);
      for (let y = g - 1; y >= 1 && !BLOCKS[world.get(x, y, z)].solid; y--) set(x, y, z, BlockId.Dirt);
      set(x, g, z, BlockId.Planks);
    }
  }

  // Walls.
  for (let x = rect.x0; x <= rect.x1; x++) {
    for (let z = rect.z0; z <= rect.z1; z++) {
      if (x !== rect.x0 && x !== rect.x1 && z !== rect.z0 && z !== rect.z1) continue;
      for (let y = g + 1; y <= g + INTERIOR_HEIGHT; y++) set(x, y, z, spec.wall);
    }
  }

  // Coordinates along the wall that holds the door (u) and across it (outward normal n).
  const alongX = facing === 'north' || facing === 'south';
  const a0 = alongX ? rect.x0 : rect.z0;
  const length = (alongX ? rect.x1 - rect.x0 : rect.z1 - rect.z0) + 1;
  const start = a0 + Math.floor((length - DOOR_WIDTH) / 2);
  const wallLine = facing === 'north' ? rect.z0 : facing === 'south' ? rect.z1 : facing === 'east' ? rect.x1 : rect.x0;
  const out = facing === 'south' || facing === 'east' ? 1 : -1;
  const at = (along: number, depth: number, y: number): Cell =>
    alongX ? [along, y, wallLine + depth * out] : [wallLine + depth * out, y, along];

  // Door gap, jambs and lintel.
  const doorCells: Cell[] = [];
  for (let u = start; u < start + DOOR_WIDTH; u++) {
    for (let y = g + 1; y <= g + DOOR_HEIGHT; y++) {
      const [x, , z] = at(u, 0, y);
      set(x, y, z, BlockId.Air);
    }
    doorCells.push(at(u, 0, g + 1));
  }
  for (let u = start - 1; u <= start + DOOR_WIDTH; u++) {
    const jamb = u === start - 1 || u === start + DOOR_WIDTH;
    for (let y = g + 1; y <= g + INTERIOR_HEIGHT; y++) {
      if (!jamb && y <= g + DOOR_HEIGHT) continue;
      const [x, , z] = at(u, 0, y);
      set(x, y, z, BlockId.DoorFrame);
    }
  }

  // Windows: 2x2 glass, centred, on the two walls beside the door wall.
  const windowCells: Cell[] = [];
  const sideLength = alongX ? rect.z1 - rect.z0 + 1 : rect.x1 - rect.x0 + 1;
  const sideStart = (alongX ? rect.z0 : rect.x0) + Math.floor((sideLength - 2) / 2);
  for (const sideWall of alongX ? [rect.x0, rect.x1] : [rect.z0, rect.z1]) {
    for (let s = sideStart; s < sideStart + 2; s++) {
      for (let y = g + 2; y <= g + 3; y++) {
        const [x, z] = alongX ? [sideWall, s] : [s, sideWall];
        set(x, y, z, BlockId.Glass);
        windowCells.push([x, y, z]);
      }
    }
  }

  // Ceiling, then roof layers, each inset by one.
  for (let x = rect.x0; x <= rect.x1; x++) {
    for (let z = rect.z0; z <= rect.z1; z++) set(x, g + 5, z, BlockId.RoofTile);
  }
  const roofTop = (x: number, z: number): number => {
    let top = g + 5;
    for (let k = 0; k < 3; k++) {
      const inset = k + 1;
      if (x >= rect.x0 + inset && x <= rect.x1 - inset && z >= rect.z0 + inset && z <= rect.z1 - inset) top = g + 6 + k;
    }
    return top;
  };
  for (let k = 0; k < 3; k++) {
    const inset = k + 1;
    if (rect.x0 + inset > rect.x1 - inset || rect.z0 + inset > rect.z1 - inset) break;
    for (let x = rect.x0 + inset; x <= rect.x1 - inset; x++) {
      for (let z = rect.z0 + inset; z <= rect.z1 - inset; z++) set(x, g + 6 + k, z, BlockId.RoofTile);
    }
  }
  if (spec.chimney) {
    const x = rect.x0 + spec.chimney.dx;
    const z = rect.z0 + spec.chimney.dz;
    const top = roofTop(x, z);
    set(x, top + 1, z, BlockId.Bricks);
    set(x, top + 2, z, BlockId.Bricks);
  }

  // Lamps in the ceiling over the middle row, either side of the centre.
  const iAlong0 = a0 + 1;
  const iAlong1 = a0 + length - 2;
  const midDepth = Math.floor((interiorDepth(rect, alongX) - 1) / 2) + 1;
  const lampCells: Cell[] = [];
  for (const u of [iAlong0 + 1, iAlong1 - 1]) {
    const [x, , z] = at(u, -midDepth, g + 5);
    set(x, g + 5, z, BlockId.Lamp);
    lampCells.push([x, g + 5, z]);
  }

  const floor: Cell[] = [];
  for (let x = interior.x0; x <= interior.x1; x++) {
    for (let z = interior.z0; z <= interior.z1; z++) floor.push([x, g + 1, z]);
  }
  const depthCount = interiorDepth(rect, alongX);
  const doorLine = [start, start + 1];
  let npcAlong = start + 2;
  if (npcAlong > iAlong1) npcAlong = start - 1;
  if (doorLine.includes(npcAlong)) npcAlong = iAlong0;
  const npcSpot = at(npcAlong, -depthCount, g + 1);

  const front = 3;
  const greetRect: Rect = { ...rect };
  if (facing === 'north') greetRect.z0 -= front;
  if (facing === 'south') greetRect.z1 += front;
  if (facing === 'west') greetRect.x0 -= front;
  if (facing === 'east') greetRect.x1 += front;

  return {
    id: spec.id, groundY: g, rect: { ...rect }, interior, doorCells,
    doorFront: at(start, 1, g + 1), doorInside: at(start, -1, g + 1),
    floor, npcSpot, greetRect, lampCells, windowCells,
  };
}

/** Interior cells from the door wall to the back wall. */
function interiorDepth(rect: Rect, alongX: boolean): number {
  return (alongX ? rect.z1 - rect.z0 + 1 : rect.x1 - rect.x0 + 1) - 2;
}
