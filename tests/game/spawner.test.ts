import { describe, expect, test } from 'vitest';
import type { Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import {
  CAP_WITHOUT_WEAPON, CAP_WITH_WEAPON, FIRST_SPAWN_SECONDS, GrumpSpawner, NEAR_FARM, SPAWN_JITTER, SPAWN_MIN_PLAYER, SPAWN_SECONDS,
  type SpawnContext,
} from '../../src/game/grumps';

const BORDER: Cell[] = [[10, 54, 10], [12, 54, 10], [14, 54, 10], [30, 54, 30]];
const ctx = (over: Partial<SpawnContext> = {}): SpawnContext => ({
  dt: 1, nearFarm: true, plantedCrops: 1, count: 0, hasWeapon: false, overlayOpen: false, paused: false,
  player: { x: 50, y: 54, z: 50 }, borderCells: BORDER, occupied: [], ...over,
});
/** Seconds of near-farm time until the first spawn. */
const secondsToSpawn = (sp: GrumpSpawner, over: Partial<SpawnContext> = {}, limit = 1000): number => {
  for (let t = 1; t <= limit; t++) if (sp.update(ctx(over))) return t;
  return Infinity;
};
const constant = (v: number) => () => v;

describe('grump spawner', () => {
  test('constants', () => {
    expect([SPAWN_SECONDS, FIRST_SPAWN_SECONDS, SPAWN_JITTER, SPAWN_MIN_PLAYER, NEAR_FARM, CAP_WITH_WEAPON, CAP_WITHOUT_WEAPON])
      .toEqual([120, 45, 20, 8, 16, 3, 1]);
  });

  test('no spawn before 45 s near the farm the first time, then about 120 s', () => {
    const sp = new GrumpSpawner(constant(0.5));
    expect(secondsToSpawn(sp)).toBe(45);
    expect(secondsToSpawn(sp, { count: 0, hasWeapon: true })).toBe(120);
  });

  test('the interval after a spawn is 100 to 140 s at the rng extremes', () => {
    const lo = new GrumpSpawner(constant(0));
    secondsToSpawn(lo);
    expect(secondsToSpawn(lo)).toBe(100);
    const hi = new GrumpSpawner(constant(0.999999));
    secondsToSpawn(hi);
    expect(secondsToSpawn(hi)).toBe(140);
  });

  test('the timer does not advance when far from the farm, with no planted crops, or while at the cap', () => {
    for (const over of [{ nearFarm: false }, { plantedCrops: 0 }, { count: 1 }]) {
      const sp = new GrumpSpawner(constant(0.5));
      for (let i = 0; i < 500; i++) expect(sp.update(ctx(over))).toBeNull();
      expect(sp.state().timer).toBe(0);
    }
  });

  test('a cheered-up grump is never replaced at once (the timer waits at the cap)', () => {
    const sp = new GrumpSpawner(constant(0.5));
    for (let i = 0; i < 44; i++) sp.update(ctx());
    for (let i = 0; i < 100; i++) sp.update(ctx({ count: 1 }));
    expect(sp.state().timer).toBe(44);
    expect(sp.update(ctx())).not.toBeNull(); // one more second near the farm with room: now
  });

  test('the cap is 1 without a weapon and 3 with one', () => {
    const a = new GrumpSpawner(constant(0.5));
    expect(secondsToSpawn(a, { count: 1, hasWeapon: false }, 300)).toBe(Infinity);
    const b = new GrumpSpawner(constant(0.5));
    expect(secondsToSpawn(b, { count: 2, hasWeapon: true })).toBe(45);
    const c = new GrumpSpawner(constant(0.5));
    expect(secondsToSpawn(c, { count: 3, hasWeapon: true }, 300)).toBe(Infinity);
  });

  test('no spawn and no timer while an overlay is open or the game is paused', () => {
    for (const over of [{ overlayOpen: true }, { paused: true }]) {
      const sp = new GrumpSpawner(constant(0.5));
      for (let i = 0; i < 300; i++) expect(sp.update(ctx(over))).toBeNull();
      expect(sp.state().timer).toBe(0);
    }
  });

  test('dt of 0 (or bad) never changes anything', () => {
    const sp = new GrumpSpawner(constant(0.5));
    for (const dt of [0, -1, NaN]) {
      expect(sp.update(ctx({ dt }))).toBeNull();
      expect(sp.state()).toEqual({ timer: 0, interval: FIRST_SPAWN_SECONDS, first: true });
    }
  });

  test('a huge dt fires at most one spawn per call', () => {
    const sp = new GrumpSpawner(mulberry32(3));
    const first = sp.update(ctx({ dt: 100000 }));
    expect(first).not.toBeNull();
    expect(sp.update(ctx({ dt: 0.5 }))).toBeNull();
    expect(sp.state().timer).toBeLessThan(1);
  });

  test('never spawns within 8 blocks of the player, nor on an occupied cell', () => {
    const player = { x: 10.5, y: 54, z: 10.5 };
    for (let s = 0; s < 40; s++) {
      const sp = new GrumpSpawner(mulberry32(s));
      let got: ReturnType<GrumpSpawner['update']> = null;
      for (let t = 0; t < 60 && !got; t++) got = sp.update(ctx({ player, occupied: [[30, 54, 30]] }));
      expect(got).toBeNull(); // only far cell is occupied, the rest are within 8
    }
    for (let s = 0; s < 40; s++) {
      const sp = new GrumpSpawner(mulberry32(s));
      let got: ReturnType<GrumpSpawner['update']> = null;
      for (let t = 0; t < 60 && !got; t++) got = sp.update(ctx({ player }));
      expect(got!.cell).toEqual([30, 54, 30]);
    }
  });

  test('no candidate cell waits with the timer full, and spawns later when one appears', () => {
    const sp = new GrumpSpawner(constant(0.5));
    for (let i = 0; i < 200; i++) expect(sp.update(ctx({ borderCells: [] }))).toBeNull();
    expect(sp.state().timer).toBe(FIRST_SPAWN_SECONDS);
    expect(sp.update(ctx())).not.toBeNull();
  });

  test('the kind comes from the rng', () => {
    const kinds = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const sp = new GrumpSpawner(mulberry32(s));
      kinds.add(sp.update(ctx({ dt: 1000 }))!.kind);
    }
    expect([...kinds].sort()).toEqual(['cloud', 'jelly']);
  });

  test('state round-trips and the same seed and inputs give the same spawns', () => {
    const run = (): string => {
      const sp = new GrumpSpawner(mulberry32(11));
      const out: unknown[] = [];
      for (let t = 0; t < 2000; t++) { const r = sp.update(ctx({ hasWeapon: true, count: 0 })); if (r) out.push([t, r]); }
      return JSON.stringify(out);
    };
    expect(run()).toBe(run());
    const sp = new GrumpSpawner(mulberry32(1));
    for (let i = 0; i < 20; i++) sp.update(ctx());
    const saved = sp.state();
    expect(new GrumpSpawner(mulberry32(1), saved).state()).toEqual(saved);
  });

  test('two spawns are never less than 100 s of near-farm time apart', () => {
    const sp = new GrumpSpawner(mulberry32(8));
    let last = -Infinity, firstDone = false;
    for (let t = 0; t < 20000; t++) {
      if (sp.update(ctx({ dt: 1, count: 0, hasWeapon: true }))) {
        if (firstDone) expect(t - last).toBeGreaterThanOrEqual(100);
        firstDone = true;
        last = t;
      }
    }
  });
});
