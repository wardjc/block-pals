import { BLOCKS, BlockId } from './blocks';
import { DOOR_HEIGHT, DOOR_WIDTH, type Rect } from './houses';
import type { Cell } from './pathfind';
import type { World } from './world';

/**
 * Every number that places the wizard's tower lives here, in meadow coordinates (the 96 × 96
 * world). A bigger world moves the whole stamp by shifting these, nothing else.
 */
export const TOWER_GROUND_Y = 9;

export const TOWER_PLAN: {
  /** The hilltop, pinned level at TOWER_GROUND_Y. */
  pad: Rect;
  footprint: Rect;
  facing: 'north';
  /** The path from the village square to the door front (centre line, 3 wide). */
  waypoints: Array<[number, number]>;
  /** Legs from this waypoint on cross natural ground and are shaped; the ones before it run on the level village pad. */
  shapeFrom: number;
  /** Where the wizard stands on the ground floor (column). */
  wizard: [number, number];
} = {
  pad: { x0: 29, z0: 74, x1: 43, z1: 88 },
  footprint: { x0: 33, z0: 78, x1: 39, z1: 84 },
  facing: 'north',
  // Square's south-west corner, west along z 29 between the bakery and the farmhouse, south down
  // x 50 (clear of the pasture and of the v1 meadow's trees), west, then up the hill to the door.
  waypoints: [[69, 29], [56, 29], [50, 29], [50, 66], [35, 66], [35, 77]],
  shapeFrom: 1,
  wizard: [34, 82],
};

/** Rooms from the floor block: ground room y+1..y+3, slab y+4, star room y+5..y+7, ceiling y+8, roof y+9 and y+10. */
const ROOM_HEIGHT = 3;
const SLAB = ROOM_HEIGHT + 1;
const CEILING = 2 * SLAB;
/** The beacon floats this far above the floor block (y 21.5 for a floor at 9: above the 20-high world). */
const BEACON_ABOVE = 12.5;

export interface TowerFloor {
  /** Feet height of every cell in the room. */
  y: number;
  cells: Cell[];
  /** The first solid y above the feet cells. */
  ceilingY: number;
}

export interface TowerInfo {
  groundY: number;
  rect: Rect;
  interior: Rect;
  /** Feet cells of the 2-wide gap. */
  doorCells: Cell[];
  doorFront: Cell;
  doorInside: Cell;
  /** [ground room, star room]. */
  floors: TowerFloor[];
  /** The three step cells, then the slab edge cell (feet cells, each one higher than the last). */
  stairCells: Cell[];
  wizardSpot: Cell;
  /** The footprint plus 3 cells in front of the door. */
  greetRect: Rect;
  /** Two in the slab, two in the ceiling, then the one at the very top. */
  lampCells: Cell[];
  topLamp: Cell;
  windowCells: Cell[];
  /** Where the far light floats (block units, centre of the roof, above the world). */
  beacon: { x: number; y: number; z: number };
}

/**
 * Writes the whole tower inside its footprint columns only: Dirt under the floor down to the
 * ground, Planks floor, Stone walls with Glass windows, a 2-wide door with DoorFrame jambs, a
 * ground room and a star room joined by a stair of one-block steps, Lamps in the slab and the
 * ceiling, a stepped RoofTile roof with a Lamp as its very top block. Clears everything above first.
 */
export function stampTower(world: World): TowerInfo {
  const g = TOWER_GROUND_Y;
  const r = TOWER_PLAN.footprint;
  const set = (x: number, y: number, z: number, id: BlockId): void => world.set(x, y, z, id);
  const interior: Rect = { x0: r.x0 + 1, z0: r.z0 + 1, x1: r.x1 - 1, z1: r.z1 - 1 };
  const ring = (x: number, z: number): boolean => x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;

  // Ground and clearing.
  for (let x = r.x0; x <= r.x1; x++) {
    for (let z = r.z0; z <= r.z1; z++) {
      for (let y = g + 1; y < world.sizeY; y++) set(x, y, z, BlockId.Air);
      for (let y = g - 1; y >= 1 && !BLOCKS[world.get(x, y, z)].solid; y--) set(x, y, z, BlockId.Dirt);
      set(x, g, z, BlockId.Planks);
    }
  }

  // Walls, both storeys and the slab's edge.
  for (let x = r.x0; x <= r.x1; x++) {
    for (let z = r.z0; z <= r.z1; z++) {
      if (!ring(x, z)) continue;
      for (let y = g + 1; y < g + CEILING; y++) set(x, y, z, BlockId.Stone);
    }
  }

  // Door on the north wall: gap, jambs and lintel (as the houses).
  const doorX0 = r.x0 + Math.floor((r.x1 - r.x0 + 1 - DOOR_WIDTH) / 2);
  const doorCells: Cell[] = [];
  for (let x = doorX0; x < doorX0 + DOOR_WIDTH; x++) {
    for (let y = g + 1; y <= g + DOOR_HEIGHT; y++) set(x, y, r.z0, BlockId.Air);
    doorCells.push([x, g + 1, r.z0]);
  }
  for (let x = doorX0 - 1; x <= doorX0 + DOOR_WIDTH; x++) {
    const jamb = x === doorX0 - 1 || x === doorX0 + DOOR_WIDTH;
    for (let y = g + 1; y <= g + SLAB; y++) {
      if (!jamb && y <= g + DOOR_HEIGHT) continue;
      set(x, y, r.z0, BlockId.DoorFrame);
    }
  }

  // Windows: 2×2, centred. Downstairs east and west; upstairs on all four walls.
  const windowCells: Cell[] = [];
  const midX = r.x0 + Math.floor((r.x1 - r.x0 + 1 - 2) / 2);
  const midZ = r.z0 + Math.floor((r.z1 - r.z0 + 1 - 2) / 2);
  const windowOn = (wall: 'north' | 'south' | 'east' | 'west', floorY: number): void => {
    for (let s = 0; s < 2; s++) {
      for (let y = floorY + 2; y <= floorY + 3; y++) {
        const [x, z] = wall === 'west' ? [r.x0, midZ + s] : wall === 'east' ? [r.x1, midZ + s]
          : wall === 'north' ? [midX + s, r.z0] : [midX + s, r.z1];
        set(x, y, z, BlockId.Glass);
        windowCells.push([x, y, z]);
      }
    }
  };
  windowOn('east', g);
  windowOn('west', g);
  for (const wall of ['north', 'south', 'east', 'west'] as const) windowOn(wall, g + SLAB);

  // Stair along the east interior column: three steps, each one higher, under a gap in the slab.
  const stairX = interior.x1;
  const steps = [0, 1, 2].map(k => interior.z0 + k);
  steps.forEach((z, k) => {
    for (let y = g + 1; y <= g + 1 + k; y++) set(stairX, y, z, BlockId.Planks);
  });
  const isStep = (x: number, z: number): boolean => x === stairX && steps.includes(z);

  // Slab between the rooms, ceiling over the star room.
  for (let x = interior.x0; x <= interior.x1; x++) {
    for (let z = interior.z0; z <= interior.z1; z++) if (!isStep(x, z)) set(x, g + SLAB, z, BlockId.Planks);
  }
  for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) set(x, g + CEILING, z, BlockId.RoofTile);

  // Stepped roof, then a Lamp as the very top block.
  for (let k = 1; k <= 2; k++) {
    for (let x = r.x0 + k; x <= r.x1 - k; x++) {
      for (let z = r.z0 + k; z <= r.z1 - k; z++) set(x, g + CEILING + k, z, BlockId.RoofTile);
    }
  }
  const cx = Math.floor((r.x0 + r.x1) / 2);
  const cz = Math.floor((r.z0 + r.z1) / 2);
  const topLamp: Cell = [cx, g + CEILING + 2, cz];
  set(...topLamp, BlockId.Lamp);

  // Two Lamps over the middle row of each room: in the slab and in the ceiling.
  const lampCells: Cell[] = [];
  for (const y of [g + SLAB, g + CEILING]) {
    for (const x of [interior.x0 + 1, interior.x1 - 1]) {
      set(x, y, cz, BlockId.Lamp);
      lampCells.push([x, y, cz]);
    }
  }
  lampCells.push(topLamp);

  const groundCells: Cell[] = [];
  const starCells: Cell[] = [];
  for (let x = interior.x0; x <= interior.x1; x++) {
    for (let z = interior.z0; z <= interior.z1; z++) {
      if (isStep(x, z)) continue;
      groundCells.push([x, g + 1, z]);
      starCells.push([x, g + SLAB + 1, z]);
    }
  }
  const stairCells: Cell[] = steps.map((z, k): Cell => [stairX, g + 2 + k, z]);
  stairCells.push([stairX, g + SLAB + 1, steps[2] + 1]);

  return {
    groundY: g,
    rect: { ...r },
    interior,
    doorCells,
    doorFront: [doorX0, g + 1, r.z0 - 1],
    doorInside: [doorX0, g + 1, r.z0 + 1],
    floors: [
      { y: g + 1, cells: groundCells, ceilingY: g + SLAB },
      { y: g + SLAB + 1, cells: starCells, ceilingY: g + CEILING },
    ],
    stairCells,
    wizardSpot: [TOWER_PLAN.wizard[0], g + 1, TOWER_PLAN.wizard[1]],
    greetRect: { x0: r.x0, z0: r.z0 - 3, x1: r.x1, z1: r.z1 },
    lampCells,
    topLamp,
    windowCells,
    beacon: { x: (r.x0 + r.x1 + 1) / 2, y: g + BEACON_ABOVE, z: (r.z0 + r.z1 + 1) / 2 },
  };
}
