/** Each half of the Home lift's fade: out to white-gold, then back in. */
export const HOME_FADE_SECONDS = 0.4;

/**
 * The Home lift's soft white-gold sparkle fade (spec 7h): 0.4 s out, the move happens behind the
 * full fade, 0.4 s back in. Never black. Driven by the frame loop (real time) so it is testable,
 * and it swallows taps while it shows.
 */
export class HomeFade {
  private readonly el = document.createElement('div');
  private t = -1;
  private onMiddle: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el.className = 'home-fade';
    this.el.hidden = true;
    this.el.style.opacity = '0';
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'])
      this.el.addEventListener(type, e => e.stopPropagation());
    root.appendChild(this.el);
  }

  get running(): boolean {
    return this.t >= 0;
  }

  /** Starts the fade; `onMiddle` runs once, when the picture is fully white-gold. False if one is running. */
  start(onMiddle: () => void): boolean {
    if (this.running) return false;
    this.t = 0;
    this.onMiddle = onMiddle;
    this.el.hidden = false;
    this.el.style.opacity = '0';
    return true;
  }

  update(dt: number): void {
    if (!this.running || !(dt > 0)) return;
    this.t += Math.min(dt, 0.1); // a stalled frame never skips the fully-white moment
    if (this.onMiddle && this.t >= HOME_FADE_SECONDS) {
      this.el.style.opacity = '1';
      const cb = this.onMiddle;
      this.onMiddle = null;
      cb();
      return;
    }
    if (this.t >= HOME_FADE_SECONDS * 2) {
      this.t = -1;
      this.el.hidden = true;
      this.el.style.opacity = '0';
      return;
    }
    const k = this.t < HOME_FADE_SECONDS ? this.t / HOME_FADE_SECONDS : 2 - this.t / HOME_FADE_SECONDS;
    this.el.style.opacity = String(Math.max(0, Math.min(1, k)));
  }
}
