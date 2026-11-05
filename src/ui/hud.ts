import type { BlockId } from '../core/blocks';
import { createDebouncer } from '../input/tap';

export interface HudHandlers {
  onSelect(i: number): void;
  onCraft(): void;
  onGrownUps(): void;
}

export interface HudState {
  hotbar: Array<{ id: BlockId; count: number }>;
  /** 0 = hand, 1.. = hotbar slot. */
  selected: number;
}

export class Hud {
  /** Set by later tasks (craft screen, grown-ups gate) while a full-screen overlay is up. */
  blockingOverlayOpen = false;

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
    root.appendChild(grownUps);

    this.bubble.className = 'bubble';
    this.bubble.hidden = true;
    this.bubblePicture.className = 'bubble-picture';
    this.bubbleWord.className = 'bubble-word';
    this.bubble.append(this.bubblePicture, this.bubbleWord);
    root.appendChild(this.bubble);
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
      ...state.hotbar.slice(0, 6),
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
