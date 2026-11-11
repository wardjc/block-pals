import type { StackId } from '../core/items';
import { createDebouncer } from '../input/tap';
import { stackPicture } from './picture';

/** The bar shows the hand and at most this many stacks; more go behind the bag slot. */
export const BAR_STACKS = 8;

export interface HudHandlers {
  onSelect(i: number): void;
  onCraft(): void;
  /** The bag slot was chosen: open the tray. */
  onBag?(): void;
  onGrownUps(): void;
  /** Hotspot press and release, for the 3 second hold. */
  onGrownUpsHold?(down: boolean, pointerId: number): void;
}

export interface HudState {
  /** Every stack he holds, in bar order. Only the first BAR_STACKS are drawn. */
  slots: Array<{ id: StackId; count: number }>;
  /** 0 = hand, 1..8 = a bar slot, 9 = the bag slot. */
  selected: number;
  /** More stacks than fit: the bag slot is shown. */
  overflow: boolean;
  /** An edible is selected: the munch button shows. */
  edible: boolean;
  /** The selected stack when it is hidden behind the bag slot (it is drawn there). */
  pick?: { id: StackId; count: number };
}

/**
 * Pure: what the bar shows for a bag and a selection. Up to 8 stacks look exactly like step 1;
 * with more (or a selection beyond the 8) the bag slot appears, showing the selected stack's picture
 * when it is one of the hidden ones.
 */
export function hudStateFor(
  slots: Array<{ id: StackId; count: number }>, selected: StackId | 'hand', edible: boolean,
): HudState {
  const overflow = slots.length > BAR_STACKS;
  const index = selected === 'hand' ? -1 : slots.findIndex(s => s.id === selected);
  const shown = selected === 'hand' ? 0 : index < 0 ? 0 : index < BAR_STACKS ? index + 1 : BAR_STACKS + 1;
  const pick = index >= BAR_STACKS ? slots[index] : undefined;
  return pick ? { slots, selected: shown, overflow, edible, pick } : { slots, selected: shown, overflow, edible };
}

export class Hud {
  /** Set by later tasks (craft screen, grown-ups gate) while a full-screen overlay is up. */
  blockingOverlayOpen = false;

  setOverlayOpen(open: boolean): void {
    this.blockingOverlayOpen = open;
  }

  private readonly bar = document.createElement('div');
  private munch!: HTMLButtonElement;
  private munchCb: (() => void) | undefined;
  private readonly bubble = document.createElement('div');
  private readonly bubblePicture = document.createElement('span');
  private readonly bubbleWord = document.createElement('span');
  private bubbleTimer = 0;
  private readonly allow = createDebouncer(150);

  constructor(
    root: HTMLElement,
    private readonly iconFor: (id: StackId) => string,
    private readonly handlers: HudHandlers,
  ) {
    this.bar.className = 'hotbar';
    this.guard(this.bar);
    // A mouse wheel or trackpad's up-and-down scrolls the bar sideways.
    this.bar.addEventListener('wheel', e => {
      if (this.bar.scrollWidth <= this.bar.clientWidth) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      this.bar.scrollLeft += d;
      e.preventDefault();
    }, { passive: false });
    this.bar.addEventListener('scroll', () => this.updateHints(), { passive: true });
    window.addEventListener('resize', () => { this.revealSelected(); this.updateHints(); });
    root.appendChild(this.bar);

    const craft = this.button('craft-btn', '🛠️', () => handlers.onCraft());
    craft.setAttribute('aria-label', 'Craft');
    root.appendChild(craft);

    // The big mouth button: shown only while something edible is selected. It only eats.
    this.munch = this.button('munch-btn', '👄', () => this.munchCb?.());
    this.munch.setAttribute('aria-label', 'Eat');
    this.munch.hidden = true;
    root.appendChild(this.munch);

    const grownUps = this.button('grownups-hotspot', '', () => handlers.onGrownUps());
    grownUps.setAttribute('aria-label', 'Grown-ups');
    grownUps.addEventListener('pointerdown', e => handlers.onGrownUpsHold?.(true, e.pointerId));
    for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, e => handlers.onGrownUpsHold?.(false, (e as PointerEvent).pointerId), true);
    root.appendChild(grownUps);

    this.bubble.className = 'bubble';
    this.bubble.hidden = true;
    this.bubblePicture.className = 'bubble-picture';
    this.bubbleWord.className = 'bubble-word';
    this.bubble.append(this.bubblePicture, this.bubbleWord);
    root.appendChild(this.bubble);

    this.breakBubble.className = 'break-bubble';
    this.breakBubble.hidden = true;
    const pic = document.createElement('span');
    pic.className = 'break-picture';
    pic.textContent = '🤸';
    const ok = this.button('break-ok', '✔', () => { this.hideBreak(); this.onBreakDone?.(); });
    ok.setAttribute('aria-label', 'Carry on');
    this.breakBubble.append(pic, ok);
    root.appendChild(this.breakBubble);

    // Fills around the finger while a press and hold digs (spec §7a). Never takes taps.
    this.digRing.className = 'dig-ring';
    this.digRing.hidden = true;
    root.appendChild(this.digRing);
  }

  onMunch(cb: () => void): void {
    this.munchCb = cb;
  }

  setMunchVisible(v: boolean): void {
    this.munch.hidden = !v;
  }

  /** Shows the dig ring centred on the finger, filled to `progress` (0..1). */
  showDigRing(x: number, y: number, progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    this.digRing.style.left = `${x}px`;
    this.digRing.style.top = `${y}px`;
    this.digRing.style.setProperty('--p', String(p));
    this.digRing.hidden = false;
  }

  hideDigRing(): void {
    this.digRing.hidden = true;
  }

  private readonly breakBubble = document.createElement('div');
  private readonly digRing = document.createElement('div');
  private onBreakDone: (() => void) | undefined;

  /** Stays until the big tick is tapped; never blocks play. */
  showBreak(onDone: () => void): void {
    this.onBreakDone = onDone;
    this.breakBubble.hidden = false;
  }

  /** The break reminder is showing. It never pauses play, but nothing else may talk over it. */
  get breakOpen(): boolean {
    return !this.breakBubble.hidden;
  }

  hideBreak(): void {
    this.breakBubble.hidden = true;
  }

  private button(cls: string, text: string, onTap: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    this.guard(b);
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (this.allow(cls, performance.now())) onTap();
    });
    return b;
  }

  /** HUD taps must never reach the world. */
  private guard(el: HTMLElement): void {
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup'])
      el.addEventListener(type, e => e.stopPropagation());
  }

  /** Slot index plus the stack behind the bag slot: the bag slot (9) shows different stacks. */
  private lastSelected = '';

  /** Scrolls the bar the least it takes to show the whole selected slot. */
  private revealSelected(): void {
    const el = this.bar.querySelector<HTMLElement>('.slot.selected');
    if (!el) return;
    const pad = 8;
    const left = el.offsetLeft - pad;
    const right = el.offsetLeft + el.offsetWidth + pad;
    if (left < this.bar.scrollLeft) this.bar.scrollLeft = Math.max(0, left);
    else if (right > this.bar.scrollLeft + this.bar.clientWidth) this.bar.scrollLeft = right - this.bar.clientWidth;
  }

  /** A soft fade on a side that has more slots hidden. */
  private updateHints(): void {
    const { scrollLeft, clientWidth, scrollWidth } = this.bar;
    this.bar.classList.toggle('more-start', scrollLeft > 1);
    this.bar.classList.toggle('more-end', scrollLeft + clientWidth < scrollWidth - 1);
  }

  render(state: HudState): void {
    this.setMunchVisible(state.edible);
    const keepLeft = this.bar.scrollLeft; // rebuilding the slots must not throw the player's place away
    this.bar.replaceChildren();
    const slots: Array<{ id: StackId | null; count: number }> = [
      { id: null, count: 0 },
      ...state.slots.slice(0, BAR_STACKS),
    ];
    slots.forEach((slot, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slot' + (i === state.selected ? ' selected' : '');
      el.dataset.slot = String(i);
      if (slot.id === null) {
        el.textContent = '🖐';
      } else {
        el.append(stackPicture(slot.id, this.iconFor, 'slot-pic'), this.countEl(slot.count));
      }
      this.guard(el);
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (this.allow(`slot${i}`, performance.now())) this.handlers.onSelect(i);
      });
      this.bar.appendChild(el);
    });
    if (state.overflow || state.selected > BAR_STACKS) this.bar.appendChild(this.bagSlot(state));
    this.bar.scrollLeft = keepLeft;
    const key = `${state.selected}:${state.pick?.id ?? ''}`;
    if (key !== this.lastSelected) this.revealSelected();
    this.lastSelected = key;
    this.updateHints();
  }

  private countEl(n: number): HTMLElement {
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(n);
    return count;
  }

  /** The 9th stack place: a bag picture, or the selected stack's picture when it is hidden behind the bag. */
  private bagSlot(state: HudState): HTMLElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'slot bag-slot' + (state.selected === BAR_STACKS + 1 ? ' selected' : '');
    el.dataset.slot = String(BAR_STACKS + 1);
    el.setAttribute('aria-label', 'Bag');
    const hidden = state.selected === BAR_STACKS + 1 ? state.pick : undefined;
    if (hidden) {
      el.append(stackPicture(hidden.id, this.iconFor, 'slot-pic'), this.countEl(hidden.count));
      const bag = document.createElement('span');
      bag.className = 'bag-corner';
      bag.textContent = '🎒';
      el.appendChild(bag);
    } else {
      el.textContent = '🎒';
    }
    this.guard(el);
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (this.allow('bag', performance.now())) this.handlers.onBag?.();
    });
    return el;
  }

  showBubble(picture: string, word?: string): void {
    this.bubblePicture.textContent = picture;
    this.bubbleWord.textContent = word ?? '';
    this.bubble.hidden = false;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hideBubble(), 4000);
  }

  hideBubble(): void {
    clearTimeout(this.bubbleTimer);
    this.bubble.hidden = true;
  }
}
