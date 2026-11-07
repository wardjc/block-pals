import type { Action, ButtonMapping } from './mapping';
import { createDebouncer } from './tap';

function browserPads(): (Gamepad | null)[] {
  return typeof navigator === 'undefined' ? [] : navigator.getGamepads?.() ?? [];
}

function axis(value = 0): number {
  if (!Number.isFinite(value) || Math.abs(value) < 0.25) return 0;
  return Math.max(-1, Math.min(1, value));
}

function lookAxis(value = 0): number {
  if (!Number.isFinite(value) || Math.abs(value) <= 0.25) return 0;
  return Math.sign(value) * (Math.min(1, Math.abs(value)) - 0.25) / 0.75;
}

/** A second stick turns the camera (spec §7c). Standard pads put it on axes 2 and 3. */
const LOOK_X = 2;
const LOOK_Y = 3;
const REST_THRESHOLD = 0.9;
const REST_TOLERANCE = 0.02;
const REST_DISABLE_MS = 1000;

export interface PadState {
  stick: [number, number];
  /** Second-stick camera turn, rescaled beyond the 0.25 dead-zone; [0, 0] without a usable stick. */
  look: [number, number];
  pressed: Action[];
}

export class GamepadInput {
  private activePad: string | null = null;
  /** Both look axes must have centred; a resting trigger disables look until reconnect. */
  private lookUsable = false;
  private lookDisabled = false;
  private readonly lookCentred = [false, false];
  private readonly lookRestSince: (number | null)[] = [null, null];
  private readonly lookRestValue = [0, 0];
  private previous: boolean[] = [];
  private placeSince: number | null = null;
  private readonly allow = createDebouncer();
  private capturePromise: Promise<number> | null = null;
  private captureResolve: ((button: number) => void) | null = null;

  constructor(
    private readonly mapping: ButtonMapping,
    private readonly getPads: () => (Gamepad | null)[] = browserPads,
  ) {}

  poll(now: number): PadState {
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
      this.lookUsable = false;
      this.lookDisabled = false;
      this.lookCentred.fill(false);
      this.lookRestSince.fill(null);
    }
    if (!pad) return { stick: [0, 0], look: [0, 0], pressed: [] };
    this.checkSecondStick(pad, now);

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
      return { stick: [0, 0], look: [0, 0], pressed: [] };
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
    const look: [number, number] = this.lookUsable
      ? [lookAxis(pad.axes[LOOK_X]), lookAxis(pad.axes[LOOK_Y])]
      : [0, 0];
    return { stick: [x, y], look, pressed };
  }

  /** Re-check even during setup: generic pads can report zero until their triggers first move. */
  private checkSecondStick(pad: Gamepad, now: number): void {
    this.lookUsable = false;
    if (this.lookDisabled || pad.axes.length <= LOOK_Y) return;
    if (this.mapping.axisX === LOOK_X || this.mapping.axisX === LOOK_Y ||
        this.mapping.axisY === LOOK_X || this.mapping.axisY === LOOK_Y) return;
    for (let i = 0; i < 2; i++) {
      const value = pad.axes[LOOK_X + i];
      if (Number.isFinite(value) && Math.abs(value) < 0.25) this.lookCentred[i] = true;
      if (!Number.isFinite(value) || Math.abs(value) <= REST_THRESHOLD) {
        this.lookRestSince[i] = null;
      } else if (this.lookRestSince[i] === null || Math.abs(value - this.lookRestValue[i]) > REST_TOLERANCE) {
        // Compare to the start of the interval so slow, deliberate motion resets the timer too.
        this.lookRestSince[i] = now;
        this.lookRestValue[i] = value;
      } else if (now - this.lookRestSince[i]! >= REST_DISABLE_MS) {
        this.lookDisabled = true;
      }
    }
    this.lookUsable = !this.lookDisabled && this.lookCentred[0] && this.lookCentred[1];
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
