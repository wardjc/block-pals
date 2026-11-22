import type { CropRec, TreeRec } from '../game/farm';
import type { Game } from '../game/game';
import type { WizardState } from '../game/wizardTrade';
import { BLOCKS, BlockId, isCarriable } from './blocks';
import { LEGACY_WORLD, ORIGIN, V2_WORLD, WORLD } from './bounds';
import { GrowthClock, STAGE_MS, TREE_STAGE_MS } from './growth';
import { Inventory, MAX_STACK } from './inventory';
import { isItemId } from './items';
import { isStandable, settleCell, type Cell } from './pathfind';
import type { TowerInfo } from './tower';
import type { Rect, VillageLayout } from './village';
import type { World } from './world';
import type { CaveLayout } from './caves';
import { GEN_VERSION, generateWorld, type GeneratedWorld } from './worldgen';

/**
 * Version 3 (the bigger, deeper world) lives under its OWN key. The v1 and v2 keys are never
 * written, changed or deleted by this build (only the grown-ups' reset removes them), so rolling
 * the app back to an older build still finds his untouched save and nothing is lost. An older
 * build treats an unknown version as corrupt and would overwrite it, which is why v3 must not
 * share the v2 key.
 */
export const SAVE_KEY = 'blockpals.save.v3';
/** Step 1 and 2 saves: read only, never written. */
export const V2_SAVE_KEY = 'blockpals.save.v2';
/** v1 saves: read only, never written. */
export const LEGACY_SAVE_KEY = 'blockpals.save.v1';
/** Raw copy of the v2 payload, written once when it is first migrated, never overwritten. */
export const BACKUP_V2_KEY = 'blockpals.save.v2.backup';
/** Raw copy of the v1 payload, written once when it is first migrated, never overwritten. */
export const BACKUP_KEY = 'blockpals.save.v1.backup';
/** Raw copy of a damaged v3 payload, kept before anything replaces it; never overwritten (spares: .2 to .4). */
export const BAD_V3_KEY = 'blockpals.save.v3.bad';
/** The step 2 build kept damaged v2 payloads here. This build never writes them; the reset clears them. */
export const BAD_V2_KEY = 'blockpals.save.v2.bad';
const spares = (key: string): string[] => [key, `${key}.2`, `${key}.3`, `${key}.4`];
/** Every key a reset has to clear. */
export const ALL_SAVE_KEYS: readonly string[] = [
  SAVE_KEY, V2_SAVE_KEY, LEGACY_SAVE_KEY, BACKUP_V2_KEY, BACKUP_KEY, ...spares(BAD_V3_KEY), ...spares(BAD_V2_KEY),
];

/** Where meadow cell (0, 0, 0) sits in a v3 world. Written always; a v3 save is never shifted again. */
const SAVE_ORIGIN: [number, number, number] = [ORIGIN.x, ORIGIN.y, ORIGIN.z];

/** Hint names the farm and the caves (digDown, gemFound) may save; anything else in a save is ignored. */
export const HINT_NAMES: readonly string[] = ['plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch', 'digDown', 'gemFound'];
/** More crop or tree records than this in a save are ignored (the plants still exist as blocks). */
export const MAX_FARM_RECORDS = 2000;

/** Hint names the wizard step may save (Pip's tower light line, the tower hint); anything else is ignored. */
export const WIZARD_HINT_NAMES: readonly string[] = ['seeLight', 'towerHint'];
/** Wizard counters are whole numbers from 0 to this (clamped). */
export const WIZARD_COUNT_MAX = 100_000;

/** What a save may hold about the wizard. Every field is optional: a missing or bad one means its default. */
export interface SavedWizard {
  gift?: boolean; met?: boolean; led?: boolean; solved?: number; clean?: number; bought?: number; hints?: string[];
}

export interface SaveFlags {
  ledToVillage: boolean; fernSeeds?: boolean; hints?: string[];
  /** He has been underground (7h). */
  cavesSeen?: boolean;
  /** He has found the old hideout (7h). */
  ruinFound?: boolean;
}

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

/** The step 1 and step 2 save (meadow coordinates in the 96 x 20 x 96 world). Read only. */
export interface SaveDataV2 {
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
  /** The wizard's gift, visit, lead, puzzle counters and hints. Optional and additive: absent until anything differs from the defaults. */
  wizard?: SavedWizard;
}

/**
 * Version 3: the bigger, deeper world (192 x 68 x 192). Every coordinate is a WORLD coordinate; the
 * old meadow sits at `origin`. The fields are the v2 fields plus origin and migratedFrom.
 */
export interface SaveData extends Omit<SaveDataV2, 'version'> {
  version: 3;
  /** Where meadow cell (0, 0, 0) sits: always [48, 48, 48] (informational: a v3 save is never shifted). */
  origin: [number, number, number];
  /** Set when this save was made by migrating an older one. */
  migratedFrom?: 1 | 2;
}

export function serialise(
  game: Game, seed: number, flags: SaveFlags = { ledToVillage: false }, now: number = Date.now(), animals?: SavedAnimalTuple[],
  wizard?: WizardState,
): SaveData {
  // Records first: this brings any pending plant growth into the world before the edits are read.
  const farm = game.farm.records();
  const items = game.inventory.itemsToJSON();
  const itemOrder = game.inventory.itemOrder();
  const data: SaveData = {
    version: 3,
    gen: GEN_VERSION,
    origin: [...SAVE_ORIGIN],
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
  if (flags.cavesSeen === true) data.flags.cavesSeen = true;
  if (flags.ruinFound === true) data.flags.ruinFound = true;
  // Only written when there is something, so a block-only bag with no plants saves what step 1 saved (plus savedAt).
  if (itemOrder.length > 0) {
    data.items = items;
    data.itemOrder = itemOrder;
  }
  if (farm.crops.length > 0) data.crops = farm.crops.map(c => [c.x, c.y, c.z, c.p]);
  if (farm.trees.length > 0) data.trees = farm.trees.map(t => [t.x, t.y, t.z, t.stage, t.p]);
  if (animals && animals.length > 0) data.animals = animals.map(a => [...a] as SavedAnimalTuple);
  if (wizard) {
    const w = wizardState(cleanWizard(wizard));
    if (!sameWizard(w, defaultWizard())) data.wizard = toSaved(w);
  }
  return data;
}

/** Carries everything over untouched: same seed, edits (the v1 world is the corner of the v2 one), bag. */
export function migrateV1(v1: SaveDataV1): SaveDataV2 {
  const data: SaveDataV2 = {
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

/**
 * The one shift of an old save into the big world: +ORIGIN (48) on every coordinate, once. Pure
 * (never mutates its input, shares no arrays with it). Shifts edits, the player, crops and trees
 * (indices 0..2) and animals (indices 1..3, fractions kept); copies everything else unchanged.
 */
export function shiftV2(v2: SaveDataV2): SaveData {
  const [ox, oy, oz] = SAVE_ORIGIN;
  const data: SaveData = {
    version: 3,
    gen: v2.gen,
    origin: [...SAVE_ORIGIN],
    migratedFrom: 2,
    seed: v2.seed,
    edits: v2.edits.map(([x, y, z, id]) => [x + ox, y + oy, z + oz, id] as [number, number, number, number]),
    inventory: { ...v2.inventory },
    player: { x: v2.player.x + ox, y: v2.player.y + oy, z: v2.player.z + oz },
    flags: structuredClone(v2.flags),
  };
  if (v2.order !== undefined) data.order = [...v2.order];
  if (v2.items !== undefined) data.items = { ...v2.items };
  if (v2.itemOrder !== undefined) data.itemOrder = [...v2.itemOrder];
  if (v2.savedAt !== undefined) data.savedAt = v2.savedAt;
  if (v2.crops !== undefined) data.crops = v2.crops.map(([x, y, z, p]) => [x + ox, y + oy, z + oz, p] as [number, number, number, number]);
  if (v2.trees !== undefined) {
    data.trees = v2.trees.map(([x, y, z, stage, p]) => [x + ox, y + oy, z + oz, stage, p] as [number, number, number, number, number]);
  }
  if (v2.animals !== undefined) {
    data.animals = v2.animals.map(([k, x, y, z, gift, v]) => [k, x + ox, y + oy, z + oz, gift, v] as SavedAnimalTuple);
  }
  // The wizard's gift, visit, lead, puzzle counters and hints: no coordinates, copied as they are.
  if (v2.wizard !== undefined) data.wizard = structuredClone(v2.wizard);
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
function cleanItems(items: unknown, itemOrder: unknown): Pick<SaveDataV2, 'items' | 'itemOrder'> {
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
type Box = { readonly x: number; readonly y: number; readonly z: number };

function cleanFarm(parsed: Record<string, unknown>, box: Box): Pick<SaveDataV2, 'crops' | 'trees' | 'animals' | 'savedAt'> {
  const out: Pick<SaveDataV2, 'crops' | 'trees' | 'animals' | 'savedAt'> = {};
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
    if (e.length !== 4 || !inBox(e, box) || !isFinite_(e[3])) return null;
    const key = `c${e[0]},${e[1]},${e[2]}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return [e[0], e[1], e[2], Math.min(Math.max(0, e[3]), STAGE_MS - 1)] as [number, number, number, number];
  });
  if (crops.length > 0) out.crops = crops;
  const trees = first(parsed.trees, e => {
    if (e.length !== 5 || !inBox(e, box) || !isInt(e[3]) || e[3] < 0 || e[3] > 3 || !isFinite_(e[4])) return null;
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
    if (n[1] < 0 || n[1] >= box.x || n[2] < 0 || n[2] >= box.y || n[3] < 0 || n[3] >= box.z) return null;
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
  if (flags.cavesSeen === true) out.cavesSeen = true;
  if (flags.ruinFound === true) out.ruinFound = true;
  if (Array.isArray(flags.hints)) {
    const hints = flags.hints.filter((h, i, all): h is string => typeof h === 'string' && HINT_NAMES.includes(h) && all.indexOf(h) === i);
    if (hints.length > 0) out.hints = hints;
  }
  return out;
}

const defaultWizard = (): WizardState => ({ gift: false, met: false, led: false, solved: 0, clean: 0, bought: 0, hints: [] });

/**
 * Cleans the wizard object field by field: a field of the wrong type is dropped on its own (it
 * means its default), counts are clamped to 0..WIZARD_COUNT_MAX, `clean` never exceeds a valid
 * `solved`, and only known hint names are kept (once each). Anything that is not an object is
 * dropped whole. Nothing here can ever reject the save.
 */
function cleanWizard(value: unknown): SavedWizard | undefined {
  if (!isRecord(value)) return undefined;
  const out: SavedWizard = {};
  for (const key of ['gift', 'met', 'led'] as const) if (typeof value[key] === 'boolean') out[key] = value[key];
  const count = (v: unknown): number | undefined => (isInt(v) ? Math.min(WIZARD_COUNT_MAX, Math.max(0, v)) : undefined);
  for (const key of ['solved', 'clean', 'bought'] as const) {
    const n = count(value[key]);
    if (n !== undefined) out[key] = n;
  }
  if (out.clean !== undefined && out.solved !== undefined) out.clean = Math.min(out.clean, out.solved);
  if (Array.isArray(value.hints)) {
    const hints = value.hints.filter((h, i, all): h is string => typeof h === 'string' && WIZARD_HINT_NAMES.includes(h) && all.indexOf(h) === i);
    if (hints.length > 0) out.hints = hints;
  }
  return out;
}

/** The full state from a cleaned (partial) saved object. A dropped `solved` is never less than the clean solves kept. */
function wizardState(saved: SavedWizard | undefined): WizardState {
  const w = defaultWizard();
  if (!saved) return w;
  w.gift = saved.gift ?? false;
  w.met = saved.met ?? false;
  w.led = saved.led ?? false;
  w.clean = saved.clean ?? 0;
  w.solved = Math.max(saved.solved ?? 0, w.clean);
  w.bought = saved.bought ?? 0;
  w.hints = [...(saved.hints ?? [])];
  return w;
}

const sameWizard = (a: WizardState, b: WizardState): boolean => JSON.stringify(toSaved(a)) === JSON.stringify(toSaved(b));

function toSaved(w: WizardState): SavedWizard {
  const out: SavedWizard = { gift: w.gift, met: w.met, led: w.led, solved: w.solved, clean: w.clean, bought: w.bought };
  if (w.hints.length > 0) out.hints = [...w.hints];
  return out;
}

/**
 * What a write keeps when a save is already stored: a true flag stays true, a counter never goes
 * down (so the puzzle level never drops, even from a stale tab) and stored hints are kept.
 */
/**
 * The flags never go down: a true flag stays true and a hint once told stays told, whatever an
 * older page or a later write holds (the same rule as the wizard's fields). Optional fields only
 * appear when true or non-empty.
 */
function mergeFlags(next: SaveFlags, prev: SaveFlags): SaveFlags {
  const out: SaveFlags = { ledToVillage: next.ledToVillage || prev.ledToVillage };
  if (next.fernSeeds || prev.fernSeeds) out.fernSeeds = true;
  const hints = [...(next.hints ?? []), ...(prev.hints ?? []).filter(h => !(next.hints ?? []).includes(h))];
  if (hints.length > 0) out.hints = hints;
  if (next.cavesSeen || prev.cavesSeen) out.cavesSeen = true;
  if (next.ruinFound || prev.ruinFound) out.ruinFound = true;
  return out;
}

function mergeWizard(next: WizardState, prev: WizardState): WizardState {
  return {
    gift: next.gift || prev.gift,
    met: next.met || prev.met,
    led: next.led || prev.led,
    solved: Math.max(next.solved, prev.solved),
    clean: Math.max(next.clean, prev.clean),
    bought: Math.max(next.bought, prev.bought),
    hints: [...next.hints, ...prev.hints.filter(h => !next.hints.includes(h))],
  };
}

function validInventory(inv: unknown): boolean {
  return isRecord(inv) && Object.entries(inv).every(([key, count]) => {
    const id = Number(key);
    return String(id) === key && isCarriable(id)
      && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= MAX_STACK;
  });
}

/**
 * Accepts v1 and v2 (validated in their own box, then migrated and shifted into the big world) and
 * v3; always returns v3. Anything else (corrupt, older than 1, newer than 3) is null, so the game
 * starts fresh instead of crashing. A bad inventory does NOT make the save corrupt: keep the
 * builds, use an empty bag.
 */
export function parseSave(raw: string | null): SaveData | null {
  return inspectSave(raw)?.data ?? null;
}

/** The box a save's own coordinates must lie in, by version. */
const BOX_OF: Record<1 | 2 | 3, Box> = { 1: LEGACY_WORLD, 2: V2_WORLD, 3: WORLD };

/**
 * Like parseSave, and also says how many individual edits were skipped as invalid (out of range or
 * an unknown block) and which version the payload was. Every entry is checked against the box of
 * the save's OWN version first (v1 48/16/48, v2 96/20/96, v3 192/68/192), bad entries are skipped one
 * by one, and only then is an old save shifted (once, by shiftV2). Valid edits are always kept: one
 * bad entry never costs him the rest of his world. Structural problems (not JSON, wrong version,
 * bad seed, edits or player) still reject the whole save. `only` limits the versions accepted.
 */
export function inspectSave(
  raw: string | null, only: ReadonlyArray<1 | 2 | 3> = [1, 2, 3],
): { data: SaveData; skipped: number; from: 1 | 2 | 3 } | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const version = parsed.version;
    if (version !== 1 && version !== 2 && version !== 3) return null;
    if (!only.includes(version)) return null;
    if (!validShape(parsed)) return null;
    if (version !== 1 && (!Number.isSafeInteger(parsed.gen) || (parsed.gen as number) < 1)) return null;
    const box = BOX_OF[version];
    const edits = parsed.edits as unknown[];
    const kept = edits.filter((e): e is [number, number, number, number] => validEdit(e, box))
      .map(e => [e[0], e[1], e[2], e[3]] as [number, number, number, number]);
    const skipped = edits.length - kept.length;
    const player = parsed.player as { x: number; y: number; z: number };

    // Everything below is checked in the save's own box, field by field.
    const own: SaveDataV2 = {
      version: 2,
      gen: version === 1 ? 1 : parsed.gen as number,
      seed: parsed.seed as number,
      edits: kept,
      inventory: validInventory(parsed.inventory) ? { ...(parsed.inventory as Record<number, number>) } : {},
      player: { x: player.x, y: player.y, z: player.z },
      flags: version === 1 ? { ledToVillage: false } : cleanFlags(isRecord(parsed.flags) ? parsed.flags : {}),
    };
    if ('order' in parsed && Inventory.validOrder(parsed.order)) own.order = [...(parsed.order as number[])];
    Object.assign(own, cleanItems(parsed.items, parsed.itemOrder));
    if (version !== 1) Object.assign(own, cleanFarm(parsed, box));
    // The wizard's fields hold no coordinates: cleaned the same way for v2 and v3, never shifted.
    if (version !== 1) {
      const wizard = cleanWizard(parsed.wizard);
      if (wizard) own.wizard = wizard;
    }

    if (version !== 3) {
      const data = shiftV2(own);
      data.migratedFrom = version;
      return { data, skipped, from: version };
    }
    const origin = parsed.origin;
    if (!(Array.isArray(origin) && origin.length === 3 && origin.every((n, i) => n === SAVE_ORIGIN[i]))) {
      // Informational only: a v3 save is in world coordinates and is never shifted.
      console.warn('blockpals: a v3 save with an unexpected origin', origin, 'loads unshifted');
    }
    const { version: _v2, ...rest } = own;
    const data: SaveData = { version: 3, ...rest, origin: [...SAVE_ORIGIN] };
    if (parsed.migratedFrom === 1 || parsed.migratedFrom === 2) data.migratedFrom = parsed.migratedFrom;
    return { data, skipped, from: 3 };
  } catch {
    return null;
  }
}

export interface Applied {
  world: World;
  inventory: Inventory;
  spawn: { x: number; y: number; z: number };
  village: VillageLayout;
  tower: TowerInfo;
  towerRoute: Cell[];
  /** The tower's hilltop, world coordinates. */
  towerPad: Rect;
  /** The caves as generated (his edits replayed on top: an opened chest stays open). */
  caves: CaveLayout;
  flags: SaveFlags;
  items: Record<number, number>;
  /** Plant timers to hand to Farm.restore after the edits are in. */
  farm: { crops: CropRec[]; trees: TreeRec[] };
  animals: SavedAnimalTuple[];
  /** The wizard's state, defaults when the save has none (cleaned again here, so any object handed in is safe). */
  wizard: WizardState;
  /** Time to grow while the game was closed: never negative, never more than 8 hours. */
  offlineMs: number;
}

/**
 * `generated` is the freshly generated world for `data.seed` when the caller already made it (the
 * generation worker at boot); it must be untouched (no edits). Without it the world is generated here.
 */
export function applySave(data: SaveData, now: number = Date.now(), generated?: GeneratedWorld): Applied {
  // Stamps first, then his edits: whatever he built or dug always wins over generated houses and paths.
  const fresh = generated && generated.world.edits().length === 0 ? generated : generateWorld(data.seed);
  const { world, spawn, village, tower, towerRoute, towerPad, caves } = fresh;
  for (const [x, y, z, id] of data.edits) world.replayEdit(x, y, z, id);
  // Replayed edits must remain in every later save, even while the world is clean.
  world.markClean();
  const { x, y, z } = data.player;
  // Never put him back under a roof: a saved spot inside any house or the tower means spawn instead.
  const inHouse = [...village.houses.map(h => h.rect), tower.rect].some(r => x >= r.x0 && x < r.x1 + 1 && z >= r.z0 && z < r.z1 + 1);
  // Every body is checked against the REAL replayed world (review finding 5): the spawn, Orlo's
  // spot and each villager's spot are lifted out of any block he placed there (or off a dug-out
  // void). His edits still win; only where the body stands moves. Animals are checked by
  // Herd.restore, Pip by settleCell in main.ts.
  const settle = (c: Cell): Cell => settleCell(world, c);
  const at = (p: { x: number; y: number; z: number }): Cell => [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
  const lifted = (p: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
    const [cx, cy, cz] = settle(at(p));
    return { x: cx + (p.x - Math.floor(p.x)), y: cy, z: cz + (p.z - Math.floor(p.z)) };
  };
  const safeSpawn = lifted(spawn);
  const settledVillage: VillageLayout = { ...village, houses: village.houses.map(h => ({ ...h, npcSpot: settle(h.npcSpot) })) };
  const settledTower: TowerInfo = { ...tower, wizardSpot: settle(tower.wizardSpot) };
  return {
    world,
    inventory: Inventory.fromJSON(data.inventory, data.order, data.items, data.itemOrder),
    spawn: !inHouse && isStandable(world, at(data.player)) ? { ...data.player } : safeSpawn,
    village: settledVillage,
    tower: settledTower,
    towerRoute,
    towerPad,
    caves,
    flags: cleanFlags(data.flags as unknown as Record<string, unknown>),
    items: { ...(data.items ?? {}) },
    farm: {
      crops: (data.crops ?? []).map(([cx, cy, cz, p]) => ({ x: cx, y: cy, z: cz, p })),
      trees: (data.trees ?? []).map(([tx, ty, tz, stage, p]) => ({ x: tx, y: ty, z: tz, stage: stage as TreeRec['stage'], p })),
    },
    animals: (data.animals ?? []).map(a => [...a] as SavedAnimalTuple),
    wizard: wizardState(cleanWizard(data.wizard)),
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

/** True while a migrated save still has to reach the v3 key (a failed or refused write). */
export function hasPendingMigration(storage: Storage | null): boolean {
  return storage !== null && (sessions.get(storage)?.pendingMigration ?? false);
}

/** Keys that hold a copy of a damaged v3 payload: the first is the original, then three spares. */
const BAD_SLOTS = spares(BAD_V3_KEY);

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
 * Writes v3 to its own key. Never touches the v1 or v2 key. It refuses (returns false, writes
 * nothing) when: a save from a newer build (version above 3) is stored; the stored v3 cannot be
 * read; this page started without being able to read the storage and the storage now holds a save
 * (v3, v2 or v1); or the stored v3 is damaged (unreadable JSON, not a version 3 save, or skipped
 * edits) and a copy of it cannot first be kept under a `blockpals.save.v3.bad` key. A higher stored
 * `gen` is never lowered, and neither is anything the wizard fields record (a true flag, a
 * counter, a hint): see `mergeWizard`.
 */
// Review ruling #2: the read, merge ("never lower") and write below run in one synchronous task;
// in real browsers localStorage work in one task cannot interleave with another tab's, so no lock.
export function storeSave(storage: Storage | null, data: SaveData): boolean {
  if (!storage) return false;
  try {
    const session = sessionOf(storage);
    const existing = readKey(storage, SAVE_KEY);
    if (!existing.ok) return false;
    if (session.mode === 'conflict') return false;
    if (session.mode === 'unreadable') {
      // Started blind: only write if the storage is now readable AND truly empty.
      const v2 = readKey(storage, V2_SAVE_KEY);
      const v1 = readKey(storage, LEGACY_SAVE_KEY);
      if (!v2.ok || !v1.ok) return false;
      if (existing.raw !== null || v2.raw !== null || v1.raw !== null) { session.mode = 'conflict'; return false; }
      session.mode = 'ok';
    }
    let gen: number = data.gen;
    let wizard = data.wizard;
    let flags = data.flags;
    if (existing.raw !== null) {
      const stored = parseExisting(existing.raw);
      if (stored && typeof stored.version === 'number' && stored.version > 3) return false;
      const checked = inspectSave(existing.raw, [3]);
      if ((!checked || checked.skipped > 0) && !preserveBad(storage, existing.raw)) return false;
      if (stored && stored.version === 3 && Number.isSafeInteger(stored.gen)) gen = Math.max(gen, stored.gen as number);
      if (checked) flags = mergeFlags(cleanFlags(data.flags as unknown as Record<string, unknown>), checked.data.flags);
      if (checked?.data.wizard) {
        const merged = mergeWizard(wizardState(cleanWizard(data.wizard)), wizardState(checked.data.wizard));
        if (!sameWizard(merged, defaultWizard())) wizard = toSaved(merged);
      }
    }
    const out: SaveData = { ...data, gen, flags };
    if (wizard) out.wizard = wizard; else delete out.wizard;
    storage.setItem(SAVE_KEY, JSON.stringify(out));
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

/**
 * Copies a raw old payload once. An existing backup is never overwritten; failure is harmless.
 * The one documented exception to "the old keys are never written" (review ruling #4): the
 * additive `.v2.backup` / `.v1.backup` copies are created once during a migration. The v1 and v2
 * MAIN keys themselves are never written or removed.
 */
function backupOnce(storage: Storage, key: string, raw: string): void {
  try {
    if (storage.getItem(key) === null) storage.setItem(key, raw);
  } catch { /* full or blocked storage: the old key itself is untouched anyway */ }
}

/**
 * Reads v3 first (valid edits are kept even if some entries are damaged; a damaged v3 is copied to
 * a `.bad` key, and is only ever replaced once that copy exists). Only when the v3 key is ABSENT does
 * it migrate an older save: a present-but-unusable v3 means a fresh world in memory. With no v3, migrates the
 * v2 save: the raw v2 payload is backed up (first time only), checked in the 96 box, shifted by
 * +48 once, and written to the v3 key. With no usable v2 either, migrates v1 the same way (v1 backup
 * as before, then v1 to v2 to v3). The v1 and v2 keys stay byte-identical. If a key cannot be READ,
 * nothing is migrated or written: he plays from a fresh world in memory, nothing is lost.
 */
export function readSave(storage: Storage | null): SaveData | null {
  if (!storage) return null;
  try {
    const session = sessionOf(storage);
    session.mode = 'ok';
    const v3 = readKey(storage, SAVE_KEY);
    if (!v3.ok) { session.mode = 'unreadable'; return null; }
    const current = inspectSave(v3.raw, [3]);
    if (current) {
      if (current.skipped > 0) preserveBad(storage, v3.raw as string); // retried by storeSave if it fails now
      return current.data;
    }
    // Migration happens ONLY when the v3 key is ABSENT. A v3 that is present but unusable (damaged,
    // a newer version, an old payload under the new key) is never replaced by the older v2 or v1
    // game: a newer version is never touched at all; a damaged one is copied to a .bad slot (the
    // existing rule, so a later save may replace it only once that copy exists). He plays a fresh
    // world in memory and the old keys keep his older game untouched.
    if (v3.raw !== null) {
      const stored = parseExisting(v3.raw);
      if (!(stored && typeof stored.version === 'number' && stored.version > 3)) preserveBad(storage, v3.raw);
      return null;
    }
    for (const [key, backup] of [[V2_SAVE_KEY, BACKUP_V2_KEY], [LEGACY_SAVE_KEY, BACKUP_KEY]] as const) {
      const old = readKey(storage, key);
      if (!old.ok) { session.mode = 'unreadable'; return null; }
      if (old.raw === null) continue;
      backupOnce(storage, backup, old.raw);
      // The v2 key only ever held v1 or v2 payloads; the v1 key only v1.
      const migrated = inspectSave(old.raw, key === V2_SAVE_KEY ? [1, 2] : [1]);
      if (!migrated) continue; // a corrupt v2 falls back to v1, as the step 2 build did
      session.pendingMigration = true;
      storeSave(storage, migrated.data); // refused (and retried by the autosave) if a damaged v3 could not be kept
      return migrated.data;
    }
    return null;
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
  /** Read live like `flags`: a gift, a visit or a solve marks the save dirty. */
  wizard?: WizardState,
): () => void {
  // `flags` is read live, so flipping ledToVillage later also triggers a save.
  const snapshot = (): string => JSON.stringify([game.inventory.toJSON(), game.inventory.order(), game.inventory.itemsToJSON(), game.inventory.itemOrder(), flags, game.farm.revision, game.herdRevision, wizard ?? null]);
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
    if (storeSave(storage, serialise(game, seed, flags, Date.now(), animals?.(), wizard))) {
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
