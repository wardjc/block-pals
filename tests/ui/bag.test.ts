// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { BlockId } from '../../src/core/blocks';
import { ItemId, type StackId } from '../../src/core/items';
import { BagTray, MAX_DOTS } from '../../src/ui/bag';

function make(stacks: Array<{ id: StackId; count: number }>, current: StackId | 'hand' = 'hand') {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const log = { selected: [] as StackId[], open: [] as boolean[] };
  const t = { now: 1000 };
  const bag = new BagTray(root, {
    stacks: () => stacks,
    iconFor: id => `tile-${id}`,
    select: id => log.selected.push(id),
    onOpenChange: o => log.open.push(o),
    current: () => current,
    now: () => t.now,
  });
  return { root, bag, log, t };
}
const items = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.bag-stack')];

describe('BagTray', () => {
  const some = [
    { id: BlockId.Wood as StackId, count: 5 }, { id: ItemId.WheatSeed as StackId, count: 20 },
    { id: ItemId.Egg as StackId, count: 21 }, { id: BlockId.Stone as StackId, count: 99 }, { id: ItemId.Milk as StackId, count: 1 },
  ];

  test('lists every stack with its digit; dots equal the count up to 20 and none above', () => {
    const { root, bag } = make(some);
    bag.open();
    const els = items(root);
    expect(els.length).toBe(5);
    expect(MAX_DOTS).toBe(20);
    const read = (el: HTMLElement) => [el.querySelector('.bag-digit')!.textContent, el.querySelectorAll('.bag-dots i').length];
    expect(els.map(read)).toEqual([['5', 5], ['20', 20], ['21', 0], ['99', 0], ['1', 1]]);
    expect(els[1].querySelector('.pic-badge')!.textContent).toBe('🌾');
    expect(els[0].querySelector('img')!.getAttribute('src')).toBe(`tile-${BlockId.Wood}`);
  });

  test('choosing in the tray selects and closes, and pointer events never reach the world', () => {
    const { root, bag, log } = make(some, BlockId.Stone);
    const seen: string[] = [];
    document.body.addEventListener('pointerdown', () => seen.push('pointerdown'));
    document.body.addEventListener('click', () => seen.push('click'));
    bag.open();
    expect(items(root)[3].classList.contains('selected')).toBe(true);
    items(root)[1].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    items(root)[1].click();
    expect(log.selected).toEqual([ItemId.WheatSeed]);
    expect(bag.isOpen).toBe(false);
    expect(log.open).toEqual([true, false]);
    expect(seen).toEqual([]);
  });

  test('the close button closes without choosing', () => {
    const { root, bag, log } = make(some);
    bag.open();
    root.querySelector<HTMLButtonElement>('.bag-close')!.click();
    expect(bag.isOpen).toBe(false);
    expect(log.selected).toEqual([]);
  });

  test('all targets are at least 88 px', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const rule = (sel: string) => css.match(new RegExp(`${sel.replace('.', '\\.')} \\{([^}]*)\\}`))![1];
    expect(Number(rule('.bag-close').match(/width: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
    expect(Number(rule('.bag-close').match(/height: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
    expect(Number(rule('.bag-grid').match(/repeat\(auto-fill, (\d+)px\)/)![1])).toBeGreaterThanOrEqual(88);
    expect(Number(rule('.bag-stack').match(/min-height: (\d+)px/)![1])).toBeGreaterThanOrEqual(88);
  });

  test('pad can move and select in the tray', () => {
    const { root, bag, log, t } = make(some, BlockId.Wood);
    bag.open();
    expect(items(root)[0].classList.contains('focus')).toBe(true);
    bag.padMove(1);
    bag.padMove(1);
    expect(items(root)[2].classList.contains('focus')).toBe(true);
    bag.padMove(-1);
    bag.padMove(-1);
    bag.padMove(-1);
    expect(items(root)[4].classList.contains('focus')).toBe(true); // wraps
    t.now += 500;
    bag.padSelect();
    expect(log.selected).toEqual([ItemId.Milk]);
    expect(bag.isOpen).toBe(false);
  });

  test('padInput: stick edges move, collect chooses, place closes', () => {
    const { bag, log, t } = make(some);
    bag.open();
    bag.padInput([1, 0], []);
    bag.padInput([1, 0], []); // held: no repeat
    bag.padInput([0, 0], []);
    t.now += 500;
    bag.padInput([0, 0], ['collect']);
    expect(log.selected).toEqual([ItemId.WheatSeed]);
    bag.open();
    bag.padInput([0, 0], ['place']);
    expect(bag.isOpen).toBe(false);
  });

  test('an empty bag opens and closes without errors', () => {
    const { bag } = make([]);
    bag.open();
    bag.padMove(1);
    bag.padSelect();
    bag.close();
    expect(bag.isOpen).toBe(false);
  });
});
