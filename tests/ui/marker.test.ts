// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EdgeMarker, MARKER_SIZE } from '../../src/ui/marker';
import { MARKER_BOTTOM, markerShown } from '../../src/render/beacon';

const css = readFileSync('src/ui/styles.css', 'utf8');
const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule ${sel}`);
  return m[1];
};

describe('the star marker', () => {
  it('is a 64 px picture that is never tappable', () => {
    const m = new EdgeMarker(document.body);
    expect(MARKER_SIZE).toBe(64);
    expect(m.element.style.pointerEvents).toBe('none');
    const r = rule('.edge-marker');
    expect(r).toMatch(/pointer-events: none/);
    expect(r).toMatch(/width: 64px/);
    expect(r).toMatch(/height: 64px/);
    expect(m.element.textContent).toBe('⭐'); // a picture, nothing to read
  });

  it('shows at the edge point and hides', () => {
    const m = new EdgeMarker(document.body);
    expect(m.visible).toBe(false);
    m.update({ onScreen: false, x: 1240, y: 300, angle: 0, distance: 50 }, true);
    expect(m.visible).toBe(true);
    expect(m.element.hidden).toBe(false);
    expect(m.element.style.transform).toBe(`translate(${1240 - 32}px, ${300 - 32}px)`);
    m.update({ onScreen: true, x: 0, y: 0, angle: 0, distance: 50 }, false);
    expect(m.element.hidden).toBe(true);
  });

  it('keeps 100 px clear of the bottom edge (the hotbar)', () => {
    expect(MARKER_BOTTOM - MARKER_SIZE / 2).toBeGreaterThanOrEqual(100);
  });

  it('disappears for good once he has visited', () => {
    const m = new EdgeMarker(document.body);
    for (let i = 0; i < 10; i++) m.update({ onScreen: false, x: 40, y: 40, angle: 3, distance: 60 }, markerShown({ onScreen: false, distance: 60 }, true, false));
    expect(m.visible).toBe(false);
  });
});
