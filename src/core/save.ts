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
/** Raw copy of a v2 payload that failed validation while v1 was used instead; written once, never overwritten. */
export const BAD_V2_KEY = 'blockpals.save.v2.bad';
export const ALL_SAVE_KEYS: readonly string[] = [SAVE_KEY, LEGACY_SAVE_KEY, BACKUP_KEY, BAD_V2_KEY];

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

function validShape(value: Record<string, unknown>, size: { x: number; y: number; z: number }): boolean {
  if (!Number.isSafeInteger(value.seed) || !Array.isArray(value.edits) || !isRecord(value.player)) return false;
  if (!value.edits.every(edit => Array.isArray(edit) && edit.length === 4
    && [size.x, size.y, size.z].every((n, axis) => Number.isInteger(edit[axis]) && edit[axis] >= 0 && edit[axis] < n)
    && isBlockId(edit[3]))) return false;
  const { x, y, z } = value.player;
  return [x, y, z].every(n => typeof n === 'number' && Number.isFinite(n));
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
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    let data: SaveData;
    if (parsed.version === 1) {
      if (!validShape(parsed, LEGACY_WORLD)) return null;
      data = migrateV1(parsed as unknown as SaveDataV1);
      data.inventory = parsed.inventory as Record<number, number>;
      if ('order' in parsed) data.order = parsed.order as number[];
    } else if (parsed.version === 2) {
      if (!validShape(parsed, WORLD) || !Number.isSafeInteger(parsed.gen) || (parsed.gen as number) < 1) return null;
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
    return data;
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

function readRaw(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

/**
 * Writes v2 to its own key. Never touches the v1 key. A stored save from a newer build
 * (version above 2) is never overwritten, and a higher stored `gen` is never lowered.
 */
export function storeSave(storage: Storage | null, data: SaveData): boolean {
  if (!storage) return false;
  try {
    const existing = parseExisting(readRaw(storage, SAVE_KEY));
    if (existing && typeof existing.version === 'number' && existing.version > 2) return false;
    const gen = existing && existing.version === 2 && Number.isSafeInteger(existing.gen)
      ? Math.max(data.gen, existing.gen as number) : data.gen;
    storage.setItem(SAVE_KEY, JSON.stringify({ ...data, gen }));
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

/** Keeps the unreadable v2 payload once, before v1 replaces it; an existing copy is never overwritten. */
function backupBad(storage: Storage, raw: string): void {
  try {
    if (storage.getItem(BAD_V2_KEY) === null) storage.setItem(BAD_V2_KEY, raw);
  } catch { /* full or blocked storage: harmless */ }
}

/**
 * Reads v2 first. If there is no valid v2, falls back to migrating the v1 save: the raw v1
 * payload is backed up (first time only), the v1 key stays byte-identical, and the migrated
 * save is written to the v2 key so the next launch does not migrate again.
 */
export function readSave(storage: Storage | null): SaveData | null {
  if (!storage) return null;
  try {
    const currentRaw = readRaw(storage, SAVE_KEY);
    const current = parseSave(currentRaw);
    if (current) return current;
    const legacyRaw = readRaw(storage, LEGACY_SAVE_KEY);
    const migrated = parseSave(legacyRaw);
    if (!migrated || legacyRaw === null) return null;
    if (currentRaw !== null) backupBad(storage, currentRaw);
    backupLegacy(storage, legacyRaw);
    storeSave(storage, migrated);
    return migrated;
  } catch {
    return null;
  }
}

/** Returns a disposer for the timer and visibility listener. */
export function startAutosave(
  game: Game, seed: number, storage: Storage | null, flags: SaveFlags = { ledToVillage: false },
): () => void {
  // `flags` is read live, so flipping ledToVillage later also triggers a save.
  const snapshot = (): string => JSON.stringify([game.inventory.toJSON(), game.inventory.order(), flags]);
  let savedInventory = snapshot();
  const save = (force: boolean): void => {
    const inventory = snapshot();
    if (!force && !game.world.isDirty() && inventory === savedInventory) return;
    if (storeSave(storage, serialise(game, seed, flags))) {
      game.world.markClean();
      savedInventory = inventory;
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
