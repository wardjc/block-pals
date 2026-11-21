import { BLOCKS, BlockId } from './blocks';

type Edit = [number, number, number, BlockId];
type ChangeListener = (x: number, y: number, z: number) => void;

export class World {
  private readonly cells: Uint8Array;
  private readonly changedCells = new Map<number, Edit>();
  private readonly listeners: ChangeListener[] = [];
  private dirty = false;
  /** Nesting depth of beginBulk; while above 0, set() writes the cell only. */
  private bulk = 0;

  constructor(
    readonly sizeX: number,
    readonly sizeY: number,
    readonly sizeZ: number,
    cells?: Uint8Array,
  ) {
    this.cells = cells ?? new Uint8Array(sizeX * sizeY * sizeZ);
  }

  /** Wraps an existing cell buffer (World.index order) without copying it: the world takes it. */
  static fromBuffer(sx: number, sy: number, sz: number, cells: Uint8Array): World {
    if (cells.length !== sx * sy * sz) throw new Error(`World.fromBuffer: ${cells.length} cells for ${sx} x ${sy} x ${sz}`);
    return new World(sx, sy, sz, cells);
  }

  /** The raw cells (World.index order), for transfer to and from the generation worker. */
  get buffer(): Uint8Array {
    return this.cells;
  }

  /**
   * Generation mode. While bulk, set() writes the cell only: no edit record, no listeners, no
   * dirty flag (at 2.5 million cells, recording every generated set would cost hundreds of MB).
   * Calls nest; normal play never uses it.
   */
  beginBulk(): void {
    this.bulk++;
  }

  endBulk(): void {
    this.bulk = Math.max(0, this.bulk - 1);
  }

  /** One whole horizontal layer in one typed-array fill (no edit record, like bulk mode). */
  fillLayer(y: number, id: BlockId): void {
    if (!Number.isInteger(y) || y < 0 || y >= this.sizeY) return;
    const layer = this.sizeX * this.sizeZ;
    this.cells.fill(id, y * layer, (y + 1) * layer);
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
    if (this.bulk > 0) return;
    this.changedCells.set(index, [x, y, z, id]);
    this.dirty = true;
    for (const listener of this.listeners) listener(x, y, z);
  }

  /**
   * Replays a saved edit. Unlike set(), an edit that already matches the generated world is still
   * remembered, so it stays in every later save even if a newer generator stamps something there.
   */
  replayEdit(x: number, y: number, z: number, id: BlockId): void {
    if (!this.inBounds(x, y, z)) return;
    this.set(x, y, z, id);
    this.changedCells.set(this.index(x, y, z), [x, y, z, id]);
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
