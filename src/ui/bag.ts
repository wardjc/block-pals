import { ITEMS, isItemId, stackName, type StackId } from '../core/items';
import type { Action } from '../input/mapping';
import { createDebouncer } from '../input/tap';
import { stackPicture } from './picture';

/** Counts up to this many are also drawn as dots (a picture of the number for a child who cannot read yet). */
export const MAX_DOTS = 20;

export interface BagDeps {
  stacks(): Array<{ id: StackId; count: number }>;
  iconFor(id: StackId): string;
  select(id: StackId): void;
  onOpenChange(open: boolean): void;
  /** The stack that is selected now, to ring it in the tray. */
  current?(): StackId | 'hand';
  /** Clock in ms; injectable for tests. */
  now?: () => number;
}

/**
 * The bag tray (spec Task 14): every stack he holds as a big picture with its digit and, up to 20,
 * dots. Choosing one selects it and closes the tray. It pauses the game like the craft screen and
 * works with the pad. Nothing needs reading.
 */
export class BagTray {
  private readonly el = document.createElement('div');
  private readonly grid = document.createElement('div');
  private open_ = false;
  private focus = 0;
  private padX = 0;
  private readonly allow = createDebouncer(150);

  constructor(root: HTMLElement, private readonly deps: BagDeps) {
    this.el.className = 'bag-tray';
    this.el.hidden = true;
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'])
      this.el.addEventListener(type, e => e.stopPropagation());
    this.grid.className = 'bag-grid';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bag-close';
    close.textContent = '✖';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    this.el.append(this.grid, close);
    root.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.padX = 0;
    const stacks = this.deps.stacks();
    const cur = this.deps.current?.();
    this.focus = Math.max(0, stacks.findIndex(s => s.id === cur));
    this.el.hidden = false;
    this.render();
    this.deps.onOpenChange(true);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.el.hidden = true;
    this.deps.onOpenChange(false);
  }

  /** Moves the pad highlight by dx (-1 or 1), wrapping round. */
  padMove(dx: number): void {
    const n = this.deps.stacks().length;
    if (n === 0 || dx === 0) return;
    this.focus = (this.focus + Math.sign(dx) + n) % n;
    this.refreshFocus();
  }

  /** Chooses the highlighted stack. */
  padSelect(): void {
    const stack = this.deps.stacks()[this.focus];
    if (stack) this.choose(stack.id, 'bag:pad');
  }

  /** Pad routing while open: left/right move (edge-triggered), collect chooses, place closes. */
  padInput(stick: [number, number], pressed: Action[]): void {
    const dir = stick[0] > 0.5 ? 1 : stick[0] < -0.5 ? -1 : 0;
    if (dir !== 0 && dir !== this.padX) this.padMove(dir);
    this.padX = dir;
    for (const a of pressed) {
      if (a === 'collect') this.padSelect();
      else if (a === 'place') this.close();
    }
  }

  private choose(id: StackId, source: string): void {
    const now = this.deps.now ? this.deps.now() : performance.now();
    if (!this.allow(source, now)) return;
    this.deps.select(id);
    this.close();
  }

  private refreshFocus(): void {
    [...this.grid.children].forEach((c, i) => c.classList.toggle('focus', i === this.focus));
    (this.grid.children[this.focus] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' }); // the bag scrolls on small screens
  }

  private render(): void {
    this.grid.replaceChildren();
    const cur = this.deps.current?.();
    this.deps.stacks().forEach(({ id, count }, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bag-stack' + (id === cur ? ' selected' : '');
      b.dataset.stack = String(id);
      b.setAttribute('aria-label', isItemId(id) ? ITEMS[id].name : stackName(id));
      const digit = document.createElement('span');
      digit.className = 'bag-digit';
      digit.textContent = String(count);
      const dots = document.createElement('span');
      dots.className = 'bag-dots';
      for (let d = 0; count <= MAX_DOTS && d < count; d++) dots.appendChild(document.createElement('i'));
      b.append(stackPicture(id, this.deps.iconFor, 'bag-pic'), digit, dots);
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.focus = i;
        this.choose(id, `bag:${i}`);
      });
      this.grid.appendChild(b);
    });
    this.refreshFocus();
  }
}
