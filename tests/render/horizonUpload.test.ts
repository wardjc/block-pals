import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import { VERTS_PER_CELL } from '../../src/render/horizon';
import { Horizon } from '../../src/render/horizonMesh';

function flat(): World {
  const w = new World(32, 12, 32);
  w.beginBulk();
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) w.set(x, y, z, BlockId.Grass);
  w.endBulk();
  return w;
}

describe('horizon uploads while hidden', () => {
  it('edits in separate upload intervals while hidden all reach the GPU when it is shown again', () => {
    const w = flat();
    const h = new Horizon(w);
    const cam = new THREE.PerspectiveCamera();
    const fog = new THREE.Color(0x78c6ff);
    for (let i = 0; i < 50 && !h.ready; i++) h.update(0.1);
    expect(h.ready).toBe(true);
    h.prepare(cam, fog, 20, 40, 1, 36, 0.1); // first draw: the full upload
    const priv = h as unknown as { posAttr: THREE.BufferAttribute; positions: Float32Array };
    priv.posAttr.clearUpdateRanges(); // what Three.js does when it renders

    // Hidden: update() keeps running, prepare() is not called. Two edits, two upload intervals apart.
    const cellOf = (x: number, z: number): number => Math.floor(x / 4) + 8 * Math.floor(z / 4);
    w.set(1, 4, 1, BlockId.Stone);
    h.markDirty(1, 1);
    for (let i = 0; i < 5; i++) h.update(1);
    w.set(29, 4, 29, BlockId.Stone);
    h.markDirty(29, 29);
    for (let i = 0; i < 5; i++) h.update(1);

    // Both edits are in the CPU copy (top at height 5 minus the drop)...
    for (const c of [cellOf(1, 1), cellOf(29, 29)]) expect(priv.positions[c * VERTS_PER_CELL * 3 + 1]).toBe(4);

    // ...and shown again, the next upload covers both cells' vertices.
    h.prepare(cam, fog, 20, 40, 1, 36, 0.1);
    const covered = (cell: number): boolean => {
      const from = cell * VERTS_PER_CELL * 3, to = from + VERTS_PER_CELL * 3;
      const ranges = priv.posAttr.updateRanges;
      return ranges.length === 0 || ranges.some(r => r.start <= from && r.start + r.count >= to); // none = whole buffer
    };
    expect(covered(cellOf(1, 1))).toBe(true);
    expect(covered(cellOf(29, 29))).toBe(true);
  });
});
