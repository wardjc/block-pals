/**
 * Who may speak when (pure, so it is unit-tested). The break reminder has priority: while its bubble
 * is open nothing else may talk over it or cut it, but it never pauses or locks play.
 */
export interface SpeechContext {
  /** The break reminder bubble is showing (it stays until he taps the tick). */
  breakOpen: boolean;
  /** A voice line is being prepared or spoken right now. */
  speaking: boolean;
  /** Audio is not unlocked yet (before the first tap). */
  locked: boolean;
  /** One of Pip's lines is waiting for its turn. */
  pipPending: boolean;
  /** He is pressing, holding or dragging. */
  gestureBusy: boolean;
}

/** A neighbour may say hello now. */
export function mayGreet(c: SpeechContext): boolean {
  return !c.breakOpen && !c.locked && !c.speaking && !c.pipPending && !c.gestureBusy;
}

/** Pip's queued line may be spoken now. */
export function mayPipSpeakQueued(c: SpeechContext): boolean {
  return !c.breakOpen && !c.locked && !c.speaking;
}

/** A line Pip is about to say (idle hint, reaction, lead line): only the break line gets through an open break bubble. */
export function allowLine(breakOpen: boolean, key: string): boolean {
  return key === 'breakTime' || !breakOpen;
}

/** The lead (offers, "come on", arrival) waits while an overlay is open or the break bubble is up. */
export function leadPaused(gameOrOverlayPaused: boolean, breakOpen: boolean): boolean {
  return gameOrOverlayPaused || breakOpen;
}

/** The time step Pip and the world's helpers get: zero while a menu has the game paused, so Pip stands still. */
export function helperDt(paused: boolean, dt: number): number {
  return paused ? 0 : dt;
}

/**
 * The craft screen's three speech callbacks, every one behind the break guard: while the break
 * bubble is open they say nothing (and so never cut the reminder), while crafting itself carries on.
 */
export function craftSpeech(
  breakOpen: () => boolean,
  speak: { say(text: string): void; needMore(): void; full(): void },
): { say(text: string): void; sayNeedMore(): void; sayFull(): void } {
  return {
    say: text => { if (!breakOpen()) speak.say(text); },
    sayNeedMore: () => { if (!breakOpen()) speak.needMore(); },
    sayFull: () => { if (!breakOpen()) speak.full(); },
  };
}

/**
 * A line that must be said exactly once but may have to wait (the welcome while the break bubble
 * is up). `want()` asks for it; `take(blocked)` returns true exactly once, the first time it is
 * wanted and not blocked, so a dropped line is retried and a delivered one is never repeated.
 */
export class DeferredOnce {
  private wanted = false;
  private done = false;

  want(): void {
    if (!this.done) this.wanted = true;
  }

  take(blocked: boolean): boolean {
    if (!this.wanted || this.done || blocked) return false;
    this.done = true;
    this.wanted = false;
    return true;
  }
}

/** How long held lines wait for audio to start running before they are dropped quietly. */
export const HOLD_LIMIT_SECONDS = 30;

/**
 * Held lines (neighbours' hellos, Pip's queued lead lines) wait while audio is locked or suspended.
 * `update` returns true exactly once per locked stretch, when it has lasted HOLD_LIMIT_SECONDS: the
 * caller then drops what it was holding (without using up any cooldown). Unlocking resets it.
 */
export class LockedHold {
  private locked = 0;
  private fired = false;

  update(dt: number, lockedNow: boolean): boolean {
    if (!lockedNow) { this.locked = 0; this.fired = false; return false; }
    this.locked += Math.max(0, dt);
    if (!this.fired && this.locked >= HOLD_LIMIT_SECONDS) { this.fired = true; return true; }
    return false;
  }
}
