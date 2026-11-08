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
