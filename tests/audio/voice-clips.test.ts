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
  synth: { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> };
  sources: Src[];
  fetch: ReturnType<typeof vi.fn>;
  deps: ClipDeps;
}

function rig(opts: { manifest?: unknown; manifestFails?: boolean; clip?: 'ok' | 'missing'; decodeFails?: boolean; state?: string; noAudio?: boolean; gate?: (url: string) => Promise<void> | undefined; hang?: boolean; timeoutMs?: number } = {}): Rig {
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
      return { ok: true, json: async () => opts.manifest ?? manifest } as Response;
    }
    if (opts.clip === 'missing') return { ok: false, status: 404 } as Response;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } as Response;
  });
  const synth = { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() };
  const deps: ClipDeps = {
    fetch: fetchFn as unknown as typeof fetch,
    base: '/block-pals/',
    audio: () => (opts.noAudio ? null : { ctx: ctx as unknown as AudioContext, out: {} as AudioNode }),
    resumeWaitMs: 5,
    timeoutMs: opts.timeoutMs ?? 50,
  };
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  return { voice: new Voice(synth as unknown as SpeechSynthesis, deps), synth, sources, fetch: fetchFn, deps };
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
