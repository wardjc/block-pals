import { describe, expect, it } from 'vitest';
import { FarmHints, REACTION_GAP_MS, type HintContext } from '../../src/game/hints';
import { HINT_NAMES } from '../../src/core/save';

const ctx = (over: Partial<HintContext> = {}): HintContext => ({
  hasSeeds: false, nearPlot: false, planted: false, ripeNearby: false, hasFood: false, nearPasture: false, edibleSelected: false, ...over,
});

describe('FarmHints', () => {
  it('each once-only hint fires once and is saved', () => {
    const h = new FarmHints([]);
    expect(h.shouldSay('tryMunch', ctx({ edibleSelected: true }))).toBe(true);
    h.markSeen('tryMunch');
    expect(h.shouldSay('tryMunch', ctx({ edibleSelected: true }))).toBe(false);
    expect(h.seen()).toEqual(['tryMunch']);
    expect(new FarmHints(h.seen()).shouldSay('tryMunch', ctx({ edibleSelected: true }))).toBe(false);
  });
  it('plantSome needs seeds and nearness to the plot', () => {
    const h = new FarmHints([]);
    expect(h.shouldSay('plantSome', ctx({ hasSeeds: true }))).toBe(false);
    expect(h.shouldSay('plantSome', ctx({ nearPlot: true }))).toBe(false);
    expect(h.shouldSay('plantSome', ctx({ hasSeeds: true, nearPlot: true }))).toBe(true);
  });
  it('each hint waits for its own moment', () => {
    const h = new FarmHints([]);
    expect(h.shouldSay('needWaterSun', ctx())).toBe(false);
    expect(h.shouldSay('needWaterSun', ctx({ planted: true }))).toBe(true);
    expect(h.shouldSay('cropReady', ctx())).toBe(false);
    expect(h.shouldSay('cropReady', ctx({ ripeNearby: true }))).toBe(true);
    expect(h.shouldSay('holdOutFood', ctx({ nearPasture: true }))).toBe(false);
    expect(h.shouldSay('holdOutFood', ctx({ nearPasture: true, hasFood: true }))).toBe(true);
  });
  it('reaction lines are limited to one per kind per 20 s', () => {
    const h = new FarmHints([]);
    expect(h.reactionAllowed('ateApple', 1000)).toBe(true);
    expect(h.reactionAllowed('ateApple', 1000 + REACTION_GAP_MS - 1)).toBe(false);
    expect(h.reactionAllowed('ateCarrot', 2000)).toBe(true);
    expect(h.reactionAllowed('ateApple', 1000 + REACTION_GAP_MS)).toBe(true);
    expect(REACTION_GAP_MS).toBe(20_000);
  });
  it('a clock that goes backwards does not lock a reaction out for ever', () => {
    const h = new FarmHints([]);
    expect(h.reactionAllowed('ateApple', 500_000)).toBe(true);
    expect(h.reactionAllowed('ateApple', 100)).toBe(true);
  });
  it('unknown saved hint names are ignored and seen() only returns known ones, all of which the save accepts', () => {
    const h = new FarmHints(['nope', 'cropReady', 'cropReady', 7 as unknown as string]);
    expect(h.seen()).toEqual(['cropReady']);
    for (const n of ['plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch']) {
      expect(HINT_NAMES).toContain(n);
      new FarmHints([]).markSeen(n as never);
    }
  });
});

describe('FarmHints: a held-back reaction is not used up', () => {
  it('ready does not change anything; said starts the 20 s', () => {
    const h = new FarmHints([]);
    expect(h.reactionReady('ateApple', 1000)).toBe(true);
    expect(h.reactionReady('ateApple', 1001)).toBe(true);
    h.reactionSaid('ateApple', 1001);
    expect(h.reactionReady('ateApple', 2000)).toBe(false);
    expect(h.reactionReady('ateApple', 1001 + REACTION_GAP_MS)).toBe(true);
  });
});
