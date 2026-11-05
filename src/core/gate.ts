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

/** Press-and-hold timing for the grown-ups hotspot. Clock is passed in, so it is easy to test. */
export class HoldGate {
  private since: number | null = null;

  constructor(private readonly holdMs = 3000) {}

  get active(): boolean {
    return this.since !== null;
  }

  start(now: number): void {
    this.since = now;
  }

  release(): void {
    this.since = null;
  }

  /** 0..1 fill of the ring. */
  progress(now: number): number {
    return this.since === null ? 0 : Math.min(1, Math.max(0, (now - this.since) / this.holdMs));
  }

  /** True exactly once, when the hold completes. */
  poll(now: number): boolean {
    if (this.since === null || now - this.since < this.holdMs) return false;
    this.since = null;
    return true;
  }
}
