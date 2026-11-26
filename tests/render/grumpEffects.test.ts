// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FRIEND_PALETTE, GRUMP_PALETTE } from '../../src/render/grumps';
import { Projectile, SAD_MARK_CAPACITY, SadMarks, Sparkles, type SparkleKind } from '../../src/render/effects';

const at = { x: 3, y: 2, z: 4 };
const KINDS: SparkleKind[] = ['water', 'sun', 'both', 'heart', 'crumb', 'bubble', 'star', 'drop', 'confetti'];

describe('Sparkles with the grump kinds', () => {
  it('the pool is 96 and every burst kind exists, stays near the burst and is gone within a second', () => {
    const scene = new THREE.Scene();
    const s = new Sparkles(scene);
    expect(s.capacity).toBe(96);
    for (const kind of KINDS) {
      s.burst(at, kind, 8);
      expect(s.live, kind).toBe(8);
      const pos = s.points.geometry.getAttribute('position').array as Float32Array;
      for (let i = 0; i < 8; i++) expect(Math.hypot(pos[i * 3] - at.x, pos[i * 3 + 2] - at.z)).toBeLessThan(1.5);
      s.update(1);
      expect(s.live, kind).toBe(0);
    }
  });

  it('never exceeds capacity (96) and never allocates after the constructor', () => {
    const s = new Sparkles(new THREE.Scene());
    const attr = s.points.geometry.getAttribute('position');
    for (let i = 0; i < 20; i++) { s.burst(at, 'confetti', 24); expect(s.live).toBeLessThanOrEqual(96); s.update(0.01); }
    expect(s.live).toBe(96);
    expect(s.points.geometry.getAttribute('position')).toBe(attr);
    expect(attr.count).toBe(96);
  });

  it('confetti uses only the grump and friend palettes, nothing red-heavy', () => {
    const s = new Sparkles(new THREE.Scene(), 96, () => 0.5);
    s.burst(at, 'confetti', 24);
    const col = s.points.geometry.getAttribute('color').array as Float32Array;
    const allowed = [...GRUMP_PALETTE, ...FRIEND_PALETTE].map(h => new THREE.Color(h));
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const c = new THREE.Color(col[i * 4], col[i * 4 + 1], col[i * 4 + 2]);
      expect(allowed.some(a => Math.abs(a.r - c.r) + Math.abs(a.g - c.g) + Math.abs(a.b - c.b) < 0.02), c.getHexString()).toBe(true);
      seen.add(c.getHexString());
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl, THREE.SRGBColorSpace);
      expect(hsl.h * 360 >= 345 || hsl.h * 360 <= 15).toBe(false);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('SadMarks', () => {
  const cells = (n: number): Array<[number, number, number]> => Array.from({ length: n }, (_, i) => [i, 1, 0]);

  it('is one Points object (one draw call): one point per paused plant, at most 24', () => {
    expect(SAD_MARK_CAPACITY).toBe(24);
    const scene = new THREE.Scene();
    const m = new SadMarks(scene);
    expect(scene.children.length).toBe(1);
    expect((scene.children[0] as THREE.Points).isPoints).toBe(true);
    m.set(cells(3), 0);
    expect(m.shown).toBe(3);
    m.set(cells(40), 0);
    expect(m.shown).toBe(24);
    m.set([], 0);
    expect(m.shown).toBe(0);
    const pos = m.points.geometry.getAttribute('position').array as Float32Array;
    expect(pos.length).toBe(24 * 3);
  });

  it('floats above each plant top and bobs slowly', () => {
    const m = new SadMarks(new THREE.Scene());
    m.set([[5, 1, 7]], 0);
    const pos = m.points.geometry.getAttribute('position').array as Float32Array;
    const y0 = pos[1];
    expect(pos[0]).toBeCloseTo(5.5, 5);
    expect(pos[2]).toBeCloseTo(7.5, 5);
    expect(y0).toBeGreaterThan(1.8);
    m.set([[5, 1, 7]], 1);
    expect(Math.abs(pos[1] - y0)).toBeGreaterThan(0);
    expect(Math.abs(pos[1] - y0)).toBeLessThan(0.3);
  });

  it('never touches the world (source scan) and disposes', () => {
    const src = readFileSync('src/render/effects.ts', 'utf8');
    const sad = src.slice(src.indexOf('class SadMarks'), src.indexOf('class Projectile'));
    expect(sad).not.toMatch(/world|\.set\(\s*\w+,\s*\w+,\s*\w+,\s*BlockId|setBlock/);
    const scene = new THREE.Scene();
    const m = new SadMarks(scene);
    m.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('Projectile', () => {
  it('is one mesh and one draw call, hidden until launched', () => {
    const scene = new THREE.Scene();
    const p = new Projectile(scene);
    expect(scene.children.length).toBe(1);
    expect((scene.children[0] as THREE.Mesh).isMesh).toBe(true);
    expect(scene.children[0].visible).toBe(false);
    expect(p.active).toBe(false);
  });

  it('reaches its target in exactly 0.3 s and reports arrival once', () => {
    const p = new Projectile(new THREE.Scene());
    for (const weapon of ['bubble', 'wand', 'water'] as const) {
      p.launch({ x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }, weapon);
      expect(p.active).toBe(true);
      expect(p.update(0.1)).toBe(false);
      expect(p.update(0.1)).toBe(false);
      expect(p.update(0.1)).toBe(true);
      expect(p.active).toBe(false);
      expect(p.update(0.1)).toBe(false); // never twice
    }
  });

  it('flies on a gentle arc from start to target and does not move while the game is frozen (dt 0)', () => {
    const scene = new THREE.Scene();
    const p = new Projectile(scene);
    p.launch({ x: 0, y: 1, z: 0 }, { x: 6, y: 1, z: 0 }, 'bubble');
    const mesh = scene.children[0] as THREE.Mesh;
    p.update(0.15);
    expect(mesh.position.x).toBeGreaterThan(2);
    expect(mesh.position.x).toBeLessThan(4);
    expect(mesh.position.y).toBeGreaterThan(1);
    expect(mesh.position.y).toBeLessThan(2);
    const x = mesh.position.x;
    p.update(0);
    expect(mesh.position.x).toBe(x);
  });

  it('each weapon looks different and stays small', () => {
    const scene = new THREE.Scene();
    const p = new Projectile(scene);
    const geo = new Set<THREE.BufferGeometry>();
    for (const w of ['bubble', 'wand', 'water'] as const) {
      p.launch({ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }, w);
      const mesh = scene.children[0] as THREE.Mesh;
      geo.add(mesh.geometry);
      const size = new THREE.Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeLessThanOrEqual(0.7);
      const tri = (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;
      expect(tri).toBeLessThanOrEqual(30);
    }
    expect(geo.size).toBe(3);
  });
});
