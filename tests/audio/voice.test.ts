import { describe, it, expect, vi } from 'vitest';
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

describe('Voice', () => {
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
    const vo = new Voice(synth);
    expect(vo.available).toBe(true);
    vo.say('Hiya');
    expect(calls).toEqual(['cancel', 'speak:Hiya:0.9:1.1:true']);
    vi.unstubAllGlobals();
  });
  it('never throws if synth throws', () => {
    const synth = {
      getVoices: () => [],
      cancel: () => {
        throw new Error('x');
      },
      speak: () => {
        throw new Error('y');
      },
    } as unknown as SpeechSynthesis;
    expect(() => new Voice(synth).say('a')).not.toThrow();
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
