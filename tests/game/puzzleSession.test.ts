import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { MAX_LEVEL, THINGS, makePuzzle, type Puzzle } from '../../src/core/puzzles';
import {
  FADE_SECONDS, HELP_SECONDS, HELP_WRONG, HINT1_SECONDS, HINT1_WRONG, HINT2_SECONDS, HINT2_WRONG, PuzzleSession,
} from '../../src/game/puzzleSession';

const red = { shape: 'circle', colour: 'red' } as const;
const blue = { shape: 'circle', colour: 'blue' } as const;
const green = { shape: 'circle', colour: 'green' } as const;
const yellow = { shape: 'circle', colour: 'yellow' } as const;

const match4: Puzzle = { kind: 'match', level: 3, mode: 'both', target: blue, options: [red, blue, green, yellow], answer: 1 };
const match3: Puzzle = { kind: 'match', level: 0, mode: 'colour', target: blue, options: [red, blue, green], answer: 1 };
const count: Puzzle = {
  kind: 'count', level: 3, wants: [{ thing: 'apple', n: 3 }, { thing: 'carrot', n: 2 }], shelf: ['carrot', 'egg', 'apple'],
};

function snapshot(s: PuzzleSession) {
  return JSON.stringify({ basket: s.basket, faded: [...s.faded], solved: s.solved, helped: s.helped, puzzle: s.puzzle });
}

describe('answer puzzles', () => {
  it('a right pick solves', () => {
    const s = new PuzzleSession(match3);
    expect(s.pick(1)).toBe('right');
    expect(s.solved).toBe(true);
    expect(s.helped).toBe(false);
    expect(s.clean()).toBe(true);
  });

  it('a wrong pick returns wrong and changes only wrong', () => {
    const s = new PuzzleSession(match3);
    const before = snapshot(s);
    expect(s.pick(0)).toBe('wrong');
    expect(s.wrong).toBe(1);
    expect(snapshot(s)).toBe(before);
    expect(s.solved).toBe(false);
  });

  it('after solved nothing changes any more (pick returns already)', () => {
    const s = new PuzzleSession(match3);
    s.pick(1);
    const before = snapshot(s);
    expect(s.pick(0)).toBe('already');
    expect(s.pick(1)).toBe('already');
    s.update(100);
    expect(s.wrong).toBe(0);
    expect(snapshot(s)).toBe(before);
  });

  it('a pick that is not a card changes nothing', () => {
    const s = new PuzzleSession(match3);
    for (const bad of [-1, 3, 1.5, Number.NaN]) expect(s.pick(bad)).toBe('wrong');
    expect(s.wrong).toBe(0);
  });
});

describe('counting', () => {
  it('the basket solves exactly when it equals the wants', () => {
    const s = new PuzzleSession(count);
    s.add('apple'); s.add('apple'); s.add('carrot'); s.add('carrot');
    expect(s.solved).toBe(false);
    s.add('apple');
    expect(s.solved).toBe(true);
    expect(s.clean()).toBe(true);
  });

  it('overshoot is allowed and take removes: it never blocks', () => {
    const s = new PuzzleSession(count);
    for (let i = 0; i < 30; i++) s.add('apple');
    s.add('egg');
    expect(s.basket.apple).toBeLessThanOrEqual(99);
    expect(s.solved).toBe(false);
    for (let i = 0; i < 40; i++) s.take('apple');
    expect(s.basket.apple).toBe(0);
    s.take('egg');
    s.take('potato'); // nothing there: nothing happens
    expect(s.basket.egg).toBe(0);
    expect(s.basket.potato).toBe(0);
    s.add('apple'); s.add('apple'); s.add('apple'); s.add('carrot'); s.add('carrot');
    expect(s.solved).toBe(true);
  });

  it('ghost slots show what is still missing once hint 2 is on', () => {
    const s = new PuzzleSession(count);
    s.add('apple');
    expect(s.ghost()).toEqual([]);
    s.update(HINT2_SECONDS);
    expect(s.hint()).toBe(2);
    expect(s.ghost()).toEqual([{ thing: 'apple', missing: 2 }, { thing: 'carrot', missing: 2 }]);
    expect(s.nextNeeded()).toBe('apple');
  });

  it('nextNeeded points to an extra to take out once everything wanted is there', () => {
    const s = new PuzzleSession(count);
    s.add('egg');
    for (const _ of [1, 2, 3]) s.add('apple');
    s.add('carrot'); s.add('carrot');
    expect(s.solved).toBe(false);
    expect(s.nextNeeded()).toBe('egg');
    s.take('egg');
    expect(s.solved).toBe(true);
  });
});

describe('hints', () => {
  it(`come at ${HINT1_SECONDS} s, ${HINT2_SECONDS} s and ${HELP_SECONDS} s of quiet`, () => {
    const s = new PuzzleSession(match4);
    s.update(HINT1_SECONDS - 0.1);
    expect(s.hint()).toBe(0);
    s.update(0.1);
    expect(s.hint()).toBe(1);
    s.update(HINT2_SECONDS - HINT1_SECONDS);
    expect(s.hint()).toBe(2);
    expect(s.solved).toBe(false);
    s.update(HELP_SECONDS - HINT2_SECONDS);
    expect(s.solved).toBe(true);
    expect(s.helped).toBe(true);
    expect(s.hint()).toBe(3);
    expect(s.clean()).toBe(false);
  });

  it(`come at ${HINT1_WRONG}, ${HINT2_WRONG} and ${HELP_WRONG} wrong answers, whichever first`, () => {
    const s = new PuzzleSession(match4);
    s.pick(0);
    expect(s.hint()).toBe(0);
    s.pick(2);
    expect(s.hint()).toBe(1);
    s.pick(3); s.pick(0);
    expect(s.hint()).toBe(2);
    s.pick(2); s.pick(3);
    expect(s.hint()).toBe(3);
    expect(s.solved).toBe(false); // the wizard finishes it on the next tick, with a sparkle
    s.update(0.016);
    expect(s.solved).toBe(true);
    expect(s.helped).toBe(true);
  });

  it('time and wrong answers combine: whichever is higher', () => {
    const s = new PuzzleSession(match4);
    s.update(HINT1_SECONDS);
    expect(s.hint()).toBe(1);
    s.pick(0); s.pick(2); s.pick(3); s.pick(0); // 4 wrong
    expect(s.hint()).toBe(2);
  });

  it('the hint level never decreases, even after a useful move resets the quiet time', () => {
    const s = new PuzzleSession(count);
    s.update(HINT2_SECONDS + 1);
    expect(s.hint()).toBe(2);
    s.add('apple'); // useful: quiet time starts again
    expect(s.hint()).toBe(2);
    s.update(1);
    expect(s.hint()).toBe(2);
  });

  it('hint 2 fades wrong cards one at a time, never the right one, never below 2 cards', () => {
    const s = new PuzzleSession(match4);
    s.update(HINT2_SECONDS);
    expect(s.faded.size).toBe(1);
    expect(s.faded.has(1)).toBe(false);
    s.update(FADE_SECONDS - 0.1);
    expect(s.faded.size).toBe(1);
    s.update(0.1);
    expect(s.faded.size).toBe(2);
    expect(s.faded.has(1)).toBe(false);
    s.update(FADE_SECONDS);
    expect(s.faded.size).toBe(2); // two cards left: the right one and one more
  });

  it('a further wrong answer during hint 2 fades one more card', () => {
    const s = new PuzzleSession(match4);
    s.update(HINT2_SECONDS);
    expect(s.faded.size).toBe(1);
    const left = [0, 2, 3].find(i => !s.faded.has(i))!;
    s.pick(left);
    expect(s.faded.size).toBe(2);
    expect(s.faded.has(1)).toBe(false);
  });

  it('a three-card puzzle fades at most one card', () => {
    const s = new PuzzleSession(match3);
    s.update(HINT2_SECONDS + 3 * FADE_SECONDS - 0.5);
    expect(s.faded.size).toBe(1);
    expect(s.faded.has(1)).toBe(false);
  });

  it('spamming one wrong card still reaches hint 3 within 45 s', () => {
    const s = new PuzzleSession(match4);
    for (let t = 0; t < HELP_SECONDS && !s.solved; t += 0.5) {
      s.pick(0);
      s.update(0.5);
    }
    expect(s.solved).toBe(true);
    expect(s.helped).toBe(true);
  });

  it('repeated taps on the same wrong card do not hold the hints back', () => {
    // Even if the wrong count were ignored, the quiet time must keep running.
    const s = new PuzzleSession(match4);
    s.pick(0);
    s.update(HINT1_SECONDS - 1);
    s.pick(0);
    s.update(1);
    expect(s.hint()).toBeGreaterThanOrEqual(1);
  });

  it('dt = 0 changes nothing (paused), and bad dt values are ignored', () => {
    const s = new PuzzleSession(match4);
    s.pick(0); s.pick(2); s.pick(3); s.pick(0); s.pick(2); s.pick(3); // hint 3 is due
    const before = snapshot(s);
    for (let i = 0; i < 100; i++) s.update(0);
    s.update(-5);
    s.update(Number.NaN);
    expect(snapshot(s)).toBe(before);
    expect(s.solved).toBe(false);
    s.update(Number.POSITIVE_INFINITY);
    expect(s.solved).toBe(false);
    s.update(0.1);
    expect(s.solved).toBe(true);
  });

  it('a helped counting puzzle fills the basket exactly', () => {
    const s = new PuzzleSession(count);
    s.add('egg'); s.add('apple');
    s.update(HELP_SECONDS);
    expect(s.solved).toBe(true);
    expect(s.helped).toBe(true);
    expect(s.basket).toEqual({ apple: 3, carrot: 2, potato: 0, wheat: 0, egg: 0 });
  });
});

describe('clean', () => {
  it('is true only for at most two wrongs and no help', () => {
    const two = new PuzzleSession(match4);
    two.pick(0); two.pick(2); two.pick(1);
    expect(two.clean()).toBe(true);
    const three = new PuzzleSession(match4);
    three.pick(0); three.pick(2); three.pick(3); three.pick(1);
    expect(three.clean()).toBe(false);
    const helped = new PuzzleSession(match4);
    helped.update(HELP_SECONDS);
    expect(helped.clean()).toBe(false);
    expect(new PuzzleSession(match4).clean()).toBe(false); // not solved yet
  });
});

describe('he can never be stuck', () => {
  const LEVELS = [...Array(MAX_LEVEL + 1).keys()];

  it('a patient waiter always finishes: every level, 200 seeded puzzles, 45 s of nothing', () => {
    for (const level of LEVELS) {
      const rng = mulberry32(10 + level);
      for (let i = 0; i < 200; i++) {
        const s = new PuzzleSession(makePuzzle(level, rng));
        for (let t = 0; t < HELP_SECONDS + 0.5 && !s.solved; t += 0.25) s.update(0.25);
        expect(s.solved).toBe(true);
        expect(s.helped).toBe(true);
      }
    }
  });

  it('a random clicker always finishes within 200 actions or by hint 3', () => {
    for (const level of LEVELS) {
      const rng = mulberry32(500 + level);
      const act = mulberry32(900 + level);
      for (let i = 0; i < 200; i++) {
        const p = makePuzzle(level, rng);
        const s = new PuzzleSession(p);
        const stubborn = act() < 0.3; // some clickers only ever tap the same thing
        const fixed = Math.floor(act() * 4);
        for (let n = 0; n < 200 && !s.solved; n++) {
          if (p.kind === 'count') {
            const thing = stubborn ? p.shelf[fixed % p.shelf.length]! : THINGS[Math.floor(act() * THINGS.length)]!;
            if (act() < 0.7) s.add(thing); else s.take(thing);
          } else {
            s.pick(stubborn ? fixed % p.options.length : Math.floor(act() * p.options.length));
          }
          s.update(act() * 0.5);
        }
        for (let t = 0; t < HELP_SECONDS + 1 && !s.solved; t += 0.5) s.update(0.5);
        expect(s.solved).toBe(true);
      }
    }
  });

  it('the session has no timer, lives, score or fail state', () => {
    for (const file of ['../../src/game/puzzleSession.ts', '../../src/core/puzzles.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/fail|lose|lost|lives|score|gameover|timeout|penalt/i);
    }
  });
});
