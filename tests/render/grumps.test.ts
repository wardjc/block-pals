// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GrumpSystem } from '../../src/game/grumps';
import { mulberry32 } from '../../src/core/rng';
import {
  GRUMP_MAX_SIZE, GRUMP_MAX_TRIANGLES, GRUMP_VIEW_RANGE, GrumpView, disposeGrumpGeometry, grumpParts, makeGrumpModel, spawnScale, wobble,
  type GrumpLook,
} from '../../src/render/grumps';

const LOOKS: GrumpLook[] = [];
for (const kind of ['jelly', 'cloud'] as const) {
  for (const mood of [0, 1] as const) for (let v = 0; v < 4; v++) LOOKS.push({ kind, mood, variant: v });
  for (let v = 0; v < 5; v++) LOOKS.push({ kind, mood: 'friend', variant: v });
}
const triangles = (g: THREE.Group): number => {
  const m = g.children[0] as THREE.Mesh;
  return (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
};

describe('grump models', () => {
  it('each model is one mesh with at most 130 triangles', () => {
    expect(GRUMP_MAX_TRIANGLES).toBe(130);
    for (const l of LOOKS) {
      const g = makeGrumpModel(l.kind, l.mood, l.variant);
      expect(g.children.length).toBe(1);
      expect((g.children[0] as THREE.Mesh).isMesh).toBe(true);
      expect(triangles(g), `${l.kind} ${l.mood}`).toBeLessThanOrEqual(130);
    }
  });

  it('a sulky model differs from an unsure one and a friend one (lids, pupils, mouth, colour)', () => {
    const sig = (l: GrumpLook): string => JSON.stringify(grumpParts(l).map(p => p.part));
    for (const kind of ['jelly', 'cloud'] as const) {
      const sulky = sig({ kind, mood: 0, variant: 0 });
      const unsure = sig({ kind, mood: 1, variant: 0 });
      const friend = sig({ kind, mood: 'friend', variant: 0 });
      expect(new Set([sulky, unsure, friend]).size).toBe(3);
      expect(grumpParts({ kind, mood: 0, variant: 0 }).some(p => p.role === 'lid')).toBe(true);
      expect(grumpParts({ kind, mood: 'friend', variant: 0 }).some(p => p.role === 'lid')).toBe(false);
      expect(grumpParts({ kind, mood: 'friend', variant: 0 }).filter(p => p.role === 'smile').length).toBeGreaterThan(0);
    }
  });

  it('no model has teeth, spikes, or any part wider or taller than 1.1 blocks', () => {
    expect(GRUMP_MAX_SIZE).toBe(1.1);
    for (const l of LOOKS) {
      const parts = grumpParts(l);
      for (const { role } of parts) expect(['body', 'eye', 'pupil', 'lid', 'mouth', 'smile', 'blush', 'drop']).toContain(role);
      const g = makeGrumpModel(l.kind, l.mood, l.variant);
      const box = new THREE.Box3().setFromObject(g);
      const size = box.getSize(new THREE.Vector3());
      expect(size.x, `${l.kind} w`).toBeLessThanOrEqual(1.1);
      expect(size.y, `${l.kind} h`).toBeLessThanOrEqual(1.1);
      expect(size.z, `${l.kind} d`).toBeLessThanOrEqual(1.1);
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-9); // feet at y = 0
      // Every part is a box of at least 0.02: nothing thin and spiky, nothing longer than it is thick x 8.
      for (const { part } of parts) for (const d of [part[3], part[4], part[5]]) expect(d).toBeGreaterThanOrEqual(0.02);
      for (const { part, role } of parts) {
        if (role === 'body' || role === 'drop') continue;
        expect(Math.max(part[3], part[4]) / Math.min(part[3], part[4])).toBeLessThanOrEqual(8); // a flat mouth, never a spike
      }
    }
  });

  it('faces +z: every eye sits on the front side of the body', () => {
    for (const l of LOOKS) {
      const parts = grumpParts(l);
      const bodyFront = Math.max(...parts.filter(p => p.role === 'body').map(p => p.part[2] + p.part[5] / 2));
      for (const p of parts.filter(p => p.role === 'eye')) expect(p.part[2]).toBeGreaterThan(0);
      expect(bodyFront).toBeGreaterThan(0);
    }
  });

  it('all kinds, moods and variants build, share geometry between instances and dispose without leaking', () => {
    const a = makeGrumpModel('jelly', 0, 1), b = makeGrumpModel('jelly', 0, 1);
    expect((a.children[0] as THREE.Mesh).geometry).toBe((b.children[0] as THREE.Mesh).geometry);
    expect((a.children[0] as THREE.Mesh).material).toBe((b.children[0] as THREE.Mesh).material);
    const c = makeGrumpModel('jelly', 0, 2);
    expect((c.children[0] as THREE.Mesh).geometry).not.toBe((a.children[0] as THREE.Mesh).geometry);
    let disposed = 0;
    for (const l of LOOKS) makeGrumpModel(l.kind, l.mood, l.variant);
    const g = (a.children[0] as THREE.Mesh).geometry;
    g.addEventListener('dispose', () => { disposed++; });
    disposeGrumpGeometry();
    expect(disposed).toBe(1);
    // Rebuilt on demand afterwards.
    expect(triangles(makeGrumpModel('cloud', 'friend', 4))).toBeGreaterThan(0);
  });
});

describe('GrumpView', () => {
  const ZONE = { x0: 0, z0: 0, x1: 39, z1: 29 };
  function sys(): GrumpSystem {
    const s = new GrumpSystem(mulberry32(1), ZONE, new Set());
    s.spawn([10, 1, 10], 'jelly');
    s.spawn([30, 1, 20], 'cloud');
    return s;
  }

  it('hides entities beyond 44 blocks and shows the rest', () => {
    expect(GRUMP_VIEW_RANGE).toBe(44);
    const scene = new THREE.Scene();
    const view = new GrumpView(scene);
    const s = sys();
    const near = (x: number, z: number): boolean => Math.hypot(x - 10, z - 10) <= GRUMP_VIEW_RANGE;
    view.sync(s, near, 0, () => 0);
    expect(scene.children.filter(c => c.visible).length).toBe(2);
    view.sync(s, (x, z) => Math.hypot(x - 100, z - 100) <= GRUMP_VIEW_RANGE, 0, () => 0);
    expect(scene.children.filter(c => c.visible).length).toBe(0);
    view.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('removes the model of a grump that is gone, and swaps the look when the mood changes without a new mesh', () => {
    const scene = new THREE.Scene();
    const view = new GrumpView(scene);
    const s = sys();
    let mood: 0 | 1 | 'friend' = 0;
    view.sync(s, () => true, 0, () => mood);
    const mesh = (scene.children[0] as THREE.Group).children[0] as THREE.Mesh;
    const before = mesh.geometry;
    mood = 1;
    view.sync(s, () => true, 0.1, () => mood);
    expect(((scene.children[0] as THREE.Group).children[0] as THREE.Mesh)).toBe(mesh);
    expect(mesh.geometry).not.toBe(before);
    s.grumps.pop();
    view.sync(s, () => true, 0.2, () => mood);
    expect(scene.children.length).toBe(1);
  });

  it('a cloud hovers 0.6 above the ground and a jelly sits on it', () => {
    const scene = new THREE.Scene();
    const view = new GrumpView(scene);
    const s = sys();
    view.sync(s, () => true, 0, () => 0);
    const [jelly, cloud] = scene.children as THREE.Group[];
    expect(jelly.position.y).toBeGreaterThanOrEqual(1);
    expect(jelly.position.y).toBeLessThanOrEqual(1.1);
    expect(cloud.position.y).toBeGreaterThanOrEqual(1.55);
    expect(cloud.position.y).toBeLessThanOrEqual(1.75);
  });

  it('screenPositions lists each shown entity once with its type and id', () => {
    const scene = new THREE.Scene();
    const view = new GrumpView(scene);
    const s = sys();
    s.makeFriend(s.grumps[1].id);
    view.sync(s, () => true, 0, id => (s.friends.some(f => f.id === id) ? 'friend' : 0));
    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 200);
    cam.position.set(20, 10, 40);
    cam.lookAt(20, 1, 15);
    const out = view.screenPositions(cam, { left: 0, top: 0, width: 800, height: 500 });
    expect(out.map(o => o.type).sort()).toEqual(['friend', 'grump']);
    expect(new Set(out.map(o => o.id)).size).toBe(2);
  });
});

describe('spawn-in and wobble', () => {
  it('spawn-in scales from 0.2 to 1 over 1 s and never exceeds 1.06 in any frame', () => {
    expect(spawnScale(0)).toBeCloseTo(0.2, 5);
    expect(spawnScale(1)).toBeCloseTo(1, 5);
    expect(spawnScale(5)).toBe(1);
    let last = 0;
    for (let t = 0; t <= 1.2; t += 0.01) {
      const s = spawnScale(t);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
      for (const mood of [0, 1, 'friend'] as const) {
        const w = wobble('jelly', mood, 3, t * 7);
        expect(s * Math.max(w.sx, w.sy, w.sz)).toBeLessThanOrEqual(1.06 + 1e-9);
      }
    }
  });

  it('wobble amplitude stays within the limits for 1,000 sampled times', () => {
    for (let i = 0; i < 1000; i++) {
      const t = i * 0.173;
      for (const mood of [0, 1, 'friend'] as const) for (const kind of ['jelly', 'cloud'] as const) {
        const w = wobble(kind, mood, i % 9, t);
        expect(w.sy).toBeGreaterThanOrEqual(0.9);
        expect(w.sy).toBeLessThanOrEqual(1.06);
        expect(Math.max(w.sx, w.sz)).toBeLessThanOrEqual(1.06);
        expect(Math.min(w.sx, w.sz)).toBeGreaterThanOrEqual(0.95);
        expect(Math.abs(w.sway)).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(w.lift).toBeGreaterThanOrEqual(0);
        expect(w.lift).toBeLessThanOrEqual(0.12);
      }
    }
  });

  it('a sulky one wobbles slower and flatter than a friend', () => {
    const ys = (mood: 0 | 'friend'): number[] => Array.from({ length: 4000 }, (_, i) => wobble('jelly', mood, 1, i * 0.005).sy);
    const amplitude = (v: number[]): number => Math.max(...v) - Math.min(...v);
    const peaks = (v: number[]): number => v.filter((y, i) => i > 0 && i < v.length - 1 && y > v[i - 1] && y >= v[i + 1]).length;
    expect(amplitude(ys(0))).toBeLessThan(amplitude(ys('friend')));
    expect(peaks(ys(0))).toBeLessThan(peaks(ys('friend')));
  });
});
