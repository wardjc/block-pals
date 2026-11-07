import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { LINES } from '../../src/content/lines';
import { clipKey } from '../../src/audio/voiceKey';

const all = Object.values(LINES).flat();
const manifest = JSON.parse(readFileSync('public/voice/manifest.json', 'utf8')) as Record<string, { file: string; text: string; duration: number }>;

describe('voice clips', () => {
  it('no line contains a cheer or sound-effect word (the voice would read it out)', () => {
    for (const l of all) expect(l).not.toMatch(/\b(whee+|yippee|woo-?hoo|yay|hooray|hee hee|ha ha|wahoo|ooh+|hmm+|ta-?da|hup)\b/i);
  });
  it('every line has a clip in the manifest (run `npm run voice:lines` then tools/voice/generate.py)', () => {
    const missing = all.filter((l) => !manifest[clipKey('pip', l)]);
    expect(missing).toEqual([]);
  });
  it('every manifest entry has its file and the text it was made from', () => {
    for (const [key, e] of Object.entries(manifest)) {
      expect(existsSync(`public/voice/${e.file}`), key).toBe(true);
      expect(clipKey(key.split('/')[0], e.text)).toBe(key);
      expect(e.duration).toBeGreaterThan(0.3);
    }
  });
  it('no stale clips: every manifest entry is a current line (generate.py --prune)', () => {
    const current = new Set(all.map((l) => clipKey('pip', l)));
    for (const key of Object.keys(manifest)) expect(current.has(key), key).toBe(true);
  });
});
