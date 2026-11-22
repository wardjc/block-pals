import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { cellOf, type CaveLayout } from '../../src/core/caves';
import { isStandable, type Cell } from '../../src/core/pathfind';
import type { World } from '../../src/core/world';
import { caveLook } from '../../src/render/caveLook';
import {
  CameraRig, clampDistance, CLOSE_DISTANCE, CLOSE_EXIT_DISTANCE, DEFAULT_PITCH, DRAG_RADIANS_PER_WIDTH, lookDir,
  MAX_DISTANCE, PITCH_MAX, PITCH_MIN, pipHiddenFor,
} from '../../src/render/cameraRig';
import { EYE_HEIGHT } from '../../src/render/scene';
import { blocksRay, castVoxelRay, type VoxelHit } from '../../src/render/voxelRay';
import { caveWorld } from '../helpers/caveWorld';

/**
 * The camera in caves (plan Task 20): the same sweeps as the houses (8 yaws x pitch min, default,
 * max) over the real generated world, along every trail, in every room, each treasure room, the
 * Old Hideout and the narrowest tunnel cells. Nothing here needed a change to the rig.
 */
vi.setConfig({ testTimeout: 120_000 });
const { world, caves } = caveWorld(2026);
const PITCHES = [PITCH_MIN, DEFAULT_PITCH, PITCH_MAX];
const YAWS = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
const hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };

const eyeOf = (c: Cell) => ({ x: c[0] + 0.5, y: c[1] + EYE_HEIGHT, z: c[2] + 0.5 });
const settle = (rig: CameraRig, w: World, eye: { x: number; y: number; z: number }, n = 60): void => {
  for (let i = 0; i < n; i++) rig.update(w, eye, 1 / 30);
};
const inSolid = (w: World, p: { x: number; y: number; z: number }): boolean =>
  w.inBounds(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) && blocksRay(w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));

/** The standable feet cell at or just above/below a planned cell (the floor repair may have raised it). */
function standAt(w: World, c: Cell): Cell | null {
  for (const dy of [0, 1, -1, 2, -2]) {
    const t: Cell = [c[0], c[1] + dy, c[2]];
    if (isStandable(w, t)) return t;
  }
  return null;
}

/** Every Nth trail floor cell (the trail stores the PathStone block; he stands on it). */
function trailSpots(c: CaveLayout, every: number): Cell[] {
  const out: Cell[] = [];
  let i = 0;
  for (const k of c.trail) {
    if (i++ % every !== 0) continue;
    const s = standAt(world, cellOf(world, k));
    if (s) out.push(s);
  }
  return out;
}

const roomSpots = caves.rooms.map(r => standAt(world, [r.cx, r.floorY, r.cz])).filter((c): c is Cell => c !== null);
const treasureSpots = caves.treasure.flatMap(t => [standAt(world, t.entrance), standAt(world, [t.chest[0] - t.dir[0], t.floorY, t.chest[2] - t.dir[1]])])
  .filter((c): c is Cell => c !== null);
const ruin = caves.ruin!;
const ruinSpots = [[96, ruin.floorY, 97], [ruin.rect.x0 + 2, ruin.floorY, ruin.rect.z0 + 2], [ruin.rect.x1 - 2, ruin.floorY, ruin.rect.z1 - 2]]
  .map(c => standAt(world, c as Cell)).filter((c): c is Cell => c !== null);

/** Tunnel centre-line cells with their axis, the narrowest first (least room to the sides). */
function tunnelSpots(n: number): Array<{ cell: Cell; axis: number }> {
  const all: Array<{ cell: Cell; axis: number; room: number }> = [];
  for (const t of caves.tunnels) {
    for (let i = 2; i < t.line.length - 2; i += 3) {
      const s = standAt(world, t.line[i]);
      if (!s) continue;
      const a = t.line[i - 2], b = t.line[i + 2];
      const axis = Math.atan2(b[0] - a[0], b[2] - a[2]);
      // Room to the sides: the camera's allowed distance looking across the tunnel.
      const eye = eyeOf(s);
      const side = Math.min(
        clampDistance(world, eye, lookDir(axis + Math.PI / 2, 0, { x: 0, y: 0, z: 0 }), MAX_DISTANCE),
        clampDistance(world, eye, lookDir(axis - Math.PI / 2, 0, { x: 0, y: 0, z: 0 }), MAX_DISTANCE),
      );
      all.push({ cell: s, axis, room: side });
    }
  }
  return all.sort((p, q) => p.room - q.room).slice(0, n);
}
const narrow = tunnelSpots(40);

describe('the camera in caves (seed 2026)', () => {
  it('has spots to test in every kind of place', () => {
    expect(roomSpots.length).toBeGreaterThanOrEqual(38);
    expect(treasureSpots.length).toBeGreaterThanOrEqual(6);
    expect(ruinSpots.length).toBe(3);
    expect(narrow).toHaveLength(40);
  });

  it('is never inside a solid block and always sees him, at any yaw or pitch: trails, rooms, treasure rooms, the hideout, narrow tunnels', () => {
    const spots = [...trailSpots(caves, 40), ...roomSpots, ...treasureSpots, ...ruinSpots, ...narrow.map(n => n.cell)];
    expect(spots.length).toBeGreaterThan(120);
    let checks = 0;
    for (const c of spots) {
      const eye = eyeOf(c);
      for (const yaw of YAWS) for (const pitch of PITCHES) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = pitch;
        settle(rig, world, eye, 20);
        expect(inSolid(world, rig.position), `camera in rock at ${c} yaw ${yaw} pitch ${pitch}`).toBe(false);
        // A clear line from the camera to his eye: the picture is never a wall.
        expect(castVoxelRay(world, eye.x, eye.y, eye.z, -rig.forward.x, -rig.forward.y, -rig.forward.z, rig.distance, false, hit)).toBe(false);
        checks++;
      }
    }
    console.log(`cameraCaves: ${spots.length} spots, ${checks} camera checks`);
  });

  it('close mode (first person) engages only when there is under 1.2 blocks of room, and Pip is still shown beside him', () => {
    let closeCount = 0;
    for (const c of [...roomSpots, ...narrow.map(n => n.cell), ...ruinSpots]) {
      const eye = eyeOf(c);
      for (const yaw of YAWS) for (const pitch of PITCHES) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = pitch;
        settle(rig, world, eye, 20);
        const allowed = clampDistance(world, eye, rig.forward, MAX_DISTANCE);
        if (rig.close) {
          closeCount++;
          expect(allowed).toBeLessThanOrEqual(CLOSE_EXIT_DISTANCE);
        } else {
          expect(allowed).toBeGreaterThanOrEqual(CLOSE_DISTANCE - 1e-9);
        }
      }
    }
    // Five-wide tunnels and rooms always leave room: first person never comes on there.
    expect(closeCount).toBe(0);
    // Pip a couple of blocks beside him in a tunnel, out of the middle of the view, stays drawn.
    const { cell, axis } = narrow[0];
    const rig = new CameraRig();
    rig.yaw = axis; rig.pitch = DEFAULT_PITCH;
    const eye = eyeOf(cell);
    settle(rig, world, eye);
    const side = lookDir(axis + Math.PI / 2, 0, { x: 0, y: 0, z: 0 });
    const pip = { x: eye.x + side.x * 1.6 + rig.forward.x * 3, y: cell[1] + 0.6, z: eye.z + side.z * 1.6 + rig.forward.z * 3 };
    expect(pipHiddenFor(rig.position, rig.forward, pip, false)).toBe(false);
  });

  it('in a 5 x 5 tunnel the camera stands at least 2 back along the tunnel', () => {
    let worst = Infinity;
    for (const { cell, axis } of narrow) {
      const eye = eyeOf(cell);
      let best = 0;
      for (const yaw of [axis, axis + Math.PI]) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = DEFAULT_PITCH;
        settle(rig, world, eye);
        best = Math.max(best, rig.distance);
      }
      worst = Math.min(worst, best);
      expect(best, `tunnel cell ${cell}`).toBeGreaterThanOrEqual(2);
    }
    console.log(`cameraCaves: worst distance along a narrow tunnel ${worst.toFixed(2)}`);
  });

  it('in the rooms the camera has its full reach in the open view (no hollow, cramped views)', () => {
    let full = 0;
    let worst = Infinity;
    for (const c of roomSpots) {
      const eye = eyeOf(c);
      let best = 0;
      for (const yaw of YAWS) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = PITCH_MIN;
        settle(rig, world, eye);
        best = Math.max(best, rig.distance);
      }
      worst = Math.min(worst, best);
      if (best >= MAX_DISTANCE - 1e-6) full++;
    }
    console.log(`cameraCaves: rooms with the full ${MAX_DISTANCE} reach ${full} / ${roomSpots.length}, worst best-reach ${worst.toFixed(2)}`);
    // Looking along the room (the low pitch) the camera has its whole 7 in every room.
    expect(full).toBe(roomSpots.length);
    // At the default pitch the camera never comes closer than the model-hiding distance in a room centre.
    for (const c of roomSpots) {
      const rig = new CameraRig();
      rig.pitch = DEFAULT_PITCH;
      settle(rig, world, eyeOf(c));
      expect(rig.close).toBe(false);
    }
  });

  it('never a hole to the sky colour: the cave haze and the background are the same colour, and rays from a deep room hit rock inside the haze', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) expect(caveLook(t).background).toBe(caveLook(t).fogColor);
    const look = caveLook(1);
    const aspect = 1.6;
    const tanV = Math.tan((60 * Math.PI) / 360);
    const deepRooms = caves.rooms.filter(r => r.layer === 'deep').map(r => standAt(world, [r.cx, r.floorY, r.cz])).filter((c): c is Cell => c !== null);
    let misses = 0, rays = 0;
    for (const c of deepRooms) {
      const eye = eyeOf(c);
      for (const yaw of YAWS) {
        const rig = new CameraRig();
        rig.yaw = yaw; rig.pitch = DEFAULT_PITCH;
        settle(rig, world, eye, 20);
        const f = rig.forward;
        // The view's right vector (horizontal); corners tilt up and down by the half field of view.
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const dx = f.x + rx * sx * tanV * aspect;
          const dy = f.y + sy * tanV;
          const dz = f.z + rz * sx * tanV * aspect;
          const len = Math.hypot(dx, dy, dz);
          rays++;
          if (!castVoxelRay(world, rig.position.x, rig.position.y, rig.position.z, dx / len, dy / len, dz / len, look.fogFar, false, hit)) misses++;
        }
      }
    }
    console.log(`cameraCaves: deep-room corner rays ${rays}, reaching the haze without rock ${misses}`);
    // A ray that reaches the haze end sees only haze colour, which is the background colour: never a hole.
    expect(misses).toBe(0);
  });

  it('drag-to-turn works in close mode down his own dug staircase, and the camera stays above its floor', () => {
    // A one-wide staircase dug down from the meadow near the spawn: first person comes on there.
    const w = caveWorld(2026).world;
    const x0 = 64, z0 = 72;
    const top = w.topSolidY(x0, z0);
    const cells: Cell[] = [];
    for (let i = 0; i < 8; i++) {
      const x = x0 + i, y = top - i;
      for (let k = 0; k <= 2; k++) w.set(x, y + k, z0, BlockId.Air);
      cells.push([x, y, z0]);
    }
    try {
      const c = cells[cells.length - 1];
      const eye = eyeOf(c);
      const rig = new CameraRig();
      rig.yaw = 0; rig.pitch = DEFAULT_PITCH; // looking across the one-wide stairs: the side wall is right behind his head
      settle(rig, w, eye);
      expect(rig.close).toBe(true);
      expect(rig.position.y).toBeGreaterThan(c[1]);
      const yaw0 = rig.yaw;
      rig.drag(150, 0, 1000);
      expect(Math.abs(rig.yaw - yaw0)).toBeCloseTo((150 * DRAG_RADIANS_PER_WIDTH) / 1000, 6);
      settle(rig, w, eye);
      expect(inSolid(w, rig.position)).toBe(false);
      rig.drag(0, 100000, 1000);
      expect(rig.pitch).toBe(PITCH_MAX);
      settle(rig, w, eye);
      expect(inSolid(w, rig.position)).toBe(false);
      expect(rig.position.y).toBeGreaterThan(c[1]);
      for (const s of cells) {
        for (const yaw of YAWS) for (const pitch of PITCHES) {
          const r = new CameraRig();
          r.yaw = yaw; r.pitch = pitch;
          settle(r, w, eyeOf(s), 20);
          expect(inSolid(w, r.position)).toBe(false);
          expect(r.position.y).toBeGreaterThan(s[1]);
        }
      }
    } finally {
      for (const [x, y, z] of cells) for (let k = 0; k <= 2; k++) w.set(x, y + k, z, BlockId.Stone);
    }
  });
});
