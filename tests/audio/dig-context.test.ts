import { describe, it, expect, vi, afterEach } from 'vitest';

/** A recording AudioContext stand-in. */
interface Rec { startAt: number; stopAt: number | null; disconnected: boolean; ended?: () => void }
class FakeCtx {
  static last: FakeCtx;
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  sources: Rec[] = [];
  constructor() { FakeCtx.last = this; }
  resume() { return Promise.resolve(); } // resume is delayed: it never lands by itself
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {}, disconnect() {} }; }
  createGain() {
    return {
      gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} },
      connect() {}, disconnect() {},
    };
  }
  createBufferSource() {
    const ctx = this;
    const rec: Rec = { startAt: 0, stopAt: null, disconnected: false };
    this.sources.push(rec);
    return {
      buffer: null, connect() {},
      disconnect() { rec.disconnected = true; },
      start(t: number) { rec.startAt = t; },
      stop(t?: number) { rec.stopAt = t ?? ctx.currentTime; },
      set onended(fn: () => void) { rec.ended = fn; },
    };
  }
  createOscillator() { return { type: '', frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
}

async function freshSfx() {
  vi.resetModules();
  vi.stubGlobal('AudioContext', FakeCtx);
  return (await import('../../src/audio/sfx')).sfx;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('dig sound with an AudioContext', () => {
  it('digStop fades the current scrape within 40 ms and disconnects it when it ends', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    expect(c.sources).toHaveLength(1);
    c.currentTime = 0.05; // mid-scrape (it would otherwise run to 0.12)
    sfx.digStop();
    const s = c.sources[0];
    expect(s.stopAt).not.toBeNull();
    expect(s.stopAt! - 0.05).toBeLessThanOrEqual(0.04 + 1e-9);
    s.ended?.();
    expect(s.disconnected).toBe(true);
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

  it('a scrape still pending when audio suspends is stopped and disconnected by digStop', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    expect(c.sources).toHaveLength(1);
    c.state = 'suspended';
    sfx.digStop();
    expect(c.sources[0].stopAt).not.toBeNull();
    expect(c.sources[0].disconnected).toBe(true);
  });

  it('repeated holds do not stack live sources', async () => {
    vi.useFakeTimers();
    const sfx = await freshSfx();
    sfx.digStart();
    const c = FakeCtx.last;
    for (let i = 0; i < 4; i++) { sfx.digStart(); sfx.digStop(); c.sources.at(-1)?.ended?.(); }
    expect(c.sources.every(s => s.stopAt !== null && s.disconnected)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
