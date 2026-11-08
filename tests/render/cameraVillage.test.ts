import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import type { HouseInfo } from '../../src/core/houses';
import { isStandable } from '../../src/core/pathfind';
import type { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import {
  CameraRig, DEFAULT_PITCH, DRAG_RADIANS_PER_WIDTH, EASE_OUT_SECONDS, MAX_DISTANCE, PITCH_MAX, PITCH_MIN, pipHiddenFor,
} from '../../src/render/cameraRig';
import { EYE_HEIGHT } from '../../src/render/scene';
import { blocksRay, castVoxelRay, type VoxelHit } from '../../src/render/voxelRay';

const hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };
const { world, village } = generateWorld(2026);
const houses: HouseInfo[] = village.houses;
const PITCHES = [PITCH_MIN, DEFAULT_PITCH, PITCH_MAX];
const YAWS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

const eyeOf = ([x, y, z]: [number, number, number] | number[]) => ({ x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 });
const settle = (rig: CameraRig, w: World, eye: { x: number; y: number; z: number }): void => {
  for (let i = 0; i < 90; i++) rig.update(w, eye, 1 / 30);
};
const inSolid = (w: World, p: { x: number; y: number; z: number }): boolean =>
  w.inBounds(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
  && blocksRay(w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
const insideInterior = (h: HouseInfo, p: { x: number; z: number }): boolean =>
  p.x >= h.interior.x0 && p.x < h.interior.x1 + 1 && p.z >= h.interior.z0 && p.z < h.interior.z1 + 1;

/** The camera must be in air and, if the eye is inside a house, inside that house too. */
function expectCameraSane(rig: CameraRig, w: World, eye: { x: number; y: number; z: number }, h?: HouseInfo): void {
  expect(inSolid(w, rig.position)).toBe(false);
  // The camera has a clear line to the eye (it may sit outside only by looking back through the door gap).
  expect(castVoxelRay(w, eye.x, eye.y, eye.z, -rig.forward.x, -rig.forward.y, -rig.forward.z, rig.distance, false, hit)).toBe(false);
  if (h && insideInterior(h, eye) && insideInterior(h, rig.position)) {
    expect(rig.position.y).toBeLessThan(h.groundY + 1 + 4 + 1e-6); // below the ceiling
    expect(rig.position.y).toBeGreaterThan(h.groundY + 1 - 1e-6); // above the floor block
  }
}

describe('camera inside the village houses', () => {
  it('has all five houses', () => expect(houses).toHaveLength(5));

  it('drag-to-turn works in close mode inside a house', () => {
    for (const h of houses) {
      const [mx, my, mz] = h.floor[Math.floor(h.floor.length / 2)];
      const eye = eyeOf([mx, my, mz]);
      const rig = new CameraRig();
      rig.yaw = 0.3;
      settle(rig, world, eye);
      expect(rig.close || rig.distance < MAX_DISTANCE).toBe(true);
      const before = { ...rig.forward };
      const yaw0 = rig.yaw;
      rig.drag(200, 0, 1000);
      expect(Math.abs(rig.yaw - yaw0)).toBeCloseTo(200 * DRAG_RADIANS_PER_WIDTH / 1000, 6);
      settle(rig, world, eye);
      const dot = before.x * rig.forward.x + before.y * rig.forward.y + before.z * rig.forward.z;
      expect(dot).toBeLessThan(1);
      expectCameraSane(rig, world, eye, h);
      const pitch0 = rig.pitch;
      rig.drag(0, 100, 1000);
      expect(rig.pitch).toBeGreaterThan(pitch0);
      rig.drag(0, 100000, 1000);
      expect(rig.pitch).toBe(PITCH_MAX);
      rig.drag(0, -100000, 1000);
      expect(rig.pitch).toBe(PITCH_MIN);
      settle(rig, world, eye);
      expectCameraSane(rig, world, eye, h);
    }
  });

  it('the camera never lets the player model fill the view in a room', () => {
    for (const h of houses) {
      for (const cell of h.floor) {
        for (const yaw of YAWS) for (const pitch of PITCHES) {
          const rig = new CameraRig();
          rig.yaw = yaw; rig.pitch = pitch;
          const eye = eyeOf(cell);
          settle(rig, world, eye);
          if (rig.distance < 3.4) expect(rig.modelHidden).toBe(true);
        }
      }
    }
  });

  it('camera is never inside a block, inside any house', () => {
    for (const h of houses) {
      for (const cell of h.floor) {
        const eye = eyeOf(cell);
        for (const yaw of YAWS) for (const pitch of PITCHES) {
          const rig = new CameraRig();
          rig.yaw = yaw; rig.pitch = pitch;
          settle(rig, world, eye);
          expectCameraSane(rig, world, eye, h);
        }
      }
    }
  });

  it('camera never clips outside either', () => {
    for (const h of houses) {
      let n = 0;
      for (let x = h.rect.x0 - 3; x <= h.rect.x1 + 3; x++) for (let z = h.rect.z0 - 3; z <= h.rect.z1 + 3; z++) {
        if (x >= h.rect.x0 && x <= h.rect.x1 && z >= h.rect.z0 && z <= h.rect.z1) continue;
        const y = h.groundY + 1;
        if (!isStandable(world, [x, y, z])) continue;
        n++;
        const eye = eyeOf([x, y, z]);
        for (const yaw of YAWS) for (const pitch of PITCHES) {
          const rig = new CameraRig();
          rig.yaw = yaw; rig.pitch = pitch;
          settle(rig, world, eye);
          expectCameraSane(rig, world, eye);
        }
      }
      expect(n).toBeGreaterThan(20);
    }
  });

  it('door-to-room transitions never clip and never jump out faster than the ease', () => {
    for (const h of houses) {
      const a = h.doorFront, b = h.doorInside;
      const mid = h.floor[Math.floor(h.floor.length / 2)];
      const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[2] - a[2]);
      const yaw = Math.atan2(dx || 0, dz || 0);
      const rig = new CameraRig();
      rig.yaw = yaw;
      const path: Array<[number, number]> = [];
      const pts: Array<[number, number]> = [[a[0] + 0.5, a[2] + 0.5], [b[0] + 0.5, b[2] + 0.5], [mid[0] + 0.5, mid[2] + 0.5]];
      for (let i = 0; i < pts.length - 1; i++) {
        const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        for (let s = 0; s <= len; s += 0.25) {
          path.push([pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * s) / (len || 1), pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * s) / (len || 1)]);
        }
      }
      let prev = -1;
      const dt = 1 / 30;
      for (const [x, z] of path) {
        const eye = { x, y: h.groundY + 1 + EYE_HEIGHT, z };
        rig.update(world, eye, dt);
        expect(inSolid(world, rig.position)).toBe(false);
        if (prev >= 0 && rig.distance > prev) {
          // growth per update is the exponential ease towards at most MAX_DISTANCE
          const a1 = 1 - Math.exp(-dt / EASE_OUT_SECONDS);
          expect(rig.distance - prev).toBeLessThanOrEqual((MAX_DISTANCE - prev) * a1 + 1e-6);
        }
        prev = rig.distance;
      }
    }
  });

  it('roof does not trap the camera', () => {
    for (const h of houses) {
      // find the highest solid block over the middle of the footprint and stand on it
      const x = Math.floor((h.rect.x0 + h.rect.x1) / 2), z = Math.floor((h.rect.z0 + h.rect.z1) / 2);
      let top = world.sizeY - 1;
      while (top > 0 && !blocksRay(world.get(x, top, z))) top--;
      const eye = eyeOf([x, top + 1, z]);
      const rig = new CameraRig();
      rig.yaw = 1; rig.pitch = DEFAULT_PITCH;
      settle(rig, world, eye);
      expect(inSolid(world, rig.position)).toBe(false);
      expect(rig.position.y).toBeGreaterThan(top);
    }
  });

  it('close mode is bright: every room has at least two lamps', () => {
    for (const h of houses) {
      expect(h.lampCells.length).toBeGreaterThanOrEqual(2);
      for (const [x, y, z] of h.lampCells) expect(BLOCKS[world.get(x, y, z)].solid).toBe(true);
    }
  });
});

describe('Pip never fills the view', () => {
  const fwd = { x: 0, y: 0, z: 1 };
  const cam = { x: 0, y: 5, z: 0 };
  it('hides when the camera is close to him', () => {
    expect(pipHiddenFor(cam, fwd, { x: 1, y: 4.6, z: 0 }, false)).toBe(true);
  });
  it('hides when he is near the middle of the view, not when off to the side', () => {
    expect(pipHiddenFor(cam, fwd, { x: 0, y: 4.6, z: 2.5 }, false)).toBe(true);
    expect(pipHiddenFor(cam, fwd, { x: 3.4, y: 4.6, z: 0.5 }, false)).toBe(false);
  });
  it('shows when far, and has hysteresis', () => {
    expect(pipHiddenFor(cam, fwd, { x: 0, y: 4.6, z: 7 }, false)).toBe(false);
    expect(pipHiddenFor(cam, fwd, { x: 3, y: 4.6, z: 0 }, false)).toBe(false);
    expect(pipHiddenFor(cam, fwd, { x: 3, y: 4.6, z: 0 }, true)).toBe(true);
  });
});
