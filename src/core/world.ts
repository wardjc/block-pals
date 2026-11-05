import { BLOCKS, BlockId } from './blocks';

type Edit = [number, number, number, BlockId];
type ChangeListener = (x: number, y: number, z: number) => void;

export class World {
  private readonly cells: Uint8Array;
  private readonly changedCells = new Map<number, Edit>();
  private readonly listeners: ChangeListener[] = [];
  private dirty = false;

  constructor(
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
  ) {
    this.cells = new Uint8Array(sizeX * sizeY * sizeZ);
  }

  private index(x: number, y: number, z: number): number {
    return x + this.sizeX * (z + this.sizeZ * y);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
      && x >= 0 && x < this.sizeX
      && y >= 0 && y < this.sizeY
      && z >= 0 && z < this.sizeZ;
  }

  get(x: number, y: number, z: number): BlockId {
    if (!this.inBounds(x, y, z)) {
      return y < 0 ? BlockId.Bedrock : BlockId.Air;
    }
    return this.cells[this.index(x, y, z)];
  }

  set(x: number, y: number, z: number, id: BlockId): void {
    if (!this.inBounds(x, y, z)) return;
    const index = this.index(x, y, z);
    if (this.cells[index] === id) return;

    this.cells[index] = id;
    this.changedCells.set(index, [x, y, z, id]);
    this.dirty = true;
    for (const listener of this.listeners) listener(x, y, z);
  }

  topSolidY(x: number, z: number): number {
    if (!this.inBounds(x, 0, z)) return -1;
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (BLOCKS[this.get(x, y, z)].solid) return y;
    }
    return -1;
  }

  onChange(cb: ChangeListener): void {
    this.listeners.push(cb);
  }

  /** Latest value per changed cell since clearEdits, including removals. */
  edits(): Edit[] {
    return Array.from(this.changedCells.values(), (edit): Edit => [...edit]);
  }

  /** Reset the edit history without changing cells or the save dirty flag. */
  clearEdits(): void {
    this.changedCells.clear();
  }

  isDirty(): boolean {
    return this.dirty;
  }

  /** A saved world is clean, but its edits must survive subsequent saves. */
  markClean(): void {
    this.dirty = false;
  }
}
