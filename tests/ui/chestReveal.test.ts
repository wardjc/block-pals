// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { BlockId } from '../../src/core/blocks';
import { ItemId } from '../../src/core/items';
import { CHEST_REWARDS } from '../../src/core/treasure';
import { CHEST_REVEAL_SECONDS, CHEST_TAP_GRACE_MS, ChestReveal } from '../../src/ui/chestReveal';

function make() {
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const opened: boolean[] = [];
  const clock = { t: 1000 };
  const reveal = new ChestReveal(root, { iconFor: id => `tile-${id}`, onOpenChange: o => opened.push(o), now: () => clock.t });
  return { root, reveal, opened, clock };
}
const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.chest-card')];

describe('ChestReveal (the picture cards after a chest opens)', () => {
  test('one card per entry, each a picture, a digit and that many dots (at most 20)', () => {
    const { root, reveal } = make();
    reveal.show(CHEST_REWARDS.R);
    const cs = cards(root);
    expect(cs).toHaveLength(CHEST_REWARDS.R.length);
    CHEST_REWARDS.R.forEach((e, i) => {
      const c = cs[i];
      expect(c.querySelector('.chest-digit')!.textContent).toBe(String(e.n));
      expect(Number(c.querySelector('.chest-digit')!.textContent)).toBeLessThanOrEqual(20);
      expect(c.querySelectorAll('.chest-dots i')).toHaveLength(Math.min(20, e.n));
      expect(c.querySelector('img, .pic-item')).not.toBeNull();
    });
    // A block shows its atlas tile, an item its emoji picture.
    expect(cs[0].querySelector('img')!.getAttribute('src')).toBe(`tile-${BlockId.RuinCrystal}`);
    expect(cs[1].querySelector('.pic-item')!.textContent).toContain('💎');
  });

  test('pauses the game while open and unpauses when it closes', () => {
    const { reveal, opened } = make();
    expect(reveal.open).toBe(false);
    reveal.show(CHEST_REWARDS.T1);
    expect(reveal.open).toBe(true);
    expect(opened).toEqual([true]);
    reveal.hide();
    expect(reveal.open).toBe(false);
    expect(opened).toEqual([true, false]);
  });

  test(`closes by itself after ${CHEST_REVEAL_SECONDS} s`, () => {
    const { root, reveal } = make();
    reveal.show(CHEST_REWARDS.T0);
    for (let t = 0; t < CHEST_REVEAL_SECONDS - 0.2; t += 0.1) reveal.update(0.1);
    expect(reveal.open).toBe(true);
    reveal.update(0.3);
    expect(reveal.open).toBe(false);
    expect(root.querySelector<HTMLElement>('.chest-reveal')!.hidden).toBe(true);
    expect(CHEST_REVEAL_SECONDS).toBe(4);
  });

  test('closes on any tap, and the tap never reaches the world', () => {
    const { root, reveal, clock } = make();
    reveal.show(CHEST_REWARDS.T2);
    clock.t += CHEST_TAP_GRACE_MS;
    let reached = false;
    document.body.addEventListener('pointerdown', () => { reached = true; });
    const el = root.querySelector<HTMLElement>('.chest-reveal')!;
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    el.dispatchEvent(new Event('click', { bubbles: true }));
    expect(reveal.open).toBe(false);
    expect(reached).toBe(false);
  });

  test('the click of the very tap that opened the chest does not close the cards at once', () => {
    const { root, reveal, clock } = make();
    reveal.show(CHEST_REWARDS.T1);
    const el = root.querySelector<HTMLElement>('.chest-reveal')!;
    clock.t += 120;
    el.dispatchEvent(new Event('click', { bubbles: true }));
    expect(reveal.open).toBe(true);
    clock.t += CHEST_TAP_GRACE_MS;
    el.dispatchEvent(new Event('click', { bubbles: true }));
    expect(reveal.open).toBe(false);
  });

  test('a second show while open replaces the cards and restarts the clock', () => {
    const { root, reveal, opened } = make();
    reveal.show(CHEST_REWARDS.T0);
    reveal.update(3);
    reveal.show([{ id: ItemId.Gem, n: 2 }]);
    reveal.update(3);
    expect(reveal.open).toBe(true);
    expect(cards(root)).toHaveLength(1);
    expect(opened).toEqual([true]);
  });

  test('nothing a child must read: no letters anywhere, only pictures, digits and dots', () => {
    const { root, reveal } = make();
    for (const r of Object.values(CHEST_REWARDS)) {
      reveal.show(r);
      const text = root.querySelector('.chest-reveal')!.textContent ?? '';
      expect(text).not.toMatch(/[A-Za-z]/);
    }
  });

  test('the overlay is bright (no dark backdrop) and its cards are big', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const block = css.slice(css.indexOf('.chest-reveal {'), css.indexOf('}', css.indexOf('.chest-reveal {')));
    expect(block).not.toMatch(/#000|rgba\(0, 0, 0, 0\.[5-9]/);
    const card = css.slice(css.indexOf('.chest-card {'), css.indexOf('}', css.indexOf('.chest-card {')));
    expect(card).toMatch(/min-width: (1[0-9]{2}|[89][0-9])px/);
  });
});
