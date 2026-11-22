import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import type { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { CameraRig } from '../../src/render/cameraRig';
import {
  cameraZone, MOUTH_NEAR, radialFactor, SectionQueue, SURFACE_SECTION_Y, visibleSections, ZONE_Y_WINDOW, type CameraZone,
} from '../../src/render/chunkCull';
import { buildSectionGeometry, CHUNK_SIZE, SECTION_HEIGHT } from '../../src/render/mesher';
import { EYE_HEIGHT } from '../../src/render/scene';

const g = generateWorld(2026);
const { world, spawn, village } = g;
const S = { x: world.sizeX, y: world.sizeY, z: world.sizeZ };

function cameraAt(w: World, x: number, y: number, z: number, yaw: number, pitch: number) {
  const rig = new CameraRig();
  rig.yaw = yaw; rig.pitch = pitch;
  for (let i = 0; i < 60; i++) rig.update(w, { x, y: y + EYE_HEIGHT, z }, 1 / 30);
  return { pos: { ...rig.position }, f: { ...rig.forward } };
}

function setFor(w: World, cam: { pos: { x: number; y: number; z: number }; f: { x: number; y: number; z: number } }, keep: { x: number; z: number }, zone: CameraZone, fogEnd = 40) {
  return visibleSections(S.x, S.y, S.z, cam.pos.x, cam.pos.y, cam.pos.z, cam.f.x, cam.f.y, cam.f.z, zone, keep.x, keep.z, fogEnd);
}

/** Sections of the set that hold geometry and that a 1.6-aspect camera's frustum can see. */
export function frustumCount(w: World, set: Set<string>, cam: { pos: { x: number; y: number; z: number }; f: { x: number; y: number; z: number } }, far = 44): number {
  const c = new THREE.PerspectiveCamera(60, 1.6, 0.2, far);
  c.position.set(cam.pos.x, cam.pos.y, cam.pos.z);
  c.lookAt(cam.pos.x + cam.f.x, cam.pos.y + cam.f.y, cam.pos.z + cam.f.z);
  c.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
  let n = 0;
  for (const key of set) {
    const [cx, sy, cz] = key.split(',').map(Number);
    const box = new THREE.Box3(new THREE.Vector3(cx * 16, sy * 16, cz * 16), new THREE.Vector3(cx * 16 + 16, sy * 16 + 16, cz * 16 + 16));
    if (!fr.intersectsBox(box)) continue;
    const geo = buildSectionGeometry(w, cx, sy, cz, () => [0, 0, 1, 1]);
    if (geo.indices.length + geo.transparent.indices.length > 0) n++;
  }
  return n;
}

const deepWorld = () => generateWorld(2026);

describe('cameraZone', () => {
  it('outdoors at spawn; underground inside the rock; underground near a mouth below y 60', () => {
    const cam = cameraAt(world, spawn.x, spawn.y, spawn.z, 0.7, 0.35);
    expect(cameraZone(world, cam.pos.x, cam.pos.y, cam.pos.z, [])).toBe('outdoors');
    expect(cameraZone(world, 80.5, 22, 80.5, [])).toBe('underground');
    const mouth: [number, number, number] = [Math.floor(spawn.x) + 10, spawn.y, Math.floor(spawn.z)];
    expect(cameraZone(world, cam.pos.x, cam.pos.y, cam.pos.z, [mouth])).toBe('underground');
    expect(cameraZone(world, cam.pos.x + MOUTH_NEAR + 15, cam.pos.y, cam.pos.z, [mouth])).toBe('outdoors');
    expect(cameraZone(world, cam.pos.x, mouth[1] + 9, cam.pos.z, [mouth])).toBe('outdoors');
    expect(cameraZone(world, NaN, 22, 80, [])).toBe('outdoors');
  });
});

describe('visibleSections (the draw rule)', () => {
  it('outdoors at spawn: no section below y 48 is visible', () => {
    for (const yaw of [0, 1.5, 3, 4.5]) {
      const cam = cameraAt(world, spawn.x, spawn.y, spawn.z, yaw, 0.35);
      const set = setFor(world, cam, spawn, 'outdoors');
      expect(set.size).toBeGreaterThan(0);
      for (const key of set) expect(Number(key.split(',')[1]) * SECTION_HEIGHT).toBeGreaterThanOrEqual(SURFACE_SECTION_Y);
    }
  });

  it('in a deep cave: surface sections (y >= 48) are hidden and the layer around the camera is shown (window: the cave fog, at least 20)', () => {
    const w = deepWorld().world;
    for (let x = 70; x < 90; x++) for (let z = 70; z < 90; z++) for (let y = 3; y < 10; y++) w.set(x, y, z, BlockId.Air);
    const cam = cameraAt(w, 80.5, 3, 80.5, 0.4, 0.3);
    const zone = cameraZone(w, cam.pos.x, cam.pos.y, cam.pos.z, []);
    expect(zone).toBe('underground');
    const fogEnd = 36; // the deep cave haze
    const window = Math.max(ZONE_Y_WINDOW, fogEnd + 1.5);
    const set = setFor(w, cam, { x: 200, z: 200 }, zone, fogEnd);
    for (const key of set) {
      const sy = Number(key.split(',')[1]);
      expect(sy * SECTION_HEIGHT).toBeLessThan(SURFACE_SECTION_Y);
      expect(sy * SECTION_HEIGHT + SECTION_HEIGHT).toBeGreaterThanOrEqual(cam.pos.y - window);
    }
    expect(set.has(`5,0,5`)).toBe(true); // the room's own section
  });

  it('at a cave mouth (within 24): the shallow layer sections are visible, so looking into the tunnel never shows a hole', () => {
    const cam = cameraAt(world, spawn.x, spawn.y, spawn.z, 0, 0.35);
    const mouth: [number, number, number] = [Math.floor(spawn.x), spawn.y, Math.floor(spawn.z) + 6];
    const zone = cameraZone(world, cam.pos.x, cam.pos.y, cam.pos.z, [mouth]);
    expect(zone).toBe('underground');
    const set = setFor(world, cam, spawn, zone);
    const cx = Math.floor(mouth[0] / CHUNK_SIZE), cz = Math.floor(mouth[2] / CHUNK_SIZE);
    // The shallow caves (floors y 38..42) are in section 2; the surface is in 3.
    expect(set.has(`${cx},2,${cz}`)).toBe(true);
    expect(set.has(`${cx},3,${cz}`)).toBe(true);
  });

  it('walking down a ramp into the rock: the visible set never loses the section holding the ramp cell 6 blocks ahead', () => {
    const w = deepWorld().world;
    // A 5-wide, 5-high ramp from the meadow east of spawn down 1 block per 2 cells to y 40, then flat.
    const x0 = Math.floor(spawn.x) + 3, zc = Math.floor(spawn.z);
    const ramp: Array<[number, number, number]> = [];
    const top = w.topSolidY(x0, zc) + 1;
    for (let i = 0; i < 50; i++) {
      const floor = Math.max(40, top - Math.floor(i / 2));
      for (let dz = -2; dz <= 2; dz++) for (let y = floor; y < floor + 5; y++) w.set(x0 + i, y, zc + dz, BlockId.Air);
      for (let dz = -2; dz <= 2; dz++) w.set(x0 + i, floor - 1, zc + dz, BlockId.Stone);
      ramp.push([x0 + i, floor, zc]);
    }
    const mouth = ramp[0];
    for (let i = 0; i + 6 < ramp.length; i++) {
      const [x, y, z] = ramp[i];
      const cam = cameraAt(w, x + 0.5, y, z + 0.5, Math.PI / 2, 0.3); // facing +x, down the ramp
      const zone = cameraZone(w, cam.pos.x, cam.pos.y, cam.pos.z, [mouth]);
      const set = setFor(w, cam, { x: x + 0.5, z: z + 0.5 }, zone);
      const [ax, ay, az] = ramp[i + 6];
      const key = `${Math.floor(ax / 16)},${Math.floor(ay / 16)},${Math.floor(az / 16)}`;
      expect(set.has(key), `step ${i}: ${key} (${zone})`).toBe(true);
    }
  });

  it('fails open on NaN', () => {
    const all = 12 * 12 * 5;
    expect(visibleSections(S.x, S.y, S.z, NaN, 50, 50, 1, 0, 0, 'outdoors', 50, 50).size).toBe(all);
    expect(visibleSections(S.x, S.y, S.z, 50, 50, 50, 1, NaN, 0, 'underground', 50, 50).size).toBe(all);
    expect(visibleSections(S.x, S.y, S.z, 50, 50, 50, 1, 0, 0, 'outdoors', 50, 50, NaN).size).toBe(all);
  });

  it('keeps the column he stands in', () => {
    const set = visibleSections(S.x, S.y, S.z, 20, 60, 20, 1, 0, 0, 'outdoors', 180, 180);
    expect(set.has('11,3,11')).toBe(true);
  });

  it('visible count stays under 70 sections in every sampled camera position (outdoors and underground) at the start view of 40', () => {
    const square = village.square;
    const spots: Array<{ x: number; z: number }> = [
      { x: spawn.x, z: spawn.z }, { x: (square.x0 + square.x1) / 2, z: (square.z0 + square.z1) / 2 },
      { x: village.farmPlot.x0 + 2, z: village.farmPlot.z0 - 2 }, { x: 96, z: 96 }, { x: 10, z: 10 }, { x: 180, z: 100 },
    ];
    let worst = 0;
    for (const s of spots) for (const yaw of [0, 1.57, 3.14, 4.71]) {
      const x = Math.floor(s.x), z = Math.floor(s.z);
      const cam = cameraAt(world, x + 0.5, world.topSolidY(x, z) + 1, z + 0.5, yaw, 0.35);
      const set = setFor(world, cam, { x, z }, 'outdoors');
      worst = Math.max(worst, frustumCount(world, set, cam));
    }
    const w = deepWorld().world;
    for (let x = 60; x < 100; x++) for (let z = 60; z < 100; z++) for (let y = 20; y < 27; y++) w.set(x, y, z, BlockId.Air);
    for (const yaw of [0, 2]) {
      const cam = cameraAt(w, 80.5, 20, 80.5, yaw, 0.3);
      worst = Math.max(worst, frustumCount(w, setFor(w, cam, { x: 80, z: 80 }, 'underground'), cam));
    }
    console.log(`worst frustum-visible sections at 40: ${worst}`);
    expect(worst).toBeLessThan(70);
  });

  it('radialFactor is 1 / cos(half the diagonal view): about 1.48 at 60 degrees and 1.6 aspect', () => {
    expect(radialFactor(60, 1.6)).toBeCloseTo(1.477, 2);
    expect(radialFactor(60, 2.3)).toBeLessThan(1.8);
  });
});

describe('SectionQueue (lazy builds)', () => {
  it('builds nearest first, at most 2 per call, never builds a section twice, requeues a disposed one', () => {
    const q = new SectionQueue(2);
    q.enqueue('a', 30); q.enqueue('b', 10); q.enqueue('c', 20); q.enqueue('d', 5);
    expect(q.take()).toEqual(['d', 'b']);
    expect(q.take()).toEqual(['c', 'a']);
    expect(q.take()).toEqual([]);
    q.enqueue('b', 1); // already built: ignored
    expect(q.take()).toEqual([]);
    q.requeue('b', 3);
    expect(q.take()).toEqual(['b']);
    expect(q.isBuilt('b')).toBe(true);
  });
  it('updates priorities and drops keys that left the view', () => {
    const q = new SectionQueue(2);
    q.enqueue('a', 30); q.enqueue('b', 10);
    q.enqueue('a', 1);
    q.retain(new Set(['a']));
    expect(q.size).toBe(1);
    expect(q.take()).toEqual(['a']);
  });
});
