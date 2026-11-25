import { describe, expect, it } from 'vitest';
import { HINT_NAMES } from '../../src/core/save';
import { FarmHints, type HintContext } from '../../src/game/hints';
import { HELD_KEYS } from '../../src/game/speechPolicy';

const ctx = (over: Partial<HintContext> = {}): HintContext => ({
  hasSeeds: false, nearPlot: false, planted: false, ripeNearby: false, hasFood: false, nearPasture: false, edibleSelected: false, ...over,
});
const GRUMP_HINTS = ['grumpArrives', 'plantsWaiting', 'craftWeapon', 'pickWeapon', 'friendMade'] as const;

describe('grump hints', () => {
  it('each once-only grump hint fires once and is saved', () => {
    const when: Record<(typeof GRUMP_HINTS)[number], Partial<HintContext>> = {
      grumpArrives: { grumpHere: true },
      plantsWaiting: { plantsPaused: true },
      craftWeapon: { grumpHere: true, grumpWaitedSeconds: 25, hasWeapon: false },
      pickWeapon: { hasWeapon: true, sulkyInView: true, weaponSelected: false },
      friendMade: { friendJustMade: true },
    };
    for (const k of GRUMP_HINTS) {
      const h = new FarmHints([]);
      expect(h.shouldSay(k, ctx(when[k])), k).toBe(true);
      h.markSeen(k);
      expect(h.shouldSay(k, ctx(when[k])), k).toBe(false);
      expect(h.seen()).toEqual([k]);
      expect(new FarmHints(h.seen()).shouldSay(k, ctx(when[k]))).toBe(false);
      expect(HINT_NAMES).toContain(k);
      expect(HELD_KEYS.has(k)).toBe(true);
    }
  });
  it('nothing fires with no grump facts (existing contexts are unchanged)', () => {
    const h = new FarmHints([]);
    for (const k of GRUMP_HINTS) expect(h.shouldSay(k, ctx())).toBe(false);
  });
  it('craftWeapon waits 20 s after the grump arrives and only while he owns no weapon', () => {
    const h = new FarmHints([]);
    expect(h.shouldSay('craftWeapon', ctx({ grumpHere: true, grumpWaitedSeconds: 19 }))).toBe(false);
    expect(h.shouldSay('craftWeapon', ctx({ grumpHere: true, grumpWaitedSeconds: 20 }))).toBe(true);
    expect(h.shouldSay('craftWeapon', ctx({ grumpHere: true, grumpWaitedSeconds: 60, hasWeapon: true }))).toBe(false);
  });
  it('pickWeapon needs a weapon, a sulky grump in view and no weapon selected', () => {
    const h = new FarmHints([]);
    const ok = { hasWeapon: true, sulkyInView: true, weaponSelected: false };
    expect(h.shouldSay('pickWeapon', ctx(ok))).toBe(true);
    expect(h.shouldSay('pickWeapon', ctx({ ...ok, hasWeapon: false }))).toBe(false);
    expect(h.shouldSay('pickWeapon', ctx({ ...ok, sulkyInView: false }))).toBe(false);
    expect(h.shouldSay('pickWeapon', ctx({ ...ok, weaponSelected: true }))).toBe(false);
  });
  it('grump reactions are limited to one per kind per 20 s', () => {
    const h = new FarmHints([]);
    for (const k of ['cheerHalf', 'cheeredUp', 'grumpGift', 'friendHelps'] as const) {
      expect(h.reactionAllowed(k, 5000)).toBe(true);
      expect(h.reactionAllowed(k, 5000 + 19_999)).toBe(false);
      expect(h.reactionAllowed(k, 5000 + 20_000)).toBe(true);
    }
  });
  it('unknown saved hints are ignored', () => {
    expect(new FarmHints(['nope', 'friendMade', 9 as unknown as string]).seen()).toEqual(['friendMade']);
  });
});
