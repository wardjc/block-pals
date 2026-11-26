/**
 * Things that happen a little later, counted in game time: it only moves by the dt it is given, so
 * a menu that pauses the game (dt 0) freezes it and nothing is lost. Callbacks run once, in order of
 * time (ties in the order they were added).
 */
export class Delayed {
  private items: Array<{ at: number; seq: number; fn: () => void }> = [];
  private now = 0;
  private seq = 0;

  get pending(): number {
    return this.items.length;
  }

  after(seconds: number, fn: () => void): void {
    this.items.push({ at: this.now + (Number.isFinite(seconds) ? Math.max(0, seconds) : 0), seq: this.seq++, fn });
  }

  update(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) {
      // A delay of 0 (or a bad one) still runs on the next real step, never on a frozen one.
      return;
    }
    this.now += dt;
    for (;;) {
      const due = this.items.filter(i => i.at <= this.now + 1e-9).sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (due.length === 0) return;
      const first = due[0];
      this.items = this.items.filter(i => i !== first);
      try { first.fn(); } catch { /* a visual must never stop the game */ }
    }
  }
}
