// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ItemId, ITEMS, type StackId } from '../../src/core/items';
import { BAR_STACKS, Hud, hudStateFor, type HudState } from '../../src/ui/hud';
import { readFileSync } from 'node:fs';

const BLOCKS_10: StackId[] = [
  BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Wood, BlockId.Leaves, BlockId.Sand, BlockId.Planks, BlockId.Glass, BlockId.Bricks,
  BlockId.PathStone,
];
const stacks = (ids: StackId[]) => ids.map((id, i) => ({ id, count: i + 1 }));

function make() {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const calls = { select: [] as number[], bag: 0, munch: 0 };
  const hud = new Hud(root, id => `tile-${id}`, {
    onSelect: i => calls.select.push(i), onCraft: () => {}, onGrownUps: () => {}, onBag: () => { calls.bag++; },
  });
  return { root, hud, calls };
}
const slotEls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.hotbar .slot')];
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

let t = 0;
beforeEach(() => { t += 1000; });

describe('hotbar', () => {
  test('8 or fewer stacks show no bag slot and look exactly like step 1 (hand + stacks, digit only)', () => {
    const { root, hud } = make();
    hud.render(hudStateFor(stacks(BLOCKS_10.slice(0, 8)), BlockId.Stone, false));
    const els = slotEls(root);
    expect(els.length).toBe(9);
    expect(root.querySelector('.bag-slot')).toBeNull();
    expect(els[0].textContent).toBe('🖐');
    expect(els[3].classList.contains('selected')).toBe(true);
    expect(els[1].querySelector('img')!.getAttribute('src')).toBe(`tile-${BlockId.Grass}`);
    expect(els[1].querySelector('.count')!.textContent).toBe('1');
  });

  test('10 stacks show 8 plus a bag slot', () => {
    const { root, hud, calls } = make();
    const state = hudStateFor(stacks(BLOCKS_10), 'hand', false);
    expect(state.overflow).toBe(true);
    hud.render(state);
    const els = slotEls(root);
    expect(els.length).toBe(1 + BAR_STACKS + 1);
    expect(root.querySelector('.bag-slot')!.textContent).toBe('🎒');
    expect(els[0].classList.contains('selected')).toBe(true);
    click(els[9]);
    expect(calls.bag).toBe(1);
    expect(calls.select).toEqual([]);
  });

  test('selecting a stack beyond the 8 shows it in the bag slot, highlighted', () => {
    const { root, hud } = make();
    const state = hudStateFor(stacks(BLOCKS_10), BlockId.PathStone, false);
    expect(state.selected).toBe(9);
    hud.render(state);
    const bag = root.querySelector('.bag-slot')!;
    expect(bag.classList.contains('selected')).toBe(true);
    expect(bag.querySelector('img')!.getAttribute('src')).toBe(`tile-${BlockId.PathStone}`);
    expect(bag.querySelector('.count')!.textContent).toBe('10');
    expect(bag.querySelector('.bag-corner')!.textContent).toBe('🎒');
    expect(slotEls(root).filter(e => e.classList.contains('selected')).length).toBe(1);
  });

  test('selected beyond 8 with exactly 8 stacks cannot happen, and a selection within 8 keeps the bag slot plain', () => {
    const { root, hud } = make();
    hud.render(hudStateFor(stacks(BLOCKS_10), BlockId.Wood, false));
    expect(root.querySelector('.bag-slot')!.textContent).toBe('🎒');
    expect(root.querySelector('.bag-slot')!.classList.contains('selected')).toBe(false);
  });

  test('items show their picture, and a seed shows its crop badge', () => {
    const { root, hud } = make();
    hud.render(hudStateFor(stacks([BlockId.Wood, ItemId.WheatSeed, ItemId.Apple]), ItemId.WheatSeed, false));
    const els = slotEls(root);
    expect(els[2].querySelector('.pic-item')!.textContent).toContain(ITEMS[ItemId.WheatSeed].icon);
    expect(els[2].querySelector('.pic-badge')!.textContent).toBe('🌾');
    expect(els[3].querySelector('.pic-badge')).toBeNull();
    expect(els[2].classList.contains('selected')).toBe(true);
  });

  test('tapping a bar slot selects it by index', () => {
    const { root, hud, calls } = make();
    hud.render(hudStateFor(stacks(BLOCKS_10.slice(0, 3)), 'hand', false));
    click(slotEls(root)[2]);
    expect(calls.select).toEqual([2]);
    void t;
  });
});

describe('munch button', () => {
  const state = (id: StackId | 'hand', hud?: Hud): HudState => {
    const s = hudStateFor(stacks([BlockId.Wood, ...Object.values(ItemId).filter((v): v is ItemId => typeof v === 'number')]), id,
      id !== 'hand' && id in ITEMS && ITEMS[id as ItemId].edible);
    void hud;
    return s;
  };

  test('is shown for apple, carrot, potato, milk and for nothing else', () => {
    const { root, hud } = make();
    const btn = root.querySelector<HTMLButtonElement>('.munch-btn')!;
    expect(btn.hidden).toBe(true);
    const ids: Array<StackId | 'hand'> = ['hand', BlockId.Wood, ...Object.values(ItemId).filter((v): v is ItemId => typeof v === 'number')];
    const shown = ids.filter(id => {
      hud.render(state(id));
      return !btn.hidden;
    });
    expect(shown).toEqual([ItemId.Apple, ItemId.Carrot, ItemId.Potato, ItemId.Milk]);
  });

  test('is a picture-only 96 px target', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const rule = css.match(/\.munch-btn \{([^}]*)\}/)![1];
    expect(rule).toMatch(/width: 96px/);
    expect(rule).toMatch(/height: 96px/);
    const { root } = make();
    expect(root.querySelector('.munch-btn')!.textContent).toBe('👄');
  });

  test('taps are debounced', () => {
    const { root, hud } = make();
    let n = 0;
    hud.onMunch(() => { n++; });
    hud.setMunchVisible(true);
    const btn = root.querySelector('.munch-btn')!;
    const orig = performance.now;
    let now = 5000;
    performance.now = () => now;
    try {
      click(btn); now += 20; click(btn); now += 20; click(btn);
      expect(n).toBe(1);
      now += 400; click(btn);
      expect(n).toBe(2);
    } finally {
      performance.now = orig;
    }
  });
});

describe('touch target sizes', () => {
  const css = readFileSync('src/ui/styles.css', 'utf8');
  const px = (rule: string, prop: string): number => Number(rule.match(new RegExp(`(?:^|[\\s;])${prop}: (\\d+)px`))?.[1]);
  const rule = (sel: string): string => css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))![1];

  test('bar slots, bag close and munch are at least 88 px', () => {
    for (const sel of ['.slot', '.bag-close', '.munch-btn']) {
      expect(px(rule(sel), 'width')).toBeGreaterThanOrEqual(88);
      expect(px(rule(sel), 'height')).toBeGreaterThanOrEqual(88);
    }
  });
});
