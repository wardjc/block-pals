import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { isStandable } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { CAMERA_MARGIN, CameraRig, MAX_DISTANCE, clampDistance, lookDir } from '../../src/render/cameraRig';
import { blocksRay, castVoxelRay, type VoxelHit } from '../../src/render/voxelRay';

function flat(): World {
  const w = new World(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) for (let y = 0; y <= 3; y++) w.set(x, y, z, BlockId.Stone);
  return w;
}
const EYE = { x: 16.5, y: 5.6, z: 16.5 };

/** A field of ripe wheat on tilled soil. */
function field(w: World, id = BlockId.Wheat3): void {
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) { w.set(x, 3, z, BlockId.Farmland); w.set(x, 4, z, id); }
}

describe('the camera in a field', () => {
  it('blocksRay: taps pick plants, the camera ignores them, leaves and glass still block it', () => {
    expect(blocksRay(BlockId.Wheat3, true)).toBe(false);
    expect(blocksRay(BlockId.Wheat3)).toBe(true);
    expect(blocksRay(BlockId.Sapling, true)).toBe(false);
    for (const id of [BlockId.Leaves, BlockId.Glass, BlockId.AppleLeaves, BlockId.Fence, BlockId.WoolRed, BlockId.Stone]) {
      expect(blocksRay(id, true)).toBe(true);
      expect(blocksRay(id)).toBe(true);
    }
    expect(blocksRay(BlockId.Air, true)).toBe(false);
    expect(blocksRay(BlockId.Water)).toBe(false);
  });

  it('plants are walkable and a pick ray still stops at one', () => {
    const w = flat();
    field(w);
    expect(isStandable(w, [10, 4, 10])).toBe(true);
    const hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };
    expect(castVoxelRay(w, 10.5, 8, 10.5, 0, -1, 0, 10, false, hit)).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([10, 4, 10]);
    expect(castVoxelRay(w, 10.5, 8, 10.5, 0, -1, 0, 10, false, hit, true)).toBe(true);
    expect([hit.x, hit.y, hit.z]).toEqual([10, 3, 10]); // the camera ray sees only the soil
  });

  it('ripe wheat between head and wanted position does not shorten the distance; planks do', () => {
    const open = flat();
    const wheat = flat();
    field(wheat);
    // Wheat as tall as the eye's row: a 3-high wall of plants straight behind the head.
    for (let x = 0; x < 32; x++) for (let y = 4; y <= 8; y++) wheat.set(x, y, 14, BlockId.Wheat3);
    const dir = lookDir(0, 0, { x: 0, y: 0, z: 0 });
    const free = clampDistance(open, EYE, dir, MAX_DISTANCE);
    expect(clampDistance(wheat, EYE, dir, MAX_DISTANCE)).toBe(free);
    const planks = flat();
    for (let x = 0; x < 32; x++) for (let y = 4; y <= 8; y++) planks.set(x, y, 14, BlockId.Planks);
    expect(clampDistance(planks, EYE, dir, MAX_DISTANCE)).toBeLessThanOrEqual(1.5 - CAMERA_MARGIN + 1e-9);
  });

  it('a whole field of wheat never moves the rig, whichever way it turns', () => {
    const open = flat();
    const wheat = flat();
    field(wheat);
    for (const yaw of [0, 1, 2, 3, -1, -2]) {
      for (const pitch of [-0.1, 0.3, 0.5, 1.0, 1.2]) {
        const a = new CameraRig(); a.yaw = yaw; a.pitch = pitch; a.update(open, EYE, 1 / 60);
        const b = new CameraRig(); b.yaw = yaw; b.pitch = pitch; b.update(wheat, EYE, 1 / 60);
        // The soil under the plants is solid in `wheat` at y 3, same as stone in `open`.
        expect(b.distance).toBeCloseTo(a.distance, 6);
      }
    }
  });

  it('standing among the plants (eye inside a plant cell) is not "eye in a block"', () => {
    const w = flat();
    field(w);
    const eyeInPlant = { x: 16.5, y: 4.6, z: 16.5 };
    expect(clampDistance(w, eyeInPlant, lookDir(0, 0.5, { x: 0, y: 0, z: 0 }), MAX_DISTANCE)).toBeGreaterThan(1);
  });
});
