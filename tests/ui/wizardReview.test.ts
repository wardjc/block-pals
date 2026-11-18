// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { mulberry32 } from '../../src/core/rng';
import { newWizardState } from '../../src/game/wizardTrade';
import { HeldPipLine } from '../../src/game/speechPolicy';
import { discPickAllowed } from '../../src/input/entityPick';
import { WizardScreen } from '../../src/ui/wizard';
import { WIZARD_HEIGHT, WizardView, glimColour } from '../../src/render/wizard';
import { beaconPulse } from '../../src/render/beacon';

// Fixes from the review of PR #30.

describe('Pip never talks over Orlo', () => {
  it('a held Pip line waits while a voice is speaking or the break bubble is up, then comes out once', () => {
    const held = new HeldPipLine();
    expect(held.take(false, false)).toBeNull();
    held.want('puzzleStuck');
    expect(held.take(true, false)).toBeNull(); // Orlo is speaking
    expect(held.take(false, true)).toBeNull(); // break bubble
    expect(held.take(false, false)).toBe('puzzleStuck');
    expect(held.take(false, false)).toBeNull();
  });
  it('a newer want replaces an older one and clear drops it', () => {
    const held = new HeldPipLine();
    held.want('puzzleStuck');
    held.want('gotMagicBlock');
    expect(held.take(false, false)).toBe('gotMagicBlock');
    held.want('puzzleStuck');
    held.clear();
    expect(held.take(false, false)).toBeNull();
  });
});

describe('the 72 px disc only picks Orlo when nothing is in the way', () => {
  it('needs both the finger ray and the ray to his middle to reach him first', () => {
    expect(discPickAllowed(null, null, 5)).toBe(true);
    expect(discPickAllowed(6, 5.2, 5)).toBe(true);
    expect(discPickAllowed(2, null, 5)).toBe(false); // the finger is on a nearer block
    expect(discPickAllowed(null, 3, 5)).toBe(false); // a wall stands between the camera and him
  });
});

describe('the controller keeps its place when the screen redraws', () => {
  function counting() {
    const bag = { m: new Map<number, number>(), count(id: number) { return this.m.get(id) ?? 0; }, add(id: number, n = 1) { this.m.set(id, this.count(id) + n); return n; }, remove() { return false; } };
    const state = newWizardState();
    state.gift = true;
    document.body.replaceChildren();
    let t = 0;
    const screen = new WizardScreen(document.body, {
      inventory: bag, state: () => state, save: () => {}, iconFor: () => '',
      speak: { line: () => {}, countSentence: () => {}, again: () => {} },
      pipNudge: () => {}, rng: mulberry32(3), now: () => (t += 1000), celebrate: () => {}, onOpenChange: () => {},
    });
    screen.open();
    for (let i = 0; i < 40 && screen.session!.puzzle.kind !== 'count'; i++) { screen.tab('trade'); screen.tab('puzzle'); }
    return { screen, root: screen.element };
  }

  it('pressing select twice on a shelf picture adds two (focus stays on the shelf, not on the new basket item)', () => {
    const { screen, root } = counting();
    const p = screen.session!.puzzle;
    if (p.kind !== 'count') throw new Error('no counting puzzle');
    const thing = p.wants[0].thing;
    for (let i = 0; i < 30; i++) {
      if (root.querySelector('.focus')?.getAttribute('data-add') === thing) break;
      screen.padMove(1, 0);
    }
    expect(root.querySelector('.focus')!.getAttribute('data-add')).toBe(thing);
    screen.padSelect();
    expect(root.querySelector('.focus')!.getAttribute('data-add')).toBe(thing);
    if (p.wants[0].n >= 2) {
      screen.padSelect();
      expect(screen.session!.basket[thing]).toBe(2);
    }
  });

  it('the focus stays on the same card when a wrong card fades', () => {
    const { screen, root } = counting();
    for (let i = 0; i < 40 && screen.session!.puzzle.kind === 'count'; i++) { screen.tab('trade'); screen.tab('puzzle'); }
    const p = screen.session!.puzzle;
    if (p.kind === 'count') throw new Error('no answer puzzle');
    for (let i = 0; i < 30; i++) {
      if (root.querySelector('.focus')?.getAttribute('data-option') === String(p.answer)) break;
      screen.padMove(1, 0);
    }
    expect(root.querySelector('.focus')!.getAttribute('data-option')).toBe(String(p.answer));
    screen.update(25); // hint 2: a wrong card fades and the screen redraws
    expect(root.querySelectorAll('.wiz-option.faded').length).toBeGreaterThan(0);
    expect(root.querySelector('.focus')!.getAttribute('data-option')).toBe(String(p.answer));
  });
});

describe('the screen styles stay on the screen', () => {
  it('.focus, .glow and .wobble are scoped to .wizard-screen (the bag tray uses .focus too)', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).not.toMatch(/(^|\n)\.(focus|glow|wobble) \{/);
    expect(css).toMatch(/\.wizard-screen \.focus \{/);
    expect(css).toMatch(/\.wizard-screen \.glow \{/);
    expect(css).toMatch(/\.wizard-screen \.wobble \{/);
  });
});

describe('Orlo in a low room', () => {
  it('his hop never pushes the hat into the ceiling', () => {
    const v = new WizardView(new THREE.Scene(), { x: 34, y: 10, z: 82 }, undefined, 3);
    v.celebrate();
    let top = 0;
    for (let i = 0; i < 60; i++) { v.update(1 / 60, i / 60, null, false); top = Math.max(top, v.group.position.y - 10); }
    expect(top + WIZARD_HEIGHT).toBeLessThanOrEqual(3);
  });
  it('glimColour and beaconPulse can fill an object they are given (no allocation a frame)', () => {
    const c = { h: 0, s: 0, l: 0 };
    expect(glimColour(3, false, c)).toBe(c);
    const p = { opacity: 0, scale: 0 };
    expect(beaconPulse(1, p)).toBe(p);
    expect(p.opacity).toBeGreaterThanOrEqual(0.8);
  });
});
