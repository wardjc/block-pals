// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ALL_SAVE_KEYS } from '../../src/core/save';
import { transferResetKeys } from '../../src/core/saveTransfer';
import { UsageTracker } from '../../src/core/usage';
import { DEFAULT_MAPPING } from '../../src/input/mapping';
import type { ViewSetting } from '../../src/render/viewDistance';
import { loadViewSetting, saveViewSetting, VIEW_SETTING_KEY } from '../../src/render/viewSetting';
import { GrownUps } from '../../src/ui/grownups';

class MemoryStorage implements Storage {
  private readonly m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
}

const throwing = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
} as unknown as Storage;

describe('the stored view setting (blockpals.view.v1)', () => {
  test('loadViewSetting gives auto for a missing, damaged, wrong-version or unknown value', () => {
    const s = new MemoryStorage();
    expect(loadViewSetting(s)).toBe('auto');
    for (const raw of ['{', 'null', '"far"', '[]', '{"v":2,"setting":"far"}', '{"v":1,"setting":"huge"}', '{"v":1}', '{"setting":"far"}']) {
      s.setItem(VIEW_SETTING_KEY, raw);
      expect(loadViewSetting(s), raw).toBe('auto');
    }
    expect(loadViewSetting(null)).toBe('auto');
  });

  test('save then load round-trips auto, near, medium and far', () => {
    const s = new MemoryStorage();
    for (const v of ['near', 'medium', 'far', 'auto'] as ViewSetting[]) {
      saveViewSetting(s, v);
      expect(s.getItem(VIEW_SETTING_KEY)).toBe(JSON.stringify({ v: 1, setting: v }));
      expect(loadViewSetting(s)).toBe(v);
    }
  });

  test('the key is blockpals.view.v1 and is not in ALL_SAVE_KEYS (Reset progress leaves it)', () => {
    expect(VIEW_SETTING_KEY).toBe('blockpals.view.v1');
    expect(ALL_SAVE_KEYS).not.toContain(VIEW_SETTING_KEY);
    expect(transferResetKeys()).not.toContain(VIEW_SETTING_KEY);
  });

  test('blocked or throwing storage never throws and reads auto', () => {
    expect(() => saveViewSetting(throwing, 'far')).not.toThrow();
    expect(loadViewSetting(throwing)).toBe('auto');
  });
});

describe('the grown-ups panel: View distance', () => {
  let t = 0;
  beforeEach(() => { vi.useFakeTimers(); t = 0; });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

  function openPanel(storage: Storage, current: () => ViewSetting, saved: (s: ViewSetting) => void, reload?: () => void) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const gu = new GrownUps(root, {
      usage: new UsageTracker(null), storage, reload,
      captureButton: () => new Promise(() => {}), cancelCapture: () => {},
      getMapping: () => ({ ...DEFAULT_MAPPING }), onMappingSaved: () => {},
      stopAutosave: () => {}, onOpenChange: () => {}, now: () => t,
      getViewSetting: current, onViewSettingSaved: saved,
    });
    gu.holdStart(1);
    t += 3100;
    vi.advanceTimersToNextFrame();
    const [a, b] = root.querySelector('[data-testid="gate-sum"]')!.textContent!.match(/\d+/g)!.map(Number);
    const keys = [...root.querySelectorAll<HTMLButtonElement>('.gu-key')];
    for (const d of String(a + b)) keys.find(k => k.textContent === d)!.click();
    keys.find(k => k.textContent === 'OK')!.click();
    return root;
  }

  test('shows four buttons Auto, Near, Medium, Far; the current one marked on and aria-pressed', () => {
    const root = openPanel(new MemoryStorage(), () => 'medium', () => {});
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.gu-view .gu-opt')];
    expect(buttons.map(b => b.textContent)).toEqual(['Auto', 'Near', 'Medium', 'Far']);
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['View distance: Auto', 'View distance: Near', 'View distance: Medium', 'View distance: Far']);
    expect(buttons.map(b => b.classList.contains('on'))).toEqual([false, false, true, false]);
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(root.textContent).toContain('How far he can see (Auto adjusts to the tablet)');
  });

  test('clicking Far saves, calls onViewSettingSaved("far") and moves the mark', () => {
    const storage = new MemoryStorage();
    let current: ViewSetting = 'auto';
    const saved: ViewSetting[] = [];
    const root = openPanel(storage, () => current, s => { current = s; saved.push(s); });
    root.querySelector<HTMLButtonElement>('.gu-view .gu-opt[data-view="far"]')!.click();
    expect(saved).toEqual(['far']);
    expect(loadViewSetting(storage)).toBe('far');
    const on = [...root.querySelectorAll<HTMLButtonElement>('.gu-view .gu-opt.on')].map(b => b.textContent);
    expect(on).toEqual(['Far']);
  });

  test('Reset progress leaves the stored setting', () => {
    const storage = new MemoryStorage();
    saveViewSetting(storage, 'near');
    storage.setItem('blockpals.save.v3', '{}');
    const root = openPanel(storage, () => 'near', () => {}, () => {});
    [...root.querySelectorAll<HTMLButtonElement>('.gu-action')].find(b => b.textContent === 'Reset progress')!.click();
    [...root.querySelectorAll<HTMLButtonElement>('.gu-action')].find(b => b.textContent === 'Yes, reset everything')!.click();
    expect(storage.getItem('blockpals.save.v3')).toBeNull();
    expect(loadViewSetting(storage)).toBe('near');
  });

  test('each button is at least 88 px wide and tall, and the row wraps so at 360 px wide none is under 88 px', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const rule = (sel: string): string => css.match(new RegExp(`(?:^|\\n)${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
    const opt = rule('.gu-opt'), view = rule('.gu-view .gu-opt'), row = rule('.gu-options');
    expect(Number(opt.match(/min-width: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
    expect(Number(view.match(/min-height: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
    expect(view).toMatch(/flex: 1 1 88px/);
    expect(row).toMatch(/flex-wrap: wrap/);
    // At 360 px wide, the panel (92vw, 28 px padding each side) leaves about 275 px: two 88 px buttons and a
    // 12 px gap fit a row; four do not, so the row wraps to two rows of two and each keeps its 88 px minimum.
    const inner = 360 * 0.92 - 56;
    const perRow = Math.floor((inner + 12) / (88 + 12));
    expect(perRow).toBeGreaterThanOrEqual(2);
    expect(perRow).toBeLessThan(4);
    expect((inner - (perRow - 1) * 12) / perRow).toBeGreaterThanOrEqual(88);
  });
});
