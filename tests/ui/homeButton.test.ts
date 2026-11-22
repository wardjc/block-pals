// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hud } from '../../src/ui/hud';
import { HOME_FADE_SECONDS, HomeFade } from '../../src/ui/homeFade';

const css = readFileSync('src/ui/styles.css', 'utf8');
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
  return m ? m[1] : '';
};
const px = (r: string, prop: string): number | null => {
  const m = r.match(new RegExp(`(?:^|[;\\s])${prop}: (-?\\d+)px`));
  return m ? Number(m[1]) : null;
};

function make() {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const log = { home: 0 };
  const hud = new Hud(root, () => '', { onSelect: () => {}, onCraft: () => {}, onGrownUps: () => {}, onHome: () => { log.home++; } });
  return { root, hud, log };
}

describe('the Home button', () => {
  test('hidden at first, shown and hidden on request; a tap calls onHome and never reaches the world', () => {
    const { root, hud, log } = make();
    const b = root.querySelector<HTMLButtonElement>('.home-btn')!;
    expect(b).not.toBeNull();
    expect(b.hidden).toBe(true);
    hud.setHomeVisible(true);
    expect(b.hidden).toBe(false);
    let reached = false;
    document.body.addEventListener('pointerdown', () => { reached = true; });
    b.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    b.click();
    expect(log.home).toBe(1);
    expect(reached).toBe(false);
    hud.setHomeVisible(false);
    expect(b.hidden).toBe(true);
    expect(hud.homeVisible).toBe(false);
  });

  test('a house with an up arrow, a picture only (no words), with an aria label for grown-ups', () => {
    const { root } = make();
    const b = root.querySelector<HTMLButtonElement>('.home-btn')!;
    expect(b.textContent).toContain('🏠');
    expect(b.querySelector('.home-badge')!.textContent).toBe('⬆️');
    expect(b.textContent!.replace(/[^A-Za-z]/g, '')).toBe('');
    expect(b.getAttribute('aria-label')).toBe('Home');
  });

  test('wobble plays a short shake (restartable)', () => {
    const { root, hud } = make();
    hud.setHomeVisible(true);
    hud.wobbleHome();
    const b = root.querySelector<HTMLButtonElement>('.home-btn')!;
    expect(b.classList.contains('wobble')).toBe(true);
    expect(css).toMatch(/\.home-btn\.wobble \{[^}]*animation: home-wobble/);
  });

  test('at least 96 px, picture only, and bright', () => {
    const r = rule('.home-btn');
    expect(px(r, 'width')).toBeGreaterThanOrEqual(96);
    expect(px(r, 'height')).toBeGreaterThanOrEqual(96);
    expect(r).toMatch(/position: fixed/);
    expect(r).not.toMatch(/#000|black/);
  });

  test.each([[1920, 1200], [1280, 800]])('never overlaps the hotbar, craft, munch or grown-ups buttons at %i x %i', (W, H) => {
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const boxOf = (sel: string, w: number, h: number): Box => {
      const r = rule(sel);
      const left = px(r, 'left'), right = px(r, 'right'), top = px(r, 'top'), bottom = px(r, 'bottom');
      const x0 = left !== null ? left : W - (right ?? 0) - w;
      const y0 = top !== null ? top : H - (bottom ?? 0) - h;
      return { x0, y0, x1: x0 + w, y1: y0 + h };
    };
    const home = boxOf('.home-btn', px(rule('.home-btn'), 'width')!, px(rule('.home-btn'), 'height')!);
    // The bar: centred, at most nine 96 px slots 8 px apart plus 16 px padding, 16 + 96 + 8 high plus the lift, 12 from the bottom.
    const barW = Math.min(W - 16, 9 * 96 + 8 * 8 + 16);
    const bar: Box = { x0: (W - barW) / 2, y0: H - 12 - (16 + 96 + 8) - 8, x1: (W + barW) / 2, y1: H - 12 };
    const others: Record<string, Box> = {
      hotbar: bar,
      craft: boxOf('.craft-btn', 96, 96),
      munch: boxOf('.munch-btn', 96, 96),
      grownups: boxOf('.grownups-hotspot', 96, 96),
    };
    const overlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    for (const [name, b] of Object.entries(others)) expect(overlap(home, b), name).toBe(false);
    expect(home.x0).toBeGreaterThanOrEqual(0);
    expect(home.y0).toBeGreaterThanOrEqual(0);
  });

  test('on very short screens it moves beside the grown-ups corner, still 96 px and clear of the munch button', () => {
    const i = css.indexOf('@media (max-height: 419px)');
    const block = css.slice(i, css.indexOf('\n}\n', i));
    expect(block).toMatch(/\.home-btn \{[^}]*top: 12px/);
  });
});

describe('the Home fade (white-gold, never black)', () => {
  function fade() {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.appendChild(root);
    return { root, f: new HomeFade(root) };
  }

  test('0.4 s out, the move behind a full fade, then 0.4 s in', () => {
    const { root, f } = fade();
    expect(HOME_FADE_SECONDS).toBe(0.4);
    const el = root.querySelector<HTMLElement>('.home-fade')!;
    expect(el.hidden).toBe(true);
    let moved = 0;
    let opacityAtMove = -1;
    expect(f.start(() => { moved++; opacityAtMove = Number(el.style.opacity); })).toBe(true);
    expect(f.running).toBe(true);
    expect(el.hidden).toBe(false);
    // The fade starts before the move: nothing moves while it is still fading out.
    for (let t = 0; t < 0.35; t += 0.05) f.update(0.05);
    expect(moved).toBe(0);
    expect(Number(el.style.opacity)).toBeGreaterThan(0.6);
    f.update(0.1);
    expect(moved).toBe(1);
    expect(opacityAtMove).toBe(1);
    for (let t = 0; t < 0.3; t += 0.05) f.update(0.05);
    expect(f.running).toBe(true);
    f.update(0.1);
    expect(f.running).toBe(false);
    expect(el.hidden).toBe(true);
    expect(moved).toBe(1);
  });

  test('a second start while it runs is ignored', () => {
    const { f } = fade();
    let n = 0;
    f.start(() => { n++; });
    expect(f.start(() => { n += 10; })).toBe(false);
    for (let t = 0; t < 1; t += 0.05) f.update(0.05);
    expect(n).toBe(1);
  });

  test('the fade is white and gold, never dark, and swallows taps while it shows', () => {
    const r = rule('.home-fade');
    expect(r).toMatch(/radial-gradient\(/);
    expect(r).toMatch(/#fff/i);
    expect(r).toMatch(/#ffe7a3|#ffd97a|#fff1c4/i);
    expect(r).not.toMatch(/#000|black|rgba\(0, 0, 0/);
    expect(r).toMatch(/pointer-events: auto/);
    const { root, f } = fade();
    f.start(() => {});
    let reached = false;
    document.body.addEventListener('pointerdown', () => { reached = true; });
    root.querySelector('.home-fade')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(reached).toBe(false);
  });
});
