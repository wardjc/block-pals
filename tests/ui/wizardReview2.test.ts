// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { newWizardState } from '../../src/game/wizardTrade';
import { HeldPipLine } from '../../src/game/speechPolicy';
import { Pal } from '../../src/game/pal';
import type { LineKey } from '../../src/content/lines';
import { discPickAllowed } from '../../src/input/entityPick';
import { WizardScreen } from '../../src/ui/wizard';

// Fixes from the second review of PR #30.

describe('Orlo can only be picked as far as walls are checked', () => {
  it('beyond the pick range (where no block is looked for) the disc never picks him', () => {
    expect(discPickAllowed(null, null, 39, 0.7, 40)).toBe(true);
    expect(discPickAllowed(null, null, 42, 0.7, 40)).toBe(false); // a wall at 41 would go unseen
  });
});

describe('Pip never cuts Orlo off, not even after the screen closes', () => {
  it('while Orlo is speaking every Pip line but the break reminder and the welcome is held back', () => {
    const said: LineKey[] = [];
    let t = 100_000;
    const pal = new Pal({ x: 0, y: 0, z: 0 }, k => said.push(k), () => t);
    let orlo = true;
    pal.setQuiet(() => orlo);
    pal.handle({ type: 'collected', id: 4 });
    pal.handle({ type: 'crafted', recipe: 'planks' });
    expect(pal.react('gotMagicBlock')).toBe(false);
    expect(said).toEqual([]);
    pal.remindBreak();
    expect(said).toEqual(['breakTime']);
    orlo = false;
    t += 10_000;
    expect(pal.react('gotMagicBlock')).toBe(true);
  });
});

describe('a held Pip nudge is only used up when Pip really says it', () => {
  it('a refused line stays held and is tried again', () => {
    const held = new HeldPipLine();
    held.want('puzzleStuck');
    let accept = false;
    const say = (k: string) => { expect(k).toBe('puzzleStuck'); return accept; };
    expect(held.offer(false, false, say)).toBe(false); // Pip's hush after the break reminder
    accept = true;
    expect(held.offer(true, false, say)).toBe(false); // Orlo speaking: not even offered
    expect(held.offer(false, false, say)).toBe(true);
    expect(held.offer(false, false, () => true)).toBe(false); // gone once said
  });
});

describe('the controller scrolls what it is on into view', () => {
  it('a pad move scrolls the focused target into view (the basket can be taller than the screen)', () => {
    const calls: Element[] = [];
    const spy = vi.fn(function (this: Element) { calls.push(this); });
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    const state = newWizardState();
    state.gift = true;
    document.body.replaceChildren();
    let t = 0;
    const bag = { count: () => 0, add: (_: number, n = 1) => n, remove: () => false };
    const screen = new WizardScreen(document.body, {
      inventory: bag, state: () => state, save: () => {}, iconFor: () => '',
      speak: { line: () => {}, countSentence: () => {}, again: () => {} },
      pipNudge: () => {}, rng: mulberry32(1), now: () => (t += 1000), celebrate: () => {}, onOpenChange: () => {},
    });
    screen.open();
    screen.padMove(1, 0);
    expect(calls.at(-1)).toBe(screen.element.querySelector('.focus'));
  });
});
