import type { StackId } from '../core/items';
import type { RewardEntry } from '../core/treasure';
import { MAX_DOTS } from './bag';
import { stackPicture } from './picture';

/** The cards close by themselves after this long (or on any tap). */
export const CHEST_REVEAL_SECONDS = 4;
/**
 * A tap in the first moment after the cards appear does not close them: the very tap that opened
 * the chest still sends its click (and a mouse-compatibility click) to whatever is under the finger.
 */
export const CHEST_TAP_GRACE_MS = 350;

export interface ChestRevealDeps {
  iconFor(id: StackId): string;
  /** The game pauses while the cards are up (the existing overlay rule). */
  onOpenChange(open: boolean): void;
  /** Clock in ms; injectable for tests. */
  now?: () => number;
}

/**
 * What came out of a treasure chest (plan Task 19): one big card per entry, a picture, its digit
 * and that many dots (at most 20). Nothing to read. It closes by itself after 4 s or on any tap,
 * and a tap on it never reaches the world.
 */
export class ChestReveal {
  private readonly el = document.createElement('div');
  private readonly row = document.createElement('div');
  private open_ = false;
  private left = 0;
  private shownAt = -Infinity;

  constructor(root: HTMLElement, private readonly deps: ChestRevealDeps) {
    this.el.className = 'chest-reveal';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    const lid = document.createElement('div');
    lid.className = 'chest-lid';
    lid.textContent = '🎁';
    this.row.className = 'chest-row';
    this.el.append(lid, this.row);
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
      this.el.addEventListener(type, e => {
        e.stopPropagation();
        if ((type === 'pointerdown' || type === 'click') && this.now() - this.shownAt >= CHEST_TAP_GRACE_MS) this.hide();
      });
    }
    root.appendChild(this.el);
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }

  get open(): boolean {
    return this.open_;
  }

  show(reward: readonly RewardEntry[]): void {
    this.row.replaceChildren(...reward.map(e => this.card(e)));
    this.left = CHEST_REVEAL_SECONDS;
    this.shownAt = this.now();
    this.el.hidden = false;
    if (this.open_) return;
    this.open_ = true;
    this.deps.onOpenChange(true);
  }

  hide(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.hidden = true;
    this.deps.onOpenChange(false);
  }

  /** Called every frame (real time, not game time: the game is paused while it shows). */
  update(dt: number): void {
    if (!this.open_ || !(dt > 0)) return;
    this.left -= dt;
    if (this.left <= 0) this.hide();
  }

  private card(e: RewardEntry): HTMLElement {
    const c = document.createElement('div');
    c.className = 'chest-card';
    const digit = document.createElement('span');
    digit.className = 'chest-digit';
    digit.textContent = String(e.n);
    const dots = document.createElement('span');
    dots.className = 'chest-dots';
    for (let i = 0; i < Math.min(MAX_DOTS, e.n); i++) dots.appendChild(document.createElement('i'));
    c.append(stackPicture(e.id, this.deps.iconFor, 'chest-pic'), digit, dots);
    return c;
  }
}
