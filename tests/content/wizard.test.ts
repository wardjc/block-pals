import { describe as group, it, expect } from 'vitest';
import {
  WIZARD_LINES, WIZARD_ICONS, WIZARD_PARTS, NUMBER_WORDS, pickWizardLine, countSentence, wizardPartTexts, type WizardKey,
} from '../../src/content/wizard';
import { describe as describePuzzle, makePuzzle, THINGS, MAX_LEVEL, type Puzzle } from '../../src/core/puzzles';
import { mulberry32 } from '../../src/core/rng';

const keys = Object.keys(WIZARD_LINES) as WizardKey[];
const all = keys.flatMap(k => WIZARD_LINES[k]);
const words = (l: string): number => l.trim().split(/\s+/).length;

group('WIZARD_LINES policy', () => {
  it('has the sixteen planned keys, four distinct variants each, each with a picture', () => {
    expect(keys.sort()).toEqual([
      'bagFull', 'bought', 'bye', 'countAsk', 'hello', 'helped', 'hint1', 'hint2', 'matchAsk', 'needGem',
      'patternAsk', 'puzzleAsk', 'solved', 'tradeAsk', 'tryAgain', 'welcomeGift',
    ]);
    for (const k of keys) {
      expect(WIZARD_LINES[k], k).toHaveLength(4);
      expect(new Set(WIZARD_LINES[k]).size, k).toBe(4);
      expect(WIZARD_ICONS[k], k).toBeTruthy();
    }
  });
  it('lines are 12 words or fewer', () => {
    for (const l of all) expect(words(l), l).toBeLessThanOrEqual(12);
  });
  it('no cheer or sound words (the voice would read them out)', () => {
    for (const l of all) expect(l).not.toMatch(/\b(yum+|mmm+|aww+|ooh+|hmm+|ta-?da|hup|whee+|yay|hooray|yippee|woo-?hoo|wahoo|ha ha|hee hee)\b/i);
  });
  it('never says tap, click or touch', () => {
    for (const l of all) expect(l).not.toMatch(/\b(tap|taps|click|touch)\b/i);
  });
  it('nothing scary, hurt, lost, dark or wrong', () => {
    for (const l of all) expect(l).not.toMatch(/\b(scary|scared|dark|afraid|hurt|lost|wrong|fail|failed)\b/i);
  });
  it('British spelling', () => {
    for (const l of all) expect(l).not.toMatch(/\b(color|colors|favorite|gray|mom|math|center|theater|realize)\b/i);
  });
  it('true without context: no claims about his gems or bag contents', () => {
    for (const l of all) expect(l).not.toMatch(/\byou (have|got|brought) (a|some|one|\d+) gems?\b/i);
  });
  it('never asks him to read', () => {
    for (const l of all) expect(l).not.toMatch(/\bread/i);
  });
  it('no false progress claims (nearly, almost) and no promises of later', () => {
    for (const l of all) expect(l).not.toMatch(/\b(nearly|almost|soon|one day|next time|later)\b/i);
  });
  it('the solved and helped lines never promise a block (a full bag gets none)', () => {
    for (const l of [...WIZARD_LINES.solved, ...WIZARD_LINES.helped]) expect(l).not.toMatch(/\bblock/i);
  });
  it('grumps are not mentioned (they are a separate step)', () => {
    for (const l of all) expect(l).not.toMatch(/\bgrump/i);
  });
  it('the wizard introduces himself by name at least once', () => {
    expect(WIZARD_LINES.hello.some(l => /\bOrlo\b/.test(l))).toBe(true);
  });
});

group('WIZARD_PARTS', () => {
  it('numbers cover one to twenty, in order', () => {
    expect(NUMBER_WORDS).toHaveLength(20);
    expect(NUMBER_WORDS[0]).toBe('one');
    expect(NUMBER_WORDS[2]).toBe('three');
    expect(NUMBER_WORDS[19]).toBe('twenty');
  });
  it('every thing has a singular and a plural part', () => {
    for (const t of THINGS) {
      expect(WIZARD_PARTS.things[t].one, t).toBeTruthy();
      expect(WIZARD_PARTS.things[t].many, t).toBeTruthy();
    }
    expect(WIZARD_PARTS.things.wheat.many).toBe('bundles of wheat');
    expect(WIZARD_PARTS.things.apple.many).toBe('apples');
  });
  it('every part is at most three words and passes the same word policy', () => {
    const parts = wizardPartTexts();
    expect(new Set(parts).size).toBe(parts.length);
    for (const p of parts) {
      expect(words(p), p).toBeLessThanOrEqual(3);
      expect(p).not.toMatch(/\b(tap|click|touch|ooh+|hmm+|yay|hooray)\b/i);
    }
    expect(parts).toContain('and');
    for (const n of NUMBER_WORDS) expect(parts).toContain(n);
  });
});

group('pickWizardLine', () => {
  it('never repeats the same variant twice in a row', () => {
    for (const k of keys)
      for (const last of WIZARD_LINES[k])
        for (let i = 0; i < 20; i++) expect(pickWizardLine(k, last, () => i / 20)).not.toBe(last);
  });
  it('is deterministic with an rng and always returns one of the variants', () => {
    for (const k of keys) {
      expect(pickWizardLine(k, undefined, () => 0)).toBe(WIZARD_LINES[k][0]);
      expect(pickWizardLine(k, undefined, () => 0.999)).toBe(WIZARD_LINES[k][3]);
      expect(WIZARD_LINES[k]).toContain(pickWizardLine(k, undefined));
    }
  });
});

group('countSentence', () => {
  const count = (wants: Array<{ thing: (typeof THINGS)[number]; n: number }>): Puzzle =>
    ({ kind: 'count', level: 0, wants, shelf: [...THINGS] });

  it('says three apples and two carrots', () => {
    expect(countSentence(count([{ thing: 'apple', n: 3 }, { thing: 'carrot', n: 2 }]))).toEqual(['three', 'apples', 'and', 'two', 'carrots']);
  });
  it('uses the singular for one', () => {
    expect(countSentence(count([{ thing: 'wheat', n: 1 }]))).toEqual(['one', 'bundle of wheat']);
    expect(countSentence(count([{ thing: 'egg', n: 1 }, { thing: 'potato', n: 12 }]))).toEqual(['one', 'egg', 'and', 'twelve', 'potatoes']);
  });
  it('says nothing for pattern and match puzzles', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const p = makePuzzle(i % (MAX_LEVEL + 1), rng);
      if (p.kind !== 'count') expect(countSentence(p)).toEqual([]);
    }
  });
  it('over many real puzzles the numbers match describe() and every part has a text in WIZARD_PARTS', () => {
    const parts = new Set(wizardPartTexts());
    const rng = mulberry32(11);
    let seen = 0;
    for (let i = 0; i < 2000; i++) {
      const p = makePuzzle(i % (MAX_LEVEL + 1), rng);
      if (p.kind !== 'count') continue;
      seen++;
      const said = countSentence(p);
      for (const s of said) expect(parts.has(s), s).toBe(true);
      const nums = said.filter(s => NUMBER_WORDS.includes(s)).map(s => NUMBER_WORDS.indexOf(s) + 1);
      expect(nums).toEqual(describePuzzle(p).digits);
    }
    expect(seen).toBeGreaterThan(100);
  });
});
