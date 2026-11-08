import type { Game } from '../game/game';
import { BLOCKS, BlockId } from './blocks';
import { LEGACY_WORLD, WORLD } from './bounds';
import { Inventory, MAX_STACK } from './inventory';
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

export interface SaveFlags { ledToVillage: boolean }

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
  flags: SaveFlags;
}

export function serialise(game: Game, seed: number, flags: SaveFlags = { ledToVillage: false }): SaveData {
  return {
    version: 2,
    gen: GEN_VERSION,
    seed,
    edits: game.world.edits(),
    inventory: game.inventory.toJSON(),
    player: { ...game.player.pos },
    order: game.inventory.order(),
    flags: { ledToVillage: flags.ledToVillage },
  };
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

function validInventory(inv: unknown): boolean {
  return isRecord(inv) && Object.entries(inv).every(([key, count]) => {
    const id = Number(key);
    return String(id) === key && isBlockId(id) && id !== BlockId.Air && id !== BlockId.Bedrock
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
        flags: { ledToVillage: flags.ledToVillage === true },
      };
    } else {
      return null;
    }
    if (!validInventory(data.inventory)) data.inventory = {};
    if ('order' in data && !Inventory.validOrder(data.order)) delete data.order;
    return { data, skipped };
  } catch {
    return null;
  }
}

export function applySave(data: SaveData): {
  world: World;
  inventory: Inventory;
  spawn: { x: number; y: number; z: number };
  village: VillageLayout;
  flags: SaveFlags;
} {
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
    inventory: Inventory.fromJSON(data.inventory, data.order),
    spawn: !inHouse && isStandable(world, [Math.floor(x), Math.floor(y), Math.floor(z)])
      ? { ...data.player } : spawn,
    village,
    flags: { ledToVillage: data.flags.ledToVillage },
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
): () => void {
  // `flags` is read live, so flipping ledToVillage later also triggers a save.
  const snapshot = (): string => JSON.stringify([game.inventory.toJSON(), game.inventory.order(), flags]);
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
    if (storeSave(storage, serialise(game, seed, flags))) {
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
