import { describe, expect, it } from 'vitest';
import { CULL_RADIUS, visibleChunks } from '../../src/render/chunkCull';

describe('visibleChunks', () => {
  it('near the middle returns the surrounding chunks', () => {
    const v = visibleChunks(96, 96, 48, 48);
    for (const k of ['2,2', '3,3', '2,3', '3,2', '1,1', '4,4']) expect(v.has(k)).toBe(true);
    expect(v.size).toBeLessThan(36);
  });
  it('in a corner returns at most 9 of the 36', () => {
    for (const [x, z] of [[1, 1], [94, 1], [1, 94], [94, 94]]) {
      const v = visibleChunks(96, 96, x, z);
      expect(v.size).toBeGreaterThan(0);
      expect(v.size).toBeLessThanOrEqual(9);
    }
  });
  it('moving 16 cells changes the set by one row or column', () => {
    const a = visibleChunks(96, 96, 40, 40);
    const b = visibleChunks(96, 96, 56, 40);
    const gained = [...b].filter(k => !a.has(k));
    const lost = [...a].filter(k => !b.has(k));
    expect(gained.length).toBeLessThanOrEqual(6);
    expect(lost.length).toBeLessThanOrEqual(6);
    expect(gained.length + lost.length).toBeGreaterThan(0);
  });
  it('culls only what the fog already hides', () => {
    // fog is fully opaque at 40: a chunk whose nearest point is that far away cannot show.
    expect(CULL_RADIUS).toBeGreaterThanOrEqual(40);
    const v = visibleChunks(96, 96, 8, 8);
    expect(v.has('5,5')).toBe(false);
    expect(v.has('2,0')).toBe(true); // x 32..47 is within 40 of x = 8
  });
  it('fails open: a bad position draws everything', () => {
    for (const [x, z] of [[NaN, 5], [5, Infinity], [undefined as unknown as number, 1]]) {
      expect(visibleChunks(96, 96, x, z).size).toBe(36);
    }
  });
});
