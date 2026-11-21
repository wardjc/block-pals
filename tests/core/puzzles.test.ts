import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import {
  CLEAN_PER_LEVEL, COLOURS, MAX_LEVEL, SHAPES, THINGS, describe as describePuzzle, levelFor, makePuzzle,
  sameSym, type Puzzle, type Sym,
} from '../../src/core/puzzles';

const LEVELS = [...Array(MAX_LEVEL + 1).keys()];

/** Re-derives the next symbol of a 5-symbol sequence from the level's rule, independently of the generator. */
function expectedNext(level: number, seq: Sym[]): Sym {
  switch (level) {
    case 0: case 1: return seq[1]!;          // ABAB A -> B
    case 2: return seq[2]!;                  // AAB AA -> B
    case 3: case 6: return seq[2]!;          // ABC AB -> C
    case 4: return seq[1]!;                  // ABB AB -> B
    case 5: return seq[0]!;                  // AABB A -> A
    case 7: return seq[0]!;                  // A BB AA(A) -> A (runs of 1, 2, 3, 4)
    case 8: return { colour: seq[1]!.colour, shape: seq[2]!.shape }; // colour period 2, shape period 3
    case 9: return seq[1]!;                  // ABCD A -> B
    default: throw new Error('no rule');
  }
}

/** The sequence itself follows the level's rule (so the "next" above is meaningful). */
function seqFollowsRule(level: number, s: Sym[]): boolean {
  const eq = sameSym;
  const differ = (a: Sym, b: Sym) => !eq(a, b);
  switch (level) {
    case 0: return eq(s[0]!, s[2]!) && eq(s[2]!, s[4]!) && eq(s[1]!, s[3]!) && differ(s[0]!, s[1]!)
      && s[0]!.shape === s[1]!.shape && s[0]!.colour !== s[1]!.colour;
    case 1: return eq(s[0]!, s[2]!) && eq(s[2]!, s[4]!) && eq(s[1]!, s[3]!)
      && s[0]!.colour === s[1]!.colour && s[0]!.shape !== s[1]!.shape;
    case 2: return eq(s[0]!, s[1]!) && eq(s[0]!, s[3]!) && eq(s[0]!, s[4]!) && differ(s[0]!, s[2]!);
    case 3: case 6: return eq(s[0]!, s[3]!) && eq(s[1]!, s[4]!) && differ(s[0]!, s[1]!) && differ(s[1]!, s[2]!) && differ(s[0]!, s[2]!);
    case 4: return eq(s[0]!, s[3]!) && eq(s[1]!, s[2]!) && eq(s[1]!, s[4]!) && differ(s[0]!, s[1]!);
    case 5: return eq(s[0]!, s[1]!) && eq(s[2]!, s[3]!) && eq(s[0]!, s[4]!) && differ(s[0]!, s[2]!);
    case 7: return eq(s[1]!, s[2]!) && eq(s[0]!, s[3]!) && eq(s[0]!, s[4]!) && differ(s[0]!, s[1]!);
    case 8: return s.every((x, i) => x.colour === s[i % 2]!.colour && x.shape === s[i % 3]!.shape)
      && s[0]!.colour !== s[1]!.colour && new Set(s.slice(0, 3).map(x => x.shape)).size === 3;
    case 9: return eq(s[0]!, s[4]!) && new Set(s.slice(0, 4).map(x => `${x.colour}/${x.shape}`)).size === 4;
    default: return false;
  }
}

function many(level: number, n: number, seed: number): Puzzle[] {
  const rng = mulberry32(seed);
  const out: Puzzle[] = [];
  for (let i = 0; i < n; i++) out.push(makePuzzle(level, rng));
  return out;
}

const keyOf = (s: Sym) => `${s.colour}/${s.shape}`;

describe('levelFor', () => {
  it('three clean solves per step, 9 at most', () => {
    expect(CLEAN_PER_LEVEL).toBe(3);
    expect([0, 1, 2].map(levelFor)).toEqual([0, 0, 0]);
    expect(levelFor(3)).toBe(1);
    expect(levelFor(26)).toBe(8);
    expect(levelFor(27)).toBe(9);
    expect(levelFor(1000)).toBe(9);
  });

  it('is safe for NaN, negatives, fractions and huge numbers', () => {
    expect(levelFor(Number.NaN)).toBe(0);
    expect(levelFor(-4)).toBe(0);
    expect(levelFor(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(levelFor(Number.POSITIVE_INFINITY)).toBe(MAX_LEVEL);
    expect(levelFor(5.9)).toBe(1);
    expect(levelFor(Number.MAX_VALUE)).toBe(MAX_LEVEL);
  });
});

describe('makePuzzle over every level (500 seeded puzzles each)', () => {
  for (const level of LEVELS) {
    it(`level ${level}: every puzzle is well formed`, () => {
      for (const p of many(level, 500, 1000 + level)) {
        expect(p.level).toBe(level);
        if (p.kind === 'count') {
          const total = p.wants.reduce((s, w) => s + w.n, 0);
          expect(total).toBeLessThanOrEqual(20);
          for (const w of p.wants) {
            expect(Number.isInteger(w.n)).toBe(true);
            expect(w.n).toBeGreaterThanOrEqual(1);
            expect(w.n).toBeLessThanOrEqual(20);
            expect(p.shelf).toContain(w.thing);
          }
          expect(new Set(p.wants.map(w => w.thing)).size).toBe(p.wants.length);
          expect(new Set(p.shelf).size).toBe(p.shelf.length);
          expect(p.shelf.length).toBeLessThanOrEqual(5);
          const others = p.shelf.length - p.wants.length;
          expect(others).toBeGreaterThanOrEqual(1);
          expect(others).toBeLessThanOrEqual(2);
          for (const t of p.shelf) expect(THINGS).toContain(t);
        } else {
          expect(p.answer).toBeGreaterThanOrEqual(0);
          expect(p.answer).toBeLessThan(p.options.length);
          expect(new Set(p.options.map(keyOf)).size).toBe(p.options.length);
          const expected = p.kind === 'pattern' ? (level <= 5 ? 3 : 4) : (level === 3 || level >= 6 ? 4 : 3);
          expect(p.options.length).toBe(expected);
        }
        if (p.kind === 'pattern') {
          expect(p.seq).toHaveLength(5);
          expect(seqFollowsRule(level, p.seq)).toBe(true);
          const next = expectedNext(level, p.seq);
          const continuing = p.options.filter(o => sameSym(o, next));
          expect(continuing).toHaveLength(1);
          expect(sameSym(p.options[p.answer]!, next)).toBe(true);
        }
        if (p.kind === 'match') {
          const equal = p.options.filter(o => sameSym(o, p.target));
          expect(equal).toHaveLength(1);
          expect(sameSym(p.options[p.answer]!, p.target)).toBe(true);
        }
      }
    });
  }

  it('counting follows the ladder table', () => {
    const table: Record<number, { kinds: number; lo: number; hi: number; total?: number }> = {
      0: { kinds: 1, lo: 1, hi: 3 }, 1: { kinds: 1, lo: 1, hi: 5 }, 2: { kinds: 1, lo: 1, hi: 8 },
      3: { kinds: 2, lo: 1, hi: 3 }, 4: { kinds: 2, lo: 1, hi: 5 }, 5: { kinds: 2, lo: 1, hi: 8 },
      6: { kinds: 1, lo: 5, hi: 12 }, 7: { kinds: 2, lo: 3, hi: 10, total: 12 },
      8: { kinds: 1, lo: 8, hi: 20 }, 9: { kinds: 2, lo: 5, hi: 14, total: 20 },
    };
    for (const level of LEVELS) {
      const t = table[level]!;
      const seen = new Set<number>();
      for (const p of many(level, 500, 77 + level)) {
        if (p.kind !== 'count') continue;
        expect(p.wants).toHaveLength(t.kinds);
        for (const w of p.wants) {
          expect(w.n).toBeGreaterThanOrEqual(t.lo);
          expect(w.n).toBeLessThanOrEqual(t.hi);
          seen.add(w.n);
        }
        if (t.total) expect(p.wants.reduce((s, w) => s + w.n, 0)).toBeLessThanOrEqual(t.total);
      }
      expect(Math.min(...seen), `level ${level} low end`).toBe(t.lo);
    }
  });

  it('matching follows the ladder table', () => {
    const modes = ['colour', 'shape', 'both', 'both', 'outline', 'outline', 'outline', 'outline', 'outline', 'outline'];
    for (const level of LEVELS) {
      for (const p of many(level, 300, 300 + level)) {
        if (p.kind !== 'match') continue;
        expect(p.mode).toBe(modes[level]);
        const others = p.options.filter((_, i) => i !== p.answer);
        if (p.mode === 'colour') {
          expect(p.options.every(o => o.shape === p.target.shape)).toBe(true);
        } else if (p.mode === 'shape') {
          expect(p.options.every(o => o.colour === p.target.colour)).toBe(true);
        } else if (p.mode === 'both') {
          const lookAlikes = others.filter(o => o.shape === p.target.shape || o.colour === p.target.colour);
          expect(lookAlikes).toHaveLength(level === 2 ? 1 : 2);
          expect(p.options).toHaveLength(level === 2 ? 3 : 4);
        } else {
          // A grey outline shows only the shape: exactly one card has that shape.
          expect(p.options.filter(o => o.shape === p.target.shape)).toHaveLength(1);
        }
      }
    }
  });

  it('higher-level pattern answers never differ from a distractor by colour alone', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
      for (const p of many(level, 300, 900 + level)) {
        if (p.kind !== 'pattern') continue;
        const answer = p.options[p.answer]!;
        if (level === 8) continue; // colour and shape both cycle: look-alikes on purpose
        for (const o of p.options) if (o !== answer) expect(o.shape).not.toBe(answer.shape);
      }
    }
  });
});

describe('kind mix and repetition', () => {
  function mix(level: number): Record<Puzzle['kind'], number> {
    const rng = mulberry32(4242 + level);
    const counts = { count: 0, pattern: 0, match: 0 };
    let last: Puzzle | undefined;
    let before: Puzzle | undefined;
    for (let i = 0; i < 3000; i++) {
      const p = makePuzzle(level, rng, last, before);
      counts[p.kind]++;
      before = last;
      last = p;
    }
    return counts;
  }

  it('L0 leans on counting (about 50 / 30 / 20)', () => {
    const c = mix(0);
    expect(c.count / 3000).toBeGreaterThan(0.38);
    expect(c.count / 3000).toBeLessThan(0.6);
    expect(c.match / 3000).toBeGreaterThan(0.22);
    expect(c.pattern / 3000).toBeGreaterThan(0.12);
    expect(c.pattern).toBeLessThan(c.match);
  });

  it('L5 is about equal thirds', () => {
    const c = mix(5);
    for (const k of ['count', 'pattern', 'match'] as const) {
      expect(c[k] / 3000).toBeGreaterThan(0.26);
      expect(c[k] / 3000).toBeLessThan(0.41);
    }
  });

  for (const level of [0, 3, 9]) {
    it(`level ${level}: never the same kind three times in a row, never the same puzzle twice in a row`, () => {
      const rng = mulberry32(55 + level);
      let last: Puzzle | undefined;
      let before: Puzzle | undefined;
      for (let i = 0; i < 2000; i++) {
        const p = makePuzzle(level, rng, last, before);
        if (last) expect(JSON.stringify(p)).not.toBe(JSON.stringify(last));
        if (last && before) expect(p.kind === last.kind && last.kind === before.kind).toBe(false);
        before = last;
        last = p;
      }
    });
  }

  it('never equals last even with a stuck random source', () => {
    const zero = () => 0;
    const a = makePuzzle(0, zero);
    const b = makePuzzle(0, zero, a);
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    const c = makePuzzle(0, () => 0.999999, b, a);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(b));
  });
});

describe('determinism, clamping and what the wizard says', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(many(4, 50, 9))).toBe(JSON.stringify(many(4, 50, 9)));
  });

  it('clamps an out-of-range level', () => {
    expect(makePuzzle(-5, mulberry32(1)).level).toBe(0);
    expect(makePuzzle(99, mulberry32(1)).level).toBe(MAX_LEVEL);
    expect(makePuzzle(Number.NaN, mulberry32(1)).level).toBe(0);
    expect(makePuzzle(3.7, mulberry32(1)).level).toBe(3);
  });

  it('describe returns only digits 1..20 and the wanted things', () => {
    for (const level of LEVELS) {
      for (const p of many(level, 200, 31 + level)) {
        const d = describePuzzle(p);
        for (const n of d.digits) {
          expect(Number.isInteger(n)).toBe(true);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(20);
        }
        if (p.kind === 'count') {
          expect(d.digits).toEqual(p.wants.map(w => w.n));
          expect(d.things).toEqual(p.wants.map(w => w.thing));
        } else {
          expect(d).toEqual({ digits: [], things: [] });
        }
      }
    }
  });

  it('no puzzle contains text: every string is one of the enums', () => {
    const allowed = new Set<string>([
      ...SHAPES, ...COLOURS, ...THINGS, 'count', 'pattern', 'match', 'colour', 'shape', 'both', 'outline',
    ]);
    const walk = (v: unknown): void => {
      if (typeof v === 'string') expect(allowed.has(v), v).toBe(true);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const level of LEVELS) for (const p of many(level, 200, 600 + level)) walk(p);
  });

  it('the generator has no timer, lives, score or fail state', () => {
    const src = readFileSync(new URL('../../src/core/puzzles.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/fail|lose|lost|lives|score|gameover|timeout|penalt/i);
  });
});
