import { BlockId } from './blocks';
import { caveStream, RUIN_HALL } from './caves';
import type { Cell } from './pathfind';
import type { Rect } from './village';
import type { World } from './world';

/**
 * The Old Hideout (spec 7h, plan Task 17): one old ruined base deep down, for him to explore and
 * fix up. Stamped into the hall the cave plan carved at the world centre (RUIN_HALL, 23 x 19 and 8
 * high, floor feet y 12): a ring of Bricks and MossyBricks 3 to 4 high round a 17 x 13 inside, with
 * wide gaps and a few ragged missing blocks, a walkway all round outside it, a Planks floor patch,
 * four Lamp posts, a table, a bench, a red rug, a shelf, the chest on a Planks stand and a glowing
 * Ruin crystal in each inside corner. The cave ceiling is its roof. Every block is real and
 * collectable except the closed chest.
 */

export interface RuinInfo {
  /** The 17 x 13 inside of the ring. */
  rect: Rect;
  floorY: number;
  lamps: Cell[];
  chest: Cell;
  /** Feet cells of the ring's gaps (open full height). */
  gaps: Cell[];
  /** Every placed block other than the ring: posts, lamps, table, bench, shelf, stand, chest, crystals, rug and floor. */
  furnishings: Cell[];
  /** The ring cells that are Bricks or MossyBricks. */
  ring: Cell[];
  /** Ring blocks left out at random (not part of the gaps). */
  missing: Cell[];
}

export const RUIN_PLAN = {
  centre: [96, 96] as [number, number],
  hall: { w: 17, d: 13, h: 8 },
  floorY: RUIN_HALL.floorY,
} as const;

/** Stamps the Old Hideout into its carved hall (the hall and its two tunnels come from the cave plan). */
export function stampRuin(world: World, seed: number): RuinInfo {
  const rng = caveStream(seed, 7);
  const [cx, cz] = RUIN_PLAN.centre;
  const f = RUIN_PLAN.floorY;
  const hw = (RUIN_PLAN.hall.w - 1) / 2, hd = (RUIN_PLAN.hall.d - 1) / 2; // 8, 6
  const rect: Rect = { x0: cx - hw, z0: cz - hd, x1: cx + hw, z1: cz + hd };
  const ring = { x0: rect.x0 - 1, z0: rect.z0 - 1, x1: rect.x1 + 1, z1: rect.z1 + 1 };
  const furnishings: Cell[] = [];
  const put = (x: number, y: number, z: number, id: BlockId): void => {
    world.set(x, y, z, id);
    furnishings.push([x, y, z]);
  };

  // The ring's perimeter, clockwise from the north-west corner.
  const perimeter: Array<[number, number]> = [];
  for (let x = ring.x0; x <= ring.x1; x++) perimeter.push([x, ring.z0]);
  for (let z = ring.z0 + 1; z <= ring.z1; z++) perimeter.push([ring.x1, z]);
  for (let x = ring.x1 - 1; x >= ring.x0; x--) perimeter.push([x, ring.z1]);
  for (let z = ring.z1 - 1; z > ring.z0; z--) perimeter.push([ring.x0, z]);

  // Four gaps, 3 wide: one in each wall, nudged a little by the seed, away from the corners.
  const gapCols = new Set<string>();
  const nudge = (): number => Math.floor(rng() * 5) - 2;
  const north = cx - 3 + nudge(), south = cx + 3 + nudge(), west = cz - 1 + nudge(), east = cz + 1 + nudge();
  for (let d = -1; d <= 1; d++) {
    gapCols.add(`${north + d},${ring.z0}`);
    gapCols.add(`${south + d},${ring.z1}`);
    gapCols.add(`${ring.x0},${west + d}`);
    gapCols.add(`${ring.x1},${east + d}`);
  }
  const gaps: Cell[] = [...gapCols].map(k => { const [x, z] = k.split(',').map(Number); return [x, f, z] as Cell; });

  const ringCells: Cell[] = [];
  const missing: Cell[] = [];
  for (const [x, z] of perimeter) {
    if (gapCols.has(`${x},${z}`)) continue;
    const corner = (x === ring.x0 || x === ring.x1) && (z === ring.z0 || z === ring.z1);
    const height = corner ? 4 : 3 + (rng() < 0.4 ? 1 : 0);
    for (let y = f; y < f + height; y++) {
      // Ragged: now and then a block has gone (never a corner, never the bottom row).
      if (!corner && y > f && rng() < 0.06) { missing.push([x, y, z]); continue; }
      world.set(x, y, z, rng() < 0.42 ? BlockId.MossyBricks : BlockId.Bricks);
      ringCells.push([x, y, z]);
    }
  }
  // At least five ragged gaps in the wall tops, whatever the dice said (deterministic positions).
  for (let i = 0; missing.length < 5 && i < perimeter.length; i += 7) {
    const [x, z] = perimeter[i];
    if (gapCols.has(`${x},${z}`)) continue;
    const top = f + 2;
    if ((x === ring.x0 || x === ring.x1) && (z === ring.z0 || z === ring.z1)) continue;
    const k = ringCells.findIndex(c => c[0] === x && c[1] === top && c[2] === z);
    if (k < 0) continue;
    world.set(x, top, z, BlockId.Air);
    // A block left above the hole stays: the hideout is old, not falling down (no block ever falls).
    ringCells.splice(k, 1);
    missing.push([x, top, z]);
  }

  // The inside.
  const rug: Rect = { x0: cx + 1, z0: cz + 1, x1: cx + 3, z1: cz + 2 };
  for (let z = rect.z0; z <= rect.z1; z++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (x >= rug.x0 && x <= rug.x1 && z >= rug.z0 && z <= rug.z1) put(x, f - 1, z, BlockId.WoolRed);
      else if (((x * 31 + z * 17 + (seed & 0xff)) % 10) < 6) put(x, f - 1, z, BlockId.Planks);
    }
  }
  const lamps: Cell[] = [];
  for (const [x, z] of [[rect.x0 + 2, rect.z0 + 2], [rect.x1 - 2, rect.z0 + 2], [rect.x0 + 2, rect.z1 - 2], [rect.x1 - 2, rect.z1 - 2]]) {
    put(x, f, z, BlockId.Fence);
    put(x, f + 1, z, BlockId.Lamp);
    lamps.push([x, f + 1, z]);
  }
  // Table: a fence post with a Planks top.
  put(cx, f, cz - 3, BlockId.Fence);
  put(cx, f + 1, cz - 3, BlockId.Planks);
  // Bench: three Planks in a row.
  for (let x = cx - 4; x <= cx - 2; x++) put(x, f, cz + 3, BlockId.Planks);
  // Shelf: three Planks against the inside of the north wall, at shoulder height.
  for (let x = cx + 3; x <= cx + 5; x++) put(x, f + 1, rect.z0, BlockId.Planks);
  // The chest on a Planks stand, by the south-west lamp.
  const chest: Cell = [rect.x0 + 4, f + 1, rect.z1];
  put(chest[0], f, chest[2], BlockId.Planks);
  put(chest[0], chest[1], chest[2], BlockId.Chest);
  // A glowing Ruin crystal in each inside corner.
  for (const [x, z] of [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1]]) put(x, f, z, BlockId.RuinCrystal);

  return { rect, floorY: f, lamps, chest, gaps, furnishings, ring: ringCells, missing };
}
