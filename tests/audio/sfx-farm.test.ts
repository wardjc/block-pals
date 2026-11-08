import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A stub AudioContext that counts nodes and remembers every scheduled sound.
interface Param { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void; cancelScheduledValues(t: number): void }
const log = { nodes: 0, stops: [] as number[], starts: [] as number[], peaks: [] as number[], oscillators: 0 };
let clock = 0;

function param(onRamp?: (v: number) => void): Param {
  return {
    value: 0,
    setValueAtTime(v) { onRamp?.(v); },
    linearRampToValueAtTime(v) { onRamp?.(v); },
    exponentialRampToValueAtTime(v) { onRamp?.(v); },
    cancelScheduledValues() {},
  };
}
function node(extra: Record<string, unknown> = {}): Record<string, unknown> {
  log.nodes++;
  return { connect() {}, disconnect() {}, ...extra };
}
class StubContext {
  state = 'running';
  sampleRate = 44100;
  destination = {};
  get currentTime(): number { return clock; }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain(): unknown { return node({ gain: param(v => { log.peaks.push(v); }) }); }
  createOscillator(): unknown {
    log.oscillators++;
    return node({ type: 'sine', frequency: param(), start(t: number) { log.starts.push(t); }, stop(t: number) { log.stops.push(t); } });
  }
  createDynamicsCompressor(): unknown { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
  createBiquadFilter(): unknown { return node({ frequency: param(), Q: param() }); }
  createBuffer(): unknown { return { getChannelData: () => new Float32Array(10) }; }
  createBufferSource(): unknown { return node({ start(t: number) { log.starts.push(t); }, stop(t: number) { log.stops.push(t); } }); }
}

const NAMES = ['water', 'sun', 'plant', 'pick', 'gift', 'munch', 'drink', 'chime', 'pet', 'cluck', 'moo', 'baa', 'oink'] as const;
type Sfx = typeof import('../../src/audio/sfx')['sfx'];
let sfx: Sfx;
let SAME: number;

describe('farm sfx without Web Audio', () => {
  it('every farm sfx is silent and safe with no AudioContext', async () => {
    vi.resetModules();
    const m = await import('../../src/audio/sfx');
    for (const n of NAMES) expect(() => m.sfx[n]()).not.toThrow();
  });
});

describe('farm sfx with a stub AudioContext', () => {
  beforeAll(async () => {
    vi.resetModules();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = StubContext;
    const m = await import('../../src/audio/sfx');
    sfx = m.sfx;
    SAME = m.SAME_SOUND_GAP_MS;
    sfx.unlock();
  });
  afterEach(() => { vi.useRealTimers(); });

  function measure(name: (typeof NAMES)[number]) {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000 + Math.random() * 1e6); // far from any earlier call: never deduplicated
    vi.advanceTimersByTime(1000);
    clock = 100;
    log.nodes = 0; log.stops = []; log.starts = []; log.peaks = []; log.oscillators = 0;
    sfx[name]();
    return { ...log, stops: [...log.stops], starts: [...log.starts], peaks: [...log.peaks] };
  }

  for (const name of NAMES) {
    it(`${name}: makes a sound with at most 12 nodes, lasts under 1.2 s and stays gentle (peak at most 0.4)`, () => {
      const r = measure(name);
      expect(r.oscillators).toBeGreaterThan(0);
      expect(r.nodes).toBeLessThanOrEqual(12);
      expect(Math.max(...r.stops) - 100).toBeLessThanOrEqual(1.2);
      expect(Math.max(...r.peaks)).toBeLessThanOrEqual(0.4);
    });
  }

  it('munch is three bites 0.15 to 0.25 s apart, and drink three gulps', () => {
    for (const n of ['munch', 'drink'] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(9_000_000);
      vi.advanceTimersByTime(60_000 + (n === 'drink' ? 60_000 : 0)); // well past the same-sound gap
      clock = 100;
      log.starts = [];
      sfx[n]();
      const r = { starts: [...log.starts] };
      const starts = [...new Set(r.starts.map(t => Math.round((t - 100) * 1000) / 1000))].sort((a, b) => a - b);
      expect(starts).toHaveLength(3);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(0.15);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(0.25);
    }
  });

  it('animal sounds are blips: no speech synthesis is ever used', () => {
    const speak = vi.fn();
    (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = { speak, cancel: vi.fn() };
    for (const n of ['cluck', 'moo', 'baa', 'oink'] as const) measure(n);
    expect(speak).not.toHaveBeenCalled();
    delete (globalThis as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it('a second identical sound within 80 ms is dropped, a different one is not, and one later is played', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    log.oscillators = 0;
    sfx.pet();
    const one = log.oscillators;
    expect(one).toBeGreaterThan(0);
    vi.advanceTimersByTime(SAME - 20);
    sfx.pet();
    expect(log.oscillators).toBe(one);
    sfx.cluck();
    expect(log.oscillators).toBeGreaterThan(one);
    const before = log.oscillators;
    vi.advanceTimersByTime(SAME + 20);
    sfx.pet();
    expect(log.oscillators).toBeGreaterThan(before);
    expect(SAME).toBe(80);
  });
});
