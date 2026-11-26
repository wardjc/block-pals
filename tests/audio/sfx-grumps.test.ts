import { beforeAll, describe, expect, it, vi } from 'vitest';

// A stub AudioContext that records every oscillator, filter, gain peak and duration a sound schedules.
interface Rec {
  nodes: number;
  oscTypes: string[];
  oscFreqs: number[];
  firstFreq: number | null;
  noise: number;
  filterFreqs: number[];
  peaks: number[];
  ends: number[];
}
let rec: Rec;
const fresh = (): Rec => ({ nodes: 0, oscTypes: [], oscFreqs: [], firstFreq: null, noise: 0, filterFreqs: [], peaks: [], ends: [] });
let clock = 0;

function param(on: (v: number) => void) {
  return {
    value: 0,
    setValueAtTime(v: number) { on(v); },
    linearRampToValueAtTime(v: number) { on(v); },
    exponentialRampToValueAtTime(v: number) { on(v); },
    cancelScheduledValues() {},
  };
}
function node(extra: Record<string, unknown> = {}): Record<string, unknown> {
  rec.nodes++;
  return { connect() {}, disconnect() {}, ...extra };
}
class StubContext {
  state = 'running';
  sampleRate = 44100;
  destination = {};
  get currentTime(): number { return clock; }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain(): unknown {
    return node({ gain: param(v => { rec.peaks.push(v); }) });
  }
  createOscillator(): unknown {
    const o = node({
      frequency: param(v => { rec.oscFreqs.push(v); if (rec.firstFreq === null) rec.firstFreq = v; }),
      start() {}, stop(t: number) { rec.ends.push(t - clock); },
    });
    let type = 'sine';
    Object.defineProperty(o, 'type', { get: () => type, set: (v: string) => { type = v; rec.oscTypes.push(v); } });
    return o;
  }
  createDynamicsCompressor(): unknown { return node({ threshold: param(() => {}), knee: param(() => {}), ratio: param(() => {}), attack: param(() => {}), release: param(() => {}) }); }
  createBiquadFilter(): unknown {
    return node({ type: 'bandpass', frequency: param(v => { rec.filterFreqs.push(v); }), Q: param(() => {}) });
  }
  createBuffer(): unknown { return { getChannelData: () => new Float32Array(10) }; }
  createBufferSource(): unknown {
    rec.noise++;
    if (rec.firstFreq === null) rec.firstFreq = -1; // noise: distinct from any note
    return node({ start() {}, stop(t: number) { rec.ends.push(t - clock); } });
  }
}

const NAMES = ['blub', 'twinkle', 'squirt', 'grumpHop', 'confetti', 'friendChime', 'plip', 'sulk'] as const;
type Sfx = typeof import('../../src/audio/sfx')['sfx'];
let sfx: Sfx;
let SAME: number;

describe('grump sfx without Web Audio', () => {
  it('every grump sfx is silent and safe with no AudioContext', async () => {
    vi.resetModules();
    const m = await import('../../src/audio/sfx');
    for (const n of NAMES) expect(() => m.sfx[n]()).not.toThrow();
  });
});

describe('grump sfx with a stub AudioContext', () => {
  beforeAll(async () => {
    vi.resetModules();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = StubContext;
    const m = await import('../../src/audio/sfx');
    sfx = m.sfx;
    SAME = m.SAME_SOUND_GAP_MS;
    rec = fresh();
    sfx.unlock();
  });

  const play = (name: (typeof NAMES)[number], at = 1000): Rec => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(at);
    rec = fresh();
    sfx[name]();
    spy.mockRestore();
    return rec;
  };
  // Each sound needs its own timestamp: a second identical sound within 80 ms is dropped.
  let stamp = 100_000;
  const once = (name: (typeof NAMES)[number]): Rec => { stamp += 100_000; return play(name, stamp); };

  it('every sound schedules something', () => {
    for (const n of NAMES) {
      const r = once(n);
      expect(r.oscTypes.length + r.noise, n).toBeGreaterThan(0);
    }
  });

  it('none uses more than 12 nodes', () => {
    for (const n of NAMES) expect(once(n).nodes, n).toBeLessThanOrEqual(12);
  });

  it('none lasts more than 1.0 s', () => {
    for (const n of NAMES) for (const end of once(n).ends) expect(end, n).toBeLessThanOrEqual(1.0);
  });

  it('none has a peak gain above 0.3', () => {
    for (const n of NAMES) for (const p of once(n).peaks) expect(p, n).toBeLessThanOrEqual(0.3);
  });

  it('only sine and triangle oscillators are used, never sawtooth or square; noise only in the squirt', () => {
    for (const n of NAMES) {
      const r = once(n);
      for (const t of r.oscTypes) expect(['sine', 'triangle'], n).toContain(t);
      if (n !== 'squirt') expect(r.noise, n).toBe(0);
    }
    expect(once('squirt').noise).toBeGreaterThan(0);
  });

  it('no oscillator is below 200 Hz and the squirt band is 800 to 2400 Hz', () => {
    for (const n of NAMES) for (const f of once(n).oscFreqs) expect(f, n).toBeGreaterThanOrEqual(200);
    const r = once('squirt');
    expect(r.filterFreqs.length).toBeGreaterThan(0);
    for (const f of r.filterFreqs) { expect(f).toBeGreaterThanOrEqual(800); expect(f).toBeLessThanOrEqual(2400); }
  });

  it('the three weapon sounds are distinct', () => {
    const firsts = (['blub', 'twinkle', 'squirt'] as const).map(n => once(n).firstFreq);
    expect(new Set(firsts).size).toBe(3);
  });

  it('a second identical sound within 80 ms is dropped', () => {
    expect(SAME).toBe(80);
    stamp += 100_000;
    const a = play('plip', stamp);
    expect(a.nodes).toBeGreaterThan(0);
    const b = play('plip', stamp + 10);
    expect(b.nodes).toBe(0);
    const c = play('plip', stamp + SAME + 5);
    expect(c.nodes).toBeGreaterThan(0);
  });

  it('sulk plays at most once per 12 s and only within 10 blocks', () => {
    stamp += 100_000;
    const base = stamp;
    const spy = vi.spyOn(performance, 'now');
    const run = (t: number, dist?: number): number => {
      spy.mockReturnValue(t);
      rec = fresh();
      (sfx.sulk as (d?: number) => void)(dist);
      return rec.nodes;
    };
    expect(run(base, 11)).toBe(0); // too far
    expect(run(base + 1000, 10)).toBeGreaterThan(0); // within 10: plays
    expect(run(base + 5000, 3)).toBe(0); // less than 12 s later
    expect(run(base + 11_999 + 1000, 3)).toBe(0);
    expect(run(base + 13_100, 3)).toBeGreaterThan(0); // 12 s after the last one
    spy.mockRestore();
  });

  it('no sound calls speechSynthesis', () => {
    const speak = vi.fn();
    (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = { speak };
    for (const n of NAMES) once(n);
    expect(speak).not.toHaveBeenCalled();
    delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });
});
