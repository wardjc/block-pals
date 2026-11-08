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

describe('munch pose', () => {
  it('leaves the model in its rest pose at progress 0 and 1', async () => {
    const { makePlayerModel, setEatPose } = await import('../../src/render/characters');
    const m = makePlayerModel();
    for (const p of [0, 1]) {
      setEatPose(m, 0.5, 1);
      const { armL, armR, head } = m.userData as { armL: THREE.Object3D; armR: THREE.Object3D; head: THREE.Object3D };
      armL.rotation.x = armR.rotation.x = 0; // what the walk swing writes every frame when he stands still
      setEatPose(m, p, 0);
      expect([armL.rotation.x, armR.rotation.x, head.rotation.x]).toEqual([0, 0, 0]);
    }
  });
  it('raises the arms and dips the head mid-munch, gently', async () => {
    const { makePlayerModel, setEatPose } = await import('../../src/render/characters');
    const m = makePlayerModel();
    setEatPose(m, 0.5, 1);
    const { armL, head } = m.userData as { armL: THREE.Object3D; head: THREE.Object3D };
    expect(armL.rotation.x).toBeLessThan(-1);
    expect(Math.abs(head.rotation.x)).toBeLessThanOrEqual(0.31);
  });
  it('the bite picture shrinks over three bites and is gone at the end', async () => {
    const { makePlayerModel, setEatPose, biteScale } = await import('../../src/render/characters');
    expect([0, 1, 2, 3].map(b => Math.round(biteScale(b) * 100))).toEqual([100, 67, 33, 0]);
    const m = makePlayerModel();
    const sizes: number[] = [];
    for (const [p, b] of [[0.2, 0], [0.45, 1], [0.7, 2], [0.9, 3]] as const) {
      setEatPose(m, p, b);
      const s = (m.userData.bites as Map<string, THREE.Sprite>).get('🍎')!;
      sizes.push(s.visible ? s.scale.x : 0);
    }
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThan(sizes[2]);
    expect(sizes[3]).toBe(0);
    setEatPose(m, 1, 0);
    expect([...(m.userData.bites as Map<string, THREE.Sprite>).values()].every(s => !s.visible)).toBe(true);
  });
});

describe('munch pose blends with the walk swing', () => {
  it('blendArm is the walk at env 0, halfway at 0.5 and the munch at 1', async () => {
    const { blendArm, EAT_ARM } = await import('../../src/render/characters');
    expect(blendArm(0.5, EAT_ARM, 0)).toBe(0.5);
    expect(blendArm(0.5, EAT_ARM, 0.5)).toBeCloseTo((0.5 + EAT_ARM) / 2);
    expect(blendArm(0.5, EAT_ARM, 1)).toBe(EAT_ARM);
  });
  it('eating while walking never moves an arm more than 0.25 rad between frames, at the start, the end or in between', async () => {
    const c = await import('../../src/render/characters');
    const m = c.makePlayerModel();
    const walk = c.makeWalkState();
    const u = m.userData as { armL: THREE.Object3D; armR: THREE.Object3D };
    const dt = 1 / 30;
    let prev: [number, number] | null = null;
    let worst = 0;
    // 1 s walking, a 1.3 s munch while still walking, then 1 s more walking and stopping.
    for (let f = 0; f < 150; f++) {
      const t = f * dt;
      const moving = t < 3 ? 1 : 0;
      c.animatePlayerWalk(m, walk, dt, moving * 3.5 * dt);
      if (t >= 1 && t < 2.3) c.setEatPose(m, (t - 1) / 1.3, 1);
      else if (t >= 2.3 && t < 2.3 + dt) c.setEatPose(m, 0, 0);
      const now: [number, number] = [u.armL.rotation.x, u.armR.rotation.x];
      if (prev) worst = Math.max(worst, Math.abs(now[0] - prev[0]), Math.abs(now[1] - prev[1]));
      prev = now;
    }
    expect(worst).toBeLessThan(0.25);
  });
  it('a standing munch leaves no residual arm or head rotation', async () => {
    const c = await import('../../src/render/characters');
    const m = c.makePlayerModel();
    const u = m.userData as { armL: THREE.Object3D; armR: THREE.Object3D; head: THREE.Object3D };
    const walk = c.makeWalkState();
    for (let f = 0; f <= 40; f++) { c.animatePlayerWalk(m, walk, 1 / 30, 0); c.setEatPose(m, f / 39, 1); }
    c.animatePlayerWalk(m, walk, 1 / 30, 0);
    c.setEatPose(m, 0, 0);
    expect([u.armL.rotation.x, u.armR.rotation.x, u.head.rotation.x]).toEqual([0, 0, 0]);
  });
});
