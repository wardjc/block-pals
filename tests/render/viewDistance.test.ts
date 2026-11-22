import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import {
  DEFAULT_TUNING, SETTING_VIEW, VIEW_MAX, VIEW_MIN, VIEW_START, VIEW_STEP, ViewDistance, viewFog, type FrameContext,
} from '../../src/render/viewDistance';

/** A fake clock and a controller driven by fake frame times (no real timers). */
function rig(start?: number) {
  let t = 0;
  const vd = new ViewDistance(() => t, DEFAULT_TUNING, start);
  const run = (frameMs: number, seconds: number, ctx: FrameContext = {}, onFrame?: () => void): void => {
    const end = t + seconds * 1000;
    while (t < end) {
      t += frameMs;
      vd.frame(frameMs, ctx);
      onFrame?.();
    }
  };
  return { vd, run, now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('the view distance controller', () => {
  it('starts at 40 and never goes below it; frames of 45 ms for a minute hold at 40', () => {
    const { vd, run } = rig();
    expect(VIEW_START).toBe(40);
    expect(vd.distance).toBe(40);
    run(45, 60, {}, () => expect(vd.distance).toBe(40));
  });

  it('grows 8 at a time after 5 s of 20 ms frames: 40, 48 ... 96 by t = 40 s (one step per 5 s), then stays at 96', () => {
    const { vd, run, now } = rig();
    const steps: Array<{ d: number; t: number }> = [];
    let last = vd.distance;
    run(20, 120, {}, () => {
      if (vd.distance !== last) { steps.push({ d: vd.distance, t: now() }); last = vd.distance; }
    });
    expect(steps.map(s => s.d)).toEqual([48, 56, 64, 72, 80, 88, 96]);
    expect(steps.at(-1)!.t).toBeLessThanOrEqual(40_000);
    for (let i = 1; i < steps.length; i++) expect(steps[i].t - steps[i - 1].t).toBeGreaterThanOrEqual(5000);
    expect(steps[0].t).toBeGreaterThanOrEqual(5000);
    expect(vd.distance).toBe(96);
  });

  it('never above 96 or below 40, always on the 8-block grid, over a seeded random walk of 10,000 frame times', () => {
    const { vd, advance } = rig();
    const random = mulberry32(42);
    let ms = 25;
    for (let i = 0; i < 10_000; i++) {
      ms = Math.max(5, Math.min(500, ms + (random() - 0.5) * 12 + (random() < 0.01 ? 300 : 0)));
      advance(ms);
      vd.frame(ms, { backlog: random() < 0.1 ? 3 : 0, drawCalls: 40 + random() * 80, sections: 20 + random() * 60 });
      expect(vd.distance).toBeGreaterThanOrEqual(VIEW_MIN);
      expect(vd.distance).toBeLessThanOrEqual(VIEW_MAX);
      expect((vd.distance - VIEW_MIN) % VIEW_STEP).toBe(0);
    }
  });

  it('a shrink fires after 1.5 s of 40 ms frames; no second shrink inside 2 s', () => {
    const { vd, run, now } = rig(80);
    const changes: number[] = [];
    let last = vd.distance;
    run(40, 3.4, {}, () => { if (vd.distance !== last) { changes.push(now()); last = vd.distance; } });
    expect(changes).toHaveLength(1);
    expect(vd.distance).toBe(72);
    // The EMA needs time to cross 34 from 30, then 1.5 s above it.
    expect(changes[0]).toBeGreaterThanOrEqual(1500);
    run(40, 10);
    // Further shrinks are at least 2 s (settle) + 1.5 s apart.
    expect(vd.distance).toBeLessThan(72);
  });

  it('frames between 26 and 34 ms change nothing for ten minutes', () => {
    const { vd, run } = rig(64);
    const random = mulberry32(3);
    for (let i = 0; i < 600; i++) run(27 + random() * 6, 1, {}, () => expect(vd.distance).toBe(64));
  });

  it('after a shrink from 72 it does not grow above 64 for 120 s on perfect frames, then tries 72 once', () => {
    const { vd, run, now } = rig(72);
    let shrunkAt = -1;
    run(40, 4, {}, () => { if (shrunkAt < 0 && vd.distance === 64) shrunkAt = now(); });
    expect(vd.distance).toBe(64);
    let grewAt = -1;
    run(16, 130, {}, () => {
      if (now() - shrunkAt < 120_000) expect(vd.distance).toBeLessThanOrEqual(64);
      if (grewAt < 0 && vd.distance === 72) grewAt = now();
    });
    expect(grewAt).toBeGreaterThan(0); // it tried 72 again once the 2 minutes were up
    expect(grewAt - shrunkAt).toBeGreaterThanOrEqual(120_000);
  });

  it('ping-pong: 24 ms frames at 64 and 40 ms at 72 settle at 64 and try 72 at most once per 120 s over an hour', () => {
    const { vd, advance, now } = rig(64);
    let grows = 0;
    let at64 = 0;
    let frames = 0;
    let last = vd.distance;
    let lastGrowAt = -Infinity;
    while (now() < 3_600_000) {
      const ms = vd.distance >= 72 ? 40 : 24;
      advance(ms);
      vd.frame(ms);
      frames++;
      if (vd.distance === 64) at64++;
      if (vd.distance > last) {
        grows++;
        expect(now() - lastGrowAt).toBeGreaterThanOrEqual(120_000);
        lastGrowAt = now();
      }
      last = vd.distance;
      expect(vd.distance).toBeGreaterThanOrEqual(64);
      expect(vd.distance).toBeLessThanOrEqual(72);
    }
    expect(grows).toBeLessThanOrEqual(31);
    expect(at64 / frames).toBeGreaterThan(0.95);
  });

  it('one 400 ms stall frame, or three in a row, changes nothing and starts a 2 s settle', () => {
    for (const n of [1, 3]) {
      const { vd, run, advance, now } = rig(64);
      run(30, 2);
      for (let i = 0; i < n; i++) { advance(400); vd.frame(400); }
      expect(vd.distance).toBe(64);
      // During the 2 s settle even very slow frames decide nothing.
      const settleStart = now();
      run(59, 1.9);
      expect(vd.distance).toBe(64);
      expect(now() - settleStart).toBeLessThan(2000);
    }
  });

  it('one 60 ms spike between good frames does not shrink; a 5 s run of 60 ms frames does', () => {
    const { vd, run, advance } = rig(64);
    for (let i = 0; i < 20; i++) {
      run(30, 1);
      advance(60); vd.frame(60);
    }
    expect(vd.distance).toBe(64);
    run(60, 5);
    expect(vd.distance).toBeLessThan(64);
  });

  it('growth is blocked while backlog > 0, drawCalls > 100 or sections > 64; a shrink fires on sections > 70 for 1.5 s even with fast frames', () => {
    for (const ctx of [{ backlog: 1 }, { drawCalls: 101 }, { sections: 65 }]) {
      const { vd, run } = rig();
      run(16, 30, ctx);
      expect(vd.distance, JSON.stringify(ctx)).toBe(40);
    }
    const { vd, run } = rig(64);
    run(16, 1.4, { sections: 71 });
    expect(vd.distance).toBe(64);
    run(16, 0.2, { sections: 71 });
    expect(vd.distance).toBe(56);
    const b = rig(64);
    b.run(16, 1.6, { drawCalls: 111 });
    expect(b.vd.distance).toBe(56);
  });

  it('pause(3) ignores samples for 3 s', () => {
    const { vd, run } = rig(64);
    vd.pause(3);
    run(59, 2.9);
    expect(vd.distance).toBe(64);
    expect(vd.emaMs).toBe(30);
    run(59, 3);
    expect(vd.distance).toBe(56);
  });

  it("setSetting pins 96, 40 and 64 at once and frames do not move a pinned value; 'auto' resumes from the current value with a fresh average", () => {
    const { vd, run } = rig();
    vd.setSetting('far');
    expect(vd.distance).toBe(96);
    expect(vd.pinned).toBe(true);
    run(59, 20);
    expect(vd.distance).toBe(96);
    vd.setSetting('near');
    expect(vd.distance).toBe(SETTING_VIEW.near);
    run(10, 60);
    expect(vd.distance).toBe(40);
    vd.setSetting('medium');
    expect(vd.distance).toBe(64);
    expect(vd.emaMs).toBeLessThan(15); // it kept watching the 10 ms frames while pinned
    vd.setSetting('auto');
    expect(vd.pinned).toBe(false);
    expect(vd.distance).toBe(64);
    expect(vd.emaMs).toBe(30);
    run(16, 10);
    expect(vd.distance).toBe(72);
  });

  it('in auto the distance is always 40, 48 ... 96', () => {
    const { vd, advance } = rig();
    const random = mulberry32(8);
    const seen = new Set<number>();
    for (let i = 0; i < 50_000; i++) {
      const ms = random() < 0.5 ? 14 : 45;
      for (let k = 0; k < 40; k++) { advance(ms); vd.frame(ms); }
      seen.add(vd.distance);
    }
    for (const d of seen) expect([40, 48, 56, 64, 72, 80, 88, 96]).toContain(d);
  });

  it('viewFog(40) is { near: 20, far: 40 } and viewFog(96) is { near: 48, far: 96 }', () => {
    expect(viewFog(40)).toEqual({ near: 20, far: 40 });
    expect(viewFog(96)).toEqual({ near: 48, far: 96 });
    expect(viewFog(64)).toEqual({ near: 32, far: 64 });
    expect(viewFog(NaN)).toEqual({ near: 20, far: 40 });
  });
});
