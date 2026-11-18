import type { BeaconScreen } from '../render/beacon';

/** The marker is a 64 px picture: a glowing star with a small triangle pointing towards the tower's light. */
export const MARKER_SIZE = 64;

/**
 * A star on the screen edge pointing to the tower's far light (spec §7g) while it is off screen and
 * he has never been inside. Picture only, never tappable (pointer-events: none).
 */
export class EdgeMarker {
  private readonly el = document.createElement('div');
  private readonly arrow = document.createElement('span');
  private shown = false;

  constructor(root: HTMLElement) {
    this.el.className = 'edge-marker';
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.pointerEvents = 'none';
    const star = document.createElement('span');
    star.className = 'edge-star';
    star.textContent = '⭐';
    this.arrow.className = 'edge-arrow';
    this.el.append(star, this.arrow);
    root.appendChild(this.el);
  }

  get visible(): boolean {
    return this.shown;
  }

  get element(): HTMLElement {
    return this.el;
  }

  update(s: BeaconScreen, shown: boolean): void {
    if (shown !== this.shown) {
      this.shown = shown;
      this.el.hidden = !shown;
    }
    if (!shown) return;
    this.el.style.transform = `translate(${Math.round(s.x - MARKER_SIZE / 2)}px, ${Math.round(s.y - MARKER_SIZE / 2)}px)`;
    this.arrow.style.transform = `rotate(${s.angle.toFixed(3)}rad) translateX(${MARKER_SIZE / 2 + 4}px)`;
  }
}
