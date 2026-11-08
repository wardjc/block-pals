import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spokenLines } from '../../src/content/spoken';
import { clipKey } from '../../src/audio/voiceKey';

/** Every spoken line, per speaker. */
const bySpeaker = spokenLines();
const entries = Object.entries(bySpeaker).flatMap(([speaker, lines]) => lines.map((l) => ({ speaker, line: l })));
const manifest = JSON.parse(readFileSync('public/voice/manifest.json', 'utf8')) as Record<string, { file: string; text: string; duration: number }>;
const exported = JSON.parse(readFileSync('tools/voice/lines.json', 'utf8')) as Record<string, string[]>;
const voices = JSON.parse(readFileSync('tools/voice/voices.json', 'utf8')) as Record<string, unknown>;

describe('voice clips', () => {
  it('no line contains a cheer or sound-effect word (the voice would read it out)', () => {
    for (const { line } of entries) expect(line).not.toMatch(/\b(whee+|yippee|woo-?hoo|yay|hooray|hee hee|ha ha|wahoo|ooh+|hmm+|mmm+|aww+|yum+|ta-?da|hup)\b/i);
  });
  it('every speaker has a voice defined', () => {
    for (const s of Object.keys(bySpeaker)) expect(voices[s], s).toBeDefined();
  });
  it('every line has a clip for its own speaker (run `npm run voice:lines` then tools/voice/generate.py per speaker)', () => {
    const missing = entries.filter(({ speaker, line }) => !manifest[clipKey(speaker, line)]);
    expect(missing).toEqual([]);
  });
  it('tools/voice/lines.json is up to date with the lines in src', () => {
    for (const [speaker, lines] of Object.entries(bySpeaker)) expect([...new Set(lines)].sort(), speaker).toEqual([...(exported[speaker] ?? [])].sort());
  });
  it('every manifest entry has its file and the text it was made from', () => {
    for (const [key, e] of Object.entries(manifest)) {
      expect(existsSync(`public/voice/${e.file}`), key).toBe(true);
      expect(clipKey(key.split('/')[0], e.text)).toBe(key);
      expect(e.duration).toBeGreaterThan(0.3);
    }
  });
  it('no stale clips: every manifest entry is a current line (generate.py --prune)', () => {
    const current = new Set(entries.map(({ speaker, line }) => clipKey(speaker, line)));
    for (const key of Object.keys(manifest)) expect(current.has(key), key).toBe(true);
  });
});
