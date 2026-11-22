import { BLOCKS, BlockId } from './blocks';
import { ORIGIN, V2_WORLD } from './bounds';
import type { HouseInfo, Rect } from './houses';
import type { Cell } from './pathfind';
import type { TowerFloor, TowerInfo, TowerLayout } from './tower';
import type { FarmLayout, VillageLayout } from './village';
import type { World } from './world';

/** Everything the stamping code (terrain, village, farm, trees) needs from a world. */
export interface WorldCells {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  inBounds(x: number, y: number, z: number): boolean;
  get(x: number, y: number, z: number): BlockId;
  set(x: number, y: number, z: number, id: BlockId): void;
  topSolidY(x: number, z: number): number;
}

type Offset = { readonly x: number; readonly y: number; readonly z: number };

/**
 * The old 96 x 20 x 96 world, seen through a window of the big world at +origin. It reports the OLD
 * dimensions, so every existing bounds check, sizeY loop and tree rule behaves exactly as it did
 * on a plain step 2 World: the step 2 generator runs on it unchanged and the old region comes out
 * identical by construction. Outside the old box it reads like a plain World (Air, Bedrock below)
 * and writes nothing.
 */
export class ShiftedWorld implements WorldCells {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;

  constructor(private readonly base: World, private readonly origin: Offset = ORIGIN, size: Offset = V2_WORLD) {
    this.sizeX = size.x;
    this.sizeY = size.y;
    this.sizeZ = size.z;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      && x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  get(x: number, y: number, z: number): BlockId {
    if (!this.inBounds(x, y, z)) return y < 0 ? BlockId.Bedrock : BlockId.Air;
    return this.base.get(x + this.origin.x, y + this.origin.y, z + this.origin.z);
  }

  set(x: number, y: number, z: number, id: BlockId): void {
    if (!this.inBounds(x, y, z)) return;
    this.base.set(x + this.origin.x, y + this.origin.y, z + this.origin.z, id);
  }

  topSolidY(x: number, z: number): number {
    if (!this.inBounds(x, 0, z)) return -1;
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (BLOCKS[this.get(x, y, z)].solid) return y;
    }
    return -1;
  }
}

type Vec = { x: number; y: number; z: number };

const mover = (origin: Vec) => ({
  rect: (r: Rect): Rect => ({ x0: r.x0 + origin.x, x1: r.x1 + origin.x, z0: r.z0 + origin.z, z1: r.z1 + origin.z }),
  cell: ([x, y, z]: Cell): Cell => [x + origin.x, y + origin.y, z + origin.z],
});

/** Re-indexes a set of cell indices from a `from`-sized world into `base`, moved by origin. */
function moveIndices(cells: Set<number>, base: { sizeX: number; sizeZ: number }, origin: Vec, from: Vec): Set<number> {
  const out = new Set<number>();
  for (const k of cells) {
    const x = k % from.x + origin.x;
    const z = Math.floor(k / from.x) % from.z + origin.z;
    const y = Math.floor(k / (from.x * from.z)) + origin.y;
    out.add(x + base.sizeX * (z + base.sizeZ * y));
  }
  return out;
}

/**
 * The wizard's tower layout (gen 3, stamped on the view in meadow coordinates) in world
 * coordinates: every rect, cell, floor, stair, lamp, window, the wizard's spot and the beacon move
 * by origin, the route cells are re-indexed. Pure; the input is not changed or shared.
 */
export function shiftTowerLayout(
  layout: TowerLayout,
  base: { sizeX: number; sizeZ: number },
  origin: Vec = ORIGIN,
  from: Vec = V2_WORLD,
): TowerLayout {
  const { rect, cell } = mover(origin);
  const t = layout.info;
  const floor = (f: TowerFloor): TowerFloor => ({ y: f.y + origin.y, cells: f.cells.map(cell), ceilingY: f.ceilingY + origin.y });
  const info: TowerInfo = {
    groundY: t.groundY + origin.y,
    rect: rect(t.rect),
    interior: rect(t.interior),
    doorCells: t.doorCells.map(cell),
    doorFront: cell(t.doorFront),
    doorInside: cell(t.doorInside),
    floors: t.floors.map(floor),
    stairCells: t.stairCells.map(cell),
    wizardSpot: cell(t.wizardSpot),
    greetRect: rect(t.greetRect),
    lampCells: t.lampCells.map(cell),
    topLamp: cell(t.topLamp),
    windowCells: t.windowCells.map(cell),
    beacon: { x: t.beacon.x + origin.x, y: t.beacon.y + origin.y, z: t.beacon.z + origin.z },
  };
  return {
    info,
    route: layout.route.map(cell),
    routeCells: moveIndices(layout.routeCells, base, origin, from),
    stampedRects: layout.stampedRects.map(rect),
  };
}

export function shiftLayout(
  layout: VillageLayout,
  base: { sizeX: number; sizeZ: number },
  origin: { x: number; y: number; z: number } = ORIGIN,
  from: { x: number; y: number; z: number } = V2_WORLD,
): VillageLayout {
  const rect = (r: Rect): Rect => ({
    x0: r.x0 + origin.x, x1: r.x1 + origin.x,
    z0: r.z0 + origin.z, z1: r.z1 + origin.z,
  });
  const cell = ([x, y, z]: Cell): Cell => [x + origin.x, y + origin.y, z + origin.z];
  const house = (h: HouseInfo): HouseInfo => ({
    id: h.id,
    groundY: h.groundY + origin.y,
    rect: rect(h.rect),
    interior: rect(h.interior),
    doorCells: h.doorCells.map(cell),
    doorFront: cell(h.doorFront),
    doorInside: cell(h.doorInside),
    floor: h.floor.map(cell),
    npcSpot: cell(h.npcSpot),
    greetRect: rect(h.greetRect),
    lampCells: h.lampCells.map(cell),
    windowCells: h.windowCells.map(cell),
  });
  const farm: FarmLayout = {
    beds: layout.farm.beds.map(rect),
    pool: rect(layout.farm.pool),
    irrigation: rect(layout.farm.irrigation),
    pasture: rect(layout.farm.pasture),
    gate: layout.farm.gate.map(cell),
    fence: layout.farm.fence.map(cell),
    herdSpawns: layout.farm.herdSpawns.map(cell),
    path: rect(layout.farm.path),
  };
  const routeCells = moveIndices(layout.routeCells, base, origin, from);
  const result: VillageLayout = {
    houses: layout.houses.map(house),
    route: layout.route.map(cell),
    routeCells,
    gate: cell(layout.gate),
    square: rect(layout.square),
    farmPlot: rect(layout.farmPlot),
    farm,
    quarry: rect(layout.quarry),
    pad: rect(layout.pad),
    stampedRects: layout.stampedRects.map(rect),
  };
  return result;
}
