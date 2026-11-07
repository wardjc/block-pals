import { describe, it, expect, vi, afterEach } from 'vitest';
import { LoopScheduler, sfx } from '../../src/audio/sfx';

afterEach(() => { vi.useRealTimers(); });

describe('LoopScheduler', () => {
  it('starts once: ticks straight away then every interval', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const s = new LoopScheduler(tick, 130);
    s.start();
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(260);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(s.running).toBe(true);
  });
  it('stops on stop()', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const s = new LoopScheduler(tick, 130);
    s.start();
    s.stop();
    tick.mockClear();
    vi.advanceTimersByTime(1000);
    expect(tick).not.toHaveBeenCalled();
    expect(s.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('double start does not double the loop', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const s = new LoopScheduler(tick, 130);
    s.start();
    s.start();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(130);
    expect(tick).toHaveBeenCalledTimes(2);
  });
  it('stop without start is safe', () => {
    const s = new LoopScheduler(() => {}, 130);
    expect(() => { s.stop(); s.stop(); }).not.toThrow();
  });
  it('a throwing tick never escapes', () => {
    vi.useFakeTimers();
    const s = new LoopScheduler(() => { throw new Error('x'); }, 130);
    expect(() => { s.start(); vi.advanceTimersByTime(300); }).not.toThrow();
    s.stop();
  });
});

describe('sfx.digStart / digStop without an AudioContext', () => {
  it('never throws and leaves no timers', () => {
    vi.useFakeTimers();
    expect(() => { sfx.digStart(); sfx.digStart(); sfx.digStop(); sfx.digStop(); }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('digStop without digStart is safe', () => {
    expect(() => sfx.digStop()).not.toThrow();
  });
});
