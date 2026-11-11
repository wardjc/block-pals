/**
 * Stops and resumes autosave around "load a copy", and freezes every other save call while stopped.
 * `start` makes a new autosaver and returns its disposer; `write` is a forced save of the game as it is now.
 *
 * A resumed autosaver takes the game as it is NOW as its starting point, so bag, flag or animal changes
 * made before the stop would never look "changed" to it. That is why resume writes once straight away.
 */
export interface AutosaveControl {
  readonly frozen: boolean;
  stop(): void;
  resume(): void;
  /** A save from outside the autosaver (a game event); ignored while frozen. */
  save(): void;
}

export function createAutosaveControl(start: () => () => void, write: () => boolean | void): AutosaveControl {
  let dispose = start();
  let frozen = false;
  let retry = 0;
  const flush = (attempt: number): void => {
    if (frozen) return;
    if (write() === false && attempt < 12) retry = window.setTimeout(() => flush(attempt + 1), 5000);
  };
  return {
    get frozen() { return frozen; },
    stop() { frozen = true; clearTimeout(retry); dispose(); },
    resume() { dispose(); dispose = start(); frozen = false; flush(0); },
    save() { if (!frozen) write(); },
  };
}
