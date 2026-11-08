// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Animal, AnimalKind } from '../../src/game/animals';
import { ANIMAL_KINDS, ANIMAL_MAX_TRIANGLES, AnimalView, disposeAnimalGeometry, makeAnimalModel } from '../../src/render/animals';

const fake = (id: number, kind: AnimalKind, x: number, z: number, state: Animal['state'] = 'idle'): Animal =>
  ({ id, kind, variant: id % 2, x, y: 6, z, heading: 0, state, stateT: 0, giftIn: 0, noiseIn: 20, stuckFor: 0 }) as Animal;

function tris(g: THREE.Object3D): { meshes: number; tris: number; materials: Set<THREE.Material> } {
  let meshes = 0; let t = 0; const materials = new Set<THREE.Material>();
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    t += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    materials.add(m.material as THREE.Material);
  });
  return { meshes, tris: t, materials };
}

describe('animal models', () => {
  it('each model is one mesh (one draw call) with at most 130 triangles and vertex colours', () => {
    expect(ANIMAL_MAX_TRIANGLES).toBe(130);
    for (const kind of ANIMAL_KINDS) {
      for (const variant of [0, 1]) {
        const s = tris(makeAnimalModel(kind, variant));
        expect(s.meshes, `${kind}${variant}`).toBe(1);
        expect(s.tris, `${kind}${variant}`).toBeLessThanOrEqual(ANIMAL_MAX_TRIANGLES);
        expect(s.tris).toBeGreaterThan(50);
        const mesh = makeAnimalModel(kind, variant).children[0] as THREE.Mesh;
        expect(mesh.geometry.getAttribute('color')).toBeDefined();
      }
    }
  });
  it('all kinds and variants share one material, stand on y = 0 and are not huge', () => {
    const all = new Set<THREE.Material>();
    for (const kind of ANIMAL_KINDS) {
      for (const variant of [0, 1, 5]) {
        const g = makeAnimalModel(kind, variant);
        for (const m of tris(g).materials) all.add(m);
        const box = new THREE.Box3().setFromObject(g);
        expect(box.min.y).toBeCloseTo(0, 5);
        expect(box.max.y).toBeLessThan(1.6);
        expect(box.max.z - box.min.z).toBeLessThan(1.7);
      }
    }
    expect(all.size).toBe(1);
  });
  it('geometry is shared between animals of one kind and variant, and disposes cleanly', () => {
    const a = makeAnimalModel('cow', 0).children[0] as THREE.Mesh;
    const b = makeAnimalModel('cow', 0).children[0] as THREE.Mesh;
    expect(a.geometry).toBe(b.geometry);
    expect(() => disposeAnimalGeometry()).not.toThrow();
    expect(() => makeAnimalModel('pig', 1)).not.toThrow();
  });
  it('the models are friendly: every kind has a face on its front (+z) half', () => {
    for (const kind of ANIMAL_KINDS) {
      const g = makeAnimalModel(kind, 0);
      const box = new THREE.Box3().setFromObject(g);
      expect(box.max.z).toBeGreaterThan(Math.abs(box.min.z) - 0.2); // head forward, tail back
    }
  });
});

describe('AnimalView', () => {
  it('hides animals beyond 44 blocks and shows near ones; ten animals are ten meshes', () => {
    const scene = new THREE.Scene();
    const view = new AnimalView(scene);
    const kinds: AnimalKind[] = ['chicken', 'chicken', 'chicken', 'chicken', 'cow', 'cow', 'sheep', 'sheep', 'sheep', 'pig'];
    const animals = kinds.map((k, i) => fake(i, k, 10 + i, 10));
    animals[9].x = 90; // far
    view.sync(animals, (x, z) => Math.hypot(x - 10, z - 10) < 44, 1);
    expect(scene.children.length).toBe(10);
    expect(view.drawCalls).toBe(9);
    const meshes = scene.children.filter(o => o.visible);
    expect(meshes).toHaveLength(9);
    view.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('moves and turns the group to the animal and bobs while walking, hops when happy', () => {
    const scene = new THREE.Scene();
    const view = new AnimalView(scene);
    const a = fake(1, 'sheep', 12.5, 20.5, 'walk');
    a.heading = 1.2;
    view.sync([a], () => true, 0.3);
    const g = scene.children[0];
    expect(g.position.x).toBe(12.5);
    expect(g.position.z).toBe(20.5);
    expect(g.rotation.y).toBeCloseTo(1.2, 5);
    expect(g.position.y).toBeGreaterThanOrEqual(6);
    expect(g.position.y).toBeLessThan(6.1);
    a.state = 'happy';
    let top = 0;
    for (let t = 0; t < 1.2; t += 0.02) { view.sync([a], () => true, t); top = Math.max(top, scene.children[0].position.y - 6); }
    expect(top).toBeGreaterThan(0.1);
    expect(top).toBeLessThan(0.3);
  });
  it('a grazing chicken pecks: its mesh tips forward', () => {
    const scene = new THREE.Scene();
    const view = new AnimalView(scene);
    const hen = fake(2, 'chicken', 5, 5, 'graze');
    let max = 0;
    for (let t = 0; t < 3; t += 0.05) { view.sync([hen], () => true, t); max = Math.max(max, (scene.children[0].children[0] as THREE.Mesh).rotation.x); }
    expect(max).toBeGreaterThan(0.3);
  });
  it('screenPositions projects the shown animals into the rect, with depth', () => {
    const scene = new THREE.Scene();
    const view = new AnimalView(scene);
    const cam = new THREE.PerspectiveCamera(60, 2, 0.05, 64);
    cam.position.set(10, 8, 0);
    cam.lookAt(10, 6, 10);
    const near = fake(1, 'cow', 10.5, 10.5);
    const far = fake(2, 'cow', 10.5, 30.5);
    const hidden = fake(3, 'cow', 10.5, 14.5);
    view.sync([near, far, hidden], (x, z) => !(z === 14.5), 0);
    const list = view.screenPositions(cam, { left: 0, top: 0, width: 1000, height: 500 });
    expect(list.map(l => l.id).sort()).toEqual([1, 2]);
    const n = list.find(l => l.id === 1)!;
    const f = list.find(l => l.id === 2)!;
    expect(n.sx).toBeGreaterThan(400);
    expect(n.sx).toBeLessThan(600);
    expect(n.sz).toBeLessThan(f.sz);
    const offset = view.screenPositions(cam, { left: 100, top: 50, width: 1000, height: 500 });
    expect(offset.find(l => l.id === 1)!.sx).toBeCloseTo(n.sx + 100, 3);
  });
});
