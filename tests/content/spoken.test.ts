import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LINES } from '../../src/content/lines';
import { spokenLines } from '../../src/content/spoken';
import { FERN_LINES } from '../../src/content/villagers';

describe('spokenLines', () => {
  const all = spokenLines();
  it('includes every Pip key and Fern\'s seed lines', () => {
    for (const lines of Object.values(LINES)) for (const l of lines) expect(all.pip).toContain(l);
    for (const l of [...FERN_LINES.seedGift, ...FERN_LINES.moreSeeds]) expect(all.fern).toContain(l);
  });
  it('has no duplicates within a speaker', () => {
    for (const lines of Object.values(all)) expect(new Set(lines).size).toBe(lines.length);
  });
  it('tools/voice/lines.json equals spokenLines()', () => {
    expect(JSON.parse(readFileSync('tools/voice/lines.json', 'utf8'))).toEqual(all);
  });
  it('Fern\'s farm lines are plain: 4 variants, 12 words or fewer, no cheers, British', () => {
    for (const set of [FERN_LINES.seedGift, FERN_LINES.moreSeeds]) {
      expect(set).toHaveLength(4);
      for (const l of set) {
        expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
        expect(l).not.toMatch(/\b(ooh+|hmm+|mmm+|aww+|ta-?da|hup|whee+|yay|hooray|yum+|tap|click|touch)\b/i);
      }
    }
  });
});
