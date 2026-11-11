// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { BlockId } from '../../src/core/blocks';
import type { StackId } from '../../src/core/items';
import { Hud, hudStateFor } from '../../src/ui/hud';
import { Inventory } from '../../src/core/inventory';
import { CraftScreen } from '../../src/ui/craft';

const css = readFileSync('src/ui/styles.css', 'utf8');
/** The declarations of the first rule whose selector list is exactly `sel` (top level, not inside @media). */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.#>[\]="-]/g, m => `\\${m}`);
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${sel}`);
  return m[1];
};
const media = (query: string): string => {
  const i = css.indexOf(`@media ${query}`);
  if (i < 0) throw new Error(`no @media ${query}`);
  let depth = 0;
  for (let j = css.indexOf('{', i); j < css.length; j++) {
    if (css[j] === '{') depth++;
    if (css[j] === '}' && --depth === 0) return css.slice(css.indexOf('{', i) + 1, j);
  }
  throw new Error('unbalanced');
};

describe('small-screen CSS rules', () => {
  test('the hotbar never outgrows the screen and scrolls sideways by touch', () => {
    const r = rule('.hotbar');
    expect(r).toMatch(/max-width: calc\(100vw - 16px\)/);
    expect(r).toMatch(/max-width: calc\(100dvw - 16px\)/);
    expect(r).toMatch(/overflow-x: auto/);
    expect(r).toMatch(/overflow-y: hidden/);
    expect(r).toMatch(/scroll-snap-type: x proximity/);
    expect(r).toMatch(/-webkit-overflow-scrolling: touch/);
    expect(r).toMatch(/touch-action: pan-x/);
    expect(r).toMatch(/overscroll-behavior-x: contain/);
    expect(r).toMatch(/box-sizing: border-box/);
  });

  test('slots never shrink below the 88 px target and snap', () => {
    const r = rule('.slot');
    expect(Number(r.match(/width: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
    expect(Number(r.match(/height: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
    expect(r).toMatch(/flex: 0 0 auto/);
    expect(r).toMatch(/scroll-snap-align: /);
  });

  test('more slots off an edge show a fade hint', () => {
    expect(css).toMatch(/\.hotbar\.more-start/);
    expect(css).toMatch(/\.hotbar\.more-end/);
    expect(css).toMatch(/mask-image: linear-gradient/);
  });

  test('very short screens trim the bar padding but keep 88 px slots, and move the munch button clear', () => {
    const m = media('(max-height: 419px)');
    expect(m).toMatch(/\.hotbar \{[^}]*padding/);
    expect(m).toMatch(/\.munch-btn \{/);
    for (const w of m.matchAll(/(?:width|height): (\d+)px/g)) if (m.includes('.slot')) expect(Number(w[1])).toBeGreaterThanOrEqual(88);
  });

  test('tall overlays scroll inside themselves and keep their close buttons fixed in view', () => {
    for (const sel of ['.craft-list', '.bag-tray', '.gu-overlay']) {
      expect(rule(sel), sel).toMatch(/overflow-y: auto/);
      expect(rule(sel), sel).toMatch(/touch-action: pan-y/);
    }
    expect(rule('.gu-card')).toMatch(/max-height: calc\(100dvh - 16px\)/);
    expect(rule('.gu-card')).toMatch(/overflow-y: auto/);
    for (const sel of ['.craft-close', '.bag-close']) expect(rule(sel), sel).toMatch(/position: fixed/);
    expect(rule('.gu-close')).toMatch(/position: sticky/);
    expect(rule('.break-bubble')).toMatch(/max-width: calc\(100vw - 16px\)/);
  });
});

const ids: StackId[] = [BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Wood, BlockId.Leaves, BlockId.Sand, BlockId.Planks, BlockId.Glass];
const stacks = ids.map((id, i) => ({ id, count: i + 1 }));

/** jsdom has no layout: give the bar 300 px of window over 96 px slots 104 px apart. */
const slotNo = (el: HTMLElement): number | null => (el.dataset.slot === undefined ? null : Number(el.dataset.slot));
Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { const n = slotNo(this); return n === null ? 0 : 8 + n * 104; } });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return slotNo(this) === null ? 0 : 96; } });

function make() {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const hud = new Hud(root, id => `t${id}`, { onSelect: () => {}, onCraft: () => {}, onGrownUps: () => {} });
  const bar = root.querySelector('.hotbar') as HTMLElement;
  Object.defineProperty(bar, 'clientWidth', { value: 300, configurable: true });
  Object.defineProperty(bar, 'scrollWidth', { value: 9 * 104 + 8, configurable: true });
  return { hud, bar };
}

describe('hotbar scrolling', () => {
  test('a vertical wheel scrolls the bar sideways and is swallowed', () => {
    const { hud, bar } = make();
    hud.render(hudStateFor(stacks, 'hand', false));
    const ev = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    bar.dispatchEvent(ev);
    expect(bar.scrollLeft).toBe(120);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('a changed selection scrolls its slot into view; an unchanged one keeps the place the player scrolled to', () => {
    const { hud, bar } = make();
    hud.render(hudStateFor(stacks, 'hand', false));
    hud.render(hudStateFor(stacks, ids[6], false)); // slot 7 spans 736..832, window 0..300
    expect(bar.scrollLeft).toBe(832 + 8 - 300);
    bar.scrollLeft = 200; // the player scrolls a little
    hud.render(hudStateFor(stacks.map(s => ({ ...s, count: s.count + 1 })), ids[6], false)); // counts change: same selection
    expect(bar.scrollLeft).toBe(200);
  });

  test('edge hints show only for the side that has more', () => {
    const { hud, bar } = make();
    hud.render(hudStateFor(stacks, 'hand', false));
    expect(bar.classList.contains('more-end')).toBe(true);
    expect(bar.classList.contains('more-start')).toBe(false);
    bar.scrollLeft = 200;
    bar.dispatchEvent(new Event('scroll'));
    expect(bar.classList.contains('more-start')).toBe(true);
  });
});

describe('the craft list follows the controller', () => {
  test('opening and every pad move bring the selected row into view', () => {
    document.body.replaceChildren();
    const revealed: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { revealed.push(this); };
    const inv = new Inventory();
    const screen = new CraftScreen(document.body, {
      inventory: inv, tryCraft: () => false, iconFor: () => '', say: () => {}, sayNeedMore: () => {},
      sfxTap: () => {}, sfxCraft: () => {}, onOpenChange: () => {}, now: () => 0,
    });
    screen.open();
    const rows = [...document.querySelectorAll('.craft-row')];
    expect(rows.length).toBe(7);
    expect(revealed.at(-1)).toBe(rows[0]);
    for (let i = 1; i < 7; i++) {
      screen.padInput([1, 0], []);
      screen.padInput([0, 0], []);
      expect(revealed.at(-1), `row ${i}`).toBe(rows[i]);
    }
    screen.padInput([-1, 0], []); // back round
    expect(revealed.at(-1)).toBe(rows[5]);
  });
});

describe('the bag slot shows different stacks', () => {
  test('a new stack behind the bag slot is revealed though the slot index stays 9', () => {
    const { hud, bar } = make();
    const many = [...stacks, { id: BlockId.Bricks as StackId, count: 1 }, { id: BlockId.Sand as StackId, count: 1 }, { id: BlockId.PathStone as StackId, count: 1 }];
    hud.render(hudStateFor(many, BlockId.Bricks, false));
    expect(bar.scrollLeft).toBeGreaterThan(0);
    bar.scrollLeft = 0; // the player swipes back
    hud.render(hudStateFor(many, BlockId.Sand, false)); // pad "next slot": still slot 9, another stack
    expect(bar.scrollLeft).toBeGreaterThan(0);
  });
});
