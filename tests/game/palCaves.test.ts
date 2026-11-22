import { describe, expect, it } from 'vitest';
import type { LineKey } from '../../src/content/lines';
import { Pal } from '../../src/game/pal';

/** Pip's cave lines (plan Task 21): back up after the lift, the way-up answer, the digDown idle hint. */
function make() {
  const said: LineKey[] = [];
  let t = 0;
  const pal = new Pal({ x: 0, y: 0, z: 0 }, k => said.push(k), () => t);
  return { pal, said, tick: (ms: number) => { t += ms; } };
}

describe('Pip underground', () => {
  it('after the Home lift Pip says they are back in the daylight (never held back by the chatter gap)', () => {
    const { pal, said } = make();
    pal.handle({ type: 'collected', id: 1 });
    pal.handle({ type: 'homeLift' });
    expect(said).toEqual(['collectedFirst', 'backUp']);
  });

  it('a tap he cannot walk to while deep is answered by the game (Pip says no plain "cannot get there")', () => {
    const { pal, said } = make();
    pal.handle({ type: 'noPathDeep' });
    expect(said).toEqual([]);
    pal.handle({ type: 'noPath' });
    expect(said).toEqual(['noPath']);
  });

  it('the second idle hint can be replaced by digDown, and the caller hears it was said', () => {
    const { pal, said, tick } = make();
    const told: LineKey[] = [];
    pal.setIdleLine(n => (n === 2 ? 'digDown' : null), k => told.push(k));
    pal.handle({ type: 'idle', n: 1 });
    tick(10_000);
    pal.handle({ type: 'idle', n: 2 });
    expect(said).toEqual(['idleHint', 'digDown']);
    expect(told).toEqual(['digDown']);
  });

  it('a replaced idle hint held back by the chatter gap is not counted as said', () => {
    const { pal, said } = make();
    const told: LineKey[] = [];
    pal.setIdleLine(() => 'digDown', k => told.push(k));
    pal.handle({ type: 'collected', id: 1 });
    pal.handle({ type: 'idle', n: 2 });
    expect(said).toEqual(['collectedFirst']);
    expect(told).toEqual([]);
  });
});
