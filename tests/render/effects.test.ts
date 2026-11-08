// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sparkles, SPARKLE_LIFE } from '../../src/render/effects';

const at = { x: 3, y: 2, z: 4 };

describe('Sparkles', () => {
  it('is one Points object (one draw call) in the scene', () => {
    const scene = new THREE.Scene();
    const s = new Sparkles(scene);
    expect(scene.children).toEqual([s.points]);
    expect(s.points.isPoints).toBe(true);
    expect(s.capacity).toBe(64);
  });
  it('a burst makes 12 particles that are gone after one second', () => {
    const s = new Sparkles(new THREE.Scene());
    s.burst(at, 'heart');
    expect(s.live).toBe(12);
    s.update(0.4);
    expect(s.live).toBe(12);
    s.update(0.5);
    expect(s.live).toBe(0);
    expect(SPARKLE_LIFE).toBeLessThanOrEqual(1);
  });
  it('never exceeds capacity: a burst when full reuses the oldest, and never allocates after the constructor', () => {
    const s = new Sparkles(new THREE.Scene(), 64);
    const pos = s.points.geometry.getAttribute('position');
    const arr = pos.array;
    for (let i = 0; i < 20; i++) { s.burst(at, 'water'); expect(s.live).toBeLessThanOrEqual(64); s.update(0.01); }
    expect(s.live).toBe(64);
    expect(s.points.geometry.getAttribute('position')).toBe(pos);
    expect(s.points.geometry.getAttribute('position').array).toBe(arr);
    expect(arr.length).toBe(64 * 3);
    s.burst(at, 'crumb', 500); // a silly number is capped
    expect(s.live).toBeLessThanOrEqual(64);
  });
  it('every kind works, particles stay near the burst, and dead ones are parked out of sight', () => {
    const s = new Sparkles(new THREE.Scene());
    for (const kind of ['water', 'sun', 'both', 'heart', 'crumb'] as const) {
      s.burst(at, kind, 4);
      s.update(0.3);
    }
    const p = s.points.geometry.getAttribute('position').array as Float32Array;
    let near = 0;
    for (let i = 0; i < 64; i++) {
      if (p[i * 3 + 1] > -500) { near++; expect(Math.abs(p[i * 3] - at.x)).toBeLessThan(3); expect(Math.abs(p[i * 3 + 2] - at.z)).toBeLessThan(3); }
    }
    expect(near).toBe(s.live);
    s.update(2);
    expect(s.live).toBe(0);
    for (let i = 0; i < 64; i++) expect(p[i * 3 + 1]).toBeLessThan(-500);
  });
  it('dispose frees the geometry, the material and the dot texture', () => {
    const s = new Sparkles(new THREE.Scene());
    const mat = s.points.material as THREE.PointsMaterial;
    const map = new THREE.Texture();
    mat.map = map; // jsdom has no canvas, so give it one to free
    const calls: string[] = [];
    map.addEventListener('dispose', () => calls.push('map'));
    mat.addEventListener('dispose', () => calls.push('material'));
    s.points.geometry.addEventListener('dispose', () => calls.push('geometry'));
    s.dispose();
    expect(calls.sort()).toEqual(['geometry', 'map', 'material']);
  });
  it('update with nothing alive does nothing, and dispose is safe', () => {
    const scene = new THREE.Scene();
    const s = new Sparkles(scene);
    expect(() => { s.update(0.1); s.dispose(); }).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});
