import type { BlockId } from '../core/blocks';
import { createDebouncer } from '../input/tap';

export interface HudHandlers {
  onSelect(i: number): void;
  onCraft(): void;
  onGrownUps(): void;
  /** Hotspot press and release, for the 3 second hold. */
  onGrownUpsHold?(down: boolean, pointerId: number): void;
}

export interface HudState {
  hotbar: Array<{ id: BlockId; count: number }>;
  /** 0 = hand, 1.. = hotbar slot. */
  selected: number;
}

export class Hud {
  /** Set by later tasks (craft screen, grown-ups gate) while a full-screen overlay is up. */
  blockingOverlayOpen = false;

  setOverlayOpen(open: boolean): void {
    this.blockingOverlayOpen = open;
  }

  private readonly bar = document.createElement('div');
  private readonly bubble = document.createElement('div');
  private readonly bubblePicture = document.createElement('span');
  private readonly bubbleWord = document.createElement('span');
  private bubbleTimer = 0;
  private readonly allow = createDebouncer(150);

  constructor(
    root: HTMLElement,
    private readonly iconFor: (id: BlockId) => string,
    private readonly handlers: HudHandlers,
  ) {
    this.bar.className = 'hotbar';
    root.appendChild(this.bar);

    const craft = this.button('craft-btn', '🛠️', () => handlers.onCraft());
    craft.setAttribute('aria-label', 'Craft');
    root.appendChild(craft);

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

  render(state: HudState): void {
    this.bar.replaceChildren();
    const slots: Array<{ id: BlockId | null; count: number }> = [
      { id: null, count: 0 },
      ...state.hotbar.slice(0, 9), // all nine collectable kinds fit: 10 × 96 px
    ];
    slots.forEach((slot, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slot' + (i === state.selected ? ' selected' : '');
      el.dataset.slot = String(i);
      if (slot.id === null) {
        el.textContent = '🖐';
      } else {
        const img = document.createElement('img');
        img.src = this.iconFor(slot.id);
        img.alt = '';
        img.draggable = false;
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(slot.count);
        el.append(img, count);
      }
      this.guard(el);
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (this.allow(`slot${i}`, performance.now())) this.handlers.onSelect(i);
      });
      this.bar.appendChild(el);
    });
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
