// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeEmblem, disposeVillager, makeEmblem, makeVillagerModel } from '../../src/render/characters';
import { VILLAGERS } from '../../src/content/villagers';

function stats(g: THREE.Object3D): { meshes: number; tris: number; materials: Set<THREE.Material> } {
  let meshes = 0; let tris = 0; const materials = new Set<THREE.Material>();
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    materials.add(m.material as THREE.Material);
  });
  return { meshes, tris, materials };
}

describe('villager models', () => {
  it('cost a handful of draw calls each and share one material', () => {
    let total = 0;
    const all = new Set<THREE.Material>();
    for (const v of VILLAGERS) {
      const s = stats(makeVillagerModel(v.id));
      expect(s.meshes).toBeLessThanOrEqual(4);
      expect(s.materials.size).toBe(1);
      for (const m of s.materials) all.add(m);
      total += s.meshes;
    }
    expect(total).toBeLessThanOrEqual(12); // well under the 40-call budget for the four
    expect(all.size).toBe(1);
  });

  it('keep their animatable head and hat, and the triangle count is unchanged by merging (12 per box, neck included)', () => {
    const bramble = makeVillagerModel('bramble');
    expect(bramble.userData.head).toBeDefined();
    expect(bramble.userData.hat).toBeDefined();
    expect(stats(bramble).tris).toBe(324);
    expect(stats(makeVillagerModel('willow')).tris).toBe(720);
  });

  it('disposing frees their own geometry only', () => {
    const g = makeVillagerModel('fern');
    let disposed = 0;
    g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.addEventListener('dispose', () => disposed++); });
    const meshes = stats(g).meshes;
    disposeVillager(g);
    expect(disposed).toBe(meshes);
    expect(g.parent).toBeNull();
    // A new villager still builds fine from the shared pieces.
    expect(stats(makeVillagerModel('fern')).meshes).toBe(meshes);
  });

  it('emblem disposal frees its texture and material', () => {
    const e = makeEmblem('🍞');
    let t = 0; let m = 0;
    e.material.map!.addEventListener('dispose', () => t++);
    e.material.addEventListener('dispose', () => m++);
    disposeEmblem(e);
    expect([t, m]).toEqual([1, 1]);
  });
});
