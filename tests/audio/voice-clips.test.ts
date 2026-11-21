import { describe, it, expect, vi, afterEach } from 'vitest';
import { Voice, type ClipDeps } from '../../src/audio/voice';
import { clipKey } from '../../src/audio/voiceKey';

const TEXT = 'Hiya! Ready for an adventure?';
const KEY = clipKey('pip', TEXT);
const TEXT2 = 'Hello! Shall we play?';
const KEY2 = clipKey('pip', TEXT2);
const manifest = {
  [KEY]: { file: `${KEY}.ogg`, text: TEXT, duration: 2 },
  [KEY2]: { file: `${KEY2}.ogg`, text: TEXT2, duration: 2 },
};

interface Src { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }
interface Rig {
  voice: Voice;
  synth: { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn>; speaking: boolean };
  sources: Src[];
  ctx: { state: string };
  fetch: ReturnType<typeof vi.fn>;
  deps: ClipDeps;
}

function rig(opts: { manifest?: unknown; manifestFails?: boolean; clip?: 'ok' | 'missing'; decodeFails?: boolean; state?: string; noAudio?: boolean; gate?: (url: string) => Promise<void> | undefined; hang?: boolean; timeoutMs?: number; bodyHang?: 'json' | 'clip'; synthSpeaking?: boolean } = {}): Rig {
  const sources: Src[] = [];
  const ctx = {
    state: opts.state ?? 'running',
    resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => {
      if (opts.decodeFails) throw new Error('bad audio');
      return { duration: 2 } as AudioBuffer;
    }),
    createBufferSource: vi.fn(() => {
      const s = { buffer: null as unknown, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
  };
  let manifestCalls = 0;
  const fetchFn = vi.fn(async (url: string) => {
    if (opts.hang) return new Promise<Response>(() => {});
    await opts.gate?.(url);
    if (url.endsWith('manifest.json')) {
      manifestCalls++;
      if (opts.manifestFails && manifestCalls === 1) throw new Error('offline');
      return { ok: true, json: () => (opts.bodyHang === 'json' ? new Promise(() => {}) : Promise.resolve(opts.manifest ?? manifest)) } as unknown as Response;
    }
    if (opts.clip === 'missing') return { ok: false, status: 404 } as Response;
    return { ok: true, arrayBuffer: () => (opts.bodyHang === 'clip' ? new Promise(() => {}) : Promise.resolve(new ArrayBuffer(8))) } as unknown as Response;
  });
  const synth = { getVoices: () => [], cancel: vi.fn(), speak: vi.fn(), speaking: !!opts.synthSpeaking };
  const deps: ClipDeps = {
    fetch: fetchFn as unknown as typeof fetch,
    base: '/block-pals/',
    audio: () => (opts.noAudio ? null : { ctx: ctx as unknown as AudioContext, out: {} as AudioNode }),
    resumeWaitMs: 5,
    timeoutMs: opts.timeoutMs ?? 50,
  };
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  return { voice: new Voice(synth as unknown as SpeechSynthesis, deps), synth, sources, ctx, fetch: fetchFn, deps };
}

const settle = () => new Promise((r) => setTimeout(r, 25));

afterEach(() => vi.unstubAllGlobals());

describe('Voice clips', () => {
  it('plays the clip and does not use speechSynthesis to speak', async () => {
    const r = rig();
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].start).toHaveBeenCalled();
    expect(r.synth.speak).not.toHaveBeenCalled();
    expect(r.voice.last).toEqual({ source: 'clip', key: KEY });
    expect(r.fetch).toHaveBeenCalledWith('/block-pals/voice/manifest.json', expect.anything());
    expect(r.fetch).toHaveBeenCalledWith(`/block-pals/voice/${KEY}.ogg`, expect.anything());
  });
  it('fetches the manifest once and each clip once (decode cache)', async () => {
    const r = rig();
    r.voice.say(TEXT);
    await settle();
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(2);
    expect(r.fetch).toHaveBeenCalledTimes(2);
  });
  it('falls back to speech when the manifest cannot be fetched', async () => {
    const r = rig({ manifestFails: true });
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(0);
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
    expect(r.voice.last.source).toBe('tts');
  });
  it('falls back when the line is not in the manifest', async () => {
    const r = rig({ manifest: {} });
    r.voice.say(TEXT);
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
  });
  it('falls back when the clip file is missing', async () => {
    const r = rig({ clip: 'missing' });
    r.voice.say(TEXT);
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
  });
  it('falls back on a decode error', async () => {
    const r = rig({ decodeFails: true });
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(0);
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
  });
  it('falls back when audio is locked (context stays suspended)', async () => {
    const r = rig({ state: 'suspended' });
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(0);
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
  });
  it('falls back when there is no Web Audio at all', async () => {
    const r = rig({ noAudio: true });
    r.voice.say(TEXT);
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
  });
  it('a second say stops the first clip', async () => {
    const r = rig();
    r.voice.say(TEXT);
    await settle();
    r.voice.say(TEXT);
    await settle();
    expect(r.sources[0].stop).toHaveBeenCalled();
    expect(r.sources[1].stop).not.toHaveBeenCalled();
  });
  it('two quick says: only the last one plays', async () => {
    const r = rig();
    r.voice.say(TEXT);
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(1);
  });
  it('cancels tablet speech straight away', () => {
    const r = rig();
    r.voice.say(TEXT);
    expect(r.synth.cancel).toHaveBeenCalled();
  });
  it('never throws, even when everything is broken', async () => {
    const r = rig();
    r.deps.audio = () => { throw new Error('boom'); };
    expect(() => r.voice.say(TEXT)).not.toThrow();
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
    expect(() => r.voice.say('')).not.toThrow();
    expect(() => r.voice.prefetch(['x'])).not.toThrow();
  });
  it('prefetch loads and decodes clips without playing them', async () => {
    const r = rig();
    r.voice.prefetch([TEXT]);
    await settle();
    expect(r.sources).toHaveLength(0);
    r.voice.say(TEXT);
    await settle();
    expect(r.fetch).toHaveBeenCalledTimes(2); // manifest + clip, once each
    expect(r.sources).toHaveLength(1);
  });
  it('an empty line returns early: current clip keeps playing, nothing cancelled', async () => {
    const r = rig();
    r.voice.say(TEXT);
    await settle();
    r.synth.cancel.mockClear();
    r.voice.say('');
    await settle();
    expect(r.synth.cancel).not.toHaveBeenCalled();
    expect(r.sources[0].stop).not.toHaveBeenCalled();
    expect(r.synth.speak).not.toHaveBeenCalled();
  });
  it('out of order: the first load finishing late never plays and never speaks', async () => {
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    const r = rig({ timeoutMs: 5000, gate: (url) => (url.endsWith(`${KEY}.ogg`) ? held : undefined) });
    r.voice.say(TEXT); // slow
    await settle();
    r.voice.say(TEXT2); // fast
    await settle();
    expect(r.sources).toHaveLength(1);
    release();
    await settle();
    expect(r.sources).toHaveLength(1);
    expect(r.synth.speak).not.toHaveBeenCalled();
    expect(r.voice.last).toEqual({ source: 'clip', key: KEY2 });
  });
  it('a stalled network times out and falls back to speech', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ hang: true });
      r.voice.say(TEXT);
      await vi.advanceTimersByTimeAsync(60);
      expect(r.synth.speak).toHaveBeenCalledTimes(1);
      expect(r.sources).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('retries the manifest after a failed load', async () => {
    const r = rig({ manifestFails: true });
    r.voice.say(TEXT);
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
    r.voice.say(TEXT);
    await settle();
    expect(r.sources).toHaveLength(1);
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
    expect(r.voice.last.source).toBe('clip');
  });
});

describe('Voice.speaking() follows the real state', () => {
  const utter = (r: Rig) => r.synth.speak.mock.calls[0][0] as { onend?: () => void; onerror?: () => void };

  it('is false before any line and true as soon as one is requested (pending load)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const r = rig({ gate: () => gate, timeoutMs: 5000 });
    expect(r.voice.speaking()).toBe(false);
    r.voice.say(TEXT);
    expect(r.voice.speaking()).toBe(true);
    await settle();
    expect(r.voice.speaking()).toBe(true); // still loading, the old timer-from-request would have been fine here but a slow load must stay true
    release();
    await settle();
    expect(r.voice.speaking()).toBe(true); // the clip is playing
    r.sources[0].onended!();
    expect(r.voice.speaking()).toBe(false);
  });

  it('a slow load stays speaking beyond the old estimate, so nothing can talk over the late fallback', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      const r = rig({ gate: () => gate, timeoutMs: 20_000 });
      r.voice.say('Hi.');
      await vi.advanceTimersByTimeAsync(5000); // the old estimate (2.5 s minimum) would have expired
      expect(r.voice.speaking()).toBe(true);
      release();
      await vi.advanceTimersByTimeAsync(10);
      expect(r.voice.speaking()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fallback speech is speaking until the utterance ends, and an error ends it too', async () => {
    const r = rig({ manifest: {} });
    r.voice.say(TEXT);
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
    expect(r.voice.speaking()).toBe(true);
    utter(r).onend!();
    expect(r.voice.speaking()).toBe(false);

    const r2 = rig({ manifest: {} });
    r2.voice.say(TEXT);
    await settle();
    expect(r2.voice.speaking()).toBe(true);
    utter(r2).onerror!();
    expect(r2.voice.speaking()).toBe(false);
  });

  it('the end event of a cancelled utterance does not clear the line that replaced it', async () => {
    const r = rig({ manifest: {} });
    r.voice.say(TEXT);
    await settle();
    const first = utter(r);
    r.voice.say(TEXT2);
    await settle();
    first.onend!(); // the browser reports the cancelled one finishing
    expect(r.voice.speaking()).toBe(true);
  });

  it('stop() and failures end it: stop, no audio and no speech support', async () => {
    const r = rig();
    r.voice.say(TEXT);
    await settle();
    expect(r.voice.speaking()).toBe(true);
    r.voice.stop();
    expect(r.voice.speaking()).toBe(false);

    const none = rig({ noAudio: true, manifest: {} });
    none.voice.say(TEXT);
    await settle();
    expect(none.voice.speaking()).toBe(true); // fell back to speech
    none.voice.stop();
    expect(none.voice.speaking()).toBe(false);

    const silent = new Voice(null, rig({ noAudio: true }).deps);
    silent.say(TEXT);
    await settle();
    await settle();
    expect(silent.speaking()).toBe(false); // nothing could be spoken, so nothing is "speaking"
  });

  it('a superseded line does not leave speaking stuck', async () => {
    const r = rig();
    r.voice.say(TEXT);
    r.voice.say(TEXT2);
    await settle();
    r.sources.forEach((s) => s.onended?.());
    expect(r.voice.speaking()).toBe(false);
  });
});

describe('Voice.speaking() cases from the review', () => {
  it('a response body that never arrives stays speaking, then times out into the fallback speech (still speaking)', async () => {
    for (const bodyHang of ['json', 'clip'] as const) {
      const r = rig({ bodyHang, timeoutMs: 40 });
      r.voice.say(TEXT);
      await new Promise((res) => setTimeout(res, 20));
      expect(r.voice.speaking(), `${bodyHang} pending`).toBe(true);
      await new Promise((res) => setTimeout(res, 120));
      expect(r.synth.speak, `${bodyHang} fell back`).toHaveBeenCalledTimes(1);
      expect(r.voice.speaking(), `${bodyHang} tts`).toBe(true);
      (r.synth.speak.mock.calls[0][0] as { onend: () => void }).onend();
      expect(r.voice.speaking()).toBe(false);
    }
  });

  it('TTS stays speaking past the length estimate while the voice itself says it is going, and ends at onend', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ manifest: {}, synthSpeaking: true });
      r.voice.say('A long line that the tablet voice reads slowly.');
      await vi.advanceTimersByTimeAsync(30);
      expect(r.synth.speak).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(r.voice.speaking()).toBe(true);
      r.synth.speaking = false;
      await vi.advanceTimersByTimeAsync(3000);
      expect(r.voice.speaking()).toBe(false); // the watchdog gave up and cancelled it
      expect(r.synth.cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('speech that the tablet reports as finished (no end event) stops counting after a moment', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ manifest: {}, synthSpeaking: false });
      r.voice.say(TEXT);
      await vi.advanceTimersByTimeAsync(30);
      expect(r.synth.speak).toHaveBeenCalledTimes(1);
      expect(r.voice.speaking()).toBe(true); // just started: give it time
      await vi.advanceTimersByTimeAsync(2000);
      expect(r.voice.speaking()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a clip held by a suspended context still counts while it waits, and ends when it finishes after resuming', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.voice.say(TEXT);
      await vi.advanceTimersByTimeAsync(30);
      expect(r.sources).toHaveLength(1);
      r.ctx.state = 'suspended'; // e.g. the tablet paused audio mid clip
      await vi.advanceTimersByTimeAsync(10_000); // far past its 2 s length
      expect(r.voice.speaking()).toBe(true);
      r.ctx.state = 'running';
      r.sources[0].onended!();
      expect(r.voice.speaking()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a context that is closed for good (no onended ever) is given up on after the long hard cap', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.voice.say(TEXT);
      await vi.advanceTimersByTimeAsync(30);
      r.ctx.state = 'suspended';
      await vi.advanceTimersByTimeAsync(60_000);
      expect(r.voice.speaking()).toBe(false);
      expect(r.sources[0].stop).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a watchdog expiry invalidates the line: a late fallback cannot speak over silence', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const r = rig({ gate: () => gate, timeoutMs: 600_000, manifest: {} });
    const realNow = performance.now.bind(performance);
    let jump = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => realNow() + jump);
    try {
      r.voice.say(TEXT);
      expect(r.voice.speaking()).toBe(true);
      jump = 4_000_000; // far past every stage bound
      expect(r.voice.speaking()).toBe(false); // expired: invalidated first
      expect(r.synth.cancel).toHaveBeenCalled();
      release(); // the load now "completes": the manifest has no entry, which would trigger the fallback
      await settle();
      expect(r.synth.speak).not.toHaveBeenCalled();
      expect(r.sources).toHaveLength(0);
      // and a newer line is not disturbed by the stale one
      jump = 0;
      r.voice.say(TEXT2);
      await settle();
      expect(r.synth.speak).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('suspend and resume mid-clip, and held lines', () => {
  it('a clip that is suspended mid-way and resumed is not cut off and counts until it really ends', async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      r.voice.say(TEXT);
      await vi.advanceTimersByTimeAsync(30);
      expect(r.sources).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500); // 0.5 s of a 2 s clip
      r.ctx.state = 'suspended';
      await vi.advanceTimersByTimeAsync(10_000);
      expect(r.voice.speaking()).toBe(true);
      r.ctx.state = 'running'; // resumes with 1.5 s left
      expect(r.voice.speaking()).toBe(true);
      expect(r.sources[0].stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1400);
      expect(r.voice.speaking()).toBe(true); // still playing its last moments
      expect(r.sources[0].stop).not.toHaveBeenCalled();
      r.sources[0].onended!();
      expect(r.voice.speaking()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a held line never falls back to the tablet voice while the context is suspended; it is dropped quietly', async () => {
    const r = rig({ state: 'suspended' });
    r.voice.say(TEXT, 'pip', { holdForAudio: true });
    await settle();
    expect(r.synth.speak).not.toHaveBeenCalled();
    expect(r.sources).toHaveLength(0);
    expect(r.voice.speaking()).toBe(false);
    // the same line without the hold keeps the old behaviour (essential speech: welcome, break)
    const r2 = rig({ state: 'suspended' });
    r2.voice.say(TEXT);
    await settle();
    expect(r2.synth.speak).toHaveBeenCalledTimes(1);
  });

  it('a held line plays as a clip once the context is running', async () => {
    const r = rig();
    r.voice.say(TEXT, 'pip', { holdForAudio: true });
    await settle();
    expect(r.sources).toHaveLength(1);
    expect(r.synth.speak).not.toHaveBeenCalled();
  });

  it('a held line whose clip is simply missing still falls back to speech while audio runs', async () => {
    const r = rig({ clip: 'missing' });
    r.voice.say(TEXT, 'pip', { holdForAudio: true });
    await settle();
    expect(r.synth.speak).toHaveBeenCalledTimes(1);
  });
});

describe('Voice.sayParts (the wizard\'s stitched counting sentence)', () => {
  const PARTS = ['Bring me', 'three', 'apples'];
  const partManifest = (parts: string[]) => ({
    ...manifest,
    ...Object.fromEntries(parts.map((t) => { const k = clipKey('wizard', t); return [k, { file: `${k}.ogg`, text: t, duration: 1 }]; })),
  });

  it('plays the parts in order, one gap each, and counts as one line throughout', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ manifest: partManifest(PARTS) });
      r.voice.sayParts('wizard', PARTS, 120);
      expect(r.voice.speaking()).toBe(true);
      await vi.advanceTimersByTimeAsync(5);
      expect(r.sources).toHaveLength(1);
      expect(r.voice.last.key).toBe(clipKey('wizard', 'Bring me'));
      r.sources[0].onended!();
      expect(r.voice.speaking()).toBe(true); // the gap still counts
      await vi.advanceTimersByTimeAsync(100);
      expect(r.sources).toHaveLength(1); // not before the gap is over
      await vi.advanceTimersByTimeAsync(30);
      expect(r.sources).toHaveLength(2);
      expect(r.voice.last.key).toBe(clipKey('wizard', 'three'));
      r.sources[1].onended!();
      await vi.advanceTimersByTimeAsync(130);
      expect(r.sources).toHaveLength(3);
      expect(r.voice.last.key).toBe(clipKey('wizard', 'apples'));
      expect(r.voice.speaking()).toBe(true);
      r.sources[2].onended!();
      expect(r.voice.speaking()).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(r.sources).toHaveLength(3);
      expect(r.synth.speak).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a break line interrupts it and nothing replaces the break', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ manifest: partManifest(PARTS) });
      r.voice.sayParts('wizard', PARTS, 120);
      await vi.advanceTimersByTimeAsync(5);
      r.sources[0].onended!();
      await vi.advanceTimersByTimeAsync(130);
      expect(r.sources).toHaveLength(2);
      r.voice.say(TEXT); // Pip's break reminder
      await vi.advanceTimersByTimeAsync(5);
      expect(r.sources[1].stop).toHaveBeenCalled();
      expect(r.sources).toHaveLength(3);
      expect(r.voice.last.key).toBe(KEY);
      r.sources[1].onended?.(); // the stopped part ending late changes nothing
      await vi.advanceTimersByTimeAsync(1000);
      expect(r.sources).toHaveLength(3);
      expect(r.voice.speaking()).toBe(true); // the break line is still playing
      expect(r.sources[2].stop).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a newer line or stop() cancels the rest of the parts', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ manifest: partManifest(PARTS) });
      r.voice.sayParts('wizard', PARTS, 120);
      await vi.advanceTimersByTimeAsync(5);
      r.sources[0].onended!();
      r.voice.stop(); // in the gap
      await vi.advanceTimersByTimeAsync(500);
      expect(r.sources).toHaveLength(1);
      expect(r.voice.speaking()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a missing wizard clip never uses the tablet voice: that part is skipped, the rest still plays', async () => {
    const r = rig({ manifest: partManifest(['Bring me', 'apples']) }); // 'three' has no clip
    r.voice.sayParts('wizard', PARTS, 1);
    await settle();
    expect(r.sources).toHaveLength(1);
    r.sources[0].onended!();
    await settle();
    expect(r.sources).toHaveLength(2);
    expect(r.voice.last.key).toBe(clipKey('wizard', 'apples'));
    r.sources[1].onended!();
    expect(r.voice.speaking()).toBe(false);
    expect(r.synth.speak).not.toHaveBeenCalled();
  });

  it('with no clips at all it says nothing, never the tablet voice, and does not stay speaking', async () => {
    for (const opts of [{ manifest: {} }, { manifestFails: true }, { clip: 'missing' as const }, { noAudio: true }]) {
      const r = rig(opts);
      r.voice.sayParts('wizard', PARTS);
      await settle();
      expect(r.sources).toHaveLength(0);
      expect(r.synth.speak).not.toHaveBeenCalled();
      expect(r.voice.speaking()).toBe(false);
    }
  });

  it('while audio is locked it is dropped quietly, never spoken by the tablet voice', async () => {
    const r = rig({ manifest: partManifest(PARTS), state: 'suspended' });
    r.voice.sayParts('wizard', PARTS);
    await settle();
    expect(r.sources).toHaveLength(0);
    expect(r.synth.speak).not.toHaveBeenCalled();
    expect(r.voice.speaking()).toBe(false);
  });

  it('an empty list does nothing and does not cut the line that is playing', async () => {
    const r = rig();
    r.voice.say(TEXT);
    await settle();
    r.voice.sayParts('wizard', ['', '']);
    expect(r.sources[0].stop).not.toHaveBeenCalled();
    expect(r.voice.speaking()).toBe(true);
  });

  it('without clip support (no deps) it says nothing at all', () => {
    const synth = { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    const v = new Voice(synth as unknown as SpeechSynthesis);
    v.sayParts('wizard', PARTS);
    expect(synth.speak).not.toHaveBeenCalled();
    expect(v.speaking()).toBe(false);
  });
});
