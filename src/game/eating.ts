import type { LineKey } from '../content/lines';
import { ItemId } from '../core/items';

/** The munch lasts this long. He can still walk during it. */
export const EAT_SECONDS = 1.3;
/** Three bites; the little picture of the food shrinks with each. */
export const BITES = 3;

/**
 * The 1.3 s munch. It holds no stat and costs nothing: it is only the animation clock, and its
 * `active` flag is the debounce, so a second tap during it eats nothing.
 */
export class EatState {
  private t = 0;
  private current: ItemId | null = null;
  private finished: ItemId | null = null;

  /** Starts a munch; false while one is already running. */
  start(food: ItemId): boolean {
    if (this.current !== null) return false;
    this.current = food;
    this.t = 0;
    return true;
  }

  update(dt: number): void {
    if (this.current === null || !Number.isFinite(dt) || dt <= 0) return;
    this.t += dt;
    if (this.t >= EAT_SECONDS) {
      this.finished = this.current;
      this.current = null;
      this.t = 0;
    }
  }

  get active(): boolean {
    return this.current !== null;
  }

  /** 0 to 1 through the munch (0 when idle). */
  get progress(): number {
    return this.current === null ? 0 : Math.min(1, this.t / EAT_SECONDS);
  }

  /** Whole bites taken so far, 0 to BITES (0 when idle). */
  get bite(): number {
    return this.current === null ? 0 : Math.min(BITES, Math.floor(this.progress * BITES));
  }

  get food(): ItemId | null {
    return this.current;
  }

  /** The food whose munch has just ended, once. Pip reacts then, never before. */
  takeFinished(): ItemId | null {
    const f = this.finished;
    this.finished = null;
    return f;
  }
}

/** The plain-word reaction line for a food. */
export function reactionKey(food: ItemId): LineKey {
  switch (food) {
    case ItemId.Apple: return 'ateApple';
    case ItemId.Carrot: return 'ateCarrot';
    case ItemId.Potato: return 'atePotato';
    default: return 'drankMilk';
  }
}
