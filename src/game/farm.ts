import { BlockId } from '../core/blocks';
import { canPlant, cropBlock, cropOf, cue, growthRateAt, yields, type PlantKind } from '../core/crops';
import { advanceStage, OFFLINE_CAP_MS, STAGE_MS, TREE_STAGE_MS } from '../core/growth';
import { MAX_STACK, type Inventory } from '../core/inventory';
import { ItemId } from '../core/items';
import type { Cell } from '../core/pathfind';
import type { World } from '../core/world';

/** Progress (ms) toward the next stage. Kind and stage come from the block itself. */
export interface CropRec { x: number; y: number; z: number; p: number }
/** x, y, z = the trunk base cell. */
export interface TreeRec { x: number; y: number; z: number; stage: 0 | 1 | 2 | 3; p: number }

export type FarmEvent =
  | { type: 'planted'; cell: Cell; kind: PlantKind }
  | { type: 'helped'; cell: Cell; cue: 'water' | 'sun' | 'both'; ripe: boolean }
  | { type: 'ripe'; cell: Cell }
  | { type: 'harvested'; cell: Cell; ripe: boolean; got: Array<{ id: ItemId; n: number }> }
  | { type: 'full' }
  | { type: 'rest' };

/** `stage` is the logical stage; the block (`shown` for trees) catches up one record per frame. */
interface Crop { x: number; y: number; z: number; p: number; stage: number }
interface Tree { x: number; y: number; z: number; p: number; stage: number; shown: number }

const SEEDS: readonly ItemId[] = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling];
const SEED_FOR_ITEM = new Map<ItemId, PlantKind>([
  [ItemId.WheatSeed, 'wheat'], [ItemId.CarrotSeed, 'carrot'], [ItemId.PotatoSeed, 'potato'], [ItemId.AppleSapling, 'apple'],
]);

const isCell = (v: unknown): v is { x: number; y: number; z: number; p: number } =>
  v !== null && typeof v === 'object'
  && ['x', 'y', 'z'].every(k => Number.isInteger((v as Record<string, unknown>)[k]));

const cleanP = (p: unknown, len: number): number =>
  typeof p === 'number' && Number.isFinite(p) ? Math.min(Math.max(0, p), len - 1) : 0;

/**
 * Plants are real blocks; this keeps only the growth timers. A stage only ever goes up (by his
 * help or by time) and a plant block only disappears when he picks or digs it. The wall clock is
 * handled by the caller's GrowthClock; `advance` also clamps what it is given.
 */
export class Farm {
  /** Bumps on every change he causes, so the autosave notices. Natural growth does not bump it. */
  revision = 0;

  private readonly crops = new Map<number, Crop>();
  private trees: Tree[] = [];
  private readonly due = new Set<Crop | Tree>();
  private readonly listeners: Array<(e: FarmEvent) => void> = [];

  constructor(private readonly world: World, private readonly inv: Inventory) {}

  onEvent(cb: (e: FarmEvent) => void): void {
    this.listeners.push(cb);
  }

  private emit<T extends FarmEvent>(e: T): T {
    for (const cb of this.listeners) cb(e);
    return e;
  }

  private key(x: number, y: number, z: number): number {
    return x + this.world.sizeX * (z + this.world.sizeZ * y);
  }

  // ---------------------------------------------------------------- saving and loading

  /**
   * Brings pending natural stage changes into the blocks first, so a save never loses growth that
   * the one-change-per-frame drip had not shown yet.
   */
  records(): { crops: CropRec[]; trees: TreeRec[] } {
    this.flush();
    return {
      crops: [...this.crops.values()].map(c => ({ x: c.x, y: c.y, z: c.z, p: c.p })),
      trees: this.trees.map(t => ({ x: t.x, y: t.y, z: t.z, stage: t.stage as TreeRec['stage'], p: t.p })),
    };
  }

  /**
   * Drops records whose block is gone and adds p = 0 for plants that have no record (a plant the
   * save lost the timer of still grows). Bad entries are skipped one by one.
   */
  restore(crops: unknown, trees: unknown): void {
    this.crops.clear();
    this.trees = [];
    this.due.clear();
    if (Array.isArray(crops)) {
      for (const c of crops) {
        if (!isCell(c) || !this.world.inBounds(c.x, c.y, c.z)) continue;
        const info = cropOf(this.world.get(c.x, c.y, c.z));
        if (!info || info.kind === 'apple') continue;
        this.crops.set(this.key(c.x, c.y, c.z), {
          x: c.x, y: c.y, z: c.z, stage: info.stage, p: info.stage >= 3 ? 0 : cleanP(c.p, STAGE_MS),
        });
      }
    }
    if (Array.isArray(trees)) {
      for (const t of trees) {
        if (!isCell(t) || !this.world.inBounds(t.x, t.y, t.z)) continue;
        const saved = (t as unknown as { stage: unknown }).stage;
        const stage = typeof saved === 'number' && Number.isInteger(saved) ? Math.max(0, Math.min(3, saved)) : 0;
        const shown = this.shownStage(t.x, t.y, t.z);
        if (shown === null || this.trees.some(o => o.x === t.x && o.y === t.y && o.z === t.z)) continue;
        const logical = Math.max(stage, shown);
        const rec: Tree = {
          x: t.x, y: t.y, z: t.z, stage: logical, shown,
          p: logical >= 3 ? 0 : cleanP(t.p, TREE_STAGE_MS[logical]),
        };
        this.trees.push(rec);
        if (logical > shown) this.due.add(rec);
      }
    }
    // Plants with no record: every plant is an edit, so only the edits need scanning.
    for (const [x, y, z, id] of this.world.edits()) {
      const info = cropOf(id);
      if (!info || this.world.get(x, y, z) !== id) continue;
      if (info.kind === 'apple') {
        if (!this.trees.some(t => t.x === x && t.y === y && t.z === z)) this.trees.push({ x, y, z, p: 0, stage: 0, shown: 0 });
      } else if (!this.crops.has(this.key(x, y, z))) {
        this.crops.set(this.key(x, y, z), { x, y, z, p: 0, stage: info.stage });
      }
    }
  }

  /** What a tree at this base looks like now: 0 sapling .. 3 ripe, or null if there is no tree base. */
  private shownStage(x: number, y: number, z: number): number | null {
    const base = this.world.get(x, y, z);
    if (base === BlockId.Sapling) return 0;
    if (base !== BlockId.Wood) return null;
    if (this.world.get(x, y + 3, z) !== BlockId.Wood) return 1;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.world.get(x + dx, y + 4, z + dz) === BlockId.AppleLeaves) return 3;
    }
    return 2;
  }

  // ---------------------------------------------------------------- planting

  plant(cell: Cell, seed: ItemId, occupied: Cell[]): boolean {
    const kind = SEED_FOR_ITEM.get(seed);
    if (!kind || this.inv.count(seed) < 1 || !canPlant(this.world, cell, occupied)) return false;
    const [x, y, z] = cell;
    this.inv.remove(seed, 1);
    const ground = this.world.get(x, y - 1, z);
    if (ground === BlockId.Grass || ground === BlockId.Dirt) this.world.set(x, y - 1, z, BlockId.Farmland);
    if (kind === 'apple') {
      this.world.set(x, y, z, BlockId.Sapling);
      this.trees.push({ x, y, z, p: 0, stage: 0, shown: 0 });
    } else {
      this.world.set(x, y, z, cropBlock(kind, 0));
      this.crops.set(this.key(x, y, z), { x, y, z, p: 0, stage: 0 });
    }
    this.revision++;
    this.emit({ type: 'planted', cell: [x, y, z], kind });
    return true;
  }

  // ---------------------------------------------------------------- lookups

  private cropAt([x, y, z]: Cell): Crop | null {
    const info = cropOf(this.world.get(x, y, z));
    if (!info || info.kind === 'apple') return null;
    let rec = this.crops.get(this.key(x, y, z));
    if (!rec) {
      rec = { x, y, z, p: 0, stage: info.stage };
      this.crops.set(this.key(x, y, z), rec);
    }
    return rec;
  }

  /** The tree whose trunk or canopy box holds this cell and block. Trees with no base are dropped. */
  private treeAt([x, y, z]: Cell): Tree | null {
    const here = this.world.get(x, y, z);
    if (here !== BlockId.Sapling && here !== BlockId.Wood && here !== BlockId.Leaves && here !== BlockId.AppleLeaves) return null;
    for (const t of [...this.trees]) {
      if (Math.abs(x - t.x) > 1 || Math.abs(z - t.z) > 1 || y < t.y || y > t.y + 5) continue;
      if (this.shownStage(t.x, t.y, t.z) === null) { this.dropTree(t); continue; }
      return t;
    }
    return null;
  }

  private dropTree(t: Tree): void {
    this.trees = this.trees.filter(o => o !== t);
    this.due.delete(t);
  }

  isPlantCell(cell: Cell): boolean {
    const info = cropOf(this.world.get(...cell));
    return info !== null || this.treeAt(cell) !== null;
  }

  nearestRipe(from: Cell, radius: number): Cell | null {
    let best: Cell | null = null;
    let bestD = radius * radius;
    const consider = (c: Cell): void => {
      const d = (c[0] - from[0]) ** 2 + (c[1] - from[1]) ** 2 + (c[2] - from[2]) ** 2;
      if (d <= bestD) { bestD = d; best = c; }
    };
    for (const c of this.crops.values()) {
      if (cropOf(this.world.get(c.x, c.y, c.z))?.stage === 3) consider([c.x, c.y, c.z]);
    }
    for (const t of this.trees) if (t.shown === 3) consider([t.x, t.y, t.z]);
    return best;
  }

  seedsAndGrowing(): { seeds: number; growing: number } {
    return {
      seeds: SEEDS.reduce((n, id) => n + this.inv.count(id), 0),
      growing: this.crops.size + this.trees.length,
    };
  }

  // ---------------------------------------------------------------- helping

  /** One stage up at once (also for any block of a tree), with the cue for what it was given. */
  help(cell: Cell): FarmEvent | null {
    const crop = this.cropAt(cell);
    if (crop) {
      if (crop.stage >= 3) return this.emit({ type: 'rest' });
      const given = cue(crop.stage);
      this.setCropStage(crop, crop.stage + 1);
      crop.p = 0;
      this.revision++;
      return this.emit({ type: 'helped', cell: [crop.x, crop.y, crop.z], cue: given, ripe: crop.stage >= 3 });
    }
    const tree = this.treeAt(cell);
    if (!tree) return null;
    if (tree.stage >= 3) return this.emit({ type: 'rest' });
    const given = cue(tree.stage);
    this.setTreeStage(tree, tree.stage + 1);
    tree.p = 0;
    this.revision++;
    return this.emit({ type: 'helped', cell: [tree.x, tree.y, tree.z], cue: given, ripe: tree.stage >= 3 });
  }

  private setCropStage(crop: Crop, stage: number): void {
    const info = cropOf(this.world.get(crop.x, crop.y, crop.z));
    if (!info || info.kind === 'apple') return;
    crop.stage = Math.max(crop.stage, stage);
    this.world.set(crop.x, crop.y, crop.z, cropBlock(info.kind, crop.stage));
    this.due.delete(crop);
    if (crop.stage >= 3) { crop.p = 0; this.emit({ type: 'ripe', cell: [crop.x, crop.y, crop.z] }); }
  }

  private setTreeStage(tree: Tree, stage: number): void {
    tree.stage = Math.max(tree.stage, stage);
    this.due.delete(tree);
    for (let s = tree.shown + 1; s <= tree.stage; s++) {
      if (!this.stampTree(tree, s)) return; // base gone: the record is dropped
      tree.shown = s;
    }
    if (tree.stage >= 3) { tree.p = 0; this.emit({ type: 'ripe', cell: [tree.x, tree.y, tree.z] }); }
  }

  /** Stamps a tree stage into Air cells only. False (and the record dropped) when the base is gone. */
  private stampTree(t: Tree, stage: number): boolean {
    const w = this.world;
    const { x, y, z } = t;
    const base = w.get(x, y, z);
    if (base !== BlockId.Sapling && base !== BlockId.Wood) { this.dropTree(t); return false; }
    const fill = (px: number, py: number, pz: number, id: BlockId, over: BlockId[] = []): void => {
      const cur = w.get(px, py, pz);
      if (cur === BlockId.Air || over.includes(cur)) w.set(px, py, pz, id);
    };
    const ring: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (stage === 1) {
      w.set(x, y, z, BlockId.Wood);
      fill(x, y + 1, z, BlockId.Wood);
      for (const [dx, dz] of ring) fill(x + dx, y + 1, z + dz, BlockId.Leaves);
      fill(x, y + 2, z, BlockId.Leaves);
    } else if (stage === 2) {
      // The young tree's own small leaves make way for the trunk and canopy.
      for (const [dx, dz] of ring) if (w.get(x + dx, y + 1, z + dz) === BlockId.Leaves) w.set(x + dx, y + 1, z + dz, BlockId.Air);
      w.set(x, y, z, BlockId.Wood);
      for (let h = 1; h <= 3; h++) fill(x, y + h, z, BlockId.Wood, [BlockId.Leaves]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) for (const h of [4, 5]) fill(x + dx, y + h, z + dz, BlockId.Leaves);
      }
    } else if (stage === 3) {
      for (const [dx, dz] of ring) if (w.get(x + dx, y + 4, z + dz) === BlockId.Leaves) w.set(x + dx, y + 4, z + dz, BlockId.AppleLeaves);
    }
    return true;
  }

  // ---------------------------------------------------------------- picking

  /**
   * A crop block, a sapling or ripe apple leaves. All or nothing: a yield that would pass 99 is
   * refused and nothing changes. A pull before ripe gives the seed back.
   */
  harvest(cell: Cell): FarmEvent {
    const [x, y, z] = cell;
    const id = this.world.get(x, y, z);
    if (id === BlockId.AppleLeaves) return this.pickApples(cell);
    const info = cropOf(id);
    if (!info) return this.emit({ type: 'rest' });
    const got = yields(info.kind, info.stage);
    if (!this.fits(got)) return this.emit({ type: 'full' });
    for (const g of got) this.inv.add(g.id, g.n);
    this.world.set(x, y, z, BlockId.Air);
    if (info.kind === 'apple') {
      const t = this.trees.find(o => o.x === x && o.y === y && o.z === z);
      if (t) this.dropTree(t);
    } else {
      const c = this.crops.get(this.key(x, y, z));
      if (c) this.due.delete(c);
      this.crops.delete(this.key(x, y, z));
    }
    this.revision++;
    return this.emit({ type: 'harvested', cell: [x, y, z], ripe: info.stage >= 3, got });
  }

  private fits(got: Array<{ id: ItemId; n: number }>): boolean {
    return got.every(g => this.inv.count(g.id) + g.n <= MAX_STACK);
  }

  private pickApples(cell: Cell): FarmEvent {
    const got = yields('apple', 3);
    if (!this.fits(got)) return this.emit({ type: 'full' });
    for (const g of got) this.inv.add(g.id, g.n);
    const tree = this.treeAt(cell);
    if (tree) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.world.get(tree.x + dx, tree.y + 4, tree.z + dz) === BlockId.AppleLeaves) {
          this.world.set(tree.x + dx, tree.y + 4, tree.z + dz, BlockId.Leaves);
        }
      }
      tree.stage = 2;
      tree.shown = 2;
      tree.p = 0;
      this.due.delete(tree);
    }
    if (this.world.get(...cell) === BlockId.AppleLeaves) this.world.set(...cell, BlockId.Leaves);
    this.revision++;
    return this.emit({ type: 'harvested', cell, ripe: true, got });
  }

  // ---------------------------------------------------------------- time

  /** Natural growth. Time only adds: bad or negative amounts add nothing, and one call adds at most the offline cap. */
  advance(ms: number): void {
    if (!(ms > 0)) return;
    const amount = Math.min(ms, OFFLINE_CAP_MS);
    for (const c of this.crops.values()) {
      if (c.stage >= 3) continue;
      const r = advanceStage(c.stage, c.p, amount * growthRateAt(this.world, [c.x, c.y, c.z]), STAGE_MS, 3);
      c.p = r.progress;
      if (r.stage > c.stage) { c.stage = r.stage; this.due.add(c); }
    }
    for (const t of this.trees) {
      if (t.stage >= 3) continue;
      const r = advanceStage(t.stage, t.p, amount * growthRateAt(this.world, [t.x, t.y, t.z]), TREE_STAGE_MS, 3);
      t.p = r.progress;
      if (r.stage > t.stage) { t.stage = r.stage; this.due.add(t); }
    }
  }

  /** Shows at most ONE queued natural stage change per call, so a long sleep never rebuilds a burst of chunks. */
  update(_dt: number): void {
    const next = this.due.values().next();
    if (next.done) return;
    this.show(next.value);
  }

  private show(rec: Crop | Tree): void {
    this.due.delete(rec);
    if ('shown' in rec) {
      if (rec.shown < rec.stage) this.setTreeStage(rec, rec.stage);
    } else if (cropOf(this.world.get(rec.x, rec.y, rec.z)) === null) {
      this.crops.delete(this.key(rec.x, rec.y, rec.z)); // dug: record gone
    } else {
      this.setCropStage(rec, rec.stage);
    }
  }

  private flush(): void {
    for (const rec of [...this.due]) this.show(rec);
  }
}
