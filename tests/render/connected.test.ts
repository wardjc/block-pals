// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { idleVillager, makePalModel, makePlayerModel, makeVillagerParts } from '../../src/render/characters';
import { VILLAGERS } from '../../src/content/villagers';

/** Float-rounding slack only: parts must really touch or overlap, a 0.03 gap must fail. */
const EPS = 0.001;

/** Every mesh's world-space box, grown by a hair (EPS) so boxes that exactly touch count as joined. */
function boxes(root: THREE.Object3D): THREE.Box3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Box3[] = [];
  root.traverse(o => {
    if ((o as THREE.Mesh).isMesh) out.push(new THREE.Box3().setFromObject(o).expandByScalar(EPS));
  });
  return out;
}

/** Indices of boxes NOT in the same touching-cluster as box 0 (empty = one solid, connected model). */
function strays(bs: THREE.Box3[]): number[] {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.pop()!;
    bs.forEach((b, j) => { if (!seen.has(j) && bs[i].intersectsBox(b)) { seen.add(j); queue.push(j); } });
  }
  return bs.map((_, i) => i).filter(i => !seen.has(i));
}

/** Parts that are deliberately separate: none today (every animated pivot stays attached to its body). */
const DOCUMENTED_SEPARATE: string[] = [];

describe('every model is one connected piece', () => {
  expect(DOCUMENTED_SEPARATE).toEqual([]);
  for (const v of VILLAGERS) {
    it(`${v.id} has no floating or gapped parts`, () => {
      const bs = boxes(makeVillagerParts(v.id));
      expect(bs.length).toBeGreaterThan(10);
      expect(strays(bs).map(i => bs[i].getCenter(new THREE.Vector3()).toArray().map(n => +n.toFixed(2)))).toEqual([]);
    });
  }
  it("Granny's whole scarf is one continuous piece, from neck wrap to the tail on the floor", () => {
    const parts = makeVillagerParts('willow');
    const scarf = parts.userData.hang as THREE.Group;
    const bs = boxes(scarf);
    expect(bs.length).toBeGreaterThan(5);
    expect(strays(bs)).toEqual([]);
    // It reaches the neck and the floor, and every hanging piece hugs the body (no gap in front of the skirt/torso).
    const all = new THREE.Box3();
    bs.forEach(b => all.union(b));
    expect(all.max.y).toBeGreaterThan(1.4);
    expect(all.min.y).toBeLessThan(0.05);
    expect(all.max.z).toBeGreaterThan(0.9);
  });
  it('the player has no floating parts', () => {
    const bs = boxes(makePlayerModel());
    expect(strays(bs)).toEqual([]);
  });
  it('Pip has no floating parts', () => {
    const bs = boxes(makePalModel());
    expect(strays(bs)).toEqual([]);
  });
  describe('mutations: small gaps and animated poses are caught', () => {
    const moved = (root: THREE.Object3D, pick: (m: THREE.Mesh) => boolean, by: [number, number, number]): THREE.Box3[] => {
      let n = 0;
      root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && pick(m)) { m.position.add(new THREE.Vector3(...by)); n++; } });
      expect(n).toBeGreaterThan(0);
      return boxes(root);
    };
    const hex = (m: THREE.Mesh): number => (m.material as THREE.MeshLambertMaterial).color.getHex();
    it('the unmodified models pass (control)', () => {
      expect(strays(boxes(makeVillagerParts('willow')))).toEqual([]);
    });
    it("Granny's fringe moved out by 0.03 fails", () => {
      const w = makeVillagerParts('willow');
      expect(strays(moved(w, m => m.scale.x === 0.2 && m.scale.y === 0.08 && hex(m) === 0xffffff && m.position.z > 0.9, [0, 0, 0.03]))).not.toEqual([]);
    });
    it("Granny's floor tail moved out by 0.03 fails", () => {
      const w = makeVillagerParts('willow');
      expect(strays(moved(w, m => m.scale.z === 0.3 && m.scale.y === 0.08 && hex(m) === 0xe5484d, [0, 0, 0.03]))).not.toEqual([]);
    });
    it("Bramble's head moved up by 0.03 fails", () => {
      const b = makeVillagerParts('bramble');
      (b.userData.head as THREE.Object3D).position.y += 0.03;
      expect(strays(boxes(b))).not.toEqual([]);
    });
    it('the player head moved up by 0.03 fails', () => {
      const p = makePlayerModel();
      (p.userData.head as THREE.Object3D).position.y += 0.1;
      expect(strays(boxes(p))).not.toEqual([]);
    });
    it('animated poses stay connected: idle sway and head tilt, sampled over time', () => {
      for (const v of VILLAGERS) {
        for (const t of [0, 0.7, 1.9, 3.3, 5.1]) {
          const g = makeVillagerParts(v.id);
          idleVillager(g, t);
          expect(strays(boxes(g)), `${v.id} at ${t}s`).toEqual([]);
        }
      }
    });
  });
  it('the checker itself notices a gap', () => {
    const a = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    const b = new THREE.Box3(new THREE.Vector3(1.5, 0, 0), new THREE.Vector3(2, 1, 1));
    expect(strays([a, b])).toEqual([1]);
  });
});
