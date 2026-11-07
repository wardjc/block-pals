import { describe, it, expect, vi, afterEach } from 'vitest';

/** A recording AudioContext stand-in: every call that shapes or ends a scrape is kept. */
interface GainEvent { type: 'set' | 'linear' | 'exp' | 'cancel'; v?: number; t: number }
class Node {
  disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
}
class FakeSource extends Node {
  buffer: unknown = null;
  startAt = 0;
  stops: number[] = [];
  ended?: () => void;
  constructor(private ctx: FakeCtx) { super(); }
  start(t: number) { this.startAt = t; }
  stop(t?: number) { this.stops.push(t ?? this.ctx.currentTime); }
  set onended(fn: () => void) { this.ended = fn; }
}
class FakeFilter extends Node {
  type = '';
  frequency = { value: 0 };
  Q = { value: 0 };
}
class FakeGain extends Node {
  events: GainEvent[] = [];
  gain = {
    value: 1,
    setValueAtTime: (v: number, t: number) => { this.events.push({ type: 'set', v, t }); },
    linearRampToValueAtTime: (v: number, t: number) => { this.events.push({ type: 'linear', v, t }); },
    exponentialRampToValueAtTime: (v: number, t: number) => { this.events.push({ type: 'exp', v, t }); },
    cancelScheduledValues: (t: number) => { this.events.push({ type: 'cancel', t }); },
  };
}
class FakeCtx {
  static last: FakeCtx;
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  sources: FakeSource[] = [];
  filters: FakeFilter[] = [];
  gains: FakeGain[] = []; // gains[0] is the master gain; scrape n owns gains[n + 1]
  constructor() { FakeCtx.last = this; }
  resume() { return Promise.resolve(); } // resume is delayed: it never lands by itself
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  createBiquadFilter() { const f = new FakeFilter(); this.filters.push(f); return f; }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createBufferSource() { const s = new FakeSource(this); this.sources.push(s); return s; }
  createOscillator() { return { type: '', frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
}

async function freshSfx() {
  vi.resetModules();
  vi.stubGlobal('AudioContext', FakeCtx);
  return (await import('../../src/audio/sfx')).sfx;
}
const allDisconnected = (c: FakeCtx, i: number) =>
  c.sources[i].disconnected && c.filters[i].disconnected && c.gains[i + 1].disconnected;

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('dig sound with an AudioContext', () => {
  it('digStop fades the current scrape to near zero over ~30 ms, then stops it within 40 ms', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    expect(c.sources).toHaveLength(1);
    c.currentTime = 0.05; // mid-scrape (it would otherwise run to 0.12)
    sfx.digStop();
    const fade = c.gains[1].events.filter(e => e.type === 'linear' && (e.v ?? 1) <= 0.001 && e.t >= 0.05);
    expect(fade).toHaveLength(1);
    expect(fade[0].t).toBeCloseTo(0.08, 3);
    const stop = c.sources[0].stops.at(-1)!;
    expect(stop).toBeGreaterThanOrEqual(fade[0].t);
    expect(stop - 0.05).toBeLessThanOrEqual(0.04 + 1e-9);
    // the automation was reset from "now" so the fade starts from the current level
    expect(c.gains[1].events.some(e => e.type === 'cancel' && e.t === 0.05)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(c.sources).toHaveLength(1); // the loop is dead
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never schedules while suspended; a delayed resume plays nothing after the holds ended', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.unlock();
    const c = FakeCtx.last;
    c.state = 'suspended';
    for (let i = 0; i < 3; i++) {
      sfx.digStart();
      vi.advanceTimersByTime(500);
      sfx.digStop();
    }
    expect(c.sources).toHaveLength(0);
    c.state = 'running'; // the late resume
    vi.advanceTimersByTime(1000);
    expect(c.sources).toHaveLength(0);
  });

  it('a scrape still pending when audio suspends has its 0.12 s deadline replaced by "now" on digStop', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    expect(c.sources[0].stops).toEqual([0.12]); // scrape()'s own natural stop
    c.state = 'suspended';
    c.currentTime = 0.01;
    sfx.digStop();
    expect(c.sources[0].stops).toHaveLength(2);
    expect(c.sources[0].stops[1]).toBeCloseTo(0.01, 6); // cancelled now, not left to sound on resume
    expect(allDisconnected(c, 0)).toBe(true);
  });

  it('releases source, filter and gain on natural completion', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    expect(allDisconnected(c, 0)).toBe(false);
    c.sources[0].ended?.();
    expect(c.sources[0].disconnected).toBe(true);
    expect(c.filters[0].disconnected).toBe(true);
    expect(c.gains[1].disconnected).toBe(true);
    expect(c.gains[0].disconnected).toBe(false); // never the master gain
    sfx.digStop();
  });

  it('releases source, filter and gain on cancellation (after the fade ends)', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    sfx.digStop();
    expect(allDisconnected(c, 0)).toBe(false); // still fading
    c.sources[0].ended?.();
    expect(c.sources[0].disconnected).toBe(true);
    expect(c.filters[0].disconnected).toBe(true);
    expect(c.gains[1].disconnected).toBe(true);
  });

  it('a new hold started during the old fade is untouched by the old scrape clean-up', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart(); // hold 1: scrape A
    const c = FakeCtx.last;
    c.currentTime = 0.05;
    sfx.digStop(); // A fades until 0.09
    c.currentTime = 0.06; // hold 2 starts before A's fade has finished
    sfx.digStart(); // scrape B
    expect(c.sources).toHaveLength(2);

    c.sources[0].ended?.(); // A's late clean-up
    expect(allDisconnected(c, 0)).toBe(true);
    expect(allDisconnected(c, 1)).toBe(false); // B untouched
    expect(c.sources[1].stops).toEqual([0.06 + 0.12]); // no stop or fade applied to B
    expect(c.gains[2].events.some(e => e.type === 'cancel' || e.type === 'linear' && (e.v ?? 1) <= 0.001 && e.t < 0.12)).toBe(false);

    // B is still tracked, so ending hold 2 fades it
    c.currentTime = 0.07;
    sfx.digStop();
    expect(c.gains[2].events.some(e => e.type === 'linear' && e.t === 0.07 + 0.03)).toBe(true);
    c.sources[1].ended?.();
    expect(allDisconnected(c, 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
