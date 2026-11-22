/**
 * Exact arithmetic for world generation. The same seed must make the same world on every device
 * and browser (his saved edits are replayed on top of it), and the ECMAScript spec lets Math.hypot,
 * Math.sqrt, Math.sin, Math.cos, Math.pow, `**` and friends differ in the last bit between engines.
 * Generation therefore decides only with integers, + - * / and comparisons (exact IEEE operations,
 * the same everywhere); a test greps the generation sources for anything else.
 */

/** x * x + z * z (exact for the integer and half-integer coordinates generation uses). */
export const sq2 = (dx: number, dz: number): number => dx * dx + dz * dz;

/** floor(sqrt(n)) for a non-negative safe integer, exactly (a guess, then integer correction). */
export function isqrtFloor(n: number): number {
  if (!(n > 0)) return 0;
  let r = Math.floor(Math.sqrt(n)); // exact-math: a starting guess only, corrected exactly below
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** ceil(sqrt(n)) for a non-negative safe integer, exactly. */
export function isqrtCeil(n: number): number {
  const r = isqrtFloor(n);
  return r * r === n ? r : r + 1;
}

/** ceil(a / b) for integers, b > 0. */
export const ceilDiv = (a: number, b: number): number => -Math.floor(-a / b);

/**
 * floor(top - (num / den) * sqrt(d2)) for integers (num, den > 0, d2 >= 0): a cone of slope num/den
 * falling from `top`, exactly. (ceil((num/den) sqrt(d2)) = ceil(ceilSqrt(num² d2) / den).)
 */
export function coneFloor(top: number, num: number, den: number, d2: number): number {
  return top - ceilDiv(isqrtCeil(num * num * d2), den);
}

/** sqrt(d2) <= r for integer d2 and a non-negative integer or half-integer r, exactly. */
export const within = (d2: number, r: number): boolean => d2 * 4 <= r * r * 4;

/**
 * A smooth bump in [-1, 1] standing in for sin(pi * u) (u in any range): the parabola 4f(1 - f) on
 * each unit, positive on even units and negative on odd ones. Plain arithmetic, the same everywhere.
 */
export function bump(u: number): number {
  const k = Math.floor(u);
  const f = u - k;
  const v = 4 * f * (1 - f);
  return (k & 1) === 0 ? v : -v;
}

/**
 * Directions as whole-number vectors of length exactly 5 (Pythagorean triples), so a step along one
 * is (dx / 5, dz / 5) per cell and a straight line of a multiple of 5 cells lands on whole cells.
 */
export const DIRS5: ReadonlyArray<readonly [number, number]> = [
  [5, 0], [0, 5], [-5, 0], [0, -5],
  [3, 4], [4, 3], [-3, 4], [-4, 3], [3, -4], [4, -3], [-3, -4], [-4, -3],
];
