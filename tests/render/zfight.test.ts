// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makePalModel, makePlayerModel, makeVillagerParts } from '../../src/render/characters';
import { VILLAGERS } from '../../src/content/villagers';

/**
 * Z-fighting (flicker): two faces from DIFFERENT boxes on the same plane, facing the same way, overlapping in area.
 * The GPU cannot tell which is in front, so it flips between them as the character moves.
 */
function coplanarPairs(root: THREE.Object3D): string[] {
  root.updateMatrixWorld(true);
  const named: { b: THREE.Box3; id: number; hex: number }[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    // Only axis-aligned boxes (ears are cones and are skipped).
    if (m.isMesh && m.geometry.type === 'BoxGeometry') named.push({ b: new THREE.Box3().setFromObject(m), id: named.length, hex: (m.material as THREE.MeshLambertMaterial).color.getHex() });
  });
  const out: string[] = [];
  const axes = ['x', 'y', 'z'] as const;
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      if (named[i].hex === named[j].hex) continue; // same colour: a flip between them is invisible
      const a = named[i].b; const b = named[j].b;
      for (const ax of axes) {
        const [u, v] = axes.filter(k => k !== ax);
        const area = Math.max(0, Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]))
          * Math.max(0, Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]));
        if (area <= 1e-4) continue;
        for (const side of ['min', 'max'] as const) {
          if (Math.abs(a[side][ax] - b[side][ax]) < 1e-4) {
            const c = (x: THREE.Box3): string => x.getCenter(new THREE.Vector3()).toArray().map(n => n.toFixed(2)).join(',');
            out.push(`${ax}${side === 'min' ? '-' : '+'} face at ${a[side][ax].toFixed(3)}: box#${i}(${c(a)}) vs box#${j}(${c(b)})`);
          }
        }
      }
    }
  }
  return out;
}

describe('no two parts share a coplanar face (z-fighting)', () => {
  it('the player', () => { expect(coplanarPairs(makePlayerModel())).toEqual([]); });
  it('Pip', () => { expect(coplanarPairs(makePalModel())).toEqual([]); });
  for (const v of VILLAGERS) {
    it(v.id, () => { expect(coplanarPairs(makeVillagerParts(v.id))).toEqual([]); });
  }
  it('the checker itself finds a coplanar pair', () => {
    const g = new THREE.Group();
    const mk = (s: number[], p: number[]): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: g.children.length ? 0xff0000 : 0x00ff00 })); m.scale.set(s[0], s[1], s[2]); m.position.set(p[0], p[1], p[2]); g.add(m);
    };
    mk([1, 1, 1], [0, 0, 0]); mk([0.5, 0.5, 1], [0, 0, 0]);
    expect(coplanarPairs(g).length).toBeGreaterThan(0);
  });
});
