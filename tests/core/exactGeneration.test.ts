import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { bump, coneFloor, isqrtCeil, isqrtFloor } from '../../src/core/exactMath';
import { generateWorld } from '../../src/core/worldgen';

/**
 * The same seed makes the same world on every device (his saved edits are replayed on top of it).
 * The spec lets Math.hypot, sqrt, sin, cos, pow and ** differ in the last bit between engines, so
 * generation never decides with them.
 */
const GEN_SOURCES = ['worldgen', 'outer', 'village', 'houses', 'tower', 'caves', 'caveDress', 'treasure', 'ruin', 'rng', 'shifted', 'exactMath'];
const BANNED = /Math\.(hypot|sqrt|sin|cos|tan|atan2?|asin|acos|sinh|cosh|tanh|pow|exp|expm1|log|log2|log10|log1p|cbrt|fround)\b|\*\*\s*[\d(a-zA-Z]/;

describe('generation decides with exact arithmetic only', () => {
  test.each(GEN_SOURCES)('src/core/%s.ts uses no engine-dependent maths (outside lines marked "exact-math:")', name => {
    const lines = readFileSync(join(__dirname, `../../src/core/${name}.ts`), 'utf8').split('\n');
    const bad = lines
      .map((l, i) => ({ l, i: i + 1 }))
      .filter(({ l }) => !l.includes('exact-math:') && !/^\s*(\*|\/\*\*|\/\/)/.test(l))
      .map(({ l, i }) => ({ l: l.replace(/\/\/.*$/, ''), i }))
      .filter(({ l }) => BANNED.test(l))
      .map(({ l, i }) => `${name}.ts:${i}: ${l.trim()}`);
    expect(bad).toEqual([]);
  });

  test('integer square roots are exact, including near large perfect squares', () => {
    for (let n = 0; n < 5000; n++) {
      const f = isqrtFloor(n);
      expect(f * f <= n && (f + 1) * (f + 1) > n).toBe(true);
      const c = isqrtCeil(n);
      expect(c * c >= n && (c === 0 || (c - 1) * (c - 1) < n)).toBe(true);
    }
    for (const r of [94906265, 67108864, 9999999]) {
      expect(isqrtFloor(r * r)).toBe(r);
      expect(isqrtFloor(r * r - 1)).toBe(r - 1);
      expect(isqrtCeil(r * r + 1)).toBe(r + 1);
    }
  });

  test('coneFloor is floor(top - slope * distance) exactly; bump is a sine-like wave', () => {
    // A cone of slope 3/4: at distance 4 (d2 16) exactly 3 down; at d2 17 just over, so one more.
    expect(coneFloor(11, 3, 4, 16)).toBe(8);
    expect(coneFloor(11, 3, 4, 17)).toBe(7);
    expect(coneFloor(11, 3, 4, 0)).toBe(11);
    expect(bump(0)).toBe(0);
    expect(bump(0.5)).toBe(1);
    expect(bump(1.5)).toBe(-1);
    expect(bump(2)).toBe(0);
  });
});

/** sha256 (first 16 hex digits) of the generated world buffer. Change only with GEN_VERSION. */
const PINNED: Record<number, string> = {
  0: '18381b5672dea046',
  1: '0999c293c7bcfea4',
  7: 'e6dd51a44adffd2f',
  99: '04d58cd28f84dac0',
  2026: 'db9bfedaf4b4b3b7',
  4294967295: '77d3102e4c7f25c1',
};

test.each([0, 1, 7, 99, 2026, 4294967295])('seed %i generates the pinned world, the same on every engine', seed => {
  const h = createHash('sha256').update(generateWorld(seed).world.buffer).digest('hex').slice(0, 16);
  console.log(`exactGeneration ${seed}: ${h}`);
  expect(h).toBe(PINNED[seed]);
}, 60_000);
