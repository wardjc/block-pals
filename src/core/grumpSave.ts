import { FIRST_SPAWN_SECONDS } from '../game/grumps';
import type { Rect } from './houses';
import { ZONE_Y, plannedFarmZone } from './farmZone';
import { WORLD } from './bounds';

/** kind 0 jelly or 1 cloud, x, y, z (x and z in tenths of a block), mood 0 sulky or 1 unsure. */
export type SavedGrump = [number, number, number, number, number];
/** kind, colour variant 0..4, x, y, z (x and z in tenths), seconds to the next helpful job. */
export type SavedFriend = [number, number, number, number, number, number];
/** Cheered-up count, spawn timer s, spawn interval s, first grump met (0 or 1). */
export type SavedGrumpStats = [number, number, number, number];

export interface SavedGrumps {
  grumps: SavedGrump[];
  friends: SavedFriend[];
  stats: SavedGrumpStats;
}

export const MAX_SAVED_GRUMPS = 3;
export const MAX_SAVED_FRIENDS = 5;
export const MAX_CHEERED = 1_000_000;
export const MAX_TIMER = 300;
export const MAX_JOB = 240;

export const DEFAULT_STATS: SavedGrumpStats = [0, 0, FIRST_SPAWN_SECONDS, 0];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number =>
  isNum(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

const inZone = (zone: Rect, x10: number, z10: number): boolean =>
  x10 / 10 >= zone.x0 && x10 / 10 < zone.x1 + 1 && z10 / 10 >= zone.z0 && z10 / 10 < zone.z1 + 1;

/**
 * Cleans the grump fields of a save, field by field. A wrong type drops that field only; a bad
 * grump is dropped (the spawner brings new ones); a friend is never dropped for a bad position or
 * value, it is clamped and, if its place is bad, put in the middle of the farm zone (the game then
 * lifts it to the nearest free cell). Returns only the fields that are present and valid.
 */
export function cleanGrumpFields(parsed: Record<string, unknown>): { grumps?: SavedGrump[]; friends?: SavedFriend[]; grumpStats?: SavedGrumpStats } {
  const zone = plannedFarmZone();
  const out: { grumps?: SavedGrump[]; friends?: SavedFriend[]; grumpStats?: SavedGrumpStats } = {};
  if (Array.isArray(parsed.grumps)) {
    const kept: SavedGrump[] = [];
    for (const e of parsed.grumps) {
      if (kept.length >= MAX_SAVED_GRUMPS) break;
      if (!Array.isArray(e) || e.length !== 5 || !e.every(isNum)) continue;
      const [kind, x, y, z, mood] = e as number[];
      if ((kind !== 0 && kind !== 1) || (mood !== 0 && mood !== 1) || !Number.isInteger(y) || y < 0 || y >= WORLD.y) continue;
      if (!inZone(zone, x, z)) continue;
      kept.push([kind, Math.round(x), y, Math.round(z), mood]);
    }
    if (kept.length > 0) out.grumps = kept;
  }
  if (Array.isArray(parsed.friends)) {
    const kept: SavedFriend[] = [];
    const cx = Math.floor((zone.x0 + zone.x1 + 1) / 2) * 10 + 5, cz = Math.floor((zone.z0 + zone.z1 + 1) / 2) * 10 + 5;
    for (const e of parsed.friends) {
      if (kept.length >= MAX_SAVED_FRIENDS) break;
      if (!Array.isArray(e) || e.length !== 6) continue;
      const [kind, variant, x, y, z, job] = e as unknown[];
      const goodPlace = isNum(x) && isNum(y) && isNum(z) && Number.isInteger(y) && y >= 0 && y < WORLD.y && inZone(zone, x, z);
      kept.push([
        kind === 1 ? 1 : 0,
        clampInt(variant, 0, 4, 0),
        goodPlace ? Math.round(x as number) : cx,
        goodPlace ? (y as number) : ZONE_Y,
        goodPlace ? Math.round(z as number) : cz,
        clampInt(job, 0, MAX_JOB, MAX_JOB),
      ]);
    }
    if (kept.length > 0) out.friends = kept;
  }
  const s = parsed.grumpStats;
  if (Array.isArray(s) && s.length === 4 && s.every(isNum)) {
    out.grumpStats = [
      clampInt(s[0], 0, MAX_CHEERED, 0), clampInt(s[1], 0, MAX_TIMER, 0), clampInt(s[2], 1, MAX_TIMER, FIRST_SPAWN_SECONDS),
      s[3] >= 1 ? 1 : 0,
    ];
  }
  return out;
}

/** The save's grump state with every default filled in. */
export function grumpsOf(data: { grumps?: SavedGrump[]; friends?: SavedFriend[]; grumpStats?: SavedGrumpStats }): SavedGrumps {
  return {
    grumps: (data.grumps ?? []).map(e => [...e] as SavedGrump),
    friends: (data.friends ?? []).map(e => [...e] as SavedFriend),
    stats: [...(data.grumpStats ?? DEFAULT_STATS)] as SavedGrumpStats,
  };
}

export const isDefaultStats = (s: SavedGrumpStats): boolean => s.every((v, i) => v === DEFAULT_STATS[i]);
