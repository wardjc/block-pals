import { describe, expect, it, vi } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import type { Cell } from '../../src/core/pathfind';
import { isStandable } from '../../src/core/pathfind';
import type { TowerFloor, TowerInfo } from '../../src/core/tower';
import type { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import {
  CameraRig, DEFAULT_PITCH, DRAG_RADIANS_PER_WIDTH, EASE_OUT_SECONDS, MAX_DISTANCE, PITCH_MAX, PITCH_MIN, pipHiddenFor,
} from '../../src/render/cameraRig';
import { EYE_HEIGHT } from '../../src/render/scene';
import { blocksRay, castVoxelRay, type VoxelHit } from '../../src/render/voxelRay';

// Heavy sweeps over every floor cell of both rooms, yaw and pitch: allow time on a busy machine.
vi.setConfig({ testTimeout: 60_000 });
const hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };
const { world, tower } = generateWorld(2026);
const [groundRoom, starRoom] = tower.floors;
const PITCHES = [PITCH_MIN, DEFAULT_PITCH, PITCH_MAX];
const YAWS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

type V = { x: number; y: number; z: number };
const eyeOf = ([x, y, z]: Cell | number[]): V => ({ x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 });
const settle = (rig: CameraRig, w: World, eye: V): void => {
  for (let i = 0; i < 90; i++) rig.update(w, eye, 1 / 30);
};
const inSolid = (w: World, p: V): boolean =>
  w.inBounds(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))
  && blocksRay(w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
const inInterior = (t: TowerInfo, p: { x: number; z: number }): boolean =>
  p.x >= t.interior.x0 && p.x < t.interior.x1 + 1 && p.z >= t.interior.z0 && p.z < t.interior.z1 + 1;
/** Over the gap in the slab, where the stair climbs: the camera may look down it into the ground room. */
const overStair = (t: TowerInfo, p: { x: number; z: number }): boolean =>
  t.stairCells.slice(0, 3).some(([x, , z]) => Math.floor(p.x) === x && Math.floor(p.z) === z);

/** In air, a clear line to the eye, and inside the room when the eye is (below its ceiling, above its floor). */
function expectCameraSane(rig: CameraRig, w: World, t: TowerInfo, eye: V, room?: TowerFloor): void {
  expect(inSolid(w, rig.position)).toBe(false);
  expect(castVoxelRay(w, eye.x, eye.y, eye.z, -rig.forward.x, -rig.forward.y, -rig.forward.z, rig.distance, false, hit)).toBe(false);
  if (!room) return;
  if (room === starRoom) {
    // No door upstairs: walls and Glass windows keep the camera in the room.
    expect(inInterior(t, rig.position)).toBe(true);
  }
  if (inInterior(t, rig.position)) {
    // Over the stair the slab is open: the stairwell reaches from the ground floor to the star room's ceiling.
    const stair = overStair(t, rig.position);
    expect(rig.position.y).toBeLessThan((stair ? starRoom.ceilingY : room.ceilingY) + 1e-6);
    const floorTop = stair ? groundRoom.y : room.y;
    expect(rig.position.y).toBeGreaterThan(floorTop - 1e-6);
  }
}

describe('camera inside the wizard\'s tower', () => {
  it('has two rooms with floor cells', () => {
    expect(groundRoom.cells.length).toBeGreaterThanOrEqual(20);
    expect(starRoom.cells.length).toBeGreaterThanOrEqual(20);
  });

  it('drag-to-turn works in close mode on every floor cell of both rooms', () => {
    for (const room of tower.floors) {
      for (const cell of room.cells) {
        const eye = eyeOf(cell);
        const rig = new CameraRig();
        rig.yaw = 0.3;
        settle(rig, world, eye);
        // Downstairs the camera may sit outside by looking back through the door gap, as in the houses.
        expect(rig.close || rig.distance < MAX_DISTANCE || (room === groundRoom && !inInterior(tower, rig.position))).toBe(true);
        const before = { ...rig.forward };
        const yaw0 = rig.yaw;
        rig.drag(200, 0, 1000);
        expect(Math.abs(rig.yaw - yaw0)).toBeCloseTo(200 * DRAG_RADIANS_PER_WIDTH / 1000, 6);
        settle(rig, world, eye);
        expect(before.x * rig.forward.x + before.y * rig.forward.y + before.z * rig.forward.z).toBeLessThan(1);
        expectCameraSane(rig, world, tower, eye, room);
        rig.drag(0, 100000, 1000);
        expect(rig.pitch).toBe(PITCH_MAX);
        settle(rig, world, eye);
        expectCameraSane(rig, world, tower, eye, room);
        rig.drag(0, -100000, 1000);
        expect(rig.pitch).toBe(PITCH_MIN);
        settle(rig, world, eye);
        expectCameraSane(rig, world, tower, eye, room);
      }
    }
  });

  it('the camera is never inside a block and stays in the room, every cell, yaw and pitch, both floors', () => {
    let n = 0;
    for (const room of tower.floors) {
      for (const cell of room.cells) {
        const eye = eyeOf(cell);
        for (const yaw of YAWS) for (const pitch of PITCHES) {
          const rig = new CameraRig();
          rig.yaw = yaw; rig.pitch = pitch;
          settle(rig, world, eye);
          expectCameraSane(rig, world, tower, eye, room);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('the camera never lets the player model fill the view in either room', () => {
    for (const room of tower.floors) {
      for (const cell of room.cells) {
        for (const yaw of YAWS) for (const pitch of PITCHES) {
          const rig = new CameraRig();
          rig.yaw = yaw; rig.pitch = pitch;
          settle(rig, world, eyeOf(cell));
          if (rig.distance < 3.4) expect(rig.modelHidden).toBe(true);
        }
      }
    }
  });

  it('going up the stairs one step at a time never puts the camera in a wall', () => {
    // Door, across the ground room to the foot of the stair, up the three steps, onto the slab edge.
    const foot: Cell = [tower.stairCells[0][0] - 1, groundRoom.y, tower.stairCells[0][2]];
    const walk: Cell[] = [tower.doorFront, tower.doorInside, foot, ...tower.stairCells];
    for (const cell of walk) expect(isStandable(world, cell), cell.join()).toBe(true);
    for (const yaw of YAWS) for (const pitch of PITCHES) {
      const rig = new CameraRig();
      rig.yaw = yaw; rig.pitch = pitch;
      for (let i = 0; i < walk.length - 1; i++) {
        const a = eyeOf(walk[i]), b = eyeOf(walk[i + 1]);
        for (let s = 0; s <= 8; s++) {
          const k = s / 8;
          const eye = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
          rig.update(world, eye, 1 / 30);
          expect(inSolid(world, rig.position), `${yaw} ${pitch} step ${i} ${k}`).toBe(false);
        }
        // He stands still on each step for a moment: the settled camera is sane too.
        settle(rig, world, b);
        expectCameraSane(rig, world, tower, b);
      }
    }
  });

  it('at the top of the stairs and on the slab edge the camera stays in air', () => {
    for (const cell of tower.stairCells.slice(2)) {
      for (const yaw of YAWS) for (const pitch of PITCHES) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = pitch;
        const eye = eyeOf(cell);
        settle(rig, world, eye);
        expect(inSolid(world, rig.position)).toBe(false);
        expect(rig.position.y).toBeLessThan(starRoom.ceilingY);
        expect(inInterior(tower, rig.position)).toBe(true);
      }
    }
  });

  it('on the hilltop outside, a wall behind him pulls the camera in and it glides back out', () => {
    const eye = eyeOf([tower.doorFront[0], tower.doorFront[1], tower.doorFront[2] - 1]);
    const rig = new CameraRig();
    rig.yaw = Math.PI; // looking north, away from the tower: the camera would sit inside its wall
    settle(rig, world, eye);
    const pulled = rig.distance;
    expect(pulled).toBeLessThan(MAX_DISTANCE - 1);
    expect(inSolid(world, rig.position)).toBe(false);
    rig.yaw = 0; // turned round: open hillside behind him now
    let prev = rig.distance;
    let rose = false;
    const dt = 1 / 30;
    for (let i = 0; i < 60; i++) {
      rig.update(world, eye, dt);
      expect(inSolid(world, rig.position)).toBe(false);
      if (rig.distance > prev) {
        rose = true;
        // Never faster than the ease out (plus the rig's final 1e-3 snap onto its target).
        expect(rig.distance - prev).toBeLessThanOrEqual((MAX_DISTANCE - prev) * (1 - Math.exp(-dt / EASE_OUT_SECONDS)) + 1e-3);
      }
      prev = rig.distance;
    }
    expect(rose).toBe(true);
    expect(rig.distance).toBeGreaterThan(pulled);
  });

  it('the camera never clips on the hilltop round the tower', () => {
    const r = tower.rect;
    let n = 0;
    for (let x = r.x0 - 3; x <= r.x1 + 3; x++) for (let z = r.z0 - 3; z <= r.z1 + 3; z++) {
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) continue;
      const cell: Cell = [x, tower.groundY + 1, z];
      if (!isStandable(world, cell)) continue;
      n++;
      const eye = eyeOf(cell);
      for (const yaw of YAWS) for (const pitch of PITCHES) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = pitch;
        settle(rig, world, eye);
        expectCameraSane(rig, world, tower, eye);
      }
    }
    expect(n).toBeGreaterThan(60);
  });

  it('Pip hides in close mode in the tower, as in the houses', () => {
    let checked = 0;
    for (const room of tower.floors) {
      for (const cell of room.cells) for (const yaw of YAWS) {
        const eye = eyeOf(cell);
        const rig = new CameraRig();
        rig.yaw = yaw;
        settle(rig, world, eye);
        if (!rig.close) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const pip: Cell = [cell[0] + dx, cell[1], cell[2] + dz];
          if (!room.cells.some(c => c[0] === pip[0] && c[2] === pip[2])) continue;
          expect(pipHiddenFor(rig.position, rig.forward, { x: pip[0] + 0.5, y: pip[1], z: pip[2] + 0.5 }, false)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('the star room windows are Glass: the eye sees through, the camera stays inside', () => {
    expect(blocksRay(BlockId.Glass, true)).toBe(true);
    const upstairs = tower.windowCells.filter(([, y]) => y >= starRoom.y);
    expect(upstairs.length).toBe(16);
    for (const [x, y, z] of upstairs) expect(world.get(x, y, z)).toBe(BlockId.Glass);
    // Stand by each window looking into the room: the camera would sit outside, so it stays in.
    for (const cell of starRoom.cells) {
      const nearWindow = upstairs.some(([x, , z]) => Math.abs(x - cell[0]) + Math.abs(z - cell[2]) === 1);
      if (!nearWindow) continue;
      for (const yaw of YAWS) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = PITCH_MIN;
        const eye = eyeOf(cell);
        settle(rig, world, eye);
        expectCameraSane(rig, world, tower, eye, starRoom);
      }
    }
  });

  it('Magic mirror blocks placed in the tower count as glass for the camera', () => {
    const fresh = generateWorld(2026);
    const w = fresh.world;
    expect(BLOCKS[BlockId.MagicMirror].transparent).toBe(true);
    expect(blocksRay(BlockId.MagicMirror, true)).toBe(true);
    // He swaps every star-room window for Magic mirror.
    for (const [x, y, z] of fresh.tower.windowCells) if (y >= starRoom.y) w.set(x, y, z, BlockId.MagicMirror);
    for (const cell of starRoom.cells) {
      const eye = eyeOf(cell);
      for (const yaw of YAWS) for (const pitch of PITCHES) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = pitch;
        settle(rig, w, eye);
        expectCameraSane(rig, w, fresh.tower, eye, starRoom);
      }
    }
  });
});
