import type { Action, ButtonMapping } from './mapping';
import { createDebouncer } from './tap';

function browserPads(): (Gamepad | null)[] {
  return typeof navigator === 'undefined' ? [] : navigator.getGamepads?.() ?? [];
}

function axis(value = 0): number {
  if (!Number.isFinite(value) || Math.abs(value) < 0.25) return 0;
  return Math.max(-1, Math.min(1, value));
}

export class GamepadInput {
  private activePad: string | null = null;
  private previous: boolean[] = [];
  private placeSince: number | null = null;
  private readonly allow = createDebouncer();
  private capturePromise: Promise<number> | null = null;
  private captureResolve: ((button: number) => void) | null = null;

  constructor(
    private readonly mapping: ButtonMapping,
    private readonly getPads: () => (Gamepad | null)[] = browserPads,
  ) {}

  poll(now: number): { stick: [number, number]; pressed: Action[] } {
    let pad: Gamepad | undefined;
    try {
      pad = this.getPads().find((candidate): candidate is Gamepad => !!candidate?.connected);
    } catch {
      // The browser may block the Gamepad API; touch input remains available.
    }
    const identity = pad ? `${pad.index}:${pad.id}` : null;
    if (identity !== this.activePad) {
      this.activePad = identity;
      this.previous = [];
      this.placeSince = null;
    }
    if (!pad) return { stick: [0, 0], pressed: [] };

    const down = pad.buttons.map((button) => button.pressed);
    const rising = (index: number): boolean => !!down[index] && !this.previous[index];
    if (this.captureResolve) {
      const button = down.findIndex((pressed, index) => pressed && rising(index));
      this.placeSince = null;
      if (button !== -1) {
        this.captureResolve(button);
        this.captureResolve = null;
        this.capturePromise = null;
      }
      this.previous = down;
      return { stick: [0, 0], pressed: [] };
    }

    const pressed: Action[] = [];
    const emit = (action: Action): void => {
      if (this.allow(`${identity}:${action}`, now)) pressed.push(action);
    };
    for (const action of ['collect', 'place', 'nextSlot'] as const) {
      if (rising(this.mapping[action])) emit(action);
    }
    if (!down[this.mapping.place]) this.placeSince = null;
    else if (rising(this.mapping.place)) this.placeSince = now;
    if (this.placeSince !== null && now - this.placeSince >= 1000) {
      emit('craft');
      this.placeSince = null;
    }

    let x = axis(pad.axes[this.mapping.axisX]);
    let y = axis(pad.axes[this.mapping.axisY]);
    if (this.mapping.invertY && y !== 0) y = -y;
    // D-pad directions override the corresponding stick axis while pressed.
    if (down[14] || down[15]) x = Number(!!down[15]) - Number(!!down[14]);
    if (down[12] || down[13]) y = Number(!!down[13]) - Number(!!down[12]);
    this.previous = down;
    return { stick: [x, y], pressed };
  }

  /** Abandons a pending capture so the next press is a normal action again. */
  cancelCapture(): void {
    this.captureResolve = null;
    this.capturePromise = null;
  }

  /** The regular poll loop resolves setup capture on the next button edge. */
  captureNextButton(): Promise<number> {
    if (!this.capturePromise) {
      this.placeSince = null;
      this.capturePromise = new Promise((resolve) => { this.captureResolve = resolve; });
    }
    return this.capturePromise;
  }
}
