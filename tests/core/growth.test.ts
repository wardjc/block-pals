import { describe, expect, it } from 'vitest';
import { advanceStage, APPLE_REGROW_MS, GrowthClock, OFFLINE_CAP_MS, STAGE_MS, TREE_STAGE_MS } from '../../src/core/growth';
import { mulberry32 } from '../../src/core/rng';

describe('GrowthClock', () => {
  it('normal step', () => {
    const c = new GrowthClock(1000);
    expect(c.step(1500)).toBe(500);
    expect(c.step(2500)).toBe(1000);
  });
  it('clock going backwards adds nothing and recovers', () => {
    const c = new GrowthClock(0);
    expect(c.step(100)).toBe(100);
    expect(c.step(50)).toBe(0);
    expect(c.step(80)).toBe(30);
  });
  it('a jump of a week is capped at 8 hours', () => {
    const c = new GrowthClock(0);
    expect(c.step(7 * 24 * 3600_000)).toBe(OFFLINE_CAP_MS);
    expect(c.step(7 * 24 * 3600_000 + 1000)).toBe(1000);
  });
  it('NaN and Infinity add nothing and do not poison the clock', () => {
    const c = new GrowthClock(100);
    expect(c.step(NaN)).toBe(0);
    expect(c.step(Infinity)).toBe(0);
    expect(c.step(-Infinity)).toBe(0);
    expect(c.step(300)).toBe(200);
    expect(new GrowthClock(NaN).step(500)).toBe(0);
  });
  it('never negative and never above the cap over 10,000 random steps', () => {
    const rand = mulberry32(7);
    const c = new GrowthClock(5000);
    for (let i = 0; i < 10_000; i++) {
      const now = rand() < 0.3 ? rand() * 1e6 : rand() * 1e12;
      const add = c.step(now);
      expect(add).toBeGreaterThanOrEqual(0);
      expect(add).toBeLessThanOrEqual(OFFLINE_CAP_MS);
    }
  });
  it('constants match the plan', () => {
    expect(STAGE_MS).toBe(150_000);
    expect(TREE_STAGE_MS).toEqual([180_000, 240_000, 180_000]);
    expect(APPLE_REGROW_MS).toBe(180_000);
    expect(OFFLINE_CAP_MS).toBe(8 * 3600_000);
  });
});

describe('advanceStage', () => {
  it('adds up across stages', () => {
    const r = advanceStage(0, 0, 2.5 * STAGE_MS, STAGE_MS, 3);
    expect(r.stage).toBe(2);
    expect(r.progress).toBe(STAGE_MS / 2);
  });
  it('stops at ripe and keeps no leftover', () => {
    expect(advanceStage(0, 0, 100 * STAGE_MS, STAGE_MS, 3)).toEqual({ stage: 3, progress: 0 });
    expect(advanceStage(3, 0, 5, STAGE_MS, 3)).toEqual({ stage: 3, progress: 0 });
  });
  it('uses per-stage lengths for trees', () => {
    const r = advanceStage(0, 0, 180_000 + 240_000 + 10, TREE_STAGE_MS, 3);
    expect(r).toEqual({ stage: 2, progress: 10 });
  });
  it('bad amounts add nothing', () => {
    for (const bad of [-5, NaN, -Infinity]) expect(advanceStage(1, 7, bad, STAGE_MS, 3)).toEqual({ stage: 1, progress: 7 });
    expect(advanceStage(1, 7, Infinity, STAGE_MS, 3).stage).toBe(3);
  });
  it('stage never decreases (200 random sequences)', () => {
    const rand = mulberry32(11);
    for (let s = 0; s < 200; s++) {
      let stage = 0;
      let progress = 0;
      for (let i = 0; i < 40; i++) {
        const pick = rand();
        const add = pick < 0.2 ? 0 : pick < 0.3 ? 1e15 : pick < 0.35 ? -1000 : rand() * STAGE_MS;
        const r = advanceStage(stage, progress, add, STAGE_MS, 3);
        expect(r.stage).toBeGreaterThanOrEqual(stage);
        expect(r.progress).toBeGreaterThanOrEqual(0);
        if (r.stage === 3) expect(r.progress).toBe(0);
        stage = r.stage;
        progress = r.progress;
      }
    }
  });
});
