import type { Game } from '../game/game';
import { BLOCKS, BlockId } from './blocks';
import { Inventory, MAX_STACK } from './inventory';
import { isStandable } from './pathfind';
import type { World } from './world';
import { generateWorld } from './worldgen';

export const SAVE_KEY = 'blockpals.save.v1';

export interface SaveData {
  version: 1;
  seed: number;
  edits: Array<[number, number, number, number]>;
  inventory: Record<number, number>;
  player: { x: number; y: number; z: number };
}

export function serialise(game: Game, seed: number): SaveData {
  return {
    version: 1,
    seed,
    edits: game.world.edits(),
    inventory: game.inventory.toJSON(),
    player: { ...game.player.pos },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBlockId(value: unknown): value is BlockId {
  return typeof value === 'number' && Number.isInteger(value) && Object.hasOwn(BLOCKS, value);
}

function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value) || value.version !== 1 || !Number.isSafeInteger(value.seed)
    || !Array.isArray(value.edits) || !isRecord(value.player)) return false;

  if (!value.edits.every(edit => Array.isArray(edit) && edit.length === 4
    && [48, 16, 48].every((size, axis) => Number.isInteger(edit[axis]) && edit[axis] >= 0 && edit[axis] < size)
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

/** A bad inventory does NOT make the save corrupt: keep the builds, use an empty bag. */
export function parseSave(raw: string | null): SaveData | null {
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!isSaveData(data)) return null;
    if (!validInventory(data.inventory)) data.inventory = {};
    return data;
  } catch {
    return null;
  }
}

export function applySave(data: SaveData): {
  world: World;
  inventory: Inventory;
  spawn: { x: number; y: number; z: number };
} {
  const { world, spawn } = generateWorld(data.seed);
  for (const [x, y, z, id] of data.edits) world.set(x, y, z, id);
  // Replayed edits must remain in every later save, even while the world is clean.
  world.markClean();
  const { x, y, z } = data.player;
  return {
    world,
    inventory: Inventory.fromJSON(data.inventory),
    spawn: isStandable(world, [Math.floor(x), Math.floor(y), Math.floor(z)])
      ? { ...data.player } : spawn,
  };
}

export function storeSave(storage: Storage | null, data: SaveData): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(storage: Storage | null): SaveData | null {
  try {
    return parseSave(storage?.getItem(SAVE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Returns a disposer for the timer and visibility listener. */
export function startAutosave(game: Game, seed: number, storage: Storage | null): () => void {
  let savedInventory = JSON.stringify(game.inventory.toJSON());
  const save = (force: boolean): void => {
    const inventory = JSON.stringify(game.inventory.toJSON());
    if (!force && !game.world.isDirty() && inventory === savedInventory) return;
    if (storeSave(storage, serialise(game, seed))) {
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
