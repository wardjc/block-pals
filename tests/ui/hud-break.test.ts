// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { Hud } from '../../src/ui/hud';

describe('break bubble', () => {
  test('breakOpen is true from showBreak until the tick is tapped, and play is never blocked', () => {
    const root = document.createElement('div');
    const hud = new Hud(root, () => '', { onSelect: () => {}, onCraft: () => {}, onGrownUps: () => {} });
    expect(hud.breakOpen).toBe(false);
    let done = 0;
    hud.showBreak(() => { done++; });
    expect(hud.breakOpen).toBe(true);
    expect(hud.blockingOverlayOpen).toBe(false); // it never blocks play
    (root.querySelector('.break-ok') as HTMLButtonElement).dispatchEvent(new Event('pointerup', { bubbles: true }));
    (root.querySelector('.break-ok') as HTMLButtonElement).click();
    hud.hideBreak();
    expect(hud.breakOpen).toBe(false);
  });
});
