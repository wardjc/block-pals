import type { CaveLayout } from '../core/caves';
import type { Cell } from '../core/pathfind';

export type DiscoveryEvent = 'cavesSeen' | 'ruinFound';

/**
 * First visits underground (plan Task 21), from the saved flags: `cavesSeen` the first time he is
 * deep AND stands in a cave the world generated (his own pit or a staircase he dug never counts),
 * `ruinFound` the first time he stands inside the Old Hideout. Each fires once; a flag already set
 * in the save never fires again, and nothing here ever clears one.
 */
export class CaveDiscovery {
  private readonly carved: Uint8Array;
  private readonly sx: number;
  private readonly sxz: number;
  private seen: boolean;
  private ruin: boolean;

  constructor(
    size: { sizeX: number; sizeY: number; sizeZ: number },
    private readonly caves: Pick<CaveLayout, 'airCells' | 'ruin'>,
    flags: { cavesSeen?: boolean; ruinFound?: boolean },
  ) {
    this.sx = size.sizeX;
    this.sxz = size.sizeX * size.sizeZ;
    // One bit per cell of the world: is it a cave cell the generator carved? (313 KB for 192 x 68 x 192.)
    this.carved = new Uint8Array(Math.ceil((size.sizeX * size.sizeY * size.sizeZ) / 8));
    for (const i of caves.airCells) this.carved[i >> 3] |= 1 << (i & 7);
    this.seen = flags.cavesSeen === true;
    this.ruin = flags.ruinFound === true;
  }

  /** True when this feet cell is a cave cell the world generated (whatever he has dug since). */
  inCave(feet: Cell): boolean {
    const [x, y, z] = feet;
    if (!(x >= 0 && z >= 0 && y >= 0 && x < this.sx)) return false;
    const i = x + this.sx * z + this.sxz * y;
    return (i >> 3) < this.carved.length && (this.carved[i >> 3] & (1 << (i & 7))) !== 0;
  }

  /** True when this feet cell is inside the Old Hideout. */
  inRuin(feet: Cell): boolean {
    const r = this.caves.ruin;
    if (!r) return false;
    const [x, y, z] = feet;
    return x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1 && y >= r.floorY - 1 && y <= r.floorY + 8;
  }

  update(feet: Cell, deep: boolean): DiscoveryEvent[] {
    const out: DiscoveryEvent[] = [];
    if (!this.seen && deep && this.inCave(feet)) { this.seen = true; out.push('cavesSeen'); }
    if (!this.ruin && this.inRuin(feet)) { this.ruin = true; out.push('ruinFound'); }
    return out;
  }
}
