import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/ui/styles.css', 'utf8');
const z = (selector: string): number => {
  const m = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
  return m ? Number(m[1]) : NaN;
};

describe('layers', () => {
  it('the break reminder is above every overlay so it is always tappable', () => {
    const brk = z('.break-bubble');
    for (const overlay of ['.bag-tray', '.craft-screen']) {
      const o = z(overlay);
      if (!Number.isNaN(o)) expect(brk, overlay).toBeGreaterThan(o);
    }
    expect(brk).toBeGreaterThan(60); // the grown-ups screen
  });
});
