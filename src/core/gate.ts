export function makeSum(rng: () => number = Math.random): { a: number; b: number; answer: number } {
  const a = 3 + Math.floor(rng() * 7);
  // Avoid 3 + 3 without a retry loop, including for an injected constant RNG.
  const minimumB = a === 3 ? 4 : 3;
  const b = minimumB + Math.floor(rng() * (10 - minimumB));
  return { a, b, answer: a + b };
}

export function checkSum(sum: { answer: number }, input: string): boolean {
  const trimmed = input.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) === sum.answer;
}
