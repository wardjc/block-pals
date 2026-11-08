import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../src/render/mesher';
import { CULL_MOVE, CULL_RADIUS, FOG_FAR, ChunkCuller, visibleChunks } from '../../src/render/chunkCull';

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

describe('ChunkCuller (the set follows the real camera, never a stale chunk)', () => {
  const nearest = (cx: number, cz: number, x: number, z: number): number => {
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    return Math.hypot(Math.max(x0 - x, 0, x - (x0 + CHUNK_SIZE)), Math.max(z0 - z, 0, z - (z0 + CHUNK_SIZE)));
  };

  it('moving inside one chunk from x 16.1 to 31.9 never hides a chunk inside the fog', () => {
    const c = new ChunkCuller(96, 96);
    for (let x = 16.1; x <= 31.9; x += 0.1) {
      const set = c.update(x, 24);
      for (let cz = 0; cz < 6; cz++) for (let cx = 0; cx < 6; cx++) {
        if (nearest(cx, cz, x, 24) <= FOG_FAR) expect(set.has(`${cx},${cz}`), `${cx},${cz} at x=${x.toFixed(1)}`).toBe(true);
      }
    }
    // the exact case: chunk (4,1) is 32.1 blocks from x = 31.9
    expect(c.update(31.9, 24).has('4,1')).toBe(true);
  });

  it('a sweep along a winding path always draws every chunk within the fog, and the one he stands in', () => {
    const c = new ChunkCuller(96, 96);
    for (let t = 0; t <= 400; t++) {
      const x = 48 + 44 * Math.cos(t / 40), z = 48 + 40 * Math.sin(t / 25);
      const set = c.update(x, z);
      expect(set.has(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`)).toBe(true);
      for (let cz = 0; cz < 6; cz++) for (let cx = 0; cx < 6; cx++) {
        if (nearest(cx, cz, x, z) <= FOG_FAR) expect(set.has(`${cx},${cz}`)).toBe(true);
      }
    }
  });

  it('recomputes only after the camera has moved a little (cheap), and still hides far chunks', () => {
    const c = new ChunkCuller(96, 96);
    const a = c.update(10, 10);
    expect(c.update(10 + CULL_MOVE * 0.5, 10)).toBe(a); // same object: not recomputed
    expect(c.update(10 + CULL_MOVE + 0.5, 10)).not.toBe(a);
    expect(a.has('5,5')).toBe(false);
    expect(CULL_RADIUS).toBeGreaterThanOrEqual(FOG_FAR + CULL_MOVE);
  });

  it('a bad position draws everything', () => {
    expect(new ChunkCuller(96, 96).update(NaN, 3).size).toBe(36);
  });
});
