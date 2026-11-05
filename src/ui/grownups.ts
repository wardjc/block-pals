import { checkSum, HoldGate, makeSum } from '../core/gate';
import { SAVE_KEY } from '../core/save';
import { REMINDER_OPTIONS, type UsageTracker } from '../core/usage';
import { saveMapping, type ButtonMapping } from '../input/mapping';

export interface GrownUpsDeps {
  usage: UsageTracker;
  storage: Storage | null;
  /** Used for "Set up controller". */
  captureButton(): Promise<number>;
  cancelCapture(): void;
  getMapping(): ButtonMapping;
  onMappingSaved(m: ButtonMapping): void;
  /** Stops autosave so it cannot rewrite the save while resetting. */
  stopAutosave(): void;
  onOpenChange(open: boolean): void;
  reload?: () => void;
  now?: () => number;
}

/** The sum gate closes by itself after this long without a tap, so a child is never stuck on it. */
const GATE_IDLE_MS = 20_000;

const STEPS: Array<{ key: 'collect' | 'place' | 'nextSlot'; label: string }> = [
  { key: 'collect', label: 'Collect' },
  { key: 'place', label: 'Place' },
  { key: 'nextSlot', label: 'Next slot' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  if (tag === 'button') (e as HTMLButtonElement).type = 'button';
  return e;
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class GrownUps {
  private readonly hold = new HoldGate(3000);
  private readonly ring = el('div', 'gu-ring');
  private readonly overlay = el('div', 'gu-overlay');
  private raf = 0;
  private holdPointer: number | null = null;
  private open_ = false;
  private captureRun = 0;
  private gateTimer = 0;

  constructor(root: HTMLElement, private readonly deps: GrownUpsDeps) {
    this.ring.hidden = true;
    this.overlay.hidden = true;
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'])
      this.overlay.addEventListener(type, e => e.stopPropagation());
    root.append(this.ring, this.overlay);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  private now(): number {
    return (this.deps.now ?? (() => performance.now()))();
  }

  holdStart(pointerId = 0): void {
    if (this.open_ || this.hold.active) return;
    this.holdPointer = pointerId;
    this.hold.start(this.now());
    this.ring.hidden = false;
    const step = (): void => {
      const t = this.now();
      this.ring.style.setProperty('--p', String(this.hold.progress(t) * 360) + 'deg');
      if (this.hold.poll(t)) {
        this.ring.hidden = true;
        this.showGate();
        return;
      }
      if (this.hold.active) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  holdEnd(pointerId = 0): void {
    if (this.holdPointer !== null && pointerId !== this.holdPointer) return;
    this.holdPointer = null;
    this.hold.release();
    cancelAnimationFrame(this.raf);
    this.ring.hidden = true;
  }

  private show(): void {
    if (!this.open_) {
      this.open_ = true;
      this.deps.onOpenChange(true);
    }
    this.overlay.hidden = false;
    this.overlay.replaceChildren();
  }

  close(): void {
    this.stopGateTimer();
    this.captureRun++;
    this.deps.cancelCapture();
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
    if (this.open_) {
      this.open_ = false;
      this.deps.onOpenChange(false);
    }
  }

  private stopGateTimer(): void {
    clearTimeout(this.gateTimer);
    this.gateTimer = 0;
  }

  private restartGateTimer = (): void => {
    clearTimeout(this.gateTimer);
    this.gateTimer = window.setTimeout(() => this.close(), GATE_IDLE_MS);
  };

  private showGate(): void {
    this.show();
    this.restartGateTimer();
    const sum = makeSum();
    let input = '';
    const card = el('div', 'gu-card gu-gate');
    const question = el('div', 'gu-sum', `${sum.a} + ${sum.b} = ?`);
    question.dataset.testid = 'gate-sum';
    const display = el('div', 'gu-display', ' ');
    const pad = el('div', 'gu-pad');
    const refresh = (): void => { display.textContent = input || ' '; };
    const key = (label: string, cls: string, fn: () => void): void => {
      const b = el('button', 'gu-key ' + cls, label);
      b.addEventListener('click', fn);
      pad.appendChild(b);
    };
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) key(d, '', () => { if (input.length < 3) { input += d; refresh(); } });
    key('⌫', 'gu-del', () => { input = input.slice(0, -1); refresh(); });
    key('0', '', () => { if (input.length < 3) { input += '0'; refresh(); } });
    key('OK', 'gu-ok', () => {
      if (checkSum(sum, input)) this.showPanel();
      else this.close(); // wrong answer closes quietly
    });
    card.append(question, display, pad);
    // Only while this gate is still up: the OK click bubbles here after it opened the panel.
    const poke = (): void => { if (this.gateTimer !== 0 && card.isConnected) this.restartGateTimer(); };
    card.addEventListener('pointerdown', poke);
    card.addEventListener('click', poke);
    // A big way out for a child who got here by accident.
    const x = el('button', 'gu-x', '✖');
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => this.close());
    this.overlay.append(card, x);
  }

  private showPanel(): void {
    this.stopGateTimer();
    this.show();
    const { usage } = this.deps;
    const card = el('div', 'gu-card gu-panel');
    card.appendChild(el('h2', 'gu-title', 'Grown-ups'));

    const today = Math.round(usage.minutesOn(localKey(new Date())));
    const todayEl = el('p', 'gu-today', `Today: ${today} minute${today === 1 ? '' : 's'} played`);
    card.appendChild(todayEl);

    const days = usage.last7Days().map(d => ({ ...d, minutes: Math.round(d.minutes) }));
    const max = Math.max(1, ...days.map(d => d.minutes));
    const bars = el('div', 'gu-bars');
    for (const d of days) {
      const row = el('div', 'gu-bar-row');
      const bar = el('div', 'gu-bar');
      bar.style.width = `${Math.round((d.minutes / max) * 100)}%`;
      row.append(el('span', 'gu-bar-date', new Date(`${d.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })), bar, el('span', 'gu-bar-min', `${d.minutes} min`));
      bars.appendChild(row);
    }
    card.appendChild(bars);

    card.appendChild(el('h3', 'gu-sub', 'Break reminder (a gentle suggestion only; the game is never locked)'));
    const sel = el('div', 'gu-options');
    const mark = (): void => {
      sel.querySelectorAll('button').forEach(b => b.classList.toggle('on', Number(b.dataset.minutes) === usage.reminderMinutes));
    };
    for (const m of REMINDER_OPTIONS) {
      const b = el('button', 'gu-opt', m === 0 ? 'Off' : `${m} min`);
      b.dataset.minutes = String(m);
      b.addEventListener('click', () => { usage.reminderMinutes = m; usage.flush(); mark(); });
      sel.appendChild(b);
    }
    card.appendChild(sel);
    mark();

    const setup = el('button', 'gu-action', 'Set up controller');
    const status = el('p', 'gu-status');
    setup.addEventListener('click', () => this.setupController(status));
    card.append(setup, status);

    const reset = el('button', 'gu-action gu-danger', 'Reset progress');
    const confirm = el('div', 'gu-confirm');
    confirm.hidden = true;
    reset.addEventListener('click', () => { confirm.hidden = false; reset.hidden = true; });
    confirm.append(
      el('p', 'gu-warn', 'This deletes the world and everything collected. Usage history is kept. Are you sure?'),
    );
    const yes = el('button', 'gu-action gu-danger', 'Yes, reset everything');
    yes.addEventListener('click', () => this.resetProgress());
    const no = el('button', 'gu-action', 'No, keep it');
    no.addEventListener('click', () => { confirm.hidden = true; reset.hidden = false; });
    confirm.append(yes, no);
    card.append(reset, confirm);

    const done = el('button', 'gu-close', 'Close');
    done.addEventListener('click', () => this.close());
    card.appendChild(done);
    this.overlay.appendChild(card);
  }

  private async setupController(status: HTMLElement): Promise<void> {
    const run = ++this.captureRun;
    const next = { ...this.deps.getMapping() };
    for (const step of STEPS) {
      status.textContent = `Press the button for "${step.label}" on the controller...`;
      const button = await this.deps.captureButton();
      if (run !== this.captureRun) return;
      next[step.key] = button;
    }
    saveMapping(this.deps.storage, next);
    this.deps.onMappingSaved(next);
    status.textContent = 'Controller saved.';
  }

  private resetProgress(): void {
    this.deps.stopAutosave();
    try { this.deps.storage?.removeItem(SAVE_KEY); } catch { /* storage blocked: nothing to clear */ }
    this.deps.usage.flush();
    (this.deps.reload ?? (() => location.reload()))();
  }
}
