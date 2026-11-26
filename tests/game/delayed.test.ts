import { describe, expect, it } from 'vitest';
import { Delayed } from '../../src/game/delayed';

describe('Delayed', () => {
  it('runs a callback after its time, once, in order', () => {
    const d = new Delayed();
    const log: string[] = [];
    d.after(0.3, () => log.push('b'));
    d.after(0.1, () => log.push('a'));
    d.after(0.3, () => log.push('c'));
    expect(d.pending).toBe(3);
    d.update(0.05);
    expect(log).toEqual([]);
    d.update(0.1);
    expect(log).toEqual(['a']);
    d.update(0.2);
    expect(log).toEqual(['a', 'b', 'c']);
    d.update(5);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(d.pending).toBe(0);
  });

  it('freezes when dt is 0 (a menu is open) and loses nothing', () => {
    const d = new Delayed();
    let n = 0;
    d.after(0.3, () => n++);
    for (let i = 0; i < 100; i++) d.update(0);
    expect(n).toBe(0);
    expect(d.pending).toBe(1);
    d.update(0.3);
    expect(n).toBe(1);
  });

  it('ignores bad dt (negative, NaN) and a bad delay runs on the next update', () => {
    const d = new Delayed();
    let n = 0;
    d.after(0.1, () => n++);
    d.update(-1);
    d.update(NaN);
    expect(n).toBe(0);
    d.after(Number.NaN, () => n++);
    d.update(0.001);
    expect(n).toBe(1);
  });

  it('a callback may schedule another; it waits for its own time', () => {
    const d = new Delayed();
    const log: number[] = [];
    d.after(0.1, () => { log.push(1); d.after(0.1, () => log.push(2)); });
    d.update(0.1);
    expect(log).toEqual([1]);
    d.update(0.1);
    expect(log).toEqual([1, 2]);
  });

  it('a throwing callback never stops the others', () => {
    const d = new Delayed();
    let n = 0;
    d.after(0.1, () => { throw new Error('x'); });
    d.after(0.1, () => n++);
    expect(() => d.update(0.2)).not.toThrow();
    expect(n).toBe(1);
  });
});
