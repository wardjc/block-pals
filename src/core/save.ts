import type { CropRec, TreeRec } from '../game/farm';
import type { Game } from '../game/game';
import { BLOCKS, BlockId, isCarriable } from './blocks';
import { LEGACY_WORLD, WORLD } from './bounds';
import { GrowthClock, STAGE_MS, TREE_STAGE_MS } from './growth';
import { Inventory, MAX_STACK } from './inventory';
import { isItemId } from './items';
import { isStandable } from './pathfind';
import type { VillageLayout } from './village';
import type { World } from './world';
import { GEN_VERSION, generateWorld } from './worldgen';

/**
 * Version 2 lives under its OWN key. The version 1 key is never written, changed or deleted by
 * this build (only the grown-ups' reset removes it), so rolling the app back to an older build
 * still finds his untouched v1 save and nothing is lost. The old build treats an unknown version
 * as corrupt and would overwrite it, which is why v2 must not share the v1 key.
 */
export const SAVE_KEY = 'blockpals.save.v2';
export const LEGACY_SAVE_KEY = 'blockpals.save.v1';
/** Raw copy of the v1 payload, written once when it is first migrated, never overwritten. */
export const BACKUP_KEY = 'blockpals.save.v1.backup';
/** Every key a reset has to clear. */
/** Raw copy of a damaged v2 payload, kept before anything replaces it; never overwritten (spares: .2 to .4). */
export const BAD_V2_KEY = 'blockpals.save.v2.bad';
export const ALL_SAVE_KEYS: readonly string[] = [
  SAVE_KEY, LEGACY_SAVE_KEY, BACKUP_KEY, BAD_V2_KEY, `${BAD_V2_KEY}.2`, `${BAD_V2_KEY}.3`, `${BAD_V2_KEY}.4`,
];

/** Hint names the farm may save; anything else in a save is ignored. */
export const HINT_NAMES: readonly string[] = ['plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch'];
/** More crop or tree records than this in a save are ignored (the plants still exist as blocks). */
export const MAX_FARM_RECORDS = 2000;

export interface SaveFlags { ledToVillage: boolean; fernSeeds?: boolean; hints?: string[] }

/** kind 0..3 (chicken, cow, sheep, pig), x, y, z, giftIn seconds, variant. */
export type SavedAnimalTuple = [number, number, number, number, number, number];

export interface SaveDataV1 {
  version: 1;
  seed: number;
  edits: Array<[number, number, number, number]>;
  inventory: Record<number, number>;
  player: { x: number; y: number; z: number };
  order?: number[];
}

export interface SaveData {
  version: 2;
  /** Generator version that made the world the edits sit on. */
  gen: number;
  seed: number;
  edits: Array<[number, number, number, number]>;
  inventory: Record<number, number>;
  player: { x: number; y: number; z: number };
  /** Hotbar order (first collected first). Optional: saves before the final review lack it. */
  order?: number[];
  /** Item kinds in the bag (seeds, food, wool and so on). Optional and additive: absent in saves from step 1. */
  items?: Record<number, number>;
  /** Item order, first obtained first (emptied kinds keep their place). */
  itemOrder?: number[];
  /** Milliseconds since the epoch when this was written; offline growth is counted from it (capped at 8 h). */
  savedAt?: number;
  /** x, y, z, progress ms toward the next stage. The plants themselves are blocks in `edits`. */
  crops?: Array<[number, number, number, number]>;
  /** x, y, z (trunk base), stage 0..3, progress ms. */
  trees?: Array<[number, number, number, number, number]>;
  animals?: SavedAnimalTuple[];
  flags: SaveFlags;
}

export function serialise(
  game: Game, seed: number, flags: SaveFlags = { ledToVillage: false }, now: number = Date.now(), animals?: SavedAnimalTuple[],
): SaveData {
  // Records first: this brings any pending plant growth into the world before the edits are read.
  const farm = game.farm.records();
  const items = game.inventory.itemsToJSON();
  const itemOrder = game.inventory.itemOrder();
  const data: SaveData = {
    version: 2,
    gen: GEN_VERSION,
    seed,
    edits: game.world.edits(),
    inventory: game.inventory.toJSON(),
    player: { ...game.player.pos },
    order: game.inventory.order(),
    savedAt: now,
    flags: { ledToVillage: flags.ledToVillage },
  };
  if (flags.fernSeeds === true) data.flags.fernSeeds = true;
  if (flags.hints && flags.hints.length > 0) data.flags.hints = [...flags.hints];
  // Only written when there is something, so a block-only bag with no plants saves what step 1 saved (plus savedAt).
  if (itemOrder.length > 0) {
    data.items = items;
    data.itemOrder = itemOrder;
  }
  if (farm.crops.length > 0) data.crops = farm.crops.map(c => [c.x, c.y, c.z, c.p]);
  if (farm.trees.length > 0) data.trees = farm.trees.map(t => [t.x, t.y, t.z, t.stage, t.p]);
  if (animals && animals.length > 0) data.animals = animals.map(a => [...a] as SavedAnimalTuple);
  return data;
}

/** Carries everything over untouched: same seed, edits (the v1 world is the corner of the new one), bag. */
export function migrateV1(v1: SaveDataV1): SaveData {
  const data: SaveData = {
    version: 2,
    gen: 1,
    seed: v1.seed,
    edits: v1.edits.map(edit => [...edit] as [number, number, number, number]),
    inventory: { ...v1.inventory },
    player: { ...v1.player },
    flags: { ledToVillage: false },
  };
  if (v1.order) data.order = [...v1.order];
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBlockId(value: unknown): value is BlockId {
  return typeof value === 'number' && Number.isInteger(value) && Object.hasOwn(BLOCKS, value);
}

/** The top-level fields are the right kind of thing. Individual edits are checked (and skipped) separately. */
function validShape(value: Record<string, unknown>): boolean {
  if (!Number.isSafeInteger(value.seed) || !Array.isArray(value.edits) || !isRecord(value.player)) return false;
  const { x, y, z } = value.player;
  return [x, y, z].every(n => typeof n === 'number' && Number.isFinite(n));
}

function validEdit(edit: unknown, size: { x: number; y: number; z: number }): edit is [number, number, number, number] {
  return Array.isArray(edit) && edit.length === 4
    && [size.x, size.y, size.z].every((n, axis) => Number.isInteger(edit[axis]) && edit[axis] >= 0 && edit[axis] < n)
    && isBlockId(edit[3]);
}

/**
 * Items are cleaned entry by entry: an unknown id or a bad count is dropped on its own, so one bad
 * entry never costs the rest of the bag, the blocks or the world. Anything that is not a list or a
 * record is ignored.
 */
function cleanItems(items: unknown, itemOrder: unknown): Pick<SaveData, 'items' | 'itemOrder'> {
  const kept: Record<number, number> = {};
  if (isRecord(items)) {
    for (const [key, n] of Object.entries(items)) {
      const id = Number(key);
      if (String(id) === key && isItemId(id) && typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_STACK) kept[id] = n;
    }
  }
  const order: number[] = [];
  if (Array.isArray(itemOrder)) {
    for (const id of itemOrder) {
      if (typeof id === 'number' && isItemId(id) && !order.includes(id)) order.push(id);
    }
  }
  for (const key of Object.keys(kept)) if (!order.includes(Number(key))) order.push(Number(key));
  return order.length === 0 ? {} : { items: kept, itemOrder: order };
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFinite_ = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inBox = (v: unknown[], size: { x: number; y: number; z: number }): boolean =>
  isInt(v[0]) && isInt(v[1]) && isInt(v[2]) && v[0] >= 0 && v[0] < size.x && v[1] >= 0 && v[1] < size.y && v[2] >= 0 && v[2] < size.z;

/**
 * Crop, tree and animal lists are cleaned entry by entry: a bad entry, a duplicate cell or anything
 * past the cap is dropped on its own. A list of the wrong type is dropped as a whole; nothing here
 * can ever reject the save or cost him his world.
 */
function cleanFarm(parsed: Record<string, unknown>): Pick<SaveData, 'crops' | 'trees' | 'animals' | 'savedAt'> {
  const out: Pick<SaveData, 'crops' | 'trees' | 'animals' | 'savedAt'> = {};
  if (isFinite_(parsed.savedAt) && parsed.savedAt > 0) out.savedAt = parsed.savedAt;
  const seen = new Set<string>();
  const first = <T>(list: unknown, take: (e: unknown[]) => T | null): T[] => {
    const kept: T[] = [];
    if (!Array.isArray(list)) return kept;
    for (const e of list) {
      if (kept.length >= MAX_FARM_RECORDS) break;
      if (!Array.isArray(e)) continue;
      const v = take(e);
      if (v) kept.push(v);
    }
    return kept;
  };
  const crops = first(parsed.crops, e => {
    if (e.length !== 4 || !inBox(e, WORLD) || !isFinite_(e[3])) return null;
    const key = `c${e[0]},${e[1]},${e[2]}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return [e[0], e[1], e[2], Math.min(Math.max(0, e[3]), STAGE_MS - 1)] as [number, number, number, number];
  });
  if (crops.length > 0) out.crops = crops;
  const trees = first(parsed.trees, e => {
    if (e.length !== 5 || !inBox(e, WORLD) || !isInt(e[3]) || e[3] < 0 || e[3] > 3 || !isFinite_(e[4])) return null;
    const key = `t${e[0]},${e[1]},${e[2]}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const len = e[3] >= 3 ? 1 : TREE_STAGE_MS[e[3]];
    return [e[0], e[1], e[2], e[3], e[3] >= 3 ? 0 : Math.min(Math.max(0, e[4]), len - 1)] as [number, number, number, number, number];
  });
  if (trees.length > 0) out.trees = trees;
  const animals = first(parsed.animals, e => {
    if (e.length !== 6 || !isInt(e[0]) || e[0] < 0 || e[0] > 3) return null;
    if (![e[1], e[2], e[3]].every(isFinite_) || !isFinite_(e[4]) || !isInt(e[5]) || e[5] < 0) return null;
    const n = e as number[];
    if (n[1] < 0 || n[1] >= WORLD.x || n[2] < 0 || n[2] >= WORLD.y || n[3] < 0 || n[3] >= WORLD.z) return null;
    // Two animals never share a cell, so the cell (not the rounded spot) is the identity.
    const key = `a${Math.floor(n[1])},${Math.floor(n[2])},${Math.floor(n[3])}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return [n[0], n[1], n[2], n[3], Math.max(0, n[4]), n[5]] as SavedAnimalTuple;
  });
  if (animals.length > 0) out.animals = animals;
  return out;
}

function cleanFlags(flags: Record<string, unknown>): SaveFlags {
  const out: SaveFlags = { ledToVillage: flags.ledToVillage === true };
  if (flags.fernSeeds === true) out.fernSeeds = true;
  if (Array.isArray(flags.hints)) {
    const hints = flags.hints.filter((h, i, all): h is string => typeof h === 'string' && HINT_NAMES.includes(h) && all.indexOf(h) === i);
    if (hints.length > 0) out.hints = hints;
  }
  return out;
}

function validInventory(inv: unknown): boolean {
  return isRecord(inv) && Object.entries(inv).every(([key, count]) => {
    const id = Number(key);
    return String(id) === key && isCarriable(id)
      && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= MAX_STACK;
  });
}

/**
 * Accepts v1 (migrated) and v2; always returns v2. Anything else (corrupt, older than 1, newer
 * than 2) is null, so the game starts fresh instead of crashing.
 * A bad inventory does NOT make the save corrupt: keep the builds, use an empty bag.
 */
export function parseSave(raw: string | null): SaveData | null {
  return inspectSave(raw)?.data ?? null;
}

/**
 * Like parseSave, and also says how many individual edits were skipped as invalid (out of range or
 * an unknown block). Valid edits are always kept: one bad entry never costs him the rest of his world.
 * Structural problems (not JSON, wrong version, bad seed, edits or player) still reject the whole save.
 */
export function inspectSave(raw: string | null): { data: SaveData; skipped: number } | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    let data: SaveData;
    let skipped = 0;
    const keepValid = (size: { x: number; y: number; z: number }): void => {
      const edits = parsed.edits as unknown[];
      const kept = edits.filter((e): e is [number, number, number, number] => validEdit(e, size));
      skipped = edits.length - kept.length;
      parsed.edits = kept;
    };
    if (parsed.version === 1) {
      if (!validShape(parsed)) return null;
      keepValid(LEGACY_WORLD);
      data = migrateV1(parsed as unknown as SaveDataV1);
      data.inventory = parsed.inventory as Record<number, number>;
      if ('order' in parsed) data.order = parsed.order as number[];
    } else if (parsed.version === 2) {
      if (!validShape(parsed) || !Number.isSafeInteger(parsed.gen) || (parsed.gen as number) < 1) return null;
      keepValid(WORLD);
      const flags = isRecord(parsed.flags) ? parsed.flags : {};
      data = {
        ...(parsed as unknown as SaveData),
        flags: cleanFlags(flags),
      };
    } else {
      return null;
    }
    if (!validInventory(data.inventory)) data.inventory = {};
    if ('order' in data && !Inventory.validOrder(data.order)) delete data.order;
    delete data.items;
    delete data.itemOrder;
    delete data.savedAt;
    delete data.crops;
    delete data.trees;
    delete data.animals;
    Object.assign(data, cleanItems(parsed.items, parsed.itemOrder));
    if (parsed.version === 2) Object.assign(data, cleanFarm(parsed));
    return { data, skipped };
  } catch {
    return null;
  }
}

export interface Applied {
  world: World;
  inventory: Inventory;
  spawn: { x: number; y: number; z: number };
  village: VillageLayout;
  flags: SaveFlags;
  items: Record<number, number>;
  /** Plant timers to hand to Farm.restore after the edits are in. */
  farm: { crops: CropRec[]; trees: TreeRec[] };
  animals: SavedAnimalTuple[];
  /** Time to grow while the game was closed: never negative, never more than 8 hours. */
  offlineMs: number;
}

export function applySave(data: SaveData, now: number = Date.now()): Applied {
  // Stamps first, then his edits: whatever he built or dug always wins over generated houses and paths.
  const { world, spawn, village } = generateWorld(data.seed);
  for (const [x, y, z, id] of data.edits) world.replayEdit(x, y, z, id);
  // Replayed edits must remain in every later save, even while the world is clean.
  world.markClean();
  const { x, y, z } = data.player;
  // Never put him back under a roof: a saved spot inside any house footprint means spawn instead.
  const inHouse = village.houses.some(h => x >= h.rect.x0 && x < h.rect.x1 + 1 && z >= h.rect.z0 && z < h.rect.z1 + 1);
  return {
    world,
    inventory: Inventory.fromJSON(data.inventory, data.order, data.items, data.itemOrder),
    spawn: !inHouse && isStandable(world, [Math.floor(x), Math.floor(y), Math.floor(z)])
      ? { ...data.player } : spawn,
    village,
    flags: cleanFlags(data.flags as unknown as Record<string, unknown>),
    items: { ...(data.items ?? {}) },
    farm: {
      crops: (data.crops ?? []).map(([cx, cy, cz, p]) => ({ x: cx, y: cy, z: cz, p })),
      trees: (data.trees ?? []).map(([tx, ty, tz, stage, p]) => ({ x: tx, y: ty, z: tz, stage: stage as TreeRec['stage'], p })),
    },
    animals: (data.animals ?? []).map(a => [...a] as SavedAnimalTuple),
    // No savedAt (an older save): nothing extra grows. A future savedAt or a backwards clock gives 0.
    offlineMs: isFinite_(data.savedAt) ? new GrowthClock(data.savedAt).step(now) : 0,
  };
}

type RawRead = { ok: true; raw: string | null } | { ok: false };

/** A read that throws is NOT the same as "no save": never treat it as absent. */
function readKey(storage: Storage, key: string): RawRead {
  try { return { ok: true, raw: storage.getItem(key) }; } catch { return { ok: false }; }
}

/**
 * What this page load knows about the storage, per Storage object.
 *  - ok: the game started from what the storage held (or the storage was truly empty).
 *  - unreadable: a key could not be READ at start. The game runs from a fresh world in memory and
 *    writes nothing until the storage can be read again and is found empty.
 *  - conflict: the storage turned out to hold a save the running game did not start from. Never overwritten.
 * `pendingMigration` stays true until the migrated v2 save has actually been written.
 */
interface Session { mode: 'ok' | 'unreadable' | 'conflict'; pendingMigration: boolean }
const sessions = new WeakMap<Storage, Session>();
const sessionOf = (storage: Storage): Session => {
  let s = sessions.get(storage);
  if (!s) { s = { mode: 'ok', pendingMigration: false }; sessions.set(storage, s); }
  return s;
};

/** True while a migrated save still has to reach the v2 key (a failed or refused write). */
export function hasPendingMigration(storage: Storage | null): boolean {
  return storage !== null && (sessions.get(storage)?.pendingMigration ?? false);
}

/** Keys that hold a copy of a damaged v2 payload: the first is the original, then three spares. */
const BAD_SLOTS = [BAD_V2_KEY, `${BAD_V2_KEY}.2`, `${BAD_V2_KEY}.3`, `${BAD_V2_KEY}.4`];

/**
 * Makes sure `raw` is kept under a bad-copy key before anything replaces it. True when a slot
 * already holds exactly this payload or a free slot took it. An occupied slot is never overwritten.
 */
function preserveBad(storage: Storage, raw: string): boolean {
  for (const key of BAD_SLOTS) {
    const cur = readKey(storage, key);
    if (!cur.ok) return false;
    if (cur.raw === raw) return true;
    if (cur.raw !== null) continue;
    try {
      storage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Writes v2 to its own key. Never touches the v1 key. It refuses (returns false, writes nothing) when:
 * a save from a newer build (version above 2) is stored; the stored v2 cannot be read; this page
 * started without being able to read the storage and the storage now holds a save; or the stored v2
 * is damaged (unreadable JSON or skipped edits) and a copy of it cannot first be kept under a
 * `blockpals.save.v2.bad` key. A higher stored `gen` is never lowered.
 */
export function storeSave(storage: Storage | null, data: SaveData): boolean {
  if (!storage) return false;
  try {
    const session = sessionOf(storage);
    const existing = readKey(storage, SAVE_KEY);
    if (!existing.ok) return false;
    if (session.mode === 'conflict') return false;
    if (session.mode === 'unreadable') {
      // Started blind: only write if the storage is now readable AND truly empty.
      const v1 = readKey(storage, LEGACY_SAVE_KEY);
      if (!v1.ok) return false;
      if (existing.raw !== null || v1.raw !== null) { session.mode = 'conflict'; return false; }
      session.mode = 'ok';
    }
    let gen: number = data.gen;
    if (existing.raw !== null) {
      const stored = parseExisting(existing.raw);
      if (stored && typeof stored.version === 'number' && stored.version > 2) return false;
      const checked = inspectSave(existing.raw);
      if ((!checked || checked.skipped > 0) && !preserveBad(storage, existing.raw)) return false;
      if (stored && stored.version === 2 && Number.isSafeInteger(stored.gen)) gen = Math.max(gen, stored.gen as number);
    }
    storage.setItem(SAVE_KEY, JSON.stringify({ ...data, gen }));
    session.pendingMigration = false;
    return true;
  } catch {
    return false;
  }
}

function parseExisting(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Copies the raw v1 payload once. An existing backup is never overwritten; failure is harmless. */
function backupLegacy(storage: Storage, raw: string): void {
  try {
    if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw);
  } catch { /* full or blocked storage: the v1 key itself is untouched anyway */ }
}

/**
 * Reads v2 first (valid edits are kept even if some entries are damaged). If there is no usable
 * v2, falls back to migrating the v1 save: the raw v1 payload is backed up (first time only), the
 * v1 key stays byte-identical, and the migrated save is written to the v2 key. A damaged v2 is
 * copied to a `.bad` key first, and is only replaced once that copy exists. If a key cannot be
 * READ, nothing is migrated or written: he plays from a fresh world in memory, nothing is lost.
 */
export function readSave(storage: Storage | null): SaveData | null {
  if (!storage) return null;
  try {
    const session = sessionOf(storage);
    session.mode = 'ok';
    const v2 = readKey(storage, SAVE_KEY);
    if (!v2.ok) { session.mode = 'unreadable'; return null; }
    const current = inspectSave(v2.raw);
    if (current) {
      if (current.skipped > 0) preserveBad(storage, v2.raw as string); // retried by storeSave if it fails now
      return current.data;
    }
    const v1 = readKey(storage, LEGACY_SAVE_KEY);
    if (!v1.ok) { session.mode = 'unreadable'; return null; }
    const migrated = parseSave(v1.raw);
    if (!migrated || v1.raw === null) return null;
    if (v2.raw !== null) preserveBad(storage, v2.raw);
    backupLegacy(storage, v1.raw);
    session.pendingMigration = true;
    storeSave(storage, migrated); // refused (and retried by the autosave) if the damaged v2 could not be kept
    return migrated;
  } catch {
    return null;
  }
}

/** How far (blocks) he must walk from the last written spot before position alone counts as a change. */
export const SAVE_MOVE_THRESHOLD = 1;

/** Returns a disposer for the timer and visibility listener. */
export function startAutosave(
  game: Game, seed: number, storage: Storage | null, flags: SaveFlags = { ledToVillage: false },
  /** The herd's positions ride along on every save; a gift (game.herdRevision) marks the save dirty. */
  animals?: () => SavedAnimalTuple[],
): () => void {
  // `flags` is read live, so flipping ledToVillage later also triggers a save.
  const snapshot = (): string => JSON.stringify([game.inventory.toJSON(), game.inventory.order(), game.inventory.itemsToJSON(), game.inventory.itemOrder(), flags, game.farm.revision, game.herdRevision]);
  let savedInventory = snapshot();
  let savedPos = { ...game.player.pos };
  // Stays true until a write succeeds: a failed or refused write is retried, never forgotten.
  let pending = hasPendingMigration(storage);
  const moved = (): boolean => {
    const p = game.player.pos;
    return Math.hypot(p.x - savedPos.x, p.y - savedPos.y, p.z - savedPos.z) > SAVE_MOVE_THRESHOLD;
  };
  const save = (force: boolean): void => {
    const inventory = snapshot();
    if (!force && !pending && !game.world.isDirty() && inventory === savedInventory && !moved()) return;
    pending = true;
    if (storeSave(storage, serialise(game, seed, flags, Date.now(), animals?.()))) {
      pending = false;
      game.world.markClean();
      savedInventory = inventory;
      savedPos = { ...game.player.pos };
    }
  };
  const timer = setInterval(() => save(false), 10_000);
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') save(true);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  const onPageHide = (): void => save(true);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
