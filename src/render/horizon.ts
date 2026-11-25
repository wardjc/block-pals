import { BLOCKS, BlockId } from '../core/blocks';
import type { World } from '../core/world';

/**
 * The horizon: a coarse far-terrain layer (one merged mesh of the whole world, one column of 4 x 4
 * blocks per cell) drawn beyond the detailed ring. This file is the pure part (no DOM, no three.js):
 * which block colour a cell shows, how high it stands, and the time-sliced sampling of the world.
 */
export const HORIZON_CELL = 4;
/** Vertices a cell owns in the merged mesh: its top quad plus four side-wall quads (collapsed when not needed). */
export const VERTS_PER_CELL = 20;
export const INDICES_PER_CELL = 30;
/** The horizon sits this far below the real surface, so it never pokes through detailed land at the seam. */
export const HORIZON_DROP = 1;
/** Side walls are a little darker than the top (the detailed land is lit the same way). */
export const WALL_SHADE = 0.8;

type Rgb = readonly [number, number, number];

const STONE: Rgb = [140, 140, 140];
/** The colour a block shows from far away (sRGB, 0..255). Unknown blocks read as soft grey stone. */
const COLOUR: Partial<Record<BlockId, Rgb>> = {
  [BlockId.Grass]: [90, 168, 58],
  [BlockId.Dirt]: [139, 90, 43],
  [BlockId.Stone]: STONE,
  [BlockId.Wood]: [122, 85, 48],
  [BlockId.Leaves]: [47, 143, 47],
  [BlockId.AppleLeaves]: [47, 143, 47],
  [BlockId.Sand]: [230, 214, 144],
  [BlockId.Water]: [63, 143, 224],
  [BlockId.Planks]: [168, 128, 63],
  [BlockId.Glass]: [190, 225, 240],
  [BlockId.Bricks]: [168, 69, 47],
  [BlockId.Bedrock]: [60, 60, 60],
  [BlockId.PathStone]: [217, 192, 140],
  [BlockId.RoofTile]: [212, 84, 47],
  [BlockId.DoorFrame]: [90, 58, 28],
  [BlockId.Lamp]: [255, 234, 164],
  [BlockId.Farmland]: [94, 63, 32],
  [BlockId.Fence]: [138, 98, 56],
  [BlockId.WoolWhite]: [240, 240, 234],
  [BlockId.WoolRed]: [216, 71, 63],
  [BlockId.WoolBlue]: [65, 114, 220],
  [BlockId.WoolYellow]: [243, 198, 50],
  [BlockId.MossyBricks]: [110, 130, 90],
};

export function horizonColour(id: BlockId): Rgb {
  return COLOUR[id] ?? STONE;
}

/** A block the horizon can show as ground: solid, or water (a plant is skipped: the ground under it shows). */
function showsAsGround(id: BlockId): boolean {
  return id === BlockId.Water || BLOCKS[id]?.solid === true;
}

/** The top face (y + 1) and block of the highest ground block in a column. */
export function columnTop(world: World, x: number, z: number): { top: number; id: BlockId } {
  for (let y = world.sizeY - 1; y >= 0; y--) {
    const id = world.get(x, y, z);
    if (id !== BlockId.Air && showsAsGround(id)) return { top: y + 1, id };
  }
  return { top: 0, id: BlockId.Stone };
}

/**
 * The cells of the world, sampled a few at a time. Each cell's height is its highest column (so a
 * tower or a roof still shows) and its colour is the average of the columns near that height (so a
 * tower is stone, not grass-grey). An edit marks its cell to be sampled again, a little later.
 */
export class HorizonField {
  readonly cx: number;
  readonly cz: number;
  readonly cell: number;
  readonly heights: Float32Array;
  /** sRGB bytes, 3 a cell. */
  readonly colours: Uint8Array;
  private readonly todo: number[] = [];
  private readonly queued: Uint8Array;
  private readonly seen: Uint8Array;
  private built = 0;

  constructor(private readonly world: World, cell: number = HORIZON_CELL) {
    this.cell = cell;
    this.cx = Math.ceil(world.sizeX / cell);
    this.cz = Math.ceil(world.sizeZ / cell);
    const n = this.cx * this.cz;
    this.heights = new Float32Array(n);
    this.colours = new Uint8Array(n * 3);
    this.queued = new Uint8Array(n);
    this.seen = new Uint8Array(n);
    // pop() takes from the end, so the first build runs in reading order.
    for (let i = n - 1; i >= 0; i--) {
      this.todo.push(i);
      this.queued[i] = 1;
    }
  }

  get cells(): number {
    return this.cx * this.cz;
  }

  /** Every cell has been sampled once (edits after that keep it true). */
  get ready(): boolean {
    return this.built >= this.cells;
  }

  /** Cells waiting to be (re)sampled. */
  get pending(): number {
    return this.todo.length;
  }

  /** A changed block: its cell is sampled again on a later step. */
  markDirty(x: number, z: number): void {
    if (!this.world.inBounds(x, 0, z)) return;
    const i = Math.floor(x / this.cell) + this.cx * Math.floor(z / this.cell);
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.todo.push(i);
  }

  /** Samples up to maxCells waiting cells, stopping early after budgetMs; returns the cells that changed. */
  step(maxCells: number, budgetMs = Infinity, clock: () => number = () => performance.now()): number[] {
    const out: number[] = [];
    const t0 = budgetMs === Infinity ? 0 : clock();
    let done = 0;
    while (done < maxCells && this.todo.length > 0) {
      const i = this.todo.pop()!;
      this.queued[i] = 0;
      done++;
      if (this.sample(i)) out.push(i);
      if (!this.seen[i]) {
        this.seen[i] = 1;
        this.built++;
      }
      if (budgetMs !== Infinity && clock() - t0 > budgetMs) break;
    }
    return out;
  }

  /** Samples one cell; true when its height or colour changed. */
  private sample(i: number): boolean {
    const c = this.cell;
    const x0 = (i % this.cx) * c, z0 = Math.floor(i / this.cx) * c;
    const tops: number[] = [];
    const ids: BlockId[] = [];
    let max = 0;
    for (let z = z0; z < Math.min(z0 + c, this.world.sizeZ); z++) {
      for (let x = x0; x < Math.min(x0 + c, this.world.sizeX); x++) {
        const t = columnTop(this.world, x, z);
        tops.push(t.top);
        ids.push(t.id);
        if (t.top > max) max = t.top;
      }
    }
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < tops.length; k++) {
      if (tops[k] < max - 2) continue;
      const col = horizonColour(ids[k]);
      r += col[0]; g += col[1]; b += col[2]; n++;
    }
    const nr = Math.round(r / n), ng = Math.round(g / n), nb = Math.round(b / n);
    const changed = this.heights[i] !== max || this.colours[i * 3] !== nr || this.colours[i * 3 + 1] !== ng || this.colours[i * 3 + 2] !== nb;
    this.heights[i] = max;
    this.colours[i * 3] = nr; this.colours[i * 3 + 1] = ng; this.colours[i * 3 + 2] = nb;
    return changed;
  }
}

const srgbToLinear = (v: number): number => Math.pow(v / 255, 2.2);

/**
 * Writes cell i's five quads into the merged mesh's arrays: the top at (height - HORIZON_DROP) and a
 * wall on each side that steps down to a lower neighbour (a collapsed quad otherwise). Colours are
 * linear floats. Reads the field only, so a cell and its four neighbours can be refilled cheaply.
 */
export function fillCell(field: HorizonField, i: number, positions: Float32Array, colours: Float32Array): void {
  const c = field.cell;
  const cx = i % field.cx, cz = Math.floor(i / field.cx);
  const x0 = cx * c, z0 = cz * c, x1 = x0 + c, z1 = z0 + c;
  const y = field.heights[i] - HORIZON_DROP;
  const lower = (nx: number, nz: number): number => {
    if (nx < 0 || nz < 0 || nx >= field.cx || nz >= field.cz) return y; // the world's edge: no wall
    return Math.min(y, field.heights[nx + field.cx * nz] - HORIZON_DROP);
  };
  const v = i * VERTS_PER_CELL * 3;
  let o = v;
  const put = (x: number, yy: number, z: number): void => {
    positions[o++] = x; positions[o++] = yy; positions[o++] = z;
  };
  put(x0, y, z0); put(x1, y, z0); put(x1, y, z1); put(x0, y, z1);
  const wx0 = lower(cx - 1, cz), wx1 = lower(cx + 1, cz), wz0 = lower(cx, cz - 1), wz1 = lower(cx, cz + 1);
  put(x0, y, z0); put(x0, y, z1); put(x0, wx0, z1); put(x0, wx0, z0);
  put(x1, y, z0); put(x1, y, z1); put(x1, wx1, z1); put(x1, wx1, z0);
  put(x0, y, z0); put(x1, y, z0); put(x1, wz0, z0); put(x0, wz0, z0);
  put(x0, y, z1); put(x1, y, z1); put(x1, wz1, z1); put(x0, wz1, z1);
  const lr = srgbToLinear(field.colours[i * 3]), lg = srgbToLinear(field.colours[i * 3 + 1]), lb = srgbToLinear(field.colours[i * 3 + 2]);
  let k = v;
  for (let q = 0; q < VERTS_PER_CELL; q++) {
    const s = q < 4 ? 1 : WALL_SHADE;
    colours[k++] = lr * s; colours[k++] = lg * s; colours[k++] = lb * s;
  }
}

/** The fixed index pattern (five quads a cell, two triangles each). */
export function fillIndices(cells: number, indices: Uint16Array | Uint32Array): void {
  let o = 0;
  for (let i = 0; i < cells; i++) {
    for (let q = 0; q < 5; q++) {
      const b = i * VERTS_PER_CELL + q * 4;
      indices[o++] = b; indices[o++] = b + 1; indices[o++] = b + 2;
      indices[o++] = b; indices[o++] = b + 2; indices[o++] = b + 3;
    }
  }
}

/**
 * The fog the horizon wears at distance d from the camera: the detailed land's own haze (smoothstep
 * between fogNear and fogFar, scaled by `haze`), growing on toward maxK by `end`. It matches the
 * detailed ring's edge at the seam and fades into the sky beyond it. 0 is clear, 1 is pure haze.
 */
export function horizonHaze(d: number, fogNear: number, fogFar: number, haze: number, maxK: number, end: number): number {
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-6, b - a)));
    return t * t * (3 - 2 * t);
  };
  const base = haze * smooth(fogNear, fogFar, d);
  return base + (Math.max(base, maxK) - base) * smooth(fogFar, end, d);
}
