let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : (globalThis as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    // Safety limiter: a voice clip (peak ~0.45 after master, more after the compressor's automatic makeup gain of roughly +3 dB) plus a pop or two (~0.2 each) can approach
    // full scale. Threshold -6 dB with a hard ratio keeps the sum from clipping; it is not a no-op: the compressor adds makeup gain, which is why CLIP_GAIN is a modest 1.0.
    let sink: AudioNode = ctx.destination;
    try {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -6;
      lim.knee.value = 6;
      lim.ratio.value = 12;
      lim.attack.value = 0.003;
      lim.release.value = 0.15;
      lim.connect(ctx.destination);
      sink = lim;
    } catch {
      /* no compressor: connect straight through */
    }
    master.connect(sink);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** A soft sine/triangle blip. Frequencies stay well above any rumble. */
function blip(freq: number, start: number, dur: number, type: OscillatorType = 'sine', peak = 0.4, endFreq?: number): void {
  const c = ctx;
  if (!c || !master) return;
  try {
    const t = c.currentTime + start;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {
    /* sound is optional */
  }
}

/** Repeats a tick on a timer. Start twice = still one loop; stop is always safe. Clock is injectable. */
export class LoopScheduler {
  private id: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly tick: () => void,
    private readonly intervalMs: number,
    private readonly timers: { set: typeof setInterval; clear: typeof clearInterval } = {
      set: (...a: Parameters<typeof setInterval>) => setInterval(...a),
      clear: (id) => clearInterval(id),
    } as { set: typeof setInterval; clear: typeof clearInterval },
  ) {}
  get running(): boolean { return this.id !== null; }
  start(): void {
    if (this.id !== null) return;
    this.safeTick();
    this.id = this.timers.set(() => this.safeTick(), this.intervalMs);
  }
  stop(): void {
    if (this.id === null) return;
    this.timers.clear(this.id);
    this.id = null;
  }
  private safeTick(): void {
    try { this.tick(); } catch { /* sound is optional */ }
  }
}

let noise: AudioBuffer | null = null;
let scrapeFlip = false;

interface Scrape { src: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode }
const activeScrapes = new Set<Scrape>();

function release(sc: Scrape): void {
  activeScrapes.delete(sc);
  try { sc.src.disconnect(); sc.f.disconnect(); sc.g.disconnect(); } catch { /* already gone */ }
}

/** Fade out and stop every scrape that is sounding or pending, then disconnect it. */
function silenceScrapes(): void {
  const c = ctx;
  for (const sc of [...activeScrapes]) {
    try {
      if (c && c.state === 'running') {
        const t = c.currentTime;
        sc.g.gain.cancelScheduledValues(t);
        sc.g.gain.setValueAtTime(Math.max(sc.g.gain.value, 0.0001), t);
        sc.g.gain.linearRampToValueAtTime(0.0001, t + 0.03);
        sc.src.stop(t + 0.04);
        sc.src.onended = () => release(sc);
        continue; // released when it ends
      }
      sc.src.stop();
    } catch { /* never started or already stopped */ }
    release(sc);
  }
}

/** One soft, quiet band-limited noise "scrape" (about 1.2-1.9 kHz: no rumble, nothing harsh). */
function scrape(): void {
  const c = ctx;
  // A suspended context has a frozen clock: scrapes would pile up at one timestamp and blast on resume.
  if (!c || !master || c.state !== 'running') return;
  try {
    if (!noise) {
      noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    scrapeFlip = !scrapeFlip;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = scrapeFlip ? 1200 : 1900;
    f.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 0.12);
    const sc: Scrape = { src, f, g };
    activeScrapes.add(sc);
    src.onended = () => release(sc);
  } catch {
    /* sound is optional */
  }
}

const digLoop = new LoopScheduler(scrape, 130);
const digStats = { starts: 0, stops: 0 };

function play(fn: () => void): void {
  if (!ensure()) return;
  try {
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    fn();
  } catch {
    /* ignore */
  }
}

/**
 * A second identical sound within this long is dropped, so a run of quick taps never stacks the
 * same chime on top of itself.
 */
export const SAME_SOUND_GAP_MS = 80;
const lastPlayed = new Map<string, number>();
function once(name: string, fn: () => void): () => void {
  return () => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = lastPlayed.get(name);
    if (last !== undefined && now - last < SAME_SOUND_GAP_MS && now >= last) return;
    lastPlayed.set(name, now);
    play(fn);
  };
}

/**
 * Farm and animal sounds. Every one is a few soft oscillator blips (no clips, no speech), under
 * 1.2 s, with a peak gain of at most 0.4; the animals' are short happy rising or falling notes.
 */
export const farmSfx = {
  /** Three little drops. */
  water: once('water', () => [0, 0.08, 0.17].forEach((t, i) => blip(1300 - i * 150, t, 0.1, 'sine', 0.22, 900 - i * 100))),
  /** A warm, bright chime. */
  sun: once('sun', () => [784, 988, 1175].forEach((f, i) => blip(f, i * 0.07, 0.22, 'sine', 0.2))),
  /** Seed into the soil. */
  plant: once('plant', () => { blip(300, 0, 0.1, 'triangle', 0.3, 220); blip(520, 0.06, 0.08, 'sine', 0.14, 600); }),
  /** A plant picked. */
  pick: once('pick', () => { blip(600, 0, 0.08, 'sine', 0.28, 880); blip(880, 0.08, 0.12, 'sine', 0.22, 1100); }),
  /** A gift from an animal: three rising notes. */
  gift: once('gift', () => [659, 784, 1047].forEach((f, i) => blip(f, i * 0.09, 0.2, 'triangle', 0.26))),
  /** A pat. */
  pet: once('pet', () => { blip(520, 0, 0.1, 'sine', 0.2, 700); blip(700, 0.1, 0.12, 'sine', 0.2, 880); }),
  cluck: once('cluck', () => { blip(700, 0, 0.06, 'triangle', 0.2, 920); blip(820, 0.1, 0.07, 'triangle', 0.2, 640); }),
  moo: once('moo', () => { blip(230, 0, 0.7, 'sine', 0.3, 180); blip(460, 0.02, 0.6, 'triangle', 0.08, 360); }),
  baa: once('baa', () => { blip(420, 0, 0.4, 'triangle', 0.2, 360); blip(430, 0.05, 0.35, 'sine', 0.14, 380); }),
  oink: once('oink', () => { blip(300, 0, 0.12, 'triangle', 0.25, 210); blip(270, 0.16, 0.14, 'triangle', 0.22, 190); }),
};

export const sfx = {
  ...farmSfx,
  /** The shared AudioContext and its master gain, for voice clips. Null when Web Audio is unavailable. */
  audioOut: (): { ctx: AudioContext; out: AudioNode } | null => {
    const c = ensure();
    return c && master ? { ctx: c, out: master } : null;
  },
  pop: () => play(() => blip(520, 0, 0.12, 'sine', 0.4, 780)),
  place: () => play(() => blip(400, 0, 0.1, 'triangle', 0.35, 330)),
  craft: () => play(() => [523, 659, 784].forEach((f, i) => blip(f, i * 0.09, 0.18, 'triangle', 0.3))),
  cheer: () => play(() => [523, 659, 784, 1047].forEach((f, i) => blip(f, i * 0.08, 0.22, 'sine', 0.3))),
  tap: () => play(() => blip(660, 0, 0.06, 'sine', 0.25)),
  /** A quiet "off we go" for walk taps. */
  walk: () => play(() => blip(440, 0, 0.09, 'sine', 0.14, 560)),
  /** Gentle looping scrape while he holds to dig. Safe to call twice; silent with no AudioContext. */
  digStart: () => {
    if (digLoop.running) return;
    if (!ensure()) return;
    digStats.starts++;
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    digLoop.start();
  },
  digStop: () => {
    if (digLoop.running) digStats.stops++;
    digLoop.stop();
    silenceScrapes();
  },
  /** For ?debug checks. */
  digState: () => ({ ...digStats, active: digLoop.running }),
  /** Call on the first user gesture (browsers keep audio suspended until then). */
  unlock: () => {
    const c = ensure();
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
  },
};
