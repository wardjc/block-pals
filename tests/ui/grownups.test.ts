// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ALL_SAVE_KEYS } from '../../src/core/save';
import { UsageTracker } from '../../src/core/usage';
import { DEFAULT_MAPPING } from '../../src/input/mapping';
import { GrownUps } from '../../src/ui/grownups';

let t = 0;
function make(storage: Storage | null = null, reload?: () => void) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const changes: boolean[] = [];
  const gu = new GrownUps(root, {
    usage: new UsageTracker(null),
    storage,
    reload,
    captureButton: () => new Promise(() => {}),
    cancelCapture: () => {},
    getMapping: () => ({ ...DEFAULT_MAPPING }),
    onMappingSaved: () => {},
    stopAutosave: () => {},
    onOpenChange: open => changes.push(open),
    now: () => t,
  });
  return { root, gu, changes };
}

function openGate(gu: GrownUps): void {
  gu.holdStart(1);
  t += 3100;
  vi.advanceTimersToNextFrame();
}

beforeEach(() => { vi.useFakeTimers(); t = 0; });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('grown-up gate', () => {
  test('has a big close button that shuts the gate', () => {
    const { root, gu, changes } = make();
    openGate(gu);
    expect(gu.isOpen).toBe(true);
    const x = root.querySelector<HTMLButtonElement>('.gu-x');
    expect(x).not.toBeNull();
    expect(x!.getAttribute('aria-label')).toBe('Close');
    x!.click();
    expect(gu.isOpen).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  test('closes by itself after 20 s without input', () => {
    const { gu } = make();
    openGate(gu);
    vi.advanceTimersByTime(19_000);
    expect(gu.isOpen).toBe(true);
    vi.advanceTimersByTime(1_500);
    expect(gu.isOpen).toBe(false);
  });

  test('any tap on the gate restarts the 20 s', () => {
    const { root, gu } = make();
    openGate(gu);
    vi.advanceTimersByTime(15_000);
    root.querySelector<HTMLButtonElement>('.gu-key')!.click();
    vi.advanceTimersByTime(15_000);
    expect(gu.isOpen).toBe(true);
    vi.advanceTimersByTime(6_000);
    expect(gu.isOpen).toBe(false);
  });

  test('the right answer opens the panel, which does not close by itself', () => {
    const { root, gu } = make();
    openGate(gu);
    const [a, b] = root.querySelector('[data-testid="gate-sum"]')!.textContent!.match(/\d+/g)!.map(Number);
    const keys = [...root.querySelectorAll<HTMLButtonElement>('.gu-key')];
    for (const d of String(a + b)) keys.find(k => k.textContent === d)!.click();
    keys.find(k => k.textContent === 'OK')!.click();
    expect(root.querySelector('.gu-panel')).not.toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(gu.isOpen).toBe(true);
  });

  test('reset progress removes every save key (v2, v1 and the backup)', () => {
    const removed: string[] = [];
    const storage = { removeItem: (k: string) => void removed.push(k), getItem: () => null, setItem: () => {} } as unknown as Storage;
    const reload = vi.fn();
    const { root, gu } = make(storage, reload);
    openGate(gu);
    const [a, b] = root.querySelector('[data-testid="gate-sum"]')!.textContent!.match(/\d+/g)!.map(Number);
    const keys = [...root.querySelectorAll<HTMLButtonElement>('.gu-key')];
    for (const d of String(a + b)) keys.find(k => k.textContent === d)!.click();
    keys.find(k => k.textContent === 'OK')!.click();
    root.querySelector<HTMLButtonElement>('.gu-danger')!.click();
    const yes = [...root.querySelectorAll<HTMLButtonElement>('.gu-danger')].find(b2 => b2.textContent?.startsWith('Yes'))!;
    yes.click();
    expect(removed.sort()).toEqual([...ALL_SAVE_KEYS].sort());
    expect(reload).toHaveBeenCalled();
  });
});
