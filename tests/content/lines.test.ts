import { describe, it, expect } from 'vitest';
import { LINES, LINE_ICONS, pickLine, type LineKey } from '../../src/content/lines';

const keys = Object.keys(LINES) as LineKey[];

describe('lines', () => {
  it('every LineKey has at least one line', () => {
    expect(keys).toHaveLength(39); // step 2's 34 plus the wizard step's 5 (the grumps step is not built yet)
    for (const k of keys) {
      expect(LINES[k].length).toBe(4);
      expect(new Set(LINES[k]).size).toBe(4);
    }
  });
  it('lines use British spelling', () => {
    for (const k of keys)
      for (const l of LINES[k]) expect(l).not.toMatch(/\b(color|favorite|gray|mom|math|center|theater|realize)\b/i);
  });
  it('no cheer or sound words (the voice would read them out as words)', () => {
    for (const k of keys) for (const l of LINES[k]) expect(l).not.toMatch(/\b(ooh+|hmm+|mmm+|aww+|ta-?da|hup|whee+|yay|yippee|woo-?hoo|hooray|hee hee|yum+|ha ha)\b/i);
  });
  it('the farm and eating lines exist, each with a picture', () => {
    for (const k of ['plantSome', 'needWaterSun', 'cropReady', 'harvested', 'tryMunch', 'ateApple', 'ateCarrot', 'atePotato', 'drankMilk',
      'holdOutFood', 'fedAnimal', 'animalFull', 'petAnimal', 'gotEgg', 'gotMilk', 'gotWool'] as const) {
      expect(LINES[k]).toHaveLength(4);
      expect(LINE_ICONS[k]).toBeTruthy();
    }
    expect(LINE_ICONS.tryMunch).toBe('👄');
  });
  it('the wizard step\'s Pip lines exist, each with a picture, and pass the scary-word check', () => {
    for (const k of ['seeTowerLight', 'letsVisitWizard', 'meetWizard', 'puzzleStuck', 'gotMagicBlock'] as const) {
      expect(LINES[k]).toHaveLength(4);
      expect(LINE_ICONS[k]).toBeTruthy();
      for (const l of LINES[k]) expect(l).not.toMatch(/\b(scary|scared|dark|afraid|hurt|lost|wrong|fail|failed|read)\b/i);
    }
  });
  it('puzzleStuck is true for every puzzle kind (it never mentions counting or dots)', () => {
    for (const l of LINES.puzzleStuck) expect(l).not.toMatch(/\b(count|dots?|basket)\b/i);
  });
  it('holdOutFood never says "hold" (that means press-and-hold elsewhere in the game)', () => {
    for (const l of LINES.holdOutFood) expect(l).not.toMatch(/\bhold/i);
  });
  it('lines are short', () => {
    for (const k of keys) for (const l of LINES[k]) expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
  });
  it('first variants are fixed', () => {
    expect(LINES.hello[0]).toBe("Hiya! I'm Pip. Let's go exploring!");
    expect(LINES.letsFindWood[0]).toBe("Let's find some wood. Press and hold a tree!");
    expect(LINES.crafted[0]).toBe('Brilliant! You made it!');
    expect(LINES.full[0]).toBe("That's plenty of those! Let's use some.");
    expect(LINES.noPath[0]).toBe("I can't get there. Let's try another way!");
    expect(LINES.breakTime[0]).toBe("Let's have a stretch! Wiggle your arms!");
    expect(LINES.welcomeBack[0]).toBe("You're back! I missed you!");
  });
  it('every LineKey has an icon', () => {
    for (const k of keys) expect(LINE_ICONS[k]).toBeTruthy();
  });

  it('no line tells the player to tap to collect', () => {
    for (const k of keys) for (const l of LINES[k]) expect(l).not.toMatch(/\b(tap|click|touch)\b/i);
  });
  it('lines make no false visibility or progress claims', () => {
    for (const k of keys) for (const l of LINES[k]) expect(l).not.toMatch(/I can see|Look, a|Nearly|Almost/i);
  });

  describe('pickLine', () => {
    it('empty variants returns an empty string', () => {
      const orig = LINES.hello;
      LINES.hello = [];
      try {
        expect(pickLine('hello', undefined)).toBe('');
      } finally {
        LINES.hello = orig;
      }
    });
    it('never repeats the previous variant', () => {
      for (const k of keys)
        for (const last of LINES[k])
          for (let i = 0; i < 20; i++) expect(pickLine(k, last, () => i / 20)).not.toBe(last);
    });
    it('single-variant key returns it', () => {
      const orig = LINES.hello;
      LINES.hello = ['Only one!'];
      try {
        expect(pickLine('hello', 'Only one!')).toBe('Only one!');
        expect(pickLine('hello', undefined)).toBe('Only one!');
      } finally {
        LINES.hello = orig;
      }
    });
    it('deterministic with rng', () => {
      for (const k of keys) {
        expect(pickLine(k, undefined, () => 0)).toBe(LINES[k][0]);
        expect(pickLine(k, LINES[k][0], () => 0)).toBe(LINES[k][1]);
        expect(pickLine(k, undefined, () => 0.999)).toBe(LINES[k][LINES[k].length - 1]);
      }
    });
  });
});
