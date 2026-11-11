import { describe, expect, it } from 'vitest';
import type { Cell } from '../../src/core/pathfind';
import { HOLD_LIMIT_SECONDS, LockedHold, mayGreet, mayWizardGreet, wizardSpeech, type SpeechContext } from '../../src/game/speechPolicy';
import { WIZARD_GREET_COOLDOWN_MS, WIZARD_GREET_SPEAK_MS, WizardVisit } from '../../src/game/wizardVisit';

// Meadow coordinates from the plan: footprint x 33..39, z 78..84, plus 3 cells in front of the north door.
const tower = { greetRect: { x0: 33, z0: 75, x1: 39, z1: 84 }, groundY: 9 };
const inside: Cell = [36, 10, 81];
const upstairs: Cell = [36, 14, 81];
const doorstep: Cell = [36, 10, 76];
const away: Cell = [36, 10, 60];
const quiet: SpeechContext = { breakOpen: false, speaking: false, locked: false, pipPending: false, gestureBusy: false };

const make = () => {
  let t = 0;
  return { v: new WizardVisit(() => t), at: (ms: number) => { t = ms; } };
};

describe('WizardVisit', () => {
  it('says hello once when he enters, not again until he leaves and returns', () => {
    const { v, at } = make();
    expect(v.update(away, tower, false)).toBeNull();
    expect(v.update(doorstep, tower, false)).toBe('hello');
    for (let i = 1; i < 50; i++) {
      at(i * 1000);
      expect(v.update(i % 2 ? inside : upstairs, tower, false)).toBeNull();
    }
    at(200_000);
    v.update(away, tower, false);
    at(201_000);
    expect(v.update(inside, tower, false)).toBe('hello');
  });

  it('at most once a minute', () => {
    const { v, at } = make();
    expect(v.update(inside, tower, false)).toBe('hello');
    at(10_000); v.update(away, tower, false);
    at(20_000); expect(v.update(inside, tower, false)).toBeNull();
    at(WIZARD_GREET_COOLDOWN_MS - 1); v.update(away, tower, false);
    expect(v.update(inside, tower, false)).toBeNull();
    at(WIZARD_GREET_COOLDOWN_MS + 5); v.update(away, tower, false);
    expect(v.update(inside, tower, false)).toBe('hello');
  });

  it('never while busy, and greets once he is free if he is still there', () => {
    const { v, at } = make();
    expect(v.update(inside, tower, true)).toBeNull();
    at(3000);
    expect(v.update(inside, tower, true)).toBeNull();
    at(4000);
    expect(v.update(inside, tower, false)).toBe('hello');
  });

  it('busy follows the speech rules: Pip pending, the break bubble, audio locked, a gesture or a voice line', () => {
    expect(mayWizardGreet).toBe(mayGreet);
    for (const k of ['breakOpen', 'speaking', 'locked', 'pipPending', 'gestureBusy'] as const) {
      const { v } = make();
      const busy = !mayWizardGreet({ ...quiet, [k]: true });
      expect(busy, k).toBe(true);
      expect(v.update(inside, tower, busy), k).toBeNull();
    }
    expect(mayWizardGreet(quiet)).toBe(true);
  });

  it('only near the tower floors: far below or above the ground does not count', () => {
    const { v } = make();
    expect(v.update([36, 30, 81], tower, false)).toBeNull();
    expect(v.update([36, 0, 81], tower, false)).toBeNull();
    expect(v.update([32, 10, 81], tower, false)).toBeNull();
  });

  it('skipCurrent gives up this visit without using the cooldown', () => {
    const { v, at } = make();
    v.update(inside, tower, true); // held (audio locked)
    v.skipCurrent();
    at(1000);
    expect(v.update(inside, tower, false)).toBeNull();
    at(2000); v.update(away, tower, false);
    at(3000);
    expect(v.update(inside, tower, false)).toBe('hello'); // the minute was never used up
  });

  it('skipCurrent while he is away changes nothing', () => {
    const { v } = make();
    v.update(away, tower, false);
    v.skipCurrent();
    expect(v.update(inside, tower, false)).toBe('hello');
  });

  it('walking away cancels a hello still being spoken, but not one already finished', () => {
    const { v, at } = make();
    v.update(inside, tower, false);
    at(1000);
    v.update(away, tower, false);
    expect(v.takeCancel()).toBe(true);
    expect(v.takeCancel()).toBe(false);

    const b = make();
    b.v.update(inside, tower, false);
    b.at(WIZARD_GREET_SPEAK_MS + 1);
    b.v.update(away, tower, false);
    expect(b.v.takeCancel()).toBe(false);
  });

  it('firstEnter is true once, the first time he stands in the greet area', () => {
    const { v, at } = make();
    expect(v.firstEnter()).toBe(false);
    v.update(away, tower, false);
    expect(v.firstEnter()).toBe(false);
    v.update(doorstep, tower, true); // even while busy: he has been there
    expect(v.firstEnter()).toBe(true);
    expect(v.firstEnter()).toBe(false);
    at(100_000); v.update(away, tower, false);
    at(200_000); v.update(inside, tower, false);
    expect(v.firstEnter()).toBe(false);
  });

  it('a held hello is dropped quietly after the hold limit (LockedHold) and the cooldown is kept', () => {
    const { v, at } = make();
    const hold = new LockedHold();
    let t = 0;
    let dropped = false;
    while (t < HOLD_LIMIT_SECONDS + 1) {
      at(t * 1000);
      const busy = !mayWizardGreet({ ...quiet, locked: true });
      expect(v.update(inside, tower, busy)).toBeNull();
      if (hold.update(0.5, true)) { v.skipCurrent(); dropped = true; }
      t += 0.5;
    }
    expect(dropped).toBe(true);
    // Audio runs now: no late hello for this visit.
    hold.update(0.5, false);
    expect(v.update(inside, tower, !mayWizardGreet(quiet))).toBeNull();
    // He leaves and comes back: hello straight away (no minute was used).
    at(40_000); v.update(away, tower, false);
    at(41_000);
    expect(v.update(inside, tower, false)).toBe('hello');
  });
});

describe('wizardSpeech', () => {
  const recorder = () => {
    const said: string[] = [];
    return {
      said,
      speak: {
        line: (k: string) => { said.push(`line:${k}`); },
        countSentence: (p: unknown) => { said.push(`count:${JSON.stringify(p)}`); },
        again: () => { said.push('again'); },
      },
    };
  };

  it('passes every call through while the break bubble is closed', () => {
    const r = recorder();
    const s = wizardSpeech(() => false, r.speak);
    s.line('hello'); s.countSentence({ digits: [3] }); s.again();
    expect(r.said).toEqual(['line:hello', 'count:{"digits":[3]}', 'again']);
  });

  it('is silent with the break bubble open (and never cuts it), then speaks again once it closes', () => {
    const r = recorder();
    let open = true;
    const s = wizardSpeech(() => open, r.speak);
    s.line('tryAgain'); s.countSentence({ digits: [1] }); s.again();
    expect(r.said).toEqual([]);
    open = false;
    s.line('tryAgain');
    expect(r.said).toEqual(['line:tryAgain']);
  });
});
