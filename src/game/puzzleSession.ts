import { THINGS, type Puzzle, type Thing } from '../core/puzzles';

/**
 * One puzzle being played on the wizard's screen (spec §7g). Pure and DOM-free. There is no state
 * in which the puzzle cannot be finished: a wrong card only raises `wrong` (and so the hints), the
 * basket can always be emptied again, and after a while the wizard finishes it for him (hint 3),
 * which still gives the block. Nothing here counts down, keeps points or takes anything away.
 */

/** Seconds of quiet (no useful move) before each hint. */
export const HINT1_SECONDS = 12, HINT2_SECONDS = 24, HELP_SECONDS = 45;
/** Wrong answers before each hint. */
export const HINT1_WRONG = 2, HINT2_WRONG = 4, HELP_WRONG = 6;
/** In hint 2, one more wrong card fades after this much further quiet. */
export const FADE_SECONDS = 6;
/** Cards that always stay showing in hint 2: the right one and at least one more. */
export const MIN_CARDS_SHOWING = 2;
/** The on-screen basket holds at most this many of one thing (more than any puzzle ever asks for). */
export const BASKET_MAX = 30;
/** A solve with at most this many wrong answers (and no help) is clean and counts towards the next level. */
export const CLEAN_MAX_WRONG = 2;

/** 0 none, 1 the right card or shelf picture pulses, 2 ghost slots and fading cards, 3 the wizard helps him through. */
export type HintLevel = 0 | 1 | 2 | 3;
export type PickResult = 'right' | 'wrong' | 'already';

const emptyBasket = (): Record<Thing, number> => ({ apple: 0, carrot: 0, potato: 0, wheat: 0, egg: 0 });

export class PuzzleSession {
  readonly puzzle: Puzzle;
  /** Counting: what is in the on-screen basket. Never his bag. */
  readonly basket: Record<Thing, number> = emptyBasket();
  /** Answer puzzles: wrong cards hidden by hint 2. */
  readonly faded = new Set<number>();
  wrong = 0;
  solved = false;
  /** Finished by the wizard (hint 3). The block is given just the same. */
  helped = false;

  private readonly wants: Record<Thing, number> = emptyBasket();
  /** Seconds since his last useful move. */
  private quiet = 0;
  /** Seconds of quiet since the last card faded in hint 2. */
  private fadeClock = 0;
  private level: HintLevel = 0;
  /** Wrong cards already tried once: tapping them again is not a fresh, useful move. */
  private readonly tried = new Set<number>();

  constructor(puzzle: Puzzle) {
    this.puzzle = puzzle;
    if (puzzle.kind === 'count') for (const w of puzzle.wants) this.wants[w.thing] = w.n;
  }

  /** Time passes. `dt` is 0 while the game is paused or the break bubble is up. */
  update(dt: number): void {
    if (this.solved || !Number.isFinite(dt) || dt <= 0) return;
    if (this.level === 3) { this.finishForHim(); return; }
    this.quiet += dt;
    if (this.level >= 2) this.fadeClock += dt;
    this.raise();
    if (this.level >= 2 && this.fadeClock >= FADE_SECONDS) this.fadeOne();
    if (this.hint() === 3) this.finishForHim();
  }

  /** Pattern and matching: a card is chosen. A right card solves; a wrong one only nudges the hints. */
  pick(option: number): PickResult {
    if (this.solved || this.puzzle.kind === 'count') return 'already';
    if (!Number.isInteger(option) || option < 0 || option >= this.puzzle.options.length) return 'wrong';
    if (option === this.puzzle.answer) {
      this.solved = true;
      return 'right';
    }
    const wasHint2 = this.level >= 2;
    this.wrong++;
    if (!this.tried.has(option)) {
      this.tried.add(option);
      this.quiet = 0; // trying a new card is a real go
    }
    this.raise();
    if (wasHint2) this.fadeOne();
    return 'wrong';
  }

  /** Counting: one picture from the shelf into the basket. Solves when the basket equals the wants. */
  add(thing: Thing): void {
    if (this.solved || this.puzzle.kind !== 'count' || !THINGS.includes(thing)) return;
    if (this.basket[thing] < this.wants[thing]) {
      this.basket[thing]++;
      this.quiet = 0;
    } else {
      if (this.basket[thing] < BASKET_MAX) this.basket[thing]++; // too many is fine: he can take it back
      this.wrong++;
      this.raise();
    }
    this.checkBasket();
  }

  /** Counting: one picture back out of the basket. Always allowed. */
  take(thing: Thing): void {
    if (this.solved || this.puzzle.kind !== 'count' || !THINGS.includes(thing) || this.basket[thing] <= 0) return;
    if (this.basket[thing] > this.wants[thing]) this.quiet = 0; // taking out an extra is a good move
    this.basket[thing]--;
    this.checkBasket();
  }

  /** The current hint level. Never goes down. */
  hint(): HintLevel {
    return this.level;
  }

  /** Hint 2's dotted slots: what the basket still needs. Empty before hint 2. */
  ghost(): Array<{ thing: Thing; missing: number }> {
    if (this.level < 2 || this.puzzle.kind !== 'count') return [];
    return this.puzzle.wants
      .map(w => ({ thing: w.thing, missing: Math.max(0, w.n - this.basket[w.thing]) }))
      .filter(g => g.missing > 0);
  }

  /** Counting: the shelf picture to pulse for hint 1 (something still needed, else an extra to take out). */
  nextNeeded(): Thing | null {
    if (this.puzzle.kind !== 'count' || this.solved) return null;
    for (const w of this.puzzle.wants) if (this.basket[w.thing] < w.n) return w.thing;
    for (const t of THINGS) if (this.basket[t] > this.wants[t]) return t;
    return null;
  }

  /** Solved with at most two wrong answers and no help: counts towards the next level. */
  clean(): boolean {
    return this.solved && !this.helped && this.wrong <= CLEAN_MAX_WRONG;
  }

  private raise(): void {
    const byTime: HintLevel = this.quiet >= HELP_SECONDS ? 3 : this.quiet >= HINT2_SECONDS ? 2 : this.quiet >= HINT1_SECONDS ? 1 : 0;
    const byWrong: HintLevel = this.wrong >= HELP_WRONG ? 3 : this.wrong >= HINT2_WRONG ? 2 : this.wrong >= HINT1_WRONG ? 1 : 0;
    const next = Math.max(this.level, byTime, byWrong) as HintLevel;
    if (this.level < 2 && next >= 2) this.fadeOne(); // hint 2 starts with one card fading
    this.level = next;
  }

  /** Hides one wrong card (never the right one, never leaving fewer than two showing). */
  private fadeOne(): void {
    this.fadeClock = 0;
    if (this.puzzle.kind === 'count') return;
    const { options, answer } = this.puzzle;
    if (options.length - this.faded.size <= MIN_CARDS_SHOWING) return;
    for (let i = 0; i < options.length; i++) {
      if (i !== answer && !this.faded.has(i)) {
        this.faded.add(i);
        return;
      }
    }
  }

  private checkBasket(): void {
    for (const t of THINGS) if (this.basket[t] !== this.wants[t]) return;
    this.solved = true;
  }

  /** Hint 3: Glim lights the answer and the puzzle completes itself. */
  private finishForHim(): void {
    if (this.puzzle.kind === 'count') for (const t of THINGS) this.basket[t] = this.wants[t];
    this.level = 3;
    this.helped = true;
    this.solved = true;
  }
}
