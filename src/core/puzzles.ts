/**
 * The wizard's picture puzzles (spec §7g): counting with a basket, "what comes next?" patterns and
 * matching. Pure and DOM-free. A puzzle is only symbols, numbers and thing names, never words to
 * read; the screen draws them as pictures, digits and dots. There is no timer and nothing to get
 * wrong for good: the session (src/game/puzzleSession.ts) always walks him to the answer.
 */

export const SHAPES = ['circle', 'square', 'triangle', 'star'] as const;
export const COLOURS = ['red', 'blue', 'yellow', 'green'] as const;
export const THINGS = ['apple', 'carrot', 'potato', 'wheat', 'egg'] as const;

export type Shape = typeof SHAPES[number];
export type Colour = typeof COLOURS[number];
export interface Sym { shape: Shape; colour: Colour }
export type Thing = typeof THINGS[number];
export type MatchMode = 'colour' | 'shape' | 'both' | 'outline';

export type Puzzle =
  | { kind: 'count'; level: number; wants: Array<{ thing: Thing; n: number }>; shelf: Thing[] }
  | { kind: 'pattern'; level: number; seq: Sym[]; options: Sym[]; answer: number }
  | { kind: 'match'; level: number; mode: MatchMode; target: Sym; options: Sym[]; answer: number };
export type PuzzleKind = Puzzle['kind'];

export const MAX_LEVEL = 9;
/** Clean solves (at most two wrong picks, no help) needed for each step up the ladder. */
export const CLEAN_PER_LEVEL = 3;

/** The puzzle level for a count of clean solves: min(9, floor(clean / 3)). Safe for any number. */
export function levelFor(clean: number): number {
  if (typeof clean !== 'number' || Number.isNaN(clean) || clean <= 0) return 0;
  return Math.min(MAX_LEVEL, Math.floor(clean / CLEAN_PER_LEVEL));
}

export const sameSym = (a: Sym, b: Sym): boolean => a.shape === b.shape && a.colour === b.colour;

/** A level from anything: whole, 0..MAX_LEVEL, NaN becomes 0. */
function clampLevel(level: number): number {
  if (typeof level !== 'number' || Number.isNaN(level)) return 0;
  return Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
}

// ---- small helpers over a seeded source of numbers in [0, 1) ----

type Rng = () => number;

function unit(rng: Rng): number {
  const r = rng();
  return r >= 0 && r < 1 ? r : 0; // a bad source can never push an index out of range
}

function int(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(unit(rng) * (hi - lo + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(unit(rng) * items.length)]!;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(unit(rng) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** `n` distinct values from `items`, in random order. */
function some<T>(rng: Rng, items: readonly T[], n: number): T[] {
  return shuffle(rng, items).slice(0, n);
}

/** Puts the answer among the distractors at a random place. */
function deal(rng: Rng, answer: Sym, distractors: Sym[]): { options: Sym[]; answer: number } {
  const options = shuffle(rng, [answer, ...distractors]);
  return { options, answer: options.findIndex(o => sameSym(o, answer)) };
}

/** `n` symbols that all differ from each other in both shape and colour. */
function distinctSyms(rng: Rng, n: number): Sym[] {
  const shapes = some(rng, SHAPES, n);
  const colours = some(rng, COLOURS, n);
  return shapes.map((shape, i) => ({ shape, colour: colours[i]! }));
}

// ---- counting ----

interface CountRule { kinds: 1 | 2; lo: number; hi: number; total?: number }

const COUNT_LADDER: readonly CountRule[] = [
  { kinds: 1, lo: 1, hi: 3 },
  { kinds: 1, lo: 1, hi: 5 },
  { kinds: 1, lo: 1, hi: 8 },
  { kinds: 2, lo: 1, hi: 3 },
  { kinds: 2, lo: 1, hi: 5 },
  { kinds: 2, lo: 1, hi: 8 },
  { kinds: 1, lo: 5, hi: 12 },
  { kinds: 2, lo: 3, hi: 10, total: 12 },
  { kinds: 1, lo: 8, hi: 20 },
  { kinds: 2, lo: 5, hi: 14, total: 20 },
];

function makeCount(level: number, rng: Rng): Puzzle {
  const rule = COUNT_LADDER[level]!;
  const total = Math.min(20, rule.total ?? 20);
  const things = some(rng, THINGS, rule.kinds);
  const wants: Array<{ thing: Thing; n: number }> = [];
  if (rule.kinds === 1) {
    wants.push({ thing: things[0]!, n: int(rng, rule.lo, Math.min(rule.hi, total)) });
  } else {
    const first = int(rng, rule.lo, Math.min(rule.hi, total - rule.lo));
    const second = int(rng, rule.lo, Math.min(rule.hi, total - first));
    wants.push({ thing: things[0]!, n: first }, { thing: things[1]! , n: second });
  }
  const others = THINGS.filter(t => !things.includes(t));
  const extra = some(rng, others, int(rng, 1, 2));
  return { kind: 'count', level, wants, shelf: shuffle(rng, [...things, ...extra]) };
}

// ---- patterns ("what comes next?") ----

function makePattern(level: number, rng: Rng): Puzzle {
  const optionCount = level <= 5 ? 3 : 4;
  let seq: Sym[];
  let next: Sym;
  let distractors: Sym[];

  if (level === 0 || level === 1) {
    // ABAB: first colour only (same shape), then shape only (same colour).
    if (level === 0) {
      const shape = pick(rng, SHAPES);
      const [a, b, c] = some(rng, COLOURS, 3).map(colour => ({ shape, colour }));
      seq = [a!, b!, a!, b!, a!]; next = b!; distractors = [a!, c!];
    } else {
      const colour = pick(rng, COLOURS);
      const [a, b, c] = some(rng, SHAPES, 3).map(shape => ({ shape, colour }));
      seq = [a!, b!, a!, b!, a!]; next = b!; distractors = [a!, c!];
    }
  } else if (level === 8) {
    // Colour and shape cycle together: colours every 2, shapes every 3.
    const [c0, c1] = some(rng, COLOURS, 2) as [Colour, Colour];
    const [s0, s1, s2] = some(rng, SHAPES, 3) as [Shape, Shape, Shape];
    const cs = [c0, c1];
    const ss = [s0, s1, s2];
    seq = [0, 1, 2, 3, 4].map(i => ({ colour: cs[i % 2]!, shape: ss[i % 3]! }));
    next = { colour: c1, shape: s2 };
    const lookAlikes: Sym[] = [{ colour: c0, shape: s2 }, { colour: c1, shape: s0 }, { colour: c1, shape: s1 }];
    distractors = some(rng, lookAlikes, optionCount - 1);
  } else {
    // Every element differs from the others in both shape and colour, so colour is never the only clue.
    const shapeOf: Record<number, { n: number; seq: number[]; next: number }> = {
      2: { n: 2, seq: [0, 0, 1, 0, 0], next: 1 },       // AAB
      3: { n: 3, seq: [0, 1, 2, 0, 1], next: 2 },       // ABC
      4: { n: 2, seq: [0, 1, 1, 0, 1], next: 1 },       // ABB
      5: { n: 2, seq: [0, 0, 1, 1, 0], next: 0 },       // AABB
      6: { n: 3, seq: [0, 1, 2, 0, 1], next: 2 },       // ABCABC
      7: { n: 2, seq: [0, 1, 1, 0, 0], next: 0 },       // growing: A, BB, AAA, BBBB
      9: { n: 4, seq: [0, 1, 2, 3, 0], next: 1 },       // ABCD
    };
    const plan = shapeOf[level]!;
    const els = distinctSyms(rng, plan.n);
    seq = plan.seq.map(i => els[i]!);
    next = els[plan.next]!;
    distractors = els.filter((_, i) => i !== plan.next);
    if (distractors.length > optionCount - 1) distractors = some(rng, distractors, optionCount - 1);
    // Fill up with symbols whose shape differs from the answer's (and from each other's picks).
    const spare: Sym[] = [];
    for (const shape of SHAPES) {
      for (const colour of COLOURS) {
        const s = { shape, colour };
        if (shape !== next.shape && !distractors.some(d => sameSym(d, s))) spare.push(s);
      }
    }
    distractors = [...distractors, ...some(rng, spare, optionCount - 1 - distractors.length)];
  }

  return { kind: 'pattern', level, seq, ...deal(rng, next, distractors) };
}

// ---- matching ----

function matchMode(level: number): MatchMode {
  if (level === 0) return 'colour';
  if (level === 1) return 'shape';
  if (level <= 3) return 'both';
  return 'outline';
}

function makeMatch(level: number, rng: Rng): Puzzle {
  const mode = matchMode(level);
  const target: Sym = { shape: pick(rng, SHAPES), colour: pick(rng, COLOURS) };
  const otherColours = COLOURS.filter(c => c !== target.colour);
  const otherShapes = SHAPES.filter(s => s !== target.shape);
  let distractors: Sym[];

  if (mode === 'colour') {
    distractors = some(rng, otherColours, 2).map(colour => ({ shape: target.shape, colour }));
  } else if (mode === 'shape') {
    distractors = some(rng, otherShapes, 2).map(shape => ({ shape, colour: target.colour }));
  } else if (mode === 'both') {
    const sameShape: Sym = { shape: target.shape, colour: pick(rng, otherColours) };
    const sameColour: Sym = { shape: pick(rng, otherShapes), colour: target.colour };
    const neither: Sym = { shape: pick(rng, otherShapes), colour: pick(rng, otherColours) };
    distractors = level === 2 ? [pick(rng, [sameShape, sameColour]), neither] : [sameShape, sameColour, neither];
  } else {
    // A grey outline is matched to the coloured shape: every other card has a different shape.
    const n = level <= 5 ? 2 : 3;
    distractors = some(rng, otherShapes, n).map(shape => ({ shape, colour: pick(rng, COLOURS) }));
  }

  return { kind: 'match', level, mode, target, ...deal(rng, target, distractors) };
}

// ---- choosing the next puzzle ----

const MAKERS: Record<PuzzleKind, (level: number, rng: Rng) => Puzzle> = {
  count: makeCount,
  pattern: makePattern,
  match: makeMatch,
};

/** The kind mix: L0 and L1 count 50%, match 30%, pattern 20%; from L2 equal thirds. */
function weights(level: number): Array<[PuzzleKind, number]> {
  return level <= 1
    ? [['count', 0.5], ['match', 0.3], ['pattern', 0.2]]
    : [['count', 1 / 3], ['match', 1 / 3], ['pattern', 1 / 3]];
}

function chooseKind(level: number, rng: Rng, banned: PuzzleKind | null): PuzzleKind {
  const w = weights(level).filter(([k]) => k !== banned);
  const sum = w.reduce((s, [, x]) => s + x, 0);
  let r = unit(rng) * sum;
  for (const [k, x] of w) {
    if (r < x) return k;
    r -= x;
  }
  return w[w.length - 1]![0];
}

const samePuzzle = (a: Puzzle, b: Puzzle | undefined): boolean => b !== undefined && JSON.stringify(a) === JSON.stringify(b);

/**
 * A new puzzle for `level` (clamped to 0..9). Never exactly the same as `last`, and never the same
 * kind three times in a row when the caller also passes the one before (`beforeLast`).
 */
export function makePuzzle(level: number, rng: () => number, last?: Puzzle, beforeLast?: Puzzle): Puzzle {
  const lv = clampLevel(level);
  const banned = last && beforeLast && last.kind === beforeLast.kind ? last.kind : null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const p = MAKERS[chooseKind(lv, rng, banned)](lv, rng);
    if (!samePuzzle(p, last)) return p;
  }
  // A different kind is always a different puzzle (and never makes three in a row).
  const kind = (['count', 'match', 'pattern'] as const).find(k => k !== last!.kind)!;
  return MAKERS[kind](lv, rng);
}

/** What the wizard must say aloud for a puzzle (the voice parts): counting digits and things only. */
export function describe(p: Puzzle): { digits: number[]; things: Thing[] } {
  if (p.kind !== 'count') return { digits: [], things: [] };
  return { digits: p.wants.map(w => w.n), things: p.wants.map(w => w.thing) };
}
