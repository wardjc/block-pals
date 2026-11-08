import { clipKey } from './voiceKey';

/**
 * True while speech cannot be heard yet: before the first tap, or while a created context is still
 * suspended. Callers hold their one-shot lines (hellos, Pip's lead) until it is false instead of
 * spending them silently. Without Web Audio at all (state null after a tap) speech still works.
 */
export function audioLocked(tapped: boolean, ctxState: string | null | undefined): boolean {
  return !tapped || (ctxState != null && ctxState !== 'running');
}

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const gb = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === 'en-gb');
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return gb.find((v) => v.localService) ?? gb[0] ?? en[0] ?? null;
}

/**
 * Pre-generated clips play through Web Audio (not HTMLAudioElement): the game already owns one
 * AudioContext that the first tap unlocks, decoded buffers start instantly with no per-play
 * element or autoplay policy, and the clip shares the master volume. Everything falls back to the
 * tablet's speech synthesis.
 */
export interface ClipDeps {
  fetch: typeof fetch;
  /** Vite BASE_URL, e.g. '/block-pals/'. */
  base: string;
  /** The shared audio context and output node, or null when Web Audio is unavailable. */
  audio: () => { ctx: AudioContext; out: AudioNode } | null;
  /** How long to wait for a just-unlocked context to start running before falling back. */
  resumeWaitMs?: number;
  /** Give up on a manifest/clip fetch after this long (default 4000). */
  timeoutMs?: number;
}

interface ManifestEntry { file: string; text: string; duration: number }
type Manifest = Record<string, ManifestEntry>;
export interface VoiceLast { source: 'clip' | 'tts' | 'none'; key: string }

// Clips are normalised to a 0.9 peak and the master gain is 0.5, so 1.0 puts speech peaks near 0.45 (about 0.55-0.6 after the limiter's makeup gain): clearly
// louder than the sfx blips (about 0.2 after master) without leaving room to clip when a pop lands mid-sentence.
// The master also feeds a limiter (sfx.ts) as a safety net.
const CLIP_GAIN = 1.0;
const FETCH_TIMEOUT_MS = 4000;

/** fetch that gives up after FETCH_TIMEOUT_MS (a stalled network must fall back to speech, not wait forever). */
function timedFetch(d: ClipDeps, url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => { ac?.abort(); reject(new Error('timeout')); }, d.timeoutMs ?? FETCH_TIMEOUT_MS);
    d.fetch(url, ac ? { signal: ac.signal } : undefined).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export class Voice {
  readonly available: boolean;
  /** What the last say() used, for ?debug checks. */
  last: VoiceLast = { source: 'none', key: '' };
  private synth: SpeechSynthesis | null;
  private voice: SpeechSynthesisVoice | null = null;
  private manifest: Promise<Manifest> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private current: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private token = 0;
  private requested = '';
  // Real state (not a timer from the request): a line is "speaking" from say() until it has really finished.
  // Each has a generous hard cap so a lost event (no onend from the tablet's voice, say) can never wedge it on.
  private loadingUntil = 0; // a say() is waiting for its clip to load or for the fallback to start
  private clipUntil = 0; // a clip is playing; cleared by onended or stop
  private ttsUntil = 0; // an utterance is speaking; cleared by onend / onerror or stop
  private utterance: object | null = null;

  constructor(synth?: SpeechSynthesis | null, private deps?: ClipDeps) {
    this.synth = synth === undefined ? (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null) : synth;
    this.available = !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined';
    if (this.synth) {
      try {
        this.refreshVoice();
        // Chrome loads voices asynchronously.
        this.synth.addEventListener?.('voiceschanged', () => this.refreshVoice());
      } catch {
        /* ignore */
      }
    }
  }

  private refreshVoice(): void {
    try {
      this.voice = pickVoice(this.synth?.getVoices() ?? []);
    } catch {
      this.voice = null;
    }
  }

  /**
   * True while a line is really being prepared or spoken: its clip or fallback is still loading, the
   * clip is playing, or the tablet's voice is talking. Cleared by the real end events, by stop() and by
   * errors, so a late fallback can never start while this says false.
   */
  speaking(): boolean {
    const now = performance.now();
    return now < this.loadingUntil || now < this.clipUntil || now < this.ttsUntil;
  }

  /** Stops whatever is being spoken now (clip or speech). */
  stop(): void {
    this.requested = '';
    this.token++;
    this.loadingUntil = 0;
    this.clipUntil = 0;
    this.ttsUntil = 0;
    this.utterance = null;
    this.stopClip();
    try { this.synth?.cancel(); } catch { /* speech is optional */ }
  }

  /** Stops the speech only if `text` by `speaker` is still the latest thing asked for (nothing replaced it). */
  stopIfCurrent(text: string, speaker = 'pip'): boolean {
    let key = '';
    try { key = clipKey(speaker, text); } catch { return false; }
    if (key !== this.requested) return false;
    this.stop();
    return true;
  }

  say(text: string, speaker = 'pip'): void {
    if (!text) return; // never an empty utterance: it would cancel the line that is playing
    try { this.requested = clipKey(speaker, text); } catch { this.requested = ''; }
    if (!this.deps) {
      this.speak(text);
      return;
    }
    const token = ++this.token;
    // Preparing: fetch (each with its timeout), decode, and the context resuming. Ends when the clip
    // starts or the fallback speech takes over, whichever really happens.
    const d = this.deps;
    this.loadingUntil = performance.now() + 2 * (d.timeoutMs ?? FETCH_TIMEOUT_MS) + (d.resumeWaitMs ?? 300) + 1500;
    this.clipUntil = 0;
    this.ttsUntil = 0;
    this.utterance = null;
    this.stopClip();
    try { this.synth?.cancel(); } catch { /* speech is optional */ }
    let key = '';
    try { key = clipKey(speaker, text); } catch { /* fall through to speech */ }
    this.playClip(key, token).then(
      (played) => {
        if (token !== this.token) return;
        if (!played) this.fallback(text, key);
      },
      () => { if (token === this.token) this.fallback(text, key); },
    );
  }

  /** Warm the cache (fetch + decode) for these lines without playing them. Never throws. */
  prefetch(texts: string[], speaker = 'pip'): void {
    for (const t of texts) {
      try {
        const key = clipKey(speaker, t);
        this.loadBuffer(key).catch(() => {});
      } catch { /* optional */ }
    }
  }

  private fallback(text: string, key: string): void {
    this.last = { source: 'tts', key };
    this.loadingUntil = 0;
    this.speak(text);
  }

  private stopClip(): void {
    const cur = this.current;
    this.current = null;
    this.clipUntil = 0;
    if (!cur) return;
    try { cur.src.stop(); } catch { /* already ended */ }
    try { cur.src.disconnect(); cur.gain.disconnect(); } catch { /* already gone */ }
  }

  private loadManifest(): Promise<Manifest> {
    if (!this.manifest) {
      const d = this.deps!;
      this.manifest = (async () => {
        const res = await timedFetch(d, `${d.base}voice/manifest.json`);
        if (!res.ok) throw new Error('manifest');
        return (await res.json()) as Manifest;
      })();
      // A failed load may be retried on the next say (e.g. back online).
      this.manifest.catch(() => { this.manifest = null; });
    }
    return this.manifest;
  }

  private loadBuffer(key: string): Promise<AudioBuffer> {
    let p = this.buffers.get(key);
    if (!p) {
      const d = this.deps!;
      p = (async () => {
        const entry = (await this.loadManifest())[key];
        if (!entry) throw new Error('no clip');
        const out = d.audio();
        if (!out) throw new Error('no audio');
        const res = await timedFetch(d, `${d.base}voice/${entry.file}`);
        if (!res.ok) throw new Error('clip');
        return await out.ctx.decodeAudioData(await res.arrayBuffer());
      })();
      this.buffers.set(key, p);
      p.catch(() => { if (this.buffers.get(key) === p) this.buffers.delete(key); });
    }
    return p;
  }

  /** True if the clip started playing; false/throw means fall back to speech. */
  private async playClip(key: string, token: number): Promise<boolean> {
    const buf = await this.loadBuffer(key);
    if (token !== this.token) return true; // superseded: say() was called again, nothing to fall back for
    const out = this.deps!.audio();
    if (!out) return false;
    const { ctx } = out;
    if (ctx.state !== 'running') {
      // The first tap's resume() may still be in flight.
      await Promise.race([
        Promise.resolve(ctx.resume()).catch(() => {}),
        new Promise((r) => setTimeout(r, this.deps!.resumeWaitMs ?? 300)),
      ]);
      if (token !== this.token) return true;
      if ((ctx.state as string) !== 'running') return false;
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = CLIP_GAIN;
    src.buffer = buf;
    src.connect(gain);
    gain.connect(out.out);
    src.onended = () => {
      try { src.disconnect(); gain.disconnect(); } catch { /* already gone */ }
      if (this.current?.src === src) { this.current = null; this.clipUntil = 0; }
    };
    src.start();
    this.loadingUntil = 0;
    this.clipUntil = performance.now() + buf.duration * 1000 + 3000; // cap only: onended ends it
    this.current = { src, gain };
    this.last = { source: 'clip', key };
    return true;
  }

  private speak(text: string): void {
    if (!this.synth || !this.available) { this.loadingUntil = 0; return; }
    try {
      this.synth.cancel();
      if (!this.voice) this.refreshVoice();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      u.pitch = 1.1;
      u.lang = this.voice?.lang ?? 'en-GB';
      if (this.voice) u.voice = this.voice;
      const mine = {};
      this.utterance = mine;
      this.ttsUntil = performance.now() + Math.max(6000, text.length * 150); // cap only: onend / onerror end it
      const done = (): void => {
        if (this.utterance !== mine) return; // a newer line (or stop) replaced this one
        this.utterance = null;
        this.ttsUntil = 0;
      };
      u.onend = done;
      u.onerror = done;
      this.synth.speak(u);
    } catch {
      this.ttsUntil = 0;
      this.utterance = null;
    }
  }
}
