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
    master.connect(ctx.destination);
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

function play(fn: () => void): void {
  if (!ensure()) return;
  try {
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    fn();
  } catch {
    /* ignore */
  }
}

export const sfx = {
  pop: () => play(() => blip(520, 0, 0.12, 'sine', 0.4, 780)),
  place: () => play(() => blip(400, 0, 0.1, 'triangle', 0.35, 330)),
  craft: () => play(() => [523, 659, 784].forEach((f, i) => blip(f, i * 0.09, 0.18, 'triangle', 0.3))),
  cheer: () => play(() => [523, 659, 784, 1047].forEach((f, i) => blip(f, i * 0.08, 0.22, 'sine', 0.3))),
  tap: () => play(() => blip(660, 0, 0.06, 'sine', 0.25)),
  /** A quiet "off we go" for walk taps. */
  walk: () => play(() => blip(440, 0, 0.09, 'sine', 0.14, 560)),
  /** Call on the first user gesture (browsers keep audio suspended until then). */
  unlock: () => {
    const c = ensure();
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
  },
};
