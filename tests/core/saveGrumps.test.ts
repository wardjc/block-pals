// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ORIGIN } from '../../src/core/bounds';
import { plannedFarmZone, ZONE_Y } from '../../src/core/farmZone';
import { ItemId } from '../../src/core/items';
import {
  BACKUP_V2_KEY, HINT_NAMES, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, applySave, parseSave, readSave, serialise, storeSave, type SaveData,
} from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

const zone = plannedFarmZone();
const inZone = { x: zone.x0 + 4.5, z: zone.z0 + 4.5 };
const base = (): SaveData => ({
  version: 3, gen: 1, origin: [48, 48, 48], seed: 1234, edits: [], inventory: { [BlockId.Wood]: 4 }, player: { x: 24, y: 9, z: 24 },
  flags: { ledToVillage: false },
});
const raw = (extra: Record<string, unknown>): string => JSON.stringify({ ...base(), ...extra });
const g = (x: number, z: number, kind = 0, mood = 0) => [kind, Math.round(x * 10), ZONE_Y, Math.round(z * 10), mood];
const f = (x: number, z: number, kind = 0, variant = 0, jobIn = 100) => [kind, variant, Math.round(x * 10), ZONE_Y, Math.round(z * 10), jobIn];
let world: ReturnType<typeof generateWorld>;
beforeEach(() => { localStorage.clear(); world = generateWorld(1234); });

describe('grump save fields (additive, on the v3 key)', () => {
  test('keys: the v3 key is still the key; the older keys are never written', () => {
    expect(SAVE_KEY).toBe('blockpals.save.v3');
    const data = serialise(new Game(world), 1234);
    storeSave(localStorage, data);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(V2_SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(BACKUP_V2_KEY)).toBeNull();
  });

  test('a save without any grump field loads: no grumps, no friends, stats zero, spawner starts fresh', () => {
    const data = parseSave(raw({}))!;
    expect(data).not.toBeNull();
    for (const k of ['grumps', 'friends', 'grumpStats']) expect(k in data).toBe(false);
    const a = applySave(data);
    expect(a.grumps).toEqual({ grumps: [], friends: [], stats: [0, 0, 45, 0] });
  });

  test('a default grump state is not written at all', () => {
    const data = serialise(new Game(world), 1234);
    for (const k of ['grumps', 'friends', 'grumpStats']) expect(k in data).toBe(false);
  });

  test('new fields round-trip (grumps, friends, stats, hints, a weapon in items and not in inventory)', () => {
    const game = new Game(world);
    game.inventory.add(ItemId.MagicWand, 1);
    const grumps = {
      grumps: [g(inZone.x, inZone.z, 1, 1) as never],
      friends: [f(inZone.x + 2, inZone.z, 1, 3, 77) as never],
      stats: [7, 33, 118, 1] as [number, number, number, number],
    };
    const data = serialise(game, 1234, { ledToVillage: false, hints: ['grumpArrives', 'friendMade'] }, 5, undefined, undefined, grumps);
    expect(storeSave(localStorage, data)).toBe(true);
    const back = readSave(localStorage)!;
    expect(back.items).toEqual({ [ItemId.MagicWand]: 1 });
    expect(back.inventory[ItemId.MagicWand]).toBeUndefined();
    expect(back.flags.hints).toEqual(['grumpArrives', 'friendMade']);
    const applied = applySave(back);
    expect(applied.grumps).toEqual(grumps);
    expect(applied.inventory.count(ItemId.MagicWand)).toBe(1);
  });

  test('the five grump hint names are known and unknown hints are dropped', () => {
    for (const h of ['grumpArrives', 'plantsWaiting', 'craftWeapon', 'pickWeapon', 'friendMade']) expect(HINT_NAMES).toContain(h);
    const data = parseSave(raw({ flags: { ledToVillage: false, hints: ['grumpArrives', 'nonsense', 'grumpArrives'] } }))!;
    expect(data.flags.hints).toEqual(['grumpArrives']);
  });

  test('bad grump entries are dropped and the rest of the save survives', () => {
    const data = parseSave(raw({
      grumps: [g(inZone.x, inZone.z), 'x', [1, 2], [2, 1, 1, 1, 0], [0, NaN, 1, 1, 0], [0, 1, 1, 1, 7], g(inZone.x + 1, inZone.z, 0, 1)],
      friends: [f(inZone.x, inZone.z)], grumpStats: [3, 10, 100, 0],
    }))!;
    expect(data.grumps).toEqual([g(inZone.x, inZone.z), g(inZone.x + 1, inZone.z, 0, 1)]);
    expect(data.friends).toHaveLength(1);
    expect(data.inventory[BlockId.Wood]).toBe(4);
    expect(data.seed).toBe(1234);
  });

  test('grumps outside the zone are dropped', () => {
    const data = parseSave(raw({ grumps: [g(zone.x0 - 3, zone.z0), g(zone.x1 + 5, zone.z0), g(zone.x0, zone.z1 + 4), g(inZone.x, inZone.z)] }))!;
    expect(data.grumps).toEqual([g(inZone.x, inZone.z)]);
  });

  test('more than 3 grumps keeps 3, more than 5 friends keeps 5 in saved order', () => {
    const many = Array.from({ length: 8 }, (_, i) => g(inZone.x + i * 0.5, inZone.z));
    const fr = Array.from({ length: 8 }, (_, i) => f(inZone.x, inZone.z + i * 0.5, 0, i % 5, i));
    const data = parseSave(raw({ grumps: many, friends: fr }))!;
    expect(data.grumps).toEqual(many.slice(0, 3));
    expect(data.friends).toEqual(fr.slice(0, 5));
  });

  test('a friend with a bad position is re-placed in the zone, never dropped; kind and variant are clamped; jobIn is clamped', () => {
    const data = parseSave(raw({ friends: [[0, 1, 99999, ZONE_Y, -5, 100], [9, 99, NaN, 1, 1, 100], f(inZone.x, inZone.z, 1, 2, 9999), f(inZone.x, inZone.z, 0, -3, -4)] }))!;
    expect(data.friends).toHaveLength(4);
    for (const e of data.friends!) {
      expect([0, 1]).toContain(e[0]);
      expect(e[1]).toBeGreaterThanOrEqual(0); expect(e[1]).toBeLessThanOrEqual(4);
      expect(e[2] / 10).toBeGreaterThanOrEqual(zone.x0); expect(e[2] / 10).toBeLessThan(zone.x1 + 1);
      expect(e[4] / 10).toBeGreaterThanOrEqual(zone.z0); expect(e[4] / 10).toBeLessThan(zone.z1 + 1);
      expect(e[5]).toBeGreaterThanOrEqual(0); expect(e[5]).toBeLessThanOrEqual(240);
    }
    expect(data.friends![0][1]).toBe(1);
    expect(data.friends![2][5]).toBe(240);
  });

  test('grumpStats are clamped integers: cheered 0..1,000,000, timers 0..300, firstDone 0 or 1', () => {
    const d = parseSave(raw({ grumpStats: [5e9, 9999, 9999, 7] }))!;
    expect(d.grumpStats).toEqual([1_000_000, 300, 300, 1]);
    const e = parseSave(raw({ grumpStats: [-4, -1, 0.4, -2] }))!;
    expect(e.grumpStats![0]).toBe(0);
    expect(e.grumpStats![1]).toBe(0);
    expect(Number.isInteger(e.grumpStats![2])).toBe(true);
    expect(e.grumpStats![3]).toBe(0);
  });

  test('a wrong type for any new field drops that field only', () => {
    const d = parseSave(raw({ grumps: 'no', friends: { a: 1 }, grumpStats: [1, 2], flags: { ledToVillage: true, hints: 7 } }))!;
    for (const k of ['grumps', 'friends', 'grumpStats']) expect(k in d).toBe(false);
    expect(d.flags.ledToVillage).toBe(true);
    expect(d.inventory[BlockId.Wood]).toBe(4);
  });

  test('a v2 save that somehow carries grump fields ignores them; v1 and v2 saves still load', () => {
    const v2 = JSON.stringify({ version: 2, gen: 1, seed: 1, edits: [], inventory: {}, player: { x: 1, y: 6, z: 1 }, flags: { ledToVillage: false }, grumps: [g(1, 1)] });
    const d = parseSave(v2)!;
    expect(d.version).toBe(3);
    expect('grumps' in d).toBe(false);
    const v1 = JSON.stringify({ version: 1, seed: 1, edits: [], inventory: {}, player: { x: 1, y: 6, z: 1 } });
    expect(parseSave(v1)).not.toBeNull();
  });

  test('timers are not counted down offline: a savedAt in the future or far in the past leaves the spawn timer as saved', () => {
    for (const savedAt of [Date.now() + 1e9, 1000]) {
      const d = parseSave(raw({ savedAt, grumpStats: [2, 40, 100, 1] }))!;
      expect(applySave(d).grumps.stats).toEqual([2, 40, 100, 1]);
    }
  });

  test('a stored higher gen is never lowered and a newer version is never overwritten', () => {
    const future = JSON.stringify({ version: 4, whatever: true });
    localStorage.setItem(SAVE_KEY, future);
    const data = serialise(new Game(world), 1234);
    storeSave(localStorage, data);
    expect(localStorage.getItem(SAVE_KEY)).toBe(future);
    localStorage.clear();
    storeSave(localStorage, { ...serialise(new Game(world), 1234), gen: 99 });
    storeSave(localStorage, { ...serialise(new Game(world), 1234), gen: 1 });
    expect(readSave(localStorage)!.gen).toBe(99);
  });

  test('the origin constant used for the planned zone is the world origin', () => {
    expect(zone.x0).toBeGreaterThanOrEqual(ORIGIN.x);
  });
});
