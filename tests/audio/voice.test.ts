import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickVoice, Voice } from '../../src/audio/voice';
import { sfx } from '../../src/audio/sfx';

const v = (lang: string, localService: boolean, name = lang) => ({ lang, localService, name }) as SpeechSynthesisVoice;

describe('pickVoice', () => {
  it('prefers local en-GB voice', () => {
    const local = v('en-GB', true, 'local');
    expect(pickVoice([v('en-US', true), v('en-GB', false, 'remote'), local])).toBe(local);
  });
  it('uses remote en-GB over en-US', () => {
    const r = v('en-GB', false);
    expect(pickVoice([v('en-US', true), r])).toBe(r);
  });
  it('falls back when no en-GB voice', () => {
    const us = v('en-US', true);
    expect(pickVoice([v('fr-FR', true), us])).toBe(us);
    expect(pickVoice([v('fr-FR', true)])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

function stubUtterance() {
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      rate = 1;
      pitch = 1;
      lang = '';
      voice: any = null;
      constructor(t: string) {
        this.text = t;
      }
    },
  );
}

describe('Voice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('say does nothing and does not throw when synth is null', () => {
    const vo = new Voice(null);
    expect(vo.available).toBe(false);
    expect(() => vo.say('hi')).not.toThrow();
  });
  it('cancels then speaks with rate 0.9 and pitch 1.1', () => {
    const calls: string[] = [];
    const gb = v('en-GB', true);
    const synth = {
      getVoices: () => [gb],
      cancel: () => calls.push('cancel'),
      speak: (u: any) => calls.push(`speak:${u.text}:${u.rate}:${u.pitch}:${u.voice === gb}`),
    } as unknown as SpeechSynthesis;
    stubUtterance();
    const vo = new Voice(synth);
    expect(vo.available).toBe(true);
    vo.say('Hiya');
    expect(calls).toEqual(['cancel', 'speak:Hiya:0.9:1.1:true']);
  });
  it.each(['cancel', 'speak'] as const)('never throws if %s throws', (which) => {
    stubUtterance();
    const boom = () => {
      throw new Error('boom');
    };
    const synth = {
      getVoices: () => [],
      cancel: which === 'cancel' ? boom : () => {},
      speak: which === 'speak' ? boom : () => {},
    } as unknown as SpeechSynthesis;
    const vo = new Voice(synth);
    expect(vo.available).toBe(true);
    expect(() => vo.say('a')).not.toThrow();
  });
});

describe('sfx', () => {
  it('does not throw in Node without AudioContext', () => {
    expect(() => {
      sfx.unlock();
      sfx.pop();
      sfx.place();
      sfx.craft();
      sfx.cheer();
      sfx.tap();
    }).not.toThrow();
  });
});
