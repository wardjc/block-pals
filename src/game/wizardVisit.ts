import type { Rect } from '../core/houses';
import type { Cell } from '../core/pathfind';

/** The wizard says hello at most once a minute. */
export const WIZARD_GREET_COOLDOWN_MS = 60_000;
/** Walking away cancels a hello only while it can still be speaking. */
export const WIZARD_GREET_SPEAK_MS = 8_000;
/** How far above or below the tower's ground he may stand and still be "at the tower" (both floors). */
const FLOOR_REACH = 8;

/**
 * Decides when Orlo says hello (spec §7g), like a neighbour's `GreetTracker`: once per visit when
 * he enters the tower or its doorstep, at most once a minute, never while `busy`. Pure: no audio,
 * no DOM. The caller works out `busy` with `mayWizardGreet` (Pip has a line waiting, the break
 * bubble is open, audio is locked, a voice line is playing, he is pressing or dragging) or an overlay.
 */
export class WizardVisit {
  private lastHello = -Infinity;
  /** He is standing in the greet area and this visit's hello has been said or given up. */
  private visited = false;
  private inZone = false;
  private active: number | null = null;
  private cancel = false;
  private everEntered = false;
  private firstPending = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  private static inside(c: Cell, tower: { greetRect: Rect; groundY: number }): boolean {
    const r = tower.greetRect;
    return c[0] >= r.x0 && c[0] <= r.x1 && c[2] >= r.z0 && c[2] <= r.z1 && Math.abs(c[1] - tower.groundY) <= FLOOR_REACH;
  }

  /** Call every frame. Returns 'hello' when the wizard should greet him now. */
  update(playerCell: Cell, tower: { greetRect: Rect; groundY: number }, busy: boolean): 'hello' | null {
    const t = this.now();
    const inZone = WizardVisit.inside(playerCell, tower);
    this.inZone = inZone;

    // He walked away while the hello may still be playing: stop it.
    if (this.active !== null) {
      if (t - this.active >= WIZARD_GREET_SPEAK_MS) this.active = null;
      else if (!inZone) { this.cancel = true; this.active = null; }
    }

    if (!inZone) { this.visited = false; return null; }
    if (!this.everEntered) { this.everEntered = true; this.firstPending = true; }
    if (this.visited || busy) return null;
    if (t - this.lastHello < WIZARD_GREET_COOLDOWN_MS) { this.visited = true; return null; }
    this.visited = true;
    this.lastHello = t;
    this.active = t;
    return 'hello';
  }

  /** The hello was held too long (audio locked): none until he leaves and returns. The cooldown is not used. */
  skipCurrent(): void {
    if (this.inZone) this.visited = true;
  }

  /** True once after he walked away from a hello that was still being spoken. */
  takeCancel(): boolean {
    const c = this.cancel;
    this.cancel = false;
    return c;
  }

  /** True once, the first time this session he stands in the greet area (the caller saves wizard.met). */
  firstEnter(): boolean {
    const f = this.firstPending;
    this.firstPending = false;
    return f;
  }
}
